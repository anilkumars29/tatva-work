// One voice turn: context (RAG + memory + pending action) -> Groq with tools ->
// spoken text, yielded piece by piece so the route can stream it to Agora.
import { config } from '../config.js';
import { localYmd } from '../pipeline/dates.js';
import { cancelPending, executePending, getPending, isActionKind, proposeAction, UserFacingError, type PendingAction } from './actions.js';
import { logActivity } from './activity.js';
import { allContacts, dateTimeLabel, dayLabel, recentMeetings, searchKnowledge } from './data.js';
import { confirmationIntent, dropRepeat, speakable } from './speech.js';
import { runReadTool, TOOLS } from './tools.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_ROUNDS = 4;
const HISTORY_MESSAGES = 10;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// ------------------------------------------------------------ session memory
// Agora only replays user/assistant text, so tool results would be lost
// between turns. Keep the last few facts per session ("the meeting we just
// discussed") so follow-ups like "email that to Priya" resolve.
const memory = new Map<string, { facts: string[]; at: number }>();

function remember(sessionId: string, fact: string) {
  const entry = memory.get(sessionId) ?? { facts: [], at: 0 };
  entry.facts = [...entry.facts.filter((f) => f !== fact), fact].slice(-4);
  entry.at = Date.now();
  memory.set(sessionId, entry);
  for (const [key, value] of memory) if (Date.now() - value.at > 2 * 3600_000) memory.delete(key);
}
const recall = (sessionId: string) => memory.get(sessionId)?.facts ?? [];

// -------------------------------------------------------------- the prompt

function nextMonday(): string {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short' }).format(now);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const ahead = (1 - idx + 7) % 7 || 7;
  return localYmd(new Date(now.getTime() + ahead * 86_400_000));
}

async function systemPrompt(sessionId: string, userText: string, pending: PendingAction | null): Promise<string> {
  const wordCount = userText.split(/\s+/).filter(Boolean).length;
  const [meetings, contacts, hits] = await Promise.all([
    recentMeetings().catch(() => []),
    allContacts().catch(() => []),
    wordCount >= 3 ? searchKnowledge(userText, { count: 4, threshold: 0.3 }).catch(() => []) : Promise.resolve([]),
  ]);
  const now = new Date();
  const lines = [
    `You are Pooja, the voice assistant of Tatva Work, a meeting assistant. You speak with the user in a live voice call (Indian English).`,
    ``,
    `How to speak: one to three short sentences. Plain spoken English only: no markdown, lists, bullet points, emojis, URLs or IDs. Say numbers and dates naturally. Ask at most one question.`,
    ``,
    `What you know: answer from the knowledge base (recorded meetings and uploaded company documents) and tools, never invent meetings, people, decisions or numbers. If the context below does not answer the question, call a tool (get_meeting_details, search_knowledge, get_open_items). If it is still unknown, say you don't have that in your notes.`,
    `"Brief me" or "prepare me for my next meeting" means call brief_me, then give the gist in a few sentences. "What's pending" or "what's still open" without a named meeting means get_open_items with no arguments.`,
    ``,
    `Actions: to email, post to Slack, create a calendar event, add to the tracker or log an issue (a bug, blocker or escalation: use log_issue), call that tool directly with your best arguments. Prefer passing the meeting so its content is included automatically. Only add calendar attendees the user explicitly names. Write no text in the same message as an action tool call. Do not ask for confirmation yourself and never say an action is done: the system reads the action back to the user and runs it only after they say yes. If a tool returns an error, briefly say what's missing and ask for it.`,
    `Dates: now is ${dateTimeLabel(now.toISOString())} (${localYmd(now)}), time zone ${config.timeZone}. "Next week" with no day means Monday ${nextMonday()} at 11:00. A day with no time means 11:00. Meetings default to 30 minutes.`,
    ``,
    `Recent meetings, newest first: ${meetings.slice(0, 6).map((m) => `${m.title} (${dayLabel(m.recorded_at ?? m.created_at)})`).join('; ') || 'none yet'}.`,
    `Contacts: ${contacts.map((c) => c.name).join(', ') || 'none'}.`,
  ];
  const facts = recall(sessionId);
  if (facts.length) lines.push(``, `Earlier in this call: ${facts.join(' | ')}`);
  if (hits.length) lines.push(``, `Knowledge base matches for the user's last message:`, ...hits.map((h) => `- [${h.meeting}, ${h.source_type}] ${h.content}`));
  if (pending)
    lines.push(
      ``,
      `Waiting for the user's confirmation: ${pending.summary} If they want changes, call the same action tool again with the changes. If they decline, call cancel_pending_action.`,
    );
  return lines.join('\n');
}

// ------------------------------------------------------------------- Groq

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join(' ');
  return '';
}

const MODELS = [config.voiceModel, ...(process.env.VOICE_LLM_FALLBACK_MODELS ?? 'openai/gpt-oss-20b').split(',').map((s) => s.trim())].filter(
  (m, i, all) => m && all.indexOf(m) === i,
);

/**
 * One Groq completion (streamed, assembled here). Tries each model in turn on
 * rate limits; if all are limited, returns how long to wait instead.
 */
