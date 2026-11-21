// Pooja and the specialists she orchestrates, for labels in the UI.
// Mirrors server/src/specialists.ts (GET /tatva/specialists serves the full registry).

export interface TeamMember {
  name: string;
  icon: string;
  role: string;
  when: string;
}

export const POOJA: TeamMember = { name: 'Pooja', icon: 'graphic_eq', role: 'The voice agent you talk to. She orchestrates the team and asks before acting.', when: 'Live' };

export const SPECIALISTS: TeamMember[] = [
  { name: 'Scribe', icon: 'hearing', role: 'Listens: turns the recording into a timestamped transcript', when: 'After a meeting' },
  { name: 'Analyst', icon: 'insights', role: 'Extracts decisions, owners, due dates, numbers and follow-ups', when: 'After a meeting' },
  { name: 'Lens', icon: 'visibility', role: 'Reads slides, screenshots and PDFs, including charts', when: 'When a file is shared' },
  { name: 'Librarian', icon: 'local_library', role: 'Remembers everything and finds it again, with sources', when: 'Live, for Pooja' },
  { name: 'Executor', icon: 'bolt', role: 'Acts in Gmail, Calendar, Slack, Sheets and Docs after your yes', when: 'Live, for Pooja' },
];

const LIBRARIAN = new Set(['search_knowledge', 'list_recent_meetings', 'get_meeting_details', 'get_open_items', 'brief_me']);
const EXECUTOR = new Set(['send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row', 'log_issue', 'create_google_doc', 'open_google_doc', 'mark_complete', 'reopen_item']);
const LENS = new Set(['upload_attachment', 'delete_attachment', 'upload_document']);

/** Who did an activity_log step. */
export function specialistForTool(tool: string): string {
  if (LIBRARIAN.has(tool)) return 'Librarian';
  if (EXECUTOR.has(tool)) return 'Executor';
  if (LENS.has(tool)) return 'Lens';
  return 'Pooja';
}

/** Who is working on a meeting processing step. */
export const STEP_SPECIALIST: Record<string, string> = { transcribing: 'Scribe', extracting: 'Analyst', indexing: 'Librarian' };
