import { config } from './config.js';

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST to Groq with retries on rate limits (429) and server errors (5xx),
 * honouring the retry-after header. `makeBody` is called per attempt because
 * FormData bodies can't be reused.
 */
export async function groqPost(path: string, makeBody: () => { body: BodyInit; json: boolean }): Promise<unknown> {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { body, json } = makeBody();
    const response = await fetch(`${GROQ_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });

    if (response.ok) return response.json();

    const text = await response.text();
    lastError = `Groq ${path} failed (${response.status}): ${text.slice(0, 500)}`;
    const retryable = response.status === 429 || response.status >= 500;
    // "Request too large" for the tier won't succeed on retry.
    if (!retryable || /request too large/i.test(text) || attempt === MAX_ATTEMPTS) break;

    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1);
    console.warn(`[groq] ${response.status} on ${path}, retrying in ${Math.round(waitMs / 1000)}s`);
    await sleep(Math.min(waitMs, 60_000));
  }
  throw new Error(lastError);
}
