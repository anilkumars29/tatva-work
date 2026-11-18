import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { warmUpEmbeddings } from './pipeline/embed.js';
import { meetingsRouter } from './routes/meetings.js';
import { supabase } from './supabase.js';

const app = express();

// The extension calls with host_permissions (no CORS needed); this allows the
// local web app and extension pages too.
app.use(
  cors({
    origin: (origin, cb) =>
      cb(null, !origin || /^chrome-extension:\/\//.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)),
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', meetingsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
  console.error('[http]', err);
  res.status(status).json({ error: err.message || 'Internal error' });
};
app.use(errorHandler);

// Meetings left mid-pipeline by a previous run can't resume (the temp audio
// file is gone); mark them failed so they can be retried.
async function failInterruptedMeetings() {
  const { data, error } = await supabase
    .from('meetings')
    .update({ status: 'failed', error: 'Server restarted while processing. Use POST /api/meetings/:id/retry.' })
    .in('status', ['uploaded', 'transcribing', 'extracting', 'indexing'])
    .select('id');
  if (error) {
    console.error(`[startup] Could not reach the meetings table: ${error.message}`);
    console.error('[startup] Did you run server/supabase/migrations/001_init.sql in the Supabase SQL editor?');
    return;
  }
  if (data.length) console.warn(`[startup] Marked ${data.length} interrupted meeting(s) as failed.`);
}

app.listen(config.port, () => {
  console.log(`Tatva Work server on http://localhost:${config.port}`);
  failInterruptedMeetings();
  warmUpEmbeddings()
    .then(() => console.log('[startup] Embedding model ready'))
    .catch((err) => console.error('[startup] Embedding model failed to load:', err));
});
