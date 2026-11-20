import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { embed } from '../pipeline/embed.js';
import { deleteMeeting, MeetingBusyError } from '../pipeline/delete.js';
import { enqueueMeeting, retryMeeting } from '../pipeline/process.js';
import { checkRow, supabase } from '../supabase.js';

const uploadDir = path.join(os.tmpdir(), 'tatva-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname) || '.webm'}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(audio|video)\//.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (ok) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_COLUMNS =
  'id, created_at, updated_at, recorded_at, status, error, warnings, source_title, duration_seconds, title, summary, time_saved_minutes, gdoc_url';

export const meetingsRouter = Router();

// POST /api/meetings: multipart upload from the extension.
//   audio (file, required), title_hint, source_url, recorded_at (ISO), duration_ms
meetingsRouter.post('/meetings', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'Missing "audio" file field.' });
    return;
  }
  try {
    const recordedAt = typeof req.body.recorded_at === 'string' && !Number.isNaN(Date.parse(req.body.recorded_at))
      ? new Date(req.body.recorded_at).toISOString()
      : new Date().toISOString();
    const durationMs = Number(req.body.duration_ms);
    const mimeType = file.mimetype === 'application/octet-stream' ? 'audio/webm' : file.mimetype.split(';')[0];

    const meeting = checkRow(
      await supabase
        .from('meetings')
        .insert({
          status: 'uploaded',
          recorded_at: recordedAt,
          source_title: typeof req.body.title_hint === 'string' ? req.body.title_hint.slice(0, 300) : null,
          source_url: typeof req.body.source_url === 'string' ? req.body.source_url.slice(0, 1000) : null,
          duration_seconds: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : null,
          audio_mime: mimeType,
          audio_bytes: file.size,
        })
        .select('id, status')
        .single(),
      'Create meeting',
    );

    enqueueMeeting({ meetingId: meeting.id, filePath: file.path, mimeType, deleteFileWhenDone: true });
    res.status(202).json(meeting);
  } catch (err) {
    await fs.promises.rm(file.path, { force: true }).catch(() => {});
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/meetings: newest first.
meetingsRouter.get('/meetings', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await supabase.from('meetings').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(limit);
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.json({ meetings: result.data });
});

// GET /api/meetings/:id: full result. ?transcript=false omits the segments.
meetingsRouter.get('/meetings/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid meeting id.' });
    return;
  }
  const withTranscript = req.query.transcript !== 'false';
  const select = [
    '*',
    'action_items(id, position, task, owner, due_text, due_date, status)',
    'discuss_later(id, position, topic, people, suggested_time_text, suggested_at, status)',
    ...(withTranscript ? ['transcript_segments(position, start_sec, end_sec, text)'] : []),
  ].join(', ');
  const result = await supabase.from('meetings').select(select).eq('id', req.params.id).maybeSingle();
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  if (!result.data) {
    res.status(404).json({ error: 'Meeting not found.' });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meeting: any = result.data;
  const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;
  meeting.action_items?.sort(byPosition);
  meeting.discuss_later?.sort(byPosition);
  meeting.transcript_segments?.sort(byPosition);
  if (!withTranscript) delete meeting.transcript;
  res.json({ meeting });
});

// POST /api/meetings/:id/retry: re-run a failed meeting from the stored audio.
meetingsRouter.post('/meetings/:id/retry', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid meeting id.' });
    return;
  }
  const result = await supabase.from('meetings').select('id, status, audio_path, audio_mime, warnings').eq('id', req.params.id).maybeSingle();
  if (result.error || !result.data) {
    res.status(result.error ? 500 : 404).json({ error: result.error?.message ?? 'Meeting not found.' });
    return;
  }
  const meeting = result.data;
  if (meeting.status !== 'failed') {
    res.status(409).json({ error: `Only failed meetings can be retried (status is "${meeting.status}").` });
    return;
  }
  if (!meeting.audio_path) {
    res.status(409).json({ error: 'No stored audio for this meeting; upload the recording again.' });
    return;
  }
  try {
    await retryMeeting(meeting);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.status(202).json({ id: meeting.id, status: 'uploaded' });
});

// DELETE /api/meetings/:id: removes the meeting and everything made from it
// (tracker rows, Google Doc to trash, files, activity, chunks). Returns a report.
meetingsRouter.delete('/meetings/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid meeting id.' });
    return;
  }
  try {
    const report = await deleteMeeting(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }
    res.json({ deleted: report });
  } catch (err) {
    res.status(err instanceof MeetingBusyError ? 409 : 500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/search { query, match_count?, meeting_id? }: RAG retrieval over the knowledge base.
meetingsRouter.post('/search', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'Body must include a non-empty "query".' });
    return;
  }
  try {
    const [vector] = await embed([query]);
    const result = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: JSON.stringify(vector),
      match_count: Math.min(Number(req.body.match_count) || 8, 50),
      similarity_threshold: Number(req.body.similarity_threshold ?? 0.2),
      filter_meeting_id: typeof req.body.meeting_id === 'string' && UUID.test(req.body.meeting_id) ? req.body.meeting_id : null,
    });
    if (result.error) throw new Error(result.error.message);
    res.json({ results: result.data });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
