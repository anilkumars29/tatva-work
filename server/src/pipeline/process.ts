import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { AllModelsBusyError } from '../llm.js';
import { specialistForStep } from '../specialists.js';
import { freeMemory, rssMb } from '../memory.js';
import { check, checkRow, supabase, type MeetingStatus } from '../supabase.js';
import { buildChunks } from './chunk.js';
import { embed } from './embed.js';
import { extractKnowledge, type Knowledge } from './extract.js';
import { buildMarkdown, createKnowledgeDoc } from './gdoc.js';
import { runJob } from './jobs.js';
import { recomputeTimeSaved } from './timesaved-db.js';
import { transcribe, type Segment } from './transcribe.js';
import { logActivity } from '../voice/activity.js';

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
  freeMemory(); // drop the previous step's buffers before the next one starts
  const who = specialistForStep(status);
  console.log(`[meeting ${id.slice(0, 8)}] ${status}${who ? ` -> [${who.name}]` : ''} (rss ${rssMb()} MB)`);
  // While processing, `error` holds a short progress note ("AI service busy…"); a new step clears it.
  await updateMeeting(id, { status, ...(status === 'failed' ? {} : { error: null }), ...extra });
}

/** What the user sees for a failure: plain words, not an API's JSON. */
export function friendlyError(err: unknown): string {
  if (err instanceof AllModelsBusyError) {
    const minutes = Math.max(1, Math.ceil(err.retryInMs / 60_000));
    return `AI service busy: every AI model hit its usage limit. Press Retry in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  const message = errorMessage(err);
  if (/\b429\b|rate limit/i.test(message)) return 'AI service busy (usage limit reached). Press Retry in a few minutes.';
  if (/groq|\b5\d\d\b|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message)) return 'The AI service had a problem processing this meeting. Press Retry.';
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
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
    .upload(audioPath, await fs.openAsBlob(job.filePath, { type: job.mimeType }), { contentType: job.mimeType, upsert: true });
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
    const sttStarted = Date.now();
    const transcript = await transcribe(job.filePath, job.mimeType);
    // Which speech-to-text did the work (Finch, or Whisper as the fallback), for the activity log.
    void logActivity({
      sessionId: 'pipeline',
      tool: 'transcribe',
      args: { meeting_id: meetingId, provider: transcript.provider, keywords: transcript.keywords, ...(transcript.fallbackReason ? { fallback_reason: transcript.fallbackReason.slice(0, 300) } : {}) },
      status: 'ok',
      result: { segments: transcript.segments.length, language: transcript.language, duration_seconds: transcript.durationSeconds },
      durationMs: Date.now() - sttStarted,
    });
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
    const note = (error: string) => void updateMeeting(meetingId, { error }).catch(() => {});
    const knowledge = await extractKnowledge(
      transcript.segments,
      {
        recordedAt,
        recordedAtLocal: dateTimeLabel(recordedAt),
        durationMinutes: durationSeconds / 60,
        sourceTitle: meeting.source_title,
      },
      {
        hooks: {
          onSwitch: (_from, to) => note(to ? 'AI service busy, retrying with another model' : 'AI service busy, waiting for a model to free up'),
          onWait: () => note('AI service busy, retrying in a moment'),
        },
      },
    );
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

    // A successful run clears the "resumed after a restart" markers.
    const done = checkRow(await supabase.from('meetings').select('warnings').eq('id', meetingId).single(), 'Read warnings');
    await setStatus(meetingId, 'ready', {
      processing_finished_at: new Date().toISOString(),
      warnings: (done.warnings ?? []).filter((w: string) => !w.startsWith(RESUMED)),
    });
    console.log(`[meeting ${meetingId.slice(0, 8)}] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[meeting ${meetingId.slice(0, 8)}] failed:`, err);
    await addWarning(meetingId, `Failure detail: ${errorMessage(err).slice(0, 600)}`).catch(() => {});
    await setStatus(meetingId, 'failed', { error: friendlyError(err), processing_finished_at: new Date().toISOString() }).catch(
      (e) => console.error('Could not record failure', e),
    );
  } finally {
    if (job.deleteFileWhenDone) await fs.promises.rm(job.filePath, { force: true }).catch(() => {});
  }
}

// Meetings this process has queued or is processing. A heartbeat keeps their
// updated_at fresh so another instance (Render starts the new one before it
// stops the old one during a deploy) doesn't pick them up as abandoned.
const active = new Set<string>();
const HEARTBEAT_MS = 20_000;
setInterval(() => {
  if (!active.size) return;
  // Only rows still processing, so it never clears a failure's error message.
  // Touch updated_at only: `error` may hold a progress note.
  supabase.from('meetings').update({ updated_at: new Date().toISOString() }).in('id', [...active]).in('status', [...PROCESSING_STATUSES]).then(({ error }) => {
    if (error) console.warn(`[meetings] heartbeat failed: ${error.message}`);
  });
}, HEARTBEAT_MS).unref();

// One job at a time across the server (see jobs.ts).
export function enqueueMeeting(job: MeetingJob): void {
  active.add(job.meetingId);
  runJob(`meeting ${job.meetingId.slice(0, 8)}`, () => processMeeting(job).finally(() => active.delete(job.meetingId)));
}

// ---- retry and resume ------------------------------------------------------------------

export const PROCESSING_STATUSES = ['uploaded', 'transcribing', 'extracting', 'indexing'] as const;
const RESUMED = 'Resumed after a server restart';
/** A meeting that keeps taking the server down stops resuming itself after this many tries. */
const MAX_RESUMES = 2;
const workDir = path.join(os.tmpdir(), 'tatva-uploads');

interface StoredMeeting {
  id: string;
  audio_path: string | null;
  audio_mime: string | null;
  warnings?: string[] | null;
}

/** Downloads the stored recording and queues the meeting again from the start (each step is idempotent). */
export async function requeueFromStorage(meeting: StoredMeeting, patch: Record<string, unknown> = {}): Promise<void> {
  if (!meeting.audio_path) throw new Error('No stored audio for this meeting; upload the recording again.');
  const download = await supabase.storage.from(config.audioBucket).download(meeting.audio_path);
  if (download.error) throw new Error(`Could not fetch stored audio: ${download.error.message}`);
  await fs.promises.mkdir(workDir, { recursive: true });
  const filePath = path.join(workDir, `${meeting.id}-retry${path.extname(meeting.audio_path)}`);
  await fs.promises.writeFile(filePath, Buffer.from(await download.data.arrayBuffer()));
  await updateMeeting(meeting.id, { status: 'uploaded', error: null, processing_finished_at: null, ...patch });
  enqueueMeeting({ meetingId: meeting.id, filePath, mimeType: meeting.audio_mime ?? 'audio/webm', deleteFileWhenDone: true });
}

/** Manual retry of a failed meeting: fresh resume budget. */
export async function retryMeeting(meeting: StoredMeeting): Promise<void> {
  await requeueFromStorage(meeting, { warnings: (meeting.warnings ?? []).filter((w) => !w.startsWith(RESUMED)) });
}

/** No heartbeat for this long = the instance processing it is gone. */
const ABANDONED_AFTER_MS = 75_000;

/**
 * Meetings an earlier run left mid-pipeline (a restart, a deploy or running out
 * of memory) are processed again from their stored audio. Runs on startup and
 * every minute, and only takes meetings whose heartbeat has stopped, so during
 * a zero-downtime deploy the old instance finishes what it started. A meeting
 * that was interrupted MAX_RESUMES times is marked failed instead, so one bad
 * recording can't keep restarting the server.
 */
export async function resumeInterruptedMeetings(): Promise<void> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, audio_path, audio_mime, warnings')
    .in('status', [...PROCESSING_STATUSES])
    .lt('updated_at', new Date(Date.now() - ABANDONED_AFTER_MS).toISOString())
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`[startup] Could not reach the meetings table: ${error.message}`);
    console.error('[startup] Did you run server/supabase/migrations/001_init.sql in the Supabase SQL editor?');
    return;
  }
  for (const meeting of data ?? []) {
    if (active.has(meeting.id)) continue;
    const short = meeting.id.slice(0, 8);
    const warnings: string[] = meeting.warnings ?? [];
    const resumes = warnings.filter((w) => w.startsWith(RESUMED)).length;
    // Claim it atomically: only one instance's update matches a stale row
    // (the update itself refreshes updated_at), so two servers never both resume it.
    const claim = await supabase
      .from('meetings')
      .update({ warnings: [...warnings, `${RESUMED} (${new Date().toISOString()})`] })
      .eq('id', meeting.id)
      .in('status', [...PROCESSING_STATUSES])
      .lt('updated_at', new Date(Date.now() - ABANDONED_AFTER_MS).toISOString())
      .select('id, audio_path, audio_mime, warnings');
    if (claim.error || !claim.data?.length) continue;
    try {
      if (!meeting.audio_path) {
        await setStatus(meeting.id, 'failed', { error: 'The server restarted before the recording was saved. Upload it again from the extension.' });
      } else if (resumes >= MAX_RESUMES) {
        await setStatus(meeting.id, 'failed', { error: `Processing was interrupted ${resumes + 1} times by server restarts. Press Retry to try again.` });
      } else {
        console.warn(`[meetings] resuming interrupted meeting ${short} (attempt ${resumes + 2})`);
        await requeueFromStorage(claim.data[0]);
      }
    } catch (err) {
      await setStatus(meeting.id, 'failed', { error: `Could not resume after a restart: ${errorMessage(err)}. Press Retry.` }).catch(() => {});
    }
  }
}

/** Checks for abandoned meetings now and then every minute. */
export function watchInterruptedMeetings(): void {
  const sweep = () => resumeInterruptedMeetings().catch((err) => console.error('[meetings] resume check failed:', err));
  void sweep();
  setInterval(sweep, 60_000).unref();
}