async function groqRound(messages: ChatMessage[], signal: AbortSignal): Promise<ChatMessage | { retryAfterMs: number }> {
  let response: Response | null = null;
  let lastError = '';
  let retryAfterMs = Infinity;
  for (const model of MODELS) {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        stream: true,
        temperature: 0.3,
        max_completion_tokens: config.voiceMaxTokens,
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: config.voiceReasoningEffort, include_reasoning: false } : {}),
      }),
    });
    if (response.ok) break;
    const body = await response.text();
    lastError = `${model} ${response.status}: ${body.slice(0, 300)}`;
    console.warn(`[voice] Groq ${lastError}`);
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || Number(body.match(/try again in ([\d.]+)s/)?.[1]) || 5;
      retryAfterMs = Math.min(retryAfterMs, seconds * 1000);
    } else if (response.status < 500) break;
    response = null;
  }
  if (!response && Number.isFinite(retryAfterMs)) return { retryAfterMs };
  if (!response?.ok || !response.body) throw new Error(`Groq failed: ${lastError}`);

  let content = '';
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunk: any = JSON.parse(payload);
      if (chunk.error) throw new Error(`Groq stream error: ${JSON.stringify(chunk.error).slice(0, 300)}`);
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.function.name += tc.function.name;
        if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
      }
    }
  }
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

// --------------------------------------------------------------- the turn

export async function* voiceTurn(sessionId: string, incoming: Array<{ role: string; content: unknown }>, signal: AbortSignal): AsyncGenerator<string> {
  const history: ChatMessage[] = incoming
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: textOf(m.content).slice(0, 800) }))
    .filter((m) => m.content)
    .slice(-HISTORY_MESSAGES);
  const userText = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

  let pending: PendingAction | null = null;
  try {
    pending = await getPending(sessionId);
  } catch (err) {
    console.warn('[voice] pending lookup failed:', err instanceof Error ? err.message : err);
  }

  // Confirm step: a pending action runs only on a clear spoken "yes".
  if (pending) {
    const intent = confirmationIntent(userText);
    if (intent === 'yes') {
      yield* runConfirmed(sessionId, pending);
      return;
    }
    if (intent === 'no') {
      await cancelPending(sessionId);
      yield "Okay, I've cancelled that. Anything else?";
      return;
    }
  }

  const messages: ChatMessage[] = [{ role: 'system', content: await systemPrompt(sessionId, userText, pending) }, ...history];
  let waited = false;
  let regenerated = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let reply: Awaited<ReturnType<typeof groqRound>>;
    try {
      reply = await groqRound(messages, signal);
    } catch (err) {
      // Groq rejects tool calls that break the schema (e.g. a null argument); one retry usually fixes it.
      if (regenerated || !/tool_use_failed/.test(String(err))) throw err;
      regenerated = true;
      round--;
      continue;
    }
    if ('retryAfterMs' in reply) {
      // Free-tier tokens-per-minute limit: wait once (briefly) rather than fail.
      if (waited || reply.retryAfterMs > 12_000) throw new Error('Groq rate limit (429)');
      waited = true;
      yield 'One moment. ';
      await new Promise((r) => setTimeout(r, reply.retryAfterMs + 250));
      round--;
      continue;
    }
    // Text in a round that also calls tools is a preamble ("let me check",
    // or the model asking for confirmation itself); the server speaks instead.
    if (!reply.tool_calls?.length) {
      yield speakable(dropRepeat(reply.content ?? ''));
      return;
    }
    messages.push(reply);

    let proposal: string | null = null;
    for (const call of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Arguments were not valid JSON.' }) });
        continue;
      }
      const name = call.function.name;
      console.log(`[voice] tool ${name} ${JSON.stringify(args)}`);
      if (isActionKind(name)) {
        try {
          const created = await proposeAction(sessionId, name, args);
          proposal = created.summary;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'awaiting confirmation' }) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void logActivity({ sessionId, tool: name, args, status: 'error', error: message });
          const userFacing = err instanceof UserFacingError;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: userFacing ? message : `Internal error: ${message}. Apologise and offer to try again.` }),
          });
        }
      } else {
        const result = await runReadTool(sessionId, name, args);
        const text = JSON.stringify(result);
        if (name === 'get_meeting_details' && !(result as { error?: string }).error) {
          const r = result as { title: string; date: string };
          remember(sessionId, `discussed meeting "${r.title}" (${r.date})`);
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: text.length > 3500 ? `${text.slice(0, 3500)}…` : text });
      }
    }
    // Read-back: the server, not the model, says exactly what will happen.
    if (proposal) {
      yield ` ${proposal}`;
      return;
    }
  }
  yield 'Sorry, that took me too many steps. Could you ask that a little more simply?';
}

async function* runConfirmed(sessionId: string, pending: PendingAction): AsyncGenerator<string> {
  // Speak something if the action is slow, so the call doesn't go silent.
  const outcome = executePending(sessionId, pending);
  const quick = await Promise.race([outcome, new Promise<null>((r) => setTimeout(() => r(null), 1200))]);
  if (!quick) yield 'Okay, one moment. ';
  const result = quick ?? (await outcome);
  remember(sessionId, result.fact);
  yield result.say;
}
