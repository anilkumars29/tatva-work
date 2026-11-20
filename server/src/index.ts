import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { allowedOrigin, apiAuth, SERVER_KEY } from './auth.js';
import { config } from './config.js';
import { warmUpEmbeddings } from './pipeline/embed.js';
import { resumeAttachments } from './pipeline/attachments.js';
import { queuedJobs } from './pipeline/jobs.js';
import { watchInterruptedMeetings } from './pipeline/process.js';
import { canFreeMemory, rssMb } from './memory.js';
import { appRouter } from './routes/app.js';
import { attachmentsRouter } from './routes/attachments.js';
import { chatRouter } from './routes/chat.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { meetingsRouter } from './routes/meetings.js';

const app = express();

app.set('trust proxy', 1); // behind Render's proxy

// CORS: localhost, the Chrome extension, and the deployed web app (WEB_ORIGINS).
app.use(cors({ origin: (origin, cb) => cb(null, allowedOrigin(origin)) }));
app.use(express.json({ limit: '1mb' }));

// Memory and queue length are here so an uptime monitor (or a test) can watch them.
app.get('/health', (_req, res) => {
  res.json({ ok: true, rss_mb: rssMb(), heap_mb: Math.round(process.memoryUsage().heapUsed / 1048576), gc: canFreeMemory(), jobs: queuedJobs(), commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
});

// Every /api route needs the web app's key, the access code (extension) or an upload token.
app.use('/api', apiAuth);
app.use('/api', meetingsRouter);
app.use('/api', appRouter);
app.use('/api', knowledgeRouter);
app.use('/api', attachmentsRouter);
app.use('/v1', chatRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : typeof err?.status === 'number' ? err.status : 500;
  console.error('[http]', err);
  res.status(status).json({ error: err.message || 'Internal error' });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Tatva server on http://localhost:${config.port}`);
  if (!SERVER_KEY) console.warn('[startup] TATVA_SERVER_KEY is not set: /api is open to localhost (development mode).');
  if (!config.voiceApiKey) console.warn('[startup] VOICE_LLM_API_KEY is not set: the voice endpoint /v1/chat/completions is disabled.');
  watchInterruptedMeetings();
  resumeAttachments().catch(() => {});
  warmUpEmbeddings()
    .then(() => console.log('[startup] Embedding model ready'))
    .catch((err) => console.error('[startup] Embedding model failed to load:', err));
});
