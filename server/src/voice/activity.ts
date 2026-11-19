import { supabase } from '../supabase.js';

export type ActivityStatus = 'ok' | 'error' | 'pending' | 'confirmed' | 'cancelled';

let warned = false;

/** Writes one row to activity_log. Never throws: logging must not break a voice turn. */
export async function logActivity(entry: {
  sessionId: string;
  tool: string;
  args: unknown;
  status: ActivityStatus;
  result?: unknown;
  error?: string;
  durationMs?: number;
}): Promise<void> {
  const { error } = await supabase.from('activity_log').insert({
    session_id: entry.sessionId,
    tool: entry.tool,
    args: entry.args ?? {},
    status: entry.status,
    result: entry.result === undefined ? null : truncateJson(entry.result),
    error: entry.error ?? null,
    duration_ms: entry.durationMs ?? null,
  });
  if (error && !warned) {
    warned = true;
    console.warn(`[activity] Could not write activity_log (${error.message}). Run supabase/migrations/002_voice_agent.sql.`);
  }
}

function truncateJson(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text.length > 8000 ? { truncated: text.slice(0, 8000) } : value;
}
