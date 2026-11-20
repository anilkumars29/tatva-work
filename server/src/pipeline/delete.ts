// Deleting a meeting completely: everything Tatva made from it, inside and
// outside the database.
//   - tracker sheet rows for the meeting (Google Sheets, via Composio)
//   - its Google Doc, moved to the Drive trash (recoverable for 30 days)
//   - the recording and attachment files in Supabase Storage
//   - activity log and pending action rows that refer to it
//   - the meeting row; the database cascades to transcript segments, action
//     items, follow-ups, attachments and knowledge chunks (pgvector)
// Outside steps that fail are reported, not fatal: the meeting still goes.
import { config } from '../config.js';
import { executeTool } from '../composio.js';
import { supabase } from '../supabase.js';
import { deleteTrackerRows } from '../voice/actions.js';
import { recentMeetings } from '../voice/data.js';

export interface DeleteReport {
  id: string;
  title: string | null;
  tracker_rows_deleted: number;
  google_doc: 'trashed' | 'none' | 'failed';
  files_removed: number;
  activity_rows_deleted: number;
  pending_actions_deleted: number;
  db: { transcript_segments: number; action_items: number; discuss_later: number; knowledge_chunks: number; attachments: number };
  warnings: string[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function count(table: string, meetingId: string): Promise<number> {
  const { count: n } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('meeting_id', meetingId);
  return n ?? 0;
}

export class MeetingBusyError extends Error {}

const PROCESSING = ['uploaded', 'transcribing', 'extracting', 'indexing'];

export async function deleteMeeting(id: string): Promise<DeleteReport | null> {
  const { data: meeting, error } = await supabase.from('meetings').select('id, title, status, audio_path, gdoc_id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!meeting) return null;
  if (PROCESSING.includes(meeting.status)) throw new MeetingBusyError('This meeting is being processed right now. Delete it once it is Ready or Failed.');

  const warnings: string[] = [];
  const report: DeleteReport = {
    id,
    title: meeting.title,
    tracker_rows_deleted: 0,
    google_doc: meeting.gdoc_id ? 'failed' : 'none',
    files_removed: 0,
    activity_rows_deleted: 0,
    pending_actions_deleted: 0,
    db: { transcript_segments: 0, action_items: 0, discuss_later: 0, knowledge_chunks: 0, attachments: 0 },
    warnings,
  };

  // Another meeting with the same title shares its tracker rows and activity labels: keep those.
  const { data: sameTitle } = meeting.title
    ? await supabase.from('meetings').select('id').eq('title', meeting.title).neq('id', id).limit(1)
    : { data: [] };
  const titleIsUnique = !!meeting.title && !(sameTitle ?? []).length;

  // 1. Tracker sheet rows.
  if (titleIsUnique) {
    try {
      report.tracker_rows_deleted = await deleteTrackerRows(meeting.title!);
    } catch (err) {
      warnings.push(`Tracker sheet rows not removed: ${message(err).slice(0, 200)}`);
    }
  } else if (meeting.title) warnings.push('Tracker rows kept: another meeting has the same title.');

  // 2. Google Doc to the Drive trash.
  if (meeting.gdoc_id) {
    try {
      await executeTool('googledrive', 'GOOGLEDRIVE_TRASH_FILE', { file_id: meeting.gdoc_id });
      report.google_doc = 'trashed';
    } catch (err) {
      warnings.push(`Google Doc not moved to trash: ${message(err).slice(0, 200)}`);
    }
  }

  // 3. Files: the recording and every attachment.
  const { data: attachments } = await supabase.from('meeting_attachments').select('storage_path').eq('meeting_id', id);
  const attachmentPaths = (attachments ?? []).map((a) => a.storage_path).filter((p): p is string => !!p);
  if (meeting.audio_path) {
    const { data, error: e } = await supabase.storage.from(config.audioBucket).remove([meeting.audio_path]);
    if (e) warnings.push(`Recording not removed: ${e.message}`);
    else report.files_removed += data?.length ?? 0;
  }
  if (attachmentPaths.length) {
    const { data, error: e } = await supabase.storage.from(config.attachmentsBucket).remove(attachmentPaths);
    if (e) warnings.push(`Attachment files not removed: ${e.message}`);
    else report.files_removed += data?.length ?? 0;
  }

  // 4. Activity log + pending actions that point at the meeting.
  const byId = await supabase.from('activity_log').delete({ count: 'exact' }).eq('args->>meeting_id', id);
  report.activity_rows_deleted += byId.count ?? 0;
  if (titleIsUnique) {
    const byTitle = await supabase.from('activity_log').delete({ count: 'exact' }).eq('args->>meeting', meeting.title!);
    report.activity_rows_deleted += byTitle.count ?? 0;
  }
  const pending = await supabase.from('pending_actions').delete({ count: 'exact' }).eq('args->>meeting_id', id);
  report.pending_actions_deleted = pending.count ?? 0;

  // 5. The meeting row; the database cascades to everything stored under it.
  const [segments, items, later, chunks, files] = await Promise.all(
    ['transcript_segments', 'action_items', 'discuss_later', 'knowledge_chunks', 'meeting_attachments'].map((t) => count(t, id)),
  );
  report.db = { transcript_segments: segments, action_items: items, discuss_later: later, knowledge_chunks: chunks, attachments: files };
  const del = await supabase.from('meetings').delete().eq('id', id);
  if (del.error) throw new Error(`Could not delete the meeting: ${del.error.message}`);
  const left = await Promise.all(['transcript_segments', 'action_items', 'discuss_later', 'knowledge_chunks', 'meeting_attachments'].map((t) => count(t, id)));
  if (left.some((n) => n > 0)) warnings.push(`Some rows were not removed by the database cascade: ${left.join('/')}`);

  recentMeetings.reset();
  console.log(`[delete] ${id.slice(0, 8)} "${meeting.title}" ${JSON.stringify({ ...report, warnings: warnings.length })}`);
  return report;
}
