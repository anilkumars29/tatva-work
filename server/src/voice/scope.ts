// Conversation scope. Talk to Tatva opened from the dashboard or sidebar is
// GENERAL (every meeting, document, contact and the calendar); opened from a
// meeting ("Ask Tatva about this meeting") it is MEETING mode: Pooja may only
// use that meeting. The web app passes the scope with the session
// (X-Tatva-Scope header, set by app/api/invite-agent) and the server enforces
// it in every tool and action, not just in the prompt.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Scope = { kind: 'all' } | { kind: 'meeting'; meetingId: string; title: string; date: string };

export const ALL: Scope = { kind: 'all' };

/** `meeting:<uuid>` → the meeting id; anything else (absent, "all", malformed) → null = general. */
export function parseScopeHeader(value: string | undefined | null): string | null {
  const match = value?.trim().match(/^meeting:(.+)$/i);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}

/** Words that mean "the meeting we're in" when the scope is one meeting. */
const THIS_MEETING = /^(this|that|the|current|same|latest|last|recent|most recent|our|my|it|today'?s?)?\s*(meeting|call|sync|session|one)?$/i;

export const refersToThisMeeting = (ref: string | undefined | null) => !ref || THIS_MEETING.test(ref.trim());

/** What Pooja says when asked about something outside the meeting she is focused on. */
export function outOfScopeMessage(scope: Extract<Scope, { kind: 'meeting' }>): string {
  return `I'm focused on ${scope.title} right now. For your other meetings, open Talk to Tatva from the dashboard and I can look across everything.`;
}

export class OutOfScopeError extends Error {}
