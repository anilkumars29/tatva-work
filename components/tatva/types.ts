// Shapes returned by the Tatva server's /api endpoints (see server/src/routes).

export type MeetingStatus = 'uploaded' | 'transcribing' | 'extracting' | 'indexing' | 'ready' | 'failed';

export interface MeetingRow {
  id: string;
  title: string;
  status: MeetingStatus;
  error: string | null;
  recorded_at: string;
  duration_seconds: number | null;
  time_saved_minutes: number | null;
  action_count: number;
}

export interface PendingItem {
  id: string;
  task: string;
  owner: string | null;
  owner_contact: { name: string; slack_handle: string | null } | null;
  due_text: string | null;
  due_date: string | null;
  kind: 'task' | 'issue';
  meeting_id: string | null;
  meeting: string | null;
}

export interface DashboardData {
  stats: {
    meetings_recorded: number;
    meetings_this_week: number;
    open_action_items: number;
    due_this_week: number;
    overdue: number;
    actions_by_tatva_this_week: number;
    actions_by_tool: Record<string, number>;
    time_saved_this_week_minutes: number;
    time_saved_total_minutes: number;
    week_start: string;
  };
  meetings: MeetingRow[];
  pending: PendingItem[];
}

export interface CalendarEvent {
  title: string;
  when: string;
  start: string;
  attendees: string[];
  created_by_tatva: boolean;
  link: string | null;
  meet_link: string | null;
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  slack_handle: string | null;
  role: string | null;
  aliases: string[];
  created_at: string;
}

export interface MeetingDetail {
  id: string;
  title: string | null;
  source_title: string | null;
  status: MeetingStatus;
  error: string | null;
  recorded_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  audio_path: string | null;
  summary: string | null;
  decisions: { decision: string; context?: string | null }[];
  stats_mentioned: { value: string; context: string; timestamp_sec?: number | null }[];
  key_moments: { timestamp_sec: number; note: string }[];
  time_saved_minutes: number | null;
  time_saved_breakdown: { task: string; minutes: number }[];
  gdoc_url: string | null;
  action_items: { id: string; position: number; task: string; owner: string | null; due_text: string | null; due_date: string | null; status: 'open' | 'done' }[];
  discuss_later: { id: string; position: number; topic: string; people: string[]; suggested_time_text: string | null; suggested_at: string | null; status: 'open' | 'scheduled' | 'done' }[];
  transcript_segments: { position: number; start_sec: number; end_sec: number; text: string }[];
}

export const PROCESSING: MeetingStatus[] = ['uploaded', 'transcribing', 'extracting', 'indexing'];

export const TOOL_LABELS: Record<string, string> = {
  send_email: 'Gmail',
  post_to_slack: 'Slack',
  create_calendar_event: 'Calendar',
  add_tracker_row: 'Sheets',
  log_issue: 'Issues',
  create_google_doc: 'Docs',
};
