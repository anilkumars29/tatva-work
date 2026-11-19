import fs from 'node:fs';
import { config } from '../config.js';
import { check, checkRow, supabase, type MeetingStatus } from '../supabase.js';
import { buildChunks } from './chunk.js';
import { embed } from './embed.js';
import { extractKnowledge, type Knowledge } from './extract.js';
import { buildMarkdown, createKnowledgeDoc } from './gdoc.js';
import { recomputeTimeSaved } from './timesaved-db.js';
import { transcribe, type Segment } from './transcribe.js';

export interface MeetingJob {
  meetingId: string;
  filePath: string; // local temp copy of the audio
  mimeType: string;
  deleteFileWhenDone: boolean;
}

// ---- helpers -------------------------------------------------------------------

async function updateMeeting(id: string, patch: Record<string, unknown>) {
  check(await supabase.from('meetings').update(patch).eq('id', id), 'Update meeting');
}

async function setStatus(id: string, status: MeetingStatus, extra: Record<string, unknown> = {}) {
  console.log(`[meeting ${id.slice(0, 8)}] ${status}`);
  await updateMeeting(id, { status, ...extra });
}

async function addWarning(id: string, warning: string) {
  console.warn(`[meeting ${id.slice(0, 8)}] warning: ${warning}`);
  const meeting = checkRow(await supabase.from('meetings').select('warnings').eq('id', id).single(), 'Read warnings');
  await updateMeeting(id, { warnings: [...(meeting.warnings ?? []), warning] });
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function dateTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: config.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---- steps -----------------------------------------------------------------------

async function storeAudio(job: MeetingJob, meeting: { audio_path: string | null }) {
  if (meeting.audio_path) return; // already stored (retry)
  const audioPath = `${job.meetingId}/recording.${job.mimeType.includes('ogg') ? 'ogg' : 'webm'}`;
  const { error } = await supabase.storage
    .from(config.audioBucket)
    .upload(audioPath, await fs.promises.readFile(job.filePath), { contentType: job.mimeType, upsert: true });
  if (error) {
    // Not fatal: the extension also keeps a local copy.
    await addWarning(job.meetingId, `Audio not stored in Supabase Storage: ${error.message}`);
    return;
  }
  await updateMeeting(job.meetingId, { audio_path: audioPath });
}

async function saveKnowledge(meetingId: string, knowledge: Knowledge, segments: Segment[]) {
  // Idempotent: clear rows from a previous attempt first.
  for (const table of ['transcript_segments', 'action_items', 'discuss_later', 'knowledge_chunks']) {
    check(await supabase.from(table).delete().eq('meeting_id', meetingId), `Clear ${table}`);
  }

  if (segments.length) {
    check(
      await supabase.from('transcript_segments').insert(
        segments.map((s, position) => ({ meeting_id: meetingId, position, start_sec: s.start, end_sec: s.end, text: s.text })),
      ),
      'Insert transcript segments',
    );
  }

  if (knowledge.action_items.length) {
    check(
      await supabase.from('action_items').insert(
        knowledge.action_items.map((a, position) => ({
          meeting_id: meetingId,
          position,
          task: a.task,
          owner: a.owner,
          due_text: a.due,
          due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.due_date ?? '') ? a.due_date : null,
        })),
      ),
      'Insert action items',
    );
  }

  if (knowledge.discuss_later.length) {
    check(
      await supabase.from('discuss_later').insert(
        knowledge.discuss_later.map((d, position) => ({
          meeting_id: meetingId,
          position,
          topic: d.topic,
          people: d.people,
          suggested_time_text: d.suggested_time,
          suggested_at: d.suggested_datetime && !Number.isNaN(Date.parse(d.suggested_datetime)) ? d.suggested_datetime : null,
        })),
      ),
      'Insert discuss-later items',
    );
  }

  await updateMeeting(meetingId, {
    title: knowledge.title,
    summary: knowledge.summary,
    decisions: knowledge.decisions,
    stats_mentioned: knowledge.stats_mentioned,
    key_moments: knowledge.key_moments,
  });
}

