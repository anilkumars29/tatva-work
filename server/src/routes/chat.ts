// POST /v1/chat/completions: OpenAI-compatible endpoint that Agora
// Conversational AI calls as its custom LLM. Streams chat.completion.chunk SSE.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { voiceTurn } from '../voice/agent.js';

export const chatRouter = Router();

function authorized(req: Request): boolean {
  if (!config.voiceApiKey) return false;
  const given = Buffer.from((req.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.voiceApiKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const sessionOf = (req: Request): string =>
  (req.get('x-tatva-session') ?? (typeof req.body?.user === 'string' ? req.body.user : '') ?? '').slice(0, 120) || 'default';

chatRouter.post('/chat/completions', async (req, res) => {
  if (!config.voiceApiKey) {
    res.status(503).json({ error: { message: 'Set VOICE_LLM_API_KEY in server/.env to enable the voice endpoint.' } });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: { message: 'Invalid API key.' } });
    return;
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const sessionId = sessionOf(req);
  const stream = req.body?.stream !== false;
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = 'tatva-voice';
  const started = Date.now();

  // Agora hangs up on the request when the user interrupts; stop work then.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(chunk({ role: 'assistant', content: '' }));
  }

  let text = '';
  try {
    for await (const piece of voiceTurn(sessionId, messages, abort.signal)) {
      if (!piece) continue;
      text += piece;
      if (stream && !res.writableEnded) res.write(chunk({ content: piece }));
    }
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error('[voice] turn failed:', err);
    const sorry = /429|rate/i.test(String(err))
      ? " I'm getting a lot of requests right now. Give me a few seconds and ask again."
      : ' Sorry, something went wrong on my side. Could you say that again?';
    text += sorry;
    if (stream && !res.writableEnded) res.write(chunk({ content: sorry }));
  }
  console.log(`[voice] ${sessionId} ${Date.now() - started}ms: ${text.trim().slice(0, 200)}`);

  if (stream) {
    if (!res.writableEnded) {
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    }
  } else {
    res.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text.trim() }, finish_reason: 'stop' }],
    });
  }
});
