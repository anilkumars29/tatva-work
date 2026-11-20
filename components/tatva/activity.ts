// Turns activity_log rows into readable steps (Talk to Tatva timeline, Tracker activity log).
import { eventDateTime, plural } from '@/lib/tatva';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const ACTION_VERB: Record<string, string> = {
  send_email: 'Send email via Gmail',
  post_to_slack: 'Post to Slack',
  create_calendar_event: 'Create Google Calendar event',
  add_tracker_row: 'Add to Tatva Tracker',
  log_issue: 'Log issue and escalate on Slack',
};
export const ACTION_KINDS = Object.keys(ACTION_VERB);

export interface Activity {
  id: number;
  created_at: string;
  session_id: string | null;
  tool: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error' | 'pending' | 'confirmed' | 'cancelled';
  result: unknown;
  error: string | null;
}
/** One activity_log row -> a timeline step. */
export function describe(a: Activity): { title: string; detail: string; icon: string; tone: 'done' | 'error' | 'muted' } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = a.result ?? {};
  const args = a.args ?? {};
  if (a.status === 'error') return { title: `Failed: ${ACTION_VERB[a.tool] ?? a.tool.replace(/_/g, ' ')}`, detail: a.error ?? 'Unknown error', icon: 'error', tone: 'error' };
  if (a.status === 'cancelled') return { title: `Cancelled: ${ACTION_VERB[a.tool] ?? a.tool}`, detail: 'Nothing was sent', icon: 'block', tone: 'muted' };
  if (a.status === 'pending') return { title: `Drafted: ${ACTION_VERB[a.tool] ?? a.tool}`, detail: str(r.summary).replace(/\s*(Should|Shall) I [^?]*\?$/, ''), icon: 'edit_note', tone: 'muted' };
  switch (a.tool) {
    case 'search_knowledge': {
      const n = Array.isArray(r) ? r.length : 0;
      return { title: 'Searched the knowledge base', detail: `"${str(args.query)}" · ${plural(n, 'match', 'matches')}`, icon: 'manage_search', tone: 'done' };
    }
    case 'list_recent_meetings':
      return { title: `Listed ${plural(Array.isArray(r) ? r.length : 0, 'recent meeting')}`, detail: 'From Supabase', icon: 'calendar_today', tone: 'done' };
    case 'get_meeting_details':
      return r.title
        ? { title: `Found: ${r.title}`, detail: `${plural(r.decisions?.length ?? 0, 'decision')} & ${plural(r.action_items?.length ?? 0, 'action item')}`, icon: 'check', tone: 'done' }
        : { title: 'Looked up a meeting', detail: str(r.error) || str(args.meeting), icon: 'search_off', tone: 'muted' };
    case 'get_open_items':
      return { title: 'Checked open items', detail: `${plural(r.action_items?.length ?? 0, 'action item')} · ${plural(r.discuss_later?.length ?? 0, 'parked topic')}`, icon: 'checklist', tone: 'done' };
    case 'brief_me':
      return { title: 'Prepared a briefing', detail: r.next_meeting?.title ? `${r.next_meeting.title} · ${r.next_meeting.when}` : str(r.topic) || str(r.note), icon: 'auto_awesome', tone: 'done' };
    case 'cancel_pending_action':
      return { title: 'Cancelled the pending action', detail: str(r.cancelled) || str(r.note), icon: 'block', tone: 'muted' };
    case 'send_email':
      return { title: `Sent email to ${str(args.to_name) || str(args.to)}`, detail: str(args.subject), icon: 'mail', tone: 'done' };
    case 'post_to_slack':
      return { title: `Posted in ${str(args.channel)}`, detail: 'Slack', icon: 'tag', tone: 'done' };
    case 'create_calendar_event':
      return { title: `Created event: ${str(args.title)}`, detail: args.start ? eventDateTime(str(args.start)) : 'Google Calendar', icon: 'event', tone: 'done' };
    case 'add_tracker_row':
      return { title: `Added ${plural(Array.isArray(args.rows) ? args.rows.length : 1, 'row')} to the tracker`, detail: 'Google Sheets · Tatva Tracker', icon: 'table_rows', tone: 'done' };
    case 'log_issue':
      return { title: `Logged issue: ${str(args.title)}`, detail: args.owner ? `Escalated to ${str(args.owner)} on Slack` : 'Posted on Slack', icon: 'report', tone: 'done' };
    case 'create_google_doc':
      return { title: 'Created the meeting Google Doc', detail: 'Google Docs', icon: 'description', tone: 'done' };
    case 'mark_complete':
      return { title: `Marked complete: ${str(args.task)}`, detail: 'Supabase + Tatva Tracker sheet', icon: 'task_alt', tone: 'done' };
    case 'reopen_item':
      return { title: `Reopened: ${str(args.task)}`, detail: 'Supabase + Tatva Tracker sheet', icon: 'undo', tone: 'done' };
    case 'upload_document':
      return { title: `Uploaded ${str(args.name)}`, detail: 'Added to the knowledge base', icon: 'upload_file', tone: 'done' };
    case 'upload_attachment':
      return { title: `Attached ${str(args.name) || 'a file'}`, detail: 'Added to the meeting and indexed for Pooja', icon: 'attach_file', tone: 'done' };
    case 'delete_attachment':
      return { title: `Removed ${str(args.name) || 'an attachment'}`, detail: 'Deleted from the meeting and the knowledge base', icon: 'delete', tone: 'muted' };
    case 'open_google_doc':
      return { title: 'Opened the meeting Google Doc', detail: 'Google Docs', icon: 'description', tone: 'done' };
    default: {
      // Unknown tool: "do_the_thing" -> "Do the thing".
      const words = a.tool.replace(/_/g, ' ');
      return { title: words.charAt(0).toUpperCase() + words.slice(1), detail: '', icon: 'bolt', tone: 'done' };
    }
  }
}