async function indexKnowledge(meetingId: string, knowledge: Knowledge, segments: Segment[], date: Date) {
  const chunks = buildChunks(knowledge, segments, dateLabel(date));
  const vectors = await embed(chunks.map((c) => c.content));
  const rows = chunks.map((c, i) => ({
    meeting_id: meetingId,
    source_type: c.source_type,
    content: c.content,
    metadata: c.metadata,
    embedding: JSON.stringify(vectors[i]),
  }));
  for (let i = 0; i < rows.length; i += 100) {
    check(await supabase.from('knowledge_chunks').insert(rows.slice(i, i + 100)), 'Insert knowledge chunks');
  }
  return chunks.length;
}

// ---- pipeline ----------------------------------------------------------------------

export async function processMeeting(job: MeetingJob): Promise<void> {
  const { meetingId } = job;
  const startedAt = Date.now();
  try {
    const meeting = checkRow(
      await supabase.from('meetings').select('recorded_at, created_at, source_title, duration_seconds, audio_path, gdoc_url').eq('id', meetingId).single(),
      'Load meeting',
    );
    await updateMeeting(meetingId, { processing_started_at: new Date().toISOString(), error: null });

    // 1. Store audio (status stays "uploaded").
    await storeAudio(job, meeting);

    // 2. Transcribe.
    await setStatus(meetingId, 'transcribing');
    const transcript = await transcribe(job.filePath, job.mimeType);
    if (!transcript.segments.length) throw new Error('No speech detected in the recording.');
    const durationSeconds = Number(meeting.duration_seconds) || transcript.durationSeconds || transcript.segments.at(-1)!.end;
    await updateMeeting(meetingId, {
      transcript: transcript.segments.map((s) => s.text).join('\n'),
      language: transcript.language,
      duration_seconds: durationSeconds,
    });

    // 3. Extract structured knowledge.
    await setStatus(meetingId, 'extracting');
    const recordedAt = new Date(meeting.recorded_at ?? meeting.created_at);
    const knowledge = await extractKnowledge(transcript.segments, {
      recordedAt,
      recordedAtLocal: dateTimeLabel(recordedAt),
      durationMinutes: durationSeconds / 60,
      sourceTitle: meeting.source_title,
    });
    await saveKnowledge(meetingId, knowledge, transcript.segments);
    // Time saved = notes for this length + each captured item (+ actions run later).
    const timeSaved = (await recomputeTimeSaved(meetingId)) ?? { minutes: 0, breakdown: [] };

    // 4. Index for RAG + knowledge doc.
    await setStatus(meetingId, 'indexing');
    const chunkCount = await indexKnowledge(meetingId, knowledge, transcript.segments, recordedAt);
    console.log(`[meeting ${meetingId.slice(0, 8)}] indexed ${chunkCount} chunks`);

    if (!meeting.gdoc_url) {
      try {
        const doc = await createKnowledgeDoc(
          `Tatva: ${knowledge.title} (${dateLabel(recordedAt)})`,
          buildMarkdown(knowledge, transcript.segments, { dateLabel: dateTimeLabel(recordedAt), durationMinutes: durationSeconds / 60, timeSaved }),
        );
        await updateMeeting(meetingId, { gdoc_id: doc.id, gdoc_url: doc.url });
      } catch (err) {
        // Not fatal: the knowledge is already saved and searchable.
        await addWarning(meetingId, `Google Doc not created: ${errorMessage(err)}`);
      }
    }

    await setStatus(meetingId, 'ready', { processing_finished_at: new Date().toISOString() });
    console.log(`[meeting ${meetingId.slice(0, 8)}] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[meeting ${meetingId.slice(0, 8)}] failed:`, err);
    await setStatus(meetingId, 'failed', { error: errorMessage(err), processing_finished_at: new Date().toISOString() }).catch(
      (e) => console.error('Could not record failure', e),
    );
  } finally {
    if (job.deleteFileWhenDone) await fs.promises.rm(job.filePath, { force: true }).catch(() => {});
  }
}

// One meeting at a time keeps Groq rate limits and memory predictable.
let queue: Promise<void> = Promise.resolve();
export function enqueueMeeting(job: MeetingJob): void {
  queue = queue.then(() => processMeeting(job));
}
