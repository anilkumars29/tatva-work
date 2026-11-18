import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Server-only client with the secret key (bypasses RLS). Never ship this key
// to the extension or the browser.
export const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const MEETING_STATUSES = ['uploaded', 'transcribing', 'extracting', 'indexing', 'ready', 'failed'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Throws a readable error if a Supabase call failed. */
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

/** Like `check`, for queries that must return a row (`.single()`). */
export function checkRow<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R['data']> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${what}: not found`);
  return result.data as NonNullable<R['data']>;
}
