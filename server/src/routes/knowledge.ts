// Knowledge Base (documents + search) and Tracker (items + activity) endpoints.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { embed } from '../pipeline/embed.js';
import { DOCUMENTS_BUCKET, enqueueDocument } from '../pipeline/documents.js';
import { supabase } from '../supabase.js';
import { logActivity } from '../voice/activity.js';

export const knowledgeRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: message(err) });
    });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error('Only PDF documents are supported.'));
  },
});

const DOC_COLUMNS = 'id, created_at, updated_at, name, mime, bytes, pages, status, error, summary, chunk_count';

// ------------------------------------------------------------------ documents

knowledgeRouter.post(
  '/documents',
  upload.single('file'),
  handle(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Attach a PDF in the "file" field.' });
      return;
    }
    // multer decodes the multipart filename as latin1.
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const { data: doc, error } = await supabase.from('documents').insert({ name, bytes: file.size, mime: 'application/pdf' }).select(DOC_COLUMNS).single();
    if (error) throw new Error(error.message);
    const path = `${doc.id}/${name.replace(/[^\w.\- ]+/g, '_')}`;
    const stored = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file.buffer, { contentType: 'application/pdf', upsert: true });
    if (stored.error) {
      await supabase.from('documents').update({ status: 'failed', error: `Storage: ${stored.error.message}` }).eq('id', doc.id);
      throw new Error(`Could not store the file: ${stored.error.message}`);
    }
    await supabase.from('documents').update({ storage_path: path }).eq('id', doc.id);
    void logActivity({ sessionId: 'web', tool: 'upload_document', args: { name, bytes: file.size }, status: 'ok', result: { id: doc.id } });
    enqueueDocument(doc.id, name, new Uint8Array(file.buffer));
    res.status(202).json({ document: { ...doc, storage_path: path } });
  }),
);

knowledgeRouter.get(
  '/documents',
  handle(async (_req, res) => {
    const { data, error } = await supabase.from('documents').select(DOC_COLUMNS).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ documents: data });
  }),
);

knowledgeRouter.get(
  '/documents/:id/url',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }
    const { data, error } = await supabase.from('documents').select('name, storage_path').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.storage_path) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    const download = req.query.download === '1';
    const signed = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(data.storage_path, 600, download ? { download: data.name } : undefined);
    if (signed.error) throw new Error(signed.error.message);
    res.json({ url: signed.data.signedUrl });
  }),
);

// ------------------------------------------------------------------- search

/** Semantic search across meetings and documents for the Knowledge Base page. */
knowledgeRouter.get(
  '/knowledge/search',
  handle(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const type = req.query.type === 'meetings' || req.query.type === 'documents' ? req.query.type : 'all';
    if (!q) {
      res.status(400).json({ error: 'Add a search query (?q=).' });
      return;
    }
    const [vector] = await embed([q]);
    const { data, error } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: JSON.stringify(vector),
      match_count: 30,
      similarity_threshold: 0.25,
      filter_meeting_id: null,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { meeting_id: string | null; document_id: string | null; source_type: string; content: string; metadata: Record<string, unknown>; similarity: number }[];
    const meetingIds = [...new Set(rows.map((r) => r.meeting_id).filter(Boolean))] as string[];
    const docIds = [...new Set(rows.map((r) => r.document_id).filter(Boolean))] as string[];
    const [meetings, docs] = await Promise.all([
      meetingIds.length ? supabase.from('meetings').select('id, title, recorded_at, created_at').in('id', meetingIds) : Promise.resolve({ data: [] }),
      docIds.length ? supabase.from('documents').select('id, name').in('id', docIds) : Promise.resolve({ data: [] }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meetingById = new Map((meetings.data ?? []).map((m: any) => [m.id, m]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docById = new Map((docs.data ?? []).map((d: any) => [d.id, d]));
    const results = rows
      .map((r) => {
        const kind = r.document_id ? 'document' : 'meeting';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const owner: any = r.document_id ? docById.get(r.document_id) : meetingById.get(r.meeting_id ?? '');
        const body = r.content.replace(/^(Meeting|Document): [^\n]*\n/, '');
        return {
          kind,
          id: r.document_id ?? r.meeting_id,
          title: owner ? (kind === 'document' ? owner.name : (owner.title ?? 'Untitled meeting')) : 'Unknown source',
          date: owner?.recorded_at ?? owner?.created_at ?? null,
          source_type: r.source_type,
          page: typeof r.metadata?.page === 'number' ? r.metadata.page : null,
          content: body.length > 320 ? `${body.slice(0, 320)}…` : body,
          similarity: Math.round(r.similarity * 100) / 100,
        };
      })
      .filter((r) => type === 'all' || (type === 'meetings' ? r.kind === 'meeting' : r.kind === 'document'));
    void logActivity({ sessionId: 'web', tool: 'search_knowledge', args: { query: q, type }, status: 'ok', result: results.slice(0, 10).map((r) => ({ title: r.title, similarity: r.similarity })) });
    res.json({ query: q, results });
  }),
);

// ------------------------------------------------------------------ tracker

knowledgeRouter.get(
  '/tracker',
  handle(async (_req, res) => {
    const { data, error } = await supabase
      .from('action_items')
      .select('id, task, owner, due_text, due_date, status, kind, context, source, created_at, updated_at, meeting_id, meetings(title, recorded_at, created_at)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    res.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (data ?? []).map((a: any) => ({
        id: a.id,
        task: a.task,
        owner: a.owner,
        due_text: a.due_text,
        due_date: a.due_date,
        status: a.status,
        kind: a.kind,
        context: a.context,
        source: a.source,
        created_at: a.created_at,
        updated_at: a.updated_at,
        meeting_id: a.meeting_id,
        meeting: a.meetings?.title ?? null,
        meeting_date: a.meetings?.recorded_at ?? a.meetings?.created_at ?? null,
      })),
    });
  }),
);

/** Actions executed across connected tools (excludes read-only lookups). */
knowledgeRouter.get(
  '/activity',
  handle(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const { data, error } = await supabase
      .from('activity_log')
      .select('id, created_at, session_id, tool, args, status, result, error, duration_ms')
      .in('tool', ['send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row', 'log_issue', 'create_google_doc', 'mark_complete', 'reopen_item', 'upload_document'])
      .in('status', ['confirmed', 'error', 'cancelled', 'ok'])
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    res.json({ activity: data });
  }),
);
