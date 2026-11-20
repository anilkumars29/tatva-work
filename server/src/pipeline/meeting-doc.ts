// A meeting's Google Doc, rebuilt from the database: used to create the doc
// from the web app, and to refresh it when attachments are added or removed
// (the doc gets an "Attachments" section with a one-line summary per file).
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { localYmd } from './dates.js';
import { buildMarkdown, updateKnowledgeDoc, type DocAttachment } from './gdoc.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MeetingRecord = any;

export async function meetingDocMarkdown(meetingId: string): Promise<{ meeting: MeetingRecord; markdown: string; title: string } | null> {
  const [{ data: m, error }, attachments] = await Promise.all([
    supabase
      .from('meetings')
      .select(
        '*, action_items(position, task, owner, due_text, due_date), discuss_later(position, topic, people, suggested_time_text, suggested_at), transcript_segments(position, start_sec, end_sec, text)',
      )
      .eq('id', meetingId)
      .maybeSingle(),
    supabase.from('meeting_attachments').select('name, kind, label, pages, summary').eq('meeting_id', meetingId).eq('status', 'ready').order('created_at'),
  ]);
  if (error) throw new Error(error.message);
  if (!m) return null;
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position;
  const recorded = new Date(m.recorded_at ?? m.created_at);
  const markdown = buildMarkdown(
    {
      title: m.title ?? 'Meeting',
      summary: m.summary ?? '',
      decisions: m.decisions ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      action_items: (m.action_items ?? []).sort(byPos).map((a: any) => ({ task: a.task, owner: a.owner, due: a.due_text, due_date: a.due_date })),
      stats_mentioned: m.stats_mentioned ?? [],
      key_moments: m.key_moments ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      discuss_later: (m.discuss_later ?? []).sort(byPos).map((d: any) => ({
        topic: d.topic,
        people: d.people ?? [],
        suggested_time: d.suggested_time_text,
        suggested_at: d.suggested_at,
      })),
    } as unknown as Parameters<typeof buildMarkdown>[0],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.transcript_segments ?? []).sort(byPos).map((s: any) => ({ start: Number(s.start_sec), end: Number(s.end_sec), text: s.text })),
    {
      dateLabel: new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, dateStyle: 'medium' }).format(recorded),
      durationMinutes: Number(m.duration_seconds ?? 0) / 60,
      timeSaved: { minutes: m.time_saved_minutes ?? 0, breakdown: m.time_saved_breakdown ?? [] },
      attachments: (attachments.data ?? []) as DocAttachment[],
    },
  );
  return { meeting: m, markdown, title: `Tatva: ${m.title ?? 'Meeting'} (${localYmd(recorded)})` };
}

/** Rewrites the meeting's Google Doc (if it has one) from the current data. */
export async function syncMeetingDoc(meetingId: string): Promise<'updated' | 'no-doc'> {
  const built = await meetingDocMarkdown(meetingId);
  if (!built?.meeting.gdoc_id) return 'no-doc';
  await updateKnowledgeDoc(built.meeting.gdoc_id, built.markdown);
  return 'updated';
}

// Several files dropped at once -> one doc update a few seconds after the last.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleDocSync(meetingId: string, delayMs = 4000) {
  clearTimeout(timers.get(meetingId));
  timers.set(
    meetingId,
    setTimeout(() => {
      timers.delete(meetingId);
      syncMeetingDoc(meetingId)
        .then((r) => r === 'updated' && console.log(`[gdoc] attachments synced to the doc of meeting ${meetingId}`))
        .catch((err) => console.warn(`[gdoc] could not update the doc of meeting ${meetingId}:`, err instanceof Error ? err.message : err));
    }, delayMs),
  );
}
