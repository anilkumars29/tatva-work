// Meeting attachments: PDFs and images (PNG/JPG/WebP) added on a meeting page
// by upload, drag and drop or paste. Files live in the private "attachments"
// bucket; text goes through src/pipeline/attachments.ts into the knowledge base.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { enqueueAttachment, IMAGE_MIMES } from '../pipeline/attachments.js';
import { scheduleDocSync } from '../pipeline/meeting-doc.js';
import { supabase } from '../supabase.js';
import { logActivity } from '../voice/activity.js';

export const attachmentsRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PREVIEW_TTL_SECONDS = 3600;
const COLUMNS = 'id, created_at, updated_at, meeting_id, name, mime, kind, bytes, pages, label, status, error, summary, chunk_count, storage_path';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: message(err) });
    });

class UploadError extends Error {
  status = 415;
}

/** Kind from the declared type, falling back to the extension. */
function kindOf(mime: string, name: string): { kind: 'pdf' | 'image'; mime: string } | null {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return { kind: 'pdf', mime: 'application/pdf' };
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) return { kind: 'image', mime };
  const ext = name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  if (ext) return { kind: 'image', mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (kindOf(file.mimetype, file.originalname)) cb(null, true);
    else cb(new UploadError('Only PDFs and PNG, JPG or WebP images can be attached.'));
  },
});

type Row = Record<string, unknown> & { id: string; kind: string; storage_path: string | null; name: string };

/** Adds a short-lived preview URL for images (thumbnails) and drops the storage path. */
async function withPreview(rows: Row[]) {
  const images = rows.filter((r) => r.kind === 'image' && r.storage_path);
  const signed = images.length
    ? await supabase.storage.from(config.attachmentsBucket).createSignedUrls(
        images.map((r) => r.storage_path as string),
        PREVIEW_TTL_SECONDS,
      )
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map(({ storage_path, ...rest }) => ({ ...rest, preview_url: storage_path ? (urlByPath.get(storage_path) ?? null) : null }));
}

attachmentsRouter.get(
  '/meetings/:id/attachments',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid meeting id.' });
      return;
    }
    const { data, error } = await supabase.from('meeting_attachments').select(COLUMNS).eq('meeting_id', id).order('created_at');
    if (error) throw new Error(error.message);
    res.json({ attachments: await withPreview((data ?? []) as Row[]) });
  }),
);

attachmentsRouter.post(
  '/meetings/:id/attachments',
  upload.single('file'),
  handle(async (req, res) => {
    const meetingId = String(req.params.id);
    const file = req.file;
    if (!UUID.test(meetingId)) {
      res.status(400).json({ error: 'Invalid meeting id.' });
      return;
    }
    if (!file) {
      res.status(400).json({ error: 'Attach a PDF or image in the "file" field.' });
      return;
    }
    // multer decodes the multipart filename as latin1.
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200) || 'attachment';
    const type = kindOf(file.mimetype, name)!;
    if (type.kind === 'image' && file.size > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: `Images can be up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` });
      return;
    }
    const { data: meeting } = await supabase.from('meetings').select('id, title').eq('id', meetingId).maybeSingle();
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }
    const { data: row, error } = await supabase
      .from('meeting_attachments')
      .insert({ meeting_id: meetingId, name, mime: type.mime, kind: type.kind, bytes: file.size })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(/relation .*meeting_attachments|does not exist/i.test(error.message) ? 'The meeting_attachments table is missing: run server/supabase/migrations/004_meeting_attachments.sql.' : error.message);
    const path = `${meetingId}/${row.id}/${name.replace(/[^\w.\- ]+/g, '_')}`;
    const stored = await supabase.storage.from(config.attachmentsBucket).upload(path, file.buffer, { contentType: type.mime, upsert: true });
    if (stored.error) {
      await supabase.from('meeting_attachments').update({ status: 'failed', error: `Storage: ${stored.error.message}` }).eq('id', row.id);
      throw new Error(`Could not store the file: ${stored.error.message}`);
    }
    await supabase.from('meeting_attachments').update({ storage_path: path }).eq('id', row.id);
    void logActivity({ sessionId: 'web', tool: 'upload_attachment', args: { meeting_id: meetingId, name, kind: type.kind, bytes: file.size }, status: 'ok', result: { id: row.id } });
    enqueueAttachment(row.id);
    const [shown] = await withPreview([{ ...row, storage_path: path } as Row]);
    res.status(202).json({ attachment: shown });
  }),
);

/** All attachments, newest first, with their meeting (Knowledge Base). */
attachmentsRouter.get(
  '/attachments',
  handle(async (_req, res) => {
    const { data, error } = await supabase
      .from('meeting_attachments')
      .select(`${COLUMNS}, meetings(title, recorded_at, created_at)`)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => {
      const { meetings: m, ...rest } = r as unknown as Row & { meetings?: { title?: string | null; recorded_at?: string | null; created_at?: string } | null };
      return { ...rest, meeting_title: m?.title ?? 'Untitled meeting', meeting_date: m?.recorded_at ?? m?.created_at ?? null } as Row;
    });
    res.json({ attachments: await withPreview(rows) });
  }),
);

/** One attachment with the text Tatva extracted (Preview dialog). */
attachmentsRouter.get(
  '/attachments/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid attachment id.' });
      return;
    }
    const { data, error } = await supabase.from('meeting_attachments').select(`${COLUMNS}, text_content`).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    const [shown] = await withPreview([data as unknown as Row]);
    const text = typeof data.text_content === 'string' ? data.text_content : null;
    res.json({ attachment: { ...shown, text_content: text && text.length > 20_000 ? `${text.slice(0, 20_000)}…` : text } });
  }),
);

attachmentsRouter.get(
  '/attachments/:id/url',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid attachment id.' });
      return;
    }
    const { data, error } = await supabase.from('meeting_attachments').select('name, storage_path').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.storage_path) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    const download = req.query.download === '1';
    const signed = await supabase.storage.from(config.attachmentsBucket).createSignedUrl(data.storage_path, 600, download ? { download: data.name } : undefined);
    if (signed.error) throw new Error(signed.error.message);
    res.json({ url: signed.data.signedUrl });
  }),
);

attachmentsRouter.post(
  '/attachments/:id/retry',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid attachment id.' });
      return;
    }
    const { data, error } = await supabase.from('meeting_attachments').update({ status: 'processing', error: null }).eq('id', id).eq('status', 'failed').select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(409).json({ error: 'Only failed attachments can be retried.' });
      return;
    }
    enqueueAttachment(id);
    res.status(202).json({ ok: true });
  }),
);

attachmentsRouter.delete(
  '/attachments/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid attachment id.' });
      return;
    }
    const { data: row, error } = await supabase.from('meeting_attachments').select('meeting_id, name, storage_path, status').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    if (row.storage_path) {
      const removed = await supabase.storage.from(config.attachmentsBucket).remove([row.storage_path]);
      if (removed.error) throw new Error(`Could not delete the file: ${removed.error.message}`);
    }
    // Its knowledge chunks go with it (on delete cascade).
    const del = await supabase.from('meeting_attachments').delete().eq('id', id);
    if (del.error) throw new Error(del.error.message);
    void logActivity({ sessionId: 'web', tool: 'delete_attachment', args: { meeting_id: row.meeting_id, name: row.name }, status: 'ok' });
    if (row.status === 'ready') scheduleDocSync(row.meeting_id, 1000);
    res.json({ ok: true });
  }),
);
