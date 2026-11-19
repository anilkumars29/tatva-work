// Recomputes a meeting's time saved from the database: its length, captured
// items, and every action Tatva ran for it (activity_log rows whose args carry
// the meeting_id). Called after processing and after each linked action.
import { supabase } from '../supabase.js';
import { MINUTES, estimateTimeSaved, type Breakdown } from './timesaved.js';

const ACTION_TOOLS = Object.keys(MINUTES).filter((k) => !/^notes|actionItem|followUpTopic/.test(k));

export async function recomputeTimeSaved(meetingId: string): Promise<{ minutes: number; breakdown: Breakdown[] } | null> {
  const [meeting, items, topics, actions] = await Promise.all([
    supabase.from('meetings').select('duration_seconds').eq('id', meetingId).maybeSingle(),
    supabase.from('action_items').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId).eq('kind', 'task'),
    supabase.from('discuss_later').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId),
    supabase.from('activity_log').select('tool, args').eq('status', 'confirmed').in('tool', ACTION_TOOLS).eq('args->>meeting_id', meetingId),
  ]);
  if (meeting.error || !meeting.data) return null;
  const result = estimateTimeSaved({
    durationSeconds: meeting.data.duration_seconds,
    actionItems: items.count ?? 0,
    followUpTopics: topics.count ?? 0,
    actions: (actions.data ?? []) as { tool: string; args: Record<string, unknown> }[],
  });
  await supabase.from('meetings').update({ time_saved_minutes: result.minutes, time_saved_breakdown: result.breakdown }).eq('id', meetingId);
  return result;
}
