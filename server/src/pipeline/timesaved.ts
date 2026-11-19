// "Time saved" from the work Tatva actually does, not an LLM guess.
// Pure (no config/secrets) so it is unit-tested. Minutes per unit of manual work:
export const MINUTES = {
  notesBase: 3, // writing up and sharing the summary + decisions (Google Doc)
  notesPerMeetingMinute: 0.2, // longer meetings take longer to write up
  actionItem: 1, // writing down a task with its owner and due date
  followUpTopic: 1, // noting a "discuss later" topic with a suggested time
  send_email: 4, // drafting and sending a follow-up email
  create_calendar_event: 3, // creating an invite and adding people
  post_to_slack: 2, // writing a Slack update
  add_tracker_row: 1, // per row typed into the tracker sheet
  log_issue: 3, // logging an issue and escalating it to the owner
} as const;

export interface Breakdown {
  task: string;
  minutes: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Minutes for one executed action (activity_log tool + args). */
export function actionMinutes(tool: string, args: Record<string, unknown> | null | undefined): number {
  if (tool === 'add_tracker_row') return MINUTES.add_tracker_row * Math.max(1, Array.isArray(args?.rows) ? args.rows.length : 1);
  return (MINUTES as Record<string, number>)[tool] ?? 0;
}

/**
 * Time saved for one meeting: notes for its length, each captured item, and
 * each action Tatva ran for it (emails, invites, Slack posts, tracker rows, issues).
 */
export function estimateTimeSaved(input: {
  durationSeconds: number | null;
  actionItems: number;
  followUpTopics: number;
  actions?: { tool: string; args?: Record<string, unknown> | null }[];
}): { minutes: number; breakdown: Breakdown[] } {
  const meetingMinutes = Math.max(0, Number(input.durationSeconds ?? 0) / 60);
  const breakdown: Breakdown[] = [{ task: 'Meeting notes & summary doc', minutes: Math.round(MINUTES.notesBase + MINUTES.notesPerMeetingMinute * meetingMinutes) }];
  if (input.actionItems) breakdown.push({ task: `Capturing ${plural(input.actionItems, 'action item')}`, minutes: input.actionItems * MINUTES.actionItem });
  if (input.followUpTopics) breakdown.push({ task: `Noting ${plural(input.followUpTopics, 'follow-up topic')}`, minutes: input.followUpTopics * MINUTES.followUpTopic });

  const labels: Record<string, [string, string]> = {
    send_email: ['Sending', 'email'],
    create_calendar_event: ['Creating', 'calendar invite'],
    post_to_slack: ['Posting', 'Slack update'],
    add_tracker_row: ['Adding', 'tracker row'],
    log_issue: ['Logging', 'issue'],
  };
  const grouped = new Map<string, { count: number; minutes: number }>();
  for (const a of input.actions ?? []) {
    const minutes = actionMinutes(a.tool, a.args);
    if (!minutes || !labels[a.tool]) continue;
    const units = a.tool === 'add_tracker_row' ? minutes / MINUTES.add_tracker_row : 1;
    const g = grouped.get(a.tool) ?? { count: 0, minutes: 0 };
    grouped.set(a.tool, { count: g.count + units, minutes: g.minutes + minutes });
  }
  for (const [tool, g] of grouped) breakdown.push({ task: `${labels[tool][0]} ${plural(g.count, labels[tool][1])}`, minutes: g.minutes });

  return { minutes: breakdown.reduce((sum, b) => sum + b.minutes, 0), breakdown };
}
