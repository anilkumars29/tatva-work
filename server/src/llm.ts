// Groq chat calls with a model fallback chain.
//
// Groq's free tier limits each MODEL separately (per minute: 8k tokens, 30
// requests; per day: 200k tokens, 1k requests). So when one model is out of
// tokens, another usually isn't. On a 429:
//   - per-day limit (TPD/RPD)  -> switch to the next model immediately
//   - per-minute limit (TPM/RPM) -> wait briefly (<= 20 s) and retry, else switch
// A model that hit a limit is skipped until its retry time passes; the voice
// agent reads the same state, so neither path wastes a call on a model that
// is known to be out.
import { config } from './config.js';
import { parseRetryAfter, rateLimitKind } from './llm-limits.js';

export { parseRetryAfter, rateLimitKind };

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_MINUTE_WAIT_MS = 20_000;
/** When every model is limited, wait for the first one to free up if it's this soon. */
const MAX_ALL_BUSY_WAIT_MS = 4 * 60_000;

interface ModelState {
  /** Skip the model until this time (ms). */
  until: number;
  limit: 'day' | 'minute' | null;
  lastError: string | null;
  tokens: number;
  requests: number;
  rateLimited: number;
  /** From the last 429 for a daily limit: "Limit 200000, Used 197243". */
  dailyUsed: number | null;
  dailyLimit: number | null;
  /** From the last successful response's headers. */
  minuteTokensLeft: number | null;
  dayRequestsLeft: number | null;
}

const since = Date.now();
const states = new Map<string, ModelState>();
const state = (model: string): ModelState => {
  let s = states.get(model);
  if (!s) {
    s = { until: 0, limit: null, lastError: null, tokens: 0, requests: 0, rateLimited: 0, dailyUsed: null, dailyLimit: null, minuteTokensLeft: null, dayRequestsLeft: null };
    states.set(model, s);
  }
  return s;
};

export const isAvailable = (model: string) => state(model).until <= Date.now();

/** Milliseconds until the first of `models` is available again (0 if one is now). */
export const msUntilAvailable = (models: string[]) => Math.max(0, Math.min(...models.map((m) => state(m).until)) - Date.now());

/** Records a 429 for a model; returns how long it is out and which limit it hit. */
export function markRateLimited(model: string, body: string, retryAfterHeader: string | null): { kind: 'day' | 'minute'; waitMs: number } {
  const kind = rateLimitKind(body);
  const waitMs = parseRetryAfter(retryAfterHeader, body) ?? (kind === 'day' ? 10 * 60_000 : 5_000);
  const s = state(model);
  s.rateLimited++;
  s.limit = kind;
  s.lastError = body.slice(0, 300);
  // A daily limit frees up slowly (rolling window): keep the model out for at
  // least a minute even when Groq says "try again in 30s" for a small request.
  s.until = Date.now() + (kind === 'day' ? Math.max(waitMs, 60_000) : waitMs);
  const used = body.match(/Limit (\d+), Used (\d+)/);
  if (kind === 'day' && used) {
    s.dailyLimit = Number(used[1]);
    s.dailyUsed = Number(used[2]);
  }
  return { kind, waitMs };
}

export function recordSuccess(model: string, usage: { total_tokens?: number } | undefined, headers?: Headers) {
  const s = state(model);
  s.requests++;
  s.tokens += usage?.total_tokens ?? 0;
  if (s.dailyUsed !== null) s.dailyUsed += usage?.total_tokens ?? 0;
  s.limit = null;
  const left = Number(headers?.get('x-ratelimit-remaining-tokens'));
  const reqLeft = Number(headers?.get('x-ratelimit-remaining-requests'));
  if (Number.isFinite(left)) s.minuteTokensLeft = left;
  if (Number.isFinite(reqLeft)) s.dayRequestsLeft = reqLeft;
}

