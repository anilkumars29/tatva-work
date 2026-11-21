import { Composio } from '@composio/core';
import { config } from './config.js';

// Same approach as hack-kit: one Composio client, a session per user scoped to
// the toolkits we need. Reads COMPOSIO_API_KEY from the environment.
const composio = new Composio({ apiKey: config.composioApiKey });

type Session = Awaited<ReturnType<typeof composio.create>>;
const sessions = new Map<string, Promise<Session>>();

function getSession(toolkit: string): Promise<Session> {
  let session = sessions.get(toolkit);
  if (!session) {
    session = composio.create(config.composioUserId, { toolkits: [toolkit], manageConnections: true });
    session.catch(() => sessions.delete(toolkit));
    sessions.set(toolkit, session);
  }
  return session;
}

export async function isToolkitConnected(toolkit: string): Promise<boolean> {
  const session = await getSession(toolkit);
  const item = (await session.toolkits({ toolkits: [toolkit] })).items[0];
  return item?.connection?.isActive === true;
}

const RETRY_DELAYS_MS = [3000, 8000];
const isQuotaError = (message: string) => /quota exceeded|rate.?limit|too many requests|\b429\b|userRateLimitExceeded/i.test(message);

/**
 * Runs a Composio tool and returns its `data`, throwing on failure. Google
 * per-minute quota and rate-limit errors are retried twice with a backoff.
 */
export async function executeTool(toolkit: string, slug: string, args: Record<string, unknown>): Promise<unknown> {
  const session = await getSession(toolkit);
  for (let attempt = 0; ; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await session.execute(slug, args);
    if (result?.successful !== false && !result?.error) return result?.data ?? result;
    const message = `${slug} failed: ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}`;
    if (attempt >= RETRY_DELAYS_MS.length || !isQuotaError(message)) throw new Error(message);
    console.warn(`[Executor] ${slug} hit a quota/rate limit, retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

/** Finds the first value for any of `keys` anywhere in a nested object. */
export function findDeep(value: unknown, keys: string[], depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 6) return undefined;
  for (const key of keys) {
    const found = (value as Record<string, unknown>)[key];
    if (typeof found === 'string' && found) return found;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findDeep(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}
