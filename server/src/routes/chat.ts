// POST /v1/chat/completions: OpenAI-compatible endpoint that Agora
// Conversational AI calls as its custom LLM. Streams chat.completion.chunk SSE.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { voiceTurn } from '../voice/agent.js';
import { loadScope } from '../voice/data.js';
import { parseScopeHeader } from '../voice/scope.js';

export const chatRouter = Router();
/** Typed chat from the web app (mounted under /api, so it needs the server key). */
export const textChatRouter = Router();

const sorryFor = (err: unknown) =>
  /429|rate|busy/i.test(String(err))
    ? " I'm getting a lot of requests right now. Give me a few seconds and ask again."
    : ' Sorry, something went wrong on my side. Could you say that again?';

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
  // Scope travels with the session (X-Tatva-Scope: meeting:<id>, set by the web app's
  // invite-agent) and is enforced in every tool and action, not only in the prompt.
  const scope = await loadScope(parseScopeHeader(req.get('x-tatva-scope'))).catch(() => ({ kind: 'all' as const }));
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
    for await (const piece of voiceTurn(sessionId, messages, abort.signal, scope)) {
      if (!piece) continue;
      text += piece;
      if (stream && !res.writableEnded) res.write(chunk({ content: piece }));
    }
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error('[Pooja] turn failed:', err);
    const sorry = sorryFor(err);
    text += sorry;
    if (stream && !res.writableEnded) res.write(chunk({ content: sorry }));
  }
  console.log(`[Pooja] ${sessionId}${scope.kind === 'meeting' ? ` [${scope.title}]` : ''} ${Date.now() - started}ms: ${text.trim().slice(0, 200)}`);

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

// POST /api/chat/text { session, messages, meeting_id? } -> { reply }
// The same Pooja turn as voice (prompt, tools, scope, guardrails, yes-before-acting),
// without Agora: the browser keeps the history and sends it each turn.
textChatRouter.post('/chat/text', async (req, res) => {
  const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m: unknown): m is { role: string; content: string } => !!m && typeof m === 'object' && ['user', 'assistant'].includes((m as { role?: string }).role ?? '') && typeof (m as { content?: unknown }).content === 'string')
    .slice(-20)
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    res.status(400).json({ error: 'Send at least one user message.' });
    return;
  }
  const given = typeof req.body?.session === 'string' ? req.body.session.replace(/[^\w-]/g, '').slice(0, 80) : '';
  const sessionId = given.startsWith('chat-') ? given : `chat-${given || 'default'}`;
  const meetingId = typeof req.body?.meeting_id === 'string' ? parseScopeHeader(`meeting:${req.body.meeting_id}`) : null;
  const scope = await loadScope(meetingId).catch(() => ({ kind: 'all' as const }));
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  const started = Date.now();
  let text = '';
  try {
    for await (const piece of voiceTurn(sessionId, messages, abort.signal, scope)) if (piece) text += piece;
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error('[Pooja] text turn failed:', err);
    text += sorryFor(err);
  }
  console.log(`[Pooja] ${sessionId} (text)${scope.kind === 'meeting' ? ` [${scope.title}]` : ''} ${Date.now() - started}ms: ${text.trim().slice(0, 200)}`);
  res.json({ reply: text.trim(), session: sessionId, ms: Date.now() - started });
});
