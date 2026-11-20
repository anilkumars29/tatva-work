// Send/create actions. The model only *proposes* these: proposeAction() stores a
// pending_actions row and returns the read-back sentence. executePending() runs
// the action through Composio, and is only called after the user says "yes".
import { config } from '../config.js';
import { executeTool, findDeep } from '../composio.js';
import { zoneOffset } from '../pipeline/dates.js';
import { supabase } from '../supabase.js';
import { recomputeTimeSaved } from '../pipeline/timesaved-db.js';
import { logActivity } from './activity.js';
import { dateTimeLabel, dayLabel, meetingDetails, meetingInScope, resolveContact, resolveMeeting, type MeetingDetails } from './data.js';
import { ALL, OutOfScopeError, outOfScopeMessage, type Scope } from './scope.js';

export const ACTION_KINDS = ['send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row', 'log_issue'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const isActionKind = (name: string): name is ActionKind => (ACTION_KINDS as readonly string[]).includes(name);

const PENDING_TTL_MS = 10 * 60_000;
const SECTIONS = ['summary', 'decisions', 'action_items', 'discuss_later', 'stats'] as const;
type Section = (typeof SECTIONS)[number];

export interface PendingAction {
  id: string;
  kind: ActionKind;
  args: Record<string, unknown>;
  summary: string;
  status: string;
  created_at: string;
}

/** Thrown for problems the user can fix by voice ("I don't have an email for Kiran"). */
export class UserFacingError extends Error {}

// ---------------------------------------------------------------- pending rows

export async function getPending(sessionId: string): Promise<PendingAction | null> {
  const { data, error } = await supabase
    .from('pending_actions')
    .select('id, kind, args, summary, status, created_at')
    .eq('session_id', sessionId)
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Pending actions: ${error.message}`);
  if (!data) return null;
  if (Date.now() - Date.parse(data.created_at) > PENDING_TTL_MS) {
    await setStatus(data.id, 'expired');
    return null;
  }
  return data as PendingAction;
}

async function setStatus(id: string, status: string, extra: { result?: unknown; error?: string | null } = {}) {
  await supabase.from('pending_actions').update({ status, ...extra }).eq('id', id);
}

export async function cancelPending(sessionId: string): Promise<PendingAction | null> {
  const pending = await getPending(sessionId);
  if (!pending) return null;
  await setStatus(pending.id, 'cancelled');
  void logActivity({ sessionId, tool: pending.kind, args: pending.args, status: 'cancelled' });
  return pending;
}

// ------------------------------------------------------------- building content

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);

function sectionsFrom(v: unknown, fallback: Section[]): Section[] {
  const list = strList(v).filter((s): s is Section => (SECTIONS as readonly string[]).includes(s));
  return list.length ? list : fallback;
}

/** Plain-text rendering of selected meeting sections, for email and Slack. */
function renderMeeting(m: MeetingDetails, sections: Section[], bullet: string): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section === 'summary' && m.summary) parts.push(`Summary\n${m.summary}`);
    if (section === 'decisions' && m.decisions.length) parts.push(`Decisions\n${m.decisions.map((d) => `${bullet} ${d}`).join('\n')}`);
    if (section === 'action_items' && m.action_items.length)
      parts.push(
        `Action items\n${m.action_items
          .map((a) => `${bullet} ${a.owner ?? 'Unassigned'}: ${a.task}${a.due ? ` (due ${a.due})` : ''}`)
          .join('\n')}`,
      );
    if (section === 'discuss_later' && m.discuss_later.length)
      parts.push(
        `To discuss later\n${m.discuss_later
          .map((d) => `${bullet} ${d.topic}${d.when ? `, ${d.when}` : ''}${d.people.length ? ` (${d.people.join(', ')})` : ''}`)
          .join('\n')}`,
      );
    if (section === 'stats' && m.stats.length) parts.push(`Numbers mentioned\n${m.stats.map((s) => `${bullet} ${s}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

const sectionWords: Record<Section, string> = {
  summary: 'summary',
  decisions: 'decisions',
  action_items: 'action items',
  discuss_later: 'follow-up topics',
  stats: 'numbers',
};
const joinWords = (words: string[]) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * The meeting an action uses. Meeting mode: always the scoped meeting (when
 * `scopeByDefault` or a meeting was named); naming another meeting is refused.
 */
async function loadMeeting(ref: unknown, scope: Scope = ALL, scopeByDefault = true): Promise<MeetingDetails | null> {
  const name = str(ref);
  if (scope.kind === 'meeting') {
    if (!name && !scopeByDefault) return null;
    try {
      await meetingInScope(scope, name);
    } catch (err) {
      if (err instanceof OutOfScopeError) throw new UserFacingError(err.message);
      throw err;
    }
    return meetingDetails(scope.meetingId);
  }
  if (!name) return null;
  const row = await resolveMeeting(name);
  if (!row) throw new UserFacingError(`I couldn't find a meeting matching "${name}".`);
  return meetingDetails(row.id);
}

/** Parses "2026-11-23T11:00" (local) or a full ISO string into an ISO instant. */
function parseLocalDateTime(value: string): string | null {
  const local = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
  if (local) {
    const probe = new Date(`${local[1]}T12:00:00Z`);
    return new Date(`${local[1]}T${local[2]}:00${zoneOffset(probe)}`).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Local "YYYY-MM-DDTHH:mm:ss" in the display zone, for Google Calendar + timezone. */
function toLocalNaive(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// ------------------------------------------------------------------- proposing

async function meetingOfTopic(discussLaterId: string | undefined): Promise<string | null> {
  if (!discussLaterId) return null;
  const { data } = await supabase.from('discuss_later').select('meeting_id').eq('id', discussLaterId).maybeSingle();
  return data?.meeting_id ?? null;
}

/** Linked actions count toward their meeting's time saved. */
function afterAction(args: Record<string, unknown>) {
  if (typeof args.meeting_id === 'string') void recomputeTimeSaved(args.meeting_id).catch(() => {});
}

/**
 * Validates and resolves a proposed action (contacts, meeting content, dates),
 * stores it as pending, and returns the sentence to read back.
 * Throws UserFacingError for things the user should clarify.
 */
export async function proposeAction(sessionId: string, kind: ActionKind, input: Record<string, unknown>, scope: Scope = ALL): Promise<PendingAction> {
  const { args, summary } = await prepareAction(kind, input, scope);
  // One pending action per session: a new proposal replaces the old one.
  await supabase.from('pending_actions').update({ status: 'cancelled' }).eq('session_id', sessionId).in('status', ['pending', 'failed']);
  const { data, error } = await supabase
    .from('pending_actions')
    .insert({ session_id: sessionId, kind, args, summary })
    .select('id, kind, args, summary, status, created_at')
    .single();
  if (error) throw new Error(`Could not save the pending action: ${error.message}`);
  void logActivity({ sessionId, tool: kind, args, status: 'pending', result: { summary } });
  return data as PendingAction;
}

export async function prepareAction(kind: ActionKind, input: Record<string, unknown>, scope: Scope = ALL): Promise<{ args: Record<string, unknown>; summary: string }> {
  switch (kind) {
    case 'send_email': {
      const toRaw = str(input.to);
      if (!toRaw) throw new UserFacingError('Who should I send the email to?');
      const to = await resolveContact(toRaw);
      if (!to) throw new UserFacingError(`I don't have an email address for ${toRaw}. What's their email?`);
      const meeting = await loadMeeting(input.meeting, scope, !str(input.body));
      const sections = sectionsFrom(input.sections, ['summary', 'action_items']);
      const note = str(input.body);
      if (!meeting && !note) throw new UserFacingError('What should the email say?');
      const subject =
        str(input.subject) ?? (meeting ? `${joinWords(sections.map((s) => sectionWords[s])).replace(/^./, (c) => c.toUpperCase())}: ${meeting.title}` : 'Note from Tatva');
      const named = to.name !== to.email; // a contact or the user's profile, not a bare address
      const greeting = `Hi ${named ? to.name.split(' ')[0] : 'there'},`;
      const body = [greeting, note, meeting ? `From "${meeting.title}" (${meeting.date}):\n\n${renderMeeting(meeting, sections, '-')}` : null]
        .filter(Boolean)
        .join('\n\n')
        .concat('\n\nSent by Tatva');
      const who = named ? to.name : to.email;
      const what = meeting ? `the ${joinWords(sections.map((s) => sectionWords[s]))} from ${meeting.title}` : `a note`;
      return {
        args: { to: to.email, to_name: to.name, subject, body, meeting_id: meeting?.id ?? null },
        summary: `I'll email ${who} ${what}, with the subject "${subject}". Should I send it?`,
      };
    }

    case 'post_to_slack': {
      const meeting = await loadMeeting(input.meeting, scope, !str(input.message));
      const note = str(input.message);
      if (!meeting && !note) throw new UserFacingError('What should I post in Slack?');
      const sections = sectionsFrom(input.sections, ['summary', 'decisions', 'action_items']);
      const channel = str(input.channel) ? `#${str(input.channel)!.replace(/^#/, '')}` : config.slackChannel;
      const text = [
        note,
        meeting ? `*${meeting.title}* (${meeting.date})\n\n${renderMeeting(meeting, sections, '•')}` : null,
        '_Posted by Tatva_',
      ]
        .filter(Boolean)
        .join('\n\n');
      const what = meeting ? `the ${joinWords(sections.map((s) => sectionWords[s]))} of ${meeting.title}` : `"${note}"`;
      return {
        args: { channel, text, meeting_id: meeting?.id ?? null },
        summary: `I'll post ${what} in ${channel.replace('#', 'the ')} channel on Slack. Shall I post it?`,
      };
    }

    case 'create_calendar_event': {
      const title = str(input.title);
      if (!title) throw new UserFacingError('What should I call the event?');
      const startRaw = str(input.start);
      const start = startRaw ? parseLocalDateTime(startRaw) : null;
      if (!start) throw new UserFacingError(`When should ${title} be?`);
      if (Date.parse(start) < Date.now() - 5 * 60_000) throw new UserFacingError(`That time has already passed. When should ${title} be?`);
      const minutes = Math.min(Math.max(Number(input.duration_minutes) || 30, 10), 480);
      const attendees: { name: string; email: string }[] = [];
      const unknown: string[] = [];
      for (const person of strList(input.attendees)) {
        const found = await resolveContact(person);
        if (found) attendees.push({ name: found.name, email: found.email });
        else unknown.push(person);
      }
      // Booking a planned follow-up (brief_me's follow_up_id) marks it scheduled.
      const followUpId = str(input.follow_up_id) ?? str(input.discuss_later_id);
      const followUpMeeting = await meetingOfTopic(followUpId);
      if (scope.kind === 'meeting' && followUpMeeting && followUpMeeting !== scope.meetingId) throw new UserFacingError(outOfScopeMessage(scope));
      if (unknown.length && !input.skip_unknown_attendees)
        throw new UserFacingError(`I don't have an email for ${joinWords(unknown)}. Should I leave them out, or what's their email?`);
      const who = attendees.length ? `, inviting ${joinWords(attendees.map((a) => a.name.split(' ')[0]))}` : '';
      return {
        args: {
          title,
          start,
          duration_minutes: minutes,
          attendees,
          description: str(input.description) ?? null,
          discuss_later_id: followUpId ?? null,
          meeting_id: followUpMeeting ?? (scope.kind === 'meeting' ? scope.meetingId : null),
        },
        summary: `I'll create "${title}" on ${dateTimeLabel(start)} for ${minutes} minutes${who}. Shall I go ahead?`,
      };
    }

    case 'add_tracker_row': {
      const meeting = await loadMeeting(input.meeting, scope, !str(input.task));
      let rows: { task: string; owner: string; due: string }[] = [];
      const task = str(input.task);
      if (task) rows.push({ task, owner: str(input.owner) ?? '', due: str(input.due) ?? '' });
      else if (meeting) rows = meeting.action_items.filter((a) => a.status === 'open').map((a) => ({ task: a.task, owner: a.owner ?? '', due: a.due ?? '' }));
      if (!rows.length) throw new UserFacingError('What should I add to the tracker?');
      for (const row of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(row.due)) row.due = dayLabel(`${row.due}T12:00:00Z`);
      const status = str(input.status) ?? 'Open';
      const what =
        rows.length === 1
          ? `"${rows[0].task}"${rows[0].owner ? ` for ${rows[0].owner}` : ''}${rows[0].due ? `, due ${rows[0].due}` : ''}`
          : `${rows.length} action items from ${meeting?.title}`;
      return {
        args: { rows, status, meeting: meeting?.title ?? str(input.meeting) ?? '', meeting_id: meeting?.id ?? null, custom: !!task },
        summary: `I'll add ${what} to the ${config.trackerSheetName} sheet. Should I add ${rows.length === 1 ? 'it' : 'them'}?`,
      };
    }

    case 'log_issue': {
      const title = str(input.title);
      if (!title) throw new UserFacingError('What is the issue?');
      const ownerRaw = str(input.owner);
      const owner = ownerRaw ? await resolveContact(ownerRaw) : null;
      if (ownerRaw && !owner) throw new UserFacingError(`I don't have ${ownerRaw} in contacts. Who should own this issue?`);
      const meeting = str(input.meeting) || scope.kind === 'meeting' ? await loadMeeting(input.meeting, scope) : null;
      const ownerName = owner?.name ?? null;
      const handle = owner?.contact?.slack_handle ?? null;
      const who = ownerName ? ` for ${ownerName.split(' ')[0]}` : '';
      const escalate = ownerName ? `, and escalate it to ${ownerName.split(' ')[0]} in ${config.slackChannel.replace('#', 'the ')} channel` : `, and post it in ${config.slackChannel.replace('#', 'the ')} channel`;
      return {
        args: {
          title,
          owner: ownerName,
          slack_handle: handle,
          context: str(input.context) ?? null,
          due: str(input.due) ?? null,
          meeting_id: meeting?.id ?? null,
          meeting: meeting?.title ?? null,
          source: input.source === 'web' ? 'web' : 'voice',
        },
        summary: `I'll log the issue "${title}"${who} in the tracker${escalate}. Shall I go ahead?`,
      };
    }
  }
}

// ------------------------------------------------------------------- executing

export interface ActionOutcome {
  ok: boolean;
  /** Sentence to speak. */
  say: string;
  /** Short fact for the session memory. */
  fact: string;
}

/** Runs a confirmed action. On failure the row stays "failed" so "try again" can retry it. */
export async function executePending(sessionId: string, pending: PendingAction): Promise<ActionOutcome> {
  const started = Date.now();
  try {
    const result = await runAction(pending.kind, pending.args);
    await setStatus(pending.id, 'done', { result: result.data ?? null, error: null });
    await logActivity({ sessionId, tool: pending.kind, args: pending.args, status: 'confirmed', result: result.data, durationMs: Date.now() - started });
    afterAction(pending.args);
    return { ok: true, say: result.say, fact: result.fact };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(pending.id, 'failed', { error: message });
    void logActivity({ sessionId, tool: pending.kind, args: pending.args, status: 'error', error: message, durationMs: Date.now() - started });
    console.error(`[voice] ${pending.kind} failed:`, message);
    return { ok: false, say: failureSentence(pending.kind, message), fact: `${pending.kind} failed: ${message.slice(0, 200)}` };
  }
}

function failureSentence(kind: ActionKind, message: string): string {
  const what = {
    send_email: 'sending the email',
    post_to_slack: 'posting to Slack',
    create_calendar_event: 'creating the calendar event',
    add_tracker_row: 'updating the tracker',
    log_issue: 'logging the issue',
  }[kind];
  const app = { send_email: 'Gmail', post_to_slack: 'Slack', create_calendar_event: 'Google Calendar', add_tracker_row: 'Google Sheets', log_issue: 'Google Sheets or Slack' }[kind];
  let reason = 'the service returned an error';
  if (/not.?connected|no connected account|auth|unauthori[sz]ed|401|403|expired|invalid_grant/i.test(message)) reason = `the ${app} connection needs to be re-authorised in Composio`;
  else if (/channel_not_found|not_in_channel/i.test(message)) reason = `the Tatva app isn't in that Slack channel`;
  else if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(message)) reason = `${app} didn't respond in time`;
  else if (/rate|429/i.test(message)) reason = `${app} is rate limiting us`;
  return `Sorry, ${what} failed because ${reason}. Should I try again, or would you like to change something?`;
}

export async function runAction(kind: ActionKind, a: Record<string, unknown>): Promise<{ say: string; fact: string; data?: unknown }> {
  switch (kind) {
    case 'send_email': {
      const data = await executeTool('gmail', 'GMAIL_SEND_EMAIL', {
        recipient_email: a.to,
        subject: a.subject,
        body: a.body,
        is_html: false,
      });
      const first = String(a.to_name).split(/[ @]/)[0];
      return {
        say: `Done, the email is on its way to ${first}.${a.meeting_id ? ' Want me to add the action items to the tracker too?' : ''}`,
        fact: `Emailed ${a.to_name} <${a.to}>: "${a.subject}"`,
        data: { id: findDeep(data, ['id']) },
      };
    }

    case 'post_to_slack': {
      const data = await executeTool('slack', 'SLACK_SEND_MESSAGE', { channel: a.channel, markdown_text: a.text });
      return {
        say: `Posted in ${String(a.channel).replace('#', 'the ')} channel.`,
        fact: `Posted to Slack ${a.channel}`,
        data: { ts: findDeep(data, ['ts']) },
      };
    }

    case 'create_calendar_event': {
      const attendees = (a.attendees as { name: string; email: string }[]) ?? [];
      const data = await executeTool('googlecalendar', 'GOOGLECALENDAR_CREATE_EVENT', {
        calendar_id: 'primary',
        summary: a.title,
        start_datetime: toLocalNaive(String(a.start)),
        timezone: config.timeZone,
        event_duration_hour: Math.floor(Number(a.duration_minutes) / 60),
        event_duration_minutes: Number(a.duration_minutes) % 60,
        attendees: attendees.map((p) => p.email),
        description: [a.description, 'Scheduled by Tatva'].filter(Boolean).join('\n\n'),
        send_updates: attendees.length ? 'all' : 'none',
      });
      if (a.discuss_later_id) await supabase.from('discuss_later').update({ status: 'scheduled' }).eq('id', a.discuss_later_id);
      else await markScheduled(String(a.title));
      const invited = attendees.length ? `, and I've sent the invite${attendees.length > 1 ? 's' : ''}` : '';
      return {
        say: `Done, ${a.title} is on the calendar for ${dateTimeLabel(String(a.start))}${invited}. Should I post it in Slack too?`,
        fact: `Created calendar event "${a.title}" at ${dateTimeLabel(String(a.start))}`,
        data: { id: findDeep(data, ['id']), link: findDeep(data, ['htmlLink']) },
      };
    }

    case 'add_tracker_row': {
      const { spreadsheetId, tab } = await trackerSheet();
      const rows = a.rows as { task: string; owner: string; due: string }[];
      const added = new Date().toISOString().slice(0, 10);
      await executeTool('googlesheets', 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
        spreadsheetId,
        range: `'${tab}'!A:G`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        values: rows.map((r) => [r.task, r.owner, r.due, a.status, a.meeting, added, 'Task']),
      });
      // A one-off task (not from a meeting's action items) also goes into the app's tracker.
      if (a.custom) {
        await supabase.from('action_items').insert(
          rows.map((r) => ({ task: r.task, owner: r.owner || null, due_text: r.due || null, kind: 'task', source: 'voice', meeting_id: a.meeting_id ?? null })),
        );
      }
      return {
        say: rows.length === 1 ? 'Added it to the tracker.' : `Added ${rows.length} rows to the tracker.`,
        fact: `Added ${rows.length} row(s) to ${config.trackerSheetName}`,
        data: { spreadsheetId, rows: rows.length },
      };
    }

    case 'log_issue': {
      const { data: item, error } = await supabase
        .from('action_items')
        .insert({
          task: a.title,
          owner: a.owner ?? null,
          context: a.context ?? null,
          due_text: a.due ?? null,
          kind: 'issue',
          source: a.source === 'web' ? 'web' : 'voice',
          meeting_id: a.meeting_id ?? null,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Could not save the issue: ${error.message}`);
      const { spreadsheetId, tab } = await trackerSheet();
      await executeTool('googlesheets', 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
        spreadsheetId,
        range: `'${tab}'!A:G`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        values: [[a.title, a.owner ?? '', a.due ?? '', 'Open', a.meeting ?? '', new Date().toISOString().slice(0, 10), 'Issue']],
      });
      const mention = a.slack_handle ? `@${a.slack_handle}` : a.owner ? String(a.owner) : 'team';
      await executeTool('slack', 'SLACK_SEND_MESSAGE', {
        channel: config.slackChannel,
        markdown_text: [`:rotating_light: *Issue escalated to ${mention}*`, `*${a.title}*`, a.context, a.due ? `Due: ${a.due}` : null, '_Logged by Tatva_']
          .filter(Boolean)
          .join('\n'),
      });
      const first = a.owner ? String(a.owner).split(' ')[0] : null;
      return {
        say: `Logged. ${first ? `I've escalated it to ${first} on Slack.` : "I've posted it on Slack."}`,
        fact: `Logged issue "${a.title}"${a.owner ? ` for ${a.owner}` : ''}`,
        data: { id: item.id },
      };
    }
  }
}

/** Marks open discuss-later topics matching a newly scheduled event as scheduled. */
async function markScheduled(title: string) {
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (!words.length) return;
  const { data } = await supabase.from('discuss_later').select('id, topic').eq('status', 'open');
  const ids = (data ?? [])
    .filter((row) => {
      const topic = row.topic.toLowerCase();
      return words.filter((w) => topic.includes(w)).length >= Math.min(2, words.length);
    })
    .map((row) => row.id);
  if (ids.length) await supabase.from('discuss_later').update({ status: 'scheduled' }).in('id', ids);
}

const TRACKER_HEADER = ['Task', 'Owner', 'Due', 'Status', 'Meeting', 'Added', 'Type'];
let tracker: Promise<{ spreadsheetId: string; tab: string }> | null = null;

/**
 * The "Tatva Tracker" spreadsheet (found in Drive, or created) and its first
 * tab, with the header row in place.
 */
function trackerSheet(): Promise<{ spreadsheetId: string; tab: string }> {
  tracker ??= (async () => {
    let spreadsheetId = config.trackerSpreadsheetId;
    if (!spreadsheetId) {
      const found = await executeTool('googlesheets', 'GOOGLESHEETS_SEARCH_SPREADSHEETS', { query: config.trackerSheetName, max_results: 5 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files: any[] = (found as any)?.spreadsheets ?? (found as any)?.files ?? [];
      const match = files.find((f) => f?.name === config.trackerSheetName) ?? files[0];
      spreadsheetId = match?.id ?? match?.spreadsheetId ?? '';
    }
    if (!spreadsheetId) {
      const created = await executeTool('googlesheets', 'GOOGLESHEETS_CREATE_GOOGLE_SHEET1', { title: config.trackerSheetName });
      spreadsheetId = findDeep(created, ['spreadsheetId', 'spreadsheet_id', 'id']) ?? '';
      if (!spreadsheetId) throw new Error('Created the tracker sheet but got no spreadsheet id back');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names: any = await executeTool('googlesheets', 'GOOGLESHEETS_GET_SHEET_NAMES', { spreadsheet_id: spreadsheetId });
    const tab: string = names?.sheet_names?.[0] ?? names?.sheets?.[0] ?? 'Sheet1';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const head: any = await executeTool('googlesheets', 'GOOGLESHEETS_BATCH_GET', { spreadsheet_id: spreadsheetId, ranges: [`'${tab}'!A1:G1`] });
    const current: string[] = head?.valueRanges?.[0]?.values?.[0] ?? [];
    if (current.length < TRACKER_HEADER.length) {
      await executeTool('googlesheets', 'GOOGLESHEETS_VALUES_UPDATE', {
        spreadsheet_id: spreadsheetId,
        range: `'${tab}'!A1:G1`,
        value_input_option: 'RAW',
        values: [TRACKER_HEADER],
      });
    }
    return { spreadsheetId, tab };
  })();
  tracker.catch(() => (tracker = null));
  return tracker;
}

// ------------------------------------------------------------- web app helpers

/**
 * Runs an action the user confirmed in the web app's dialog (the dialog showed
 * prepareAction's summary). Logged like a voice-confirmed action, session "web".
 */
export async function executeNow(kind: ActionKind, input: Record<string, unknown>): Promise<ActionOutcome & { summary: string; data?: unknown }> {
  const { args, summary } = await prepareAction(kind, input);
  const started = Date.now();
  try {
    const result = await runAction(kind, args);
    await logActivity({ sessionId: 'web', tool: kind, args, status: 'confirmed', result: result.data, durationMs: Date.now() - started });
    afterAction(args);
    return { ok: true, say: result.say, fact: result.fact, summary, data: result.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logActivity({ sessionId: 'web', tool: kind, args, status: 'error', error: message, durationMs: Date.now() - started });
    return { ok: false, say: failureSentence(kind, message), fact: message, summary };
  }
}

/** Sets the Status cell of a task's row in the tracker sheet (appends the row if it is missing). */
// Task column of the tracker sheet, cached so status changes don't each cost a
// Sheets read (Google's per-minute read quota is shared through Composio).
let taskColumn: { at: number; values: string[] } | null = null;

async function trackerTasks(spreadsheetId: string, tab: string): Promise<string[]> {
  if (taskColumn && Date.now() - taskColumn.at < 5 * 60_000) return taskColumn.values;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await executeTool('googlesheets', 'GOOGLESHEETS_BATCH_GET', { spreadsheet_id: spreadsheetId, ranges: [`'${tab}'!A:A`] });
  const values = ((data?.valueRanges?.[0]?.values ?? []) as string[][]).map((row) => row?.[0] ?? '');
  taskColumn = { at: Date.now(), values };
  return values;
}

export async function setTrackerStatus(item: { task: string; owner: string | null; due: string | null; meeting: string | null; kind: string }, status: string) {
  const { spreadsheetId, tab } = await trackerSheet();
  const column = await trackerTasks(spreadsheetId, tab);
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = column.findIndex((task, i) => i > 0 && norm(task) === norm(item.task));
  if (index > 0) {
    await executeTool('googlesheets', 'GOOGLESHEETS_VALUES_UPDATE', {
      spreadsheet_id: spreadsheetId,
      range: `'${tab}'!D${index + 1}`,
      value_input_option: 'RAW',
      values: [[status]],
    });
    return { row: index + 1, appended: false };
  }
  await executeTool('googlesheets', 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND', {
    spreadsheetId,
    range: `'${tab}'!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    values: [[item.task, item.owner ?? '', item.due ?? '', status, item.meeting ?? '', new Date().toISOString().slice(0, 10), item.kind === 'issue' ? 'Issue' : 'Task']],
  });
  taskColumn = null; // row numbers changed; re-read next time
  return { row: null, appended: true };
}

/** The tracker sheet's URL, for "Open in Google Sheets". */
export async function trackerSheetUrl(): Promise<string> {
  const { spreadsheetId } = await trackerSheet();
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