/** Per-model state for /health and the status API. */
export function llmStatus() {
  return Object.fromEntries(
    [...states.entries()].map(([model, s]) => [
      model,
      {
        available: s.until <= Date.now(),
        out_for_s: Math.max(0, Math.round((s.until - Date.now()) / 1000)),
        last_limit: s.limit,
        tokens_since_start: s.tokens,
        requests_since_start: s.requests,
        rate_limited: s.rateLimited,
        daily_tokens_used: s.dailyUsed,
        daily_token_limit: s.dailyLimit,
        minute_tokens_left: s.minuteTokensLeft,
        day_requests_left: s.dayRequestsLeft,
      },
    ]),
  );
}
export const llmStatsSince = () => new Date(since).toISOString();

export class AllModelsBusyError extends Error {
  constructor(
    readonly models: string[],
    readonly retryInMs: number,
  ) {
    super(`AI service busy: every model (${models.join(', ')}) hit its Groq rate limit. Try again in about ${Math.max(1, Math.ceil(retryInMs / 60_000))} min.`);
  }
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FallbackHooks {
  /** Called when a model is skipped for a rate limit (to tell the user). */
  onSwitch?: (from: string, to: string | null, kind: 'day' | 'minute') => void;
  /** Called before waiting for a busy model. */
  onWait?: (ms: number) => void;
}

/**
 * Chat completion over a model chain. `body(model)` builds the request for
 * each model (reasoning options differ). Throws LlmRequestError for a request
 * the API rejects (4xx other than 429), AllModelsBusyError when every model
 * stays limited.
 */
export async function chatWithFallback<T = unknown>(models: string[], body: (model: string) => Record<string, unknown>, hooks: FallbackHooks = {}): Promise<{ data: T; model: string }> {
  for (let pass = 0; pass < 3; pass++) {
    for (const [i, model] of models.entries()) {
      if (!isAvailable(model)) continue;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, ...body(model) }),
        }).catch((err) => err as Error);
        if (response instanceof Error) {
          if (attempt === 3) break;
          await sleep(1000 * attempt);
          continue;
        }
        if (response.ok) {
          const data = (await response.json()) as T & { usage?: { total_tokens?: number } };
          recordSuccess(model, data.usage, response.headers);
          return { data, model };
        }
        const text = await response.text();
        if (response.status === 429) {
          const { kind, waitMs } = markRateLimited(model, text, response.headers.get('retry-after'));
          if (kind === 'minute' && waitMs <= MAX_MINUTE_WAIT_MS && attempt < 3) {
            console.warn(`[llm] ${model} per-minute limit, waiting ${Math.round(waitMs / 1000)}s`);
            hooks.onWait?.(waitMs);
            await sleep(waitMs + 250);
            state(model).until = 0;
            continue;
          }
          const next = models.slice(i + 1).find(isAvailable) ?? null;
          console.warn(`[llm] ${model} ${kind === 'day' ? 'daily' : 'per-minute'} limit reached, switching to ${next ?? '(none left)'}`);
          hooks.onSwitch?.(model, next, kind);
          break;
        }
        if (response.status >= 500 && attempt < 3) {
          await sleep(2000 * attempt);
          continue;
        }
        if (response.status >= 500) break; // try the next model
        throw new LlmRequestError(`Groq ${response.status} on ${model}: ${text.slice(0, 500)}`, response.status, text);
      }
    }
    // Every model is limited: wait for the first one to free up, if that's soon.
    const soonest = Math.min(...models.map((m) => state(m).until)) - Date.now();
    if (soonest > MAX_ALL_BUSY_WAIT_MS || pass === 2) throw new AllModelsBusyError(models, Math.max(soonest, 0));
    if (soonest > 0) {
      console.warn(`[llm] all models limited, waiting ${Math.round(soonest / 1000)}s`);
      hooks.onWait?.(soonest);
      await sleep(soonest + 500);
    }
  }
  throw new AllModelsBusyError(models, 60_000);
}

/** gpt-oss models take a reasoning effort; other models don't. */
export const reasoningFor = (model: string, effort: string) => (model.startsWith('openai/gpt-oss') ? { reasoning_effort: effort } : {});
