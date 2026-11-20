// Tool schemas the voice model sees, and the server-side read tools.
// Action tools (send/post/create/add) are handled in actions.ts: they only
// create a pending action that the user must confirm.
import { config } from '../config.js';
import { executeTool } from '../composio.js';
import { ACTION_KINDS, cancelPending, isActionKind } from './actions.js';
import { logActivity } from './activity.js';
import { supabase } from '../supabase.js';
import { dateTimeLabel, dayLabel, meetingDetails, meetingInScope, openItems, recentMeetings, searchKnowledge } from './data.js';
import { ALL, OutOfScopeError, type Scope } from './scope.js';
import { mergeUpcoming, type MergedItem } from './upcoming.js';

const meetingParam = {
  type: 'string',
  description: 'Meeting title words (e.g. "performance review") or "latest". Omit for none.',
};
const sectionsParam = {
  type: 'array',
  items: { type: 'string', enum: ['summary', 'decisions', 'action_items', 'discuss_later', 'stats'] },
  description: 'Which parts of the meeting to include.',
};

const RAW_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Semantic search over all meeting notes, transcripts and company docs.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, meeting: meetingParam },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_meetings',
      description: 'Lists the most recent recorded meetings with dates.',
      parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_meeting_details',
      description: 'Summary, decisions, action items with owners, follow-up topics and numbers for one meeting.',
      parameters: { type: 'object', properties: { meeting: meetingParam }, required: ['meeting'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_open_items',
      description: 'Open action items and topics parked for later. With no arguments: across all meetings.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Only if the user asks about one person.' },
          meeting: { type: 'string', description: 'Only if the user names a meeting.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brief_me',
      description:
        "What's next: upcoming calendar events AND planned follow-ups from meetings, merged and sorted by date (says whether each follow-up is on the calendar), plus a briefing from past meetings and open items. Use for \"brief me\", \"what's next\", \"our next meeting\", \"what are we discussing next\".",
      parameters: {
        type: 'object',
        properties: { topic: { type: ['string', 'null'], description: 'Only if the user names a topic or meeting; otherwise omit.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description:
        'Proposes an email via Gmail. Give a meeting to include its content automatically (preferred), and/or a short body. The server reads it back and waits for a yes.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Contact name (e.g. "Priya") or email address.' },
          meeting: meetingParam,
          sections: sectionsParam,
          subject: { type: 'string' },
          body: { type: 'string', description: 'Optional short note in plain text.' },
        },
        required: ['to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_to_slack',
      description: `Proposes a Slack post (default channel ${config.slackChannel}). Give a meeting to post its content, and/or a message.`,
      parameters: {
        type: 'object',
        properties: { meeting: meetingParam, sections: sectionsParam, message: { type: 'string' }, channel: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: 'Proposes a Google Calendar event. Attendees are contact names or emails.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string', description: `Local start time in ${config.timeZone}, format YYYY-MM-DDTHH:mm.` },
          duration_minutes: { type: 'integer' },
          attendees: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          follow_up_id: { type: 'string', description: 'When booking a planned follow-up returned by brief_me: its follow_up_id, so it is marked scheduled.' },
        },
        required: ['title', 'start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_tracker_row',
      description: `Proposes adding rows to the "${config.trackerSheetName}" Google Sheet: one task, or all open action items of a meeting.`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          owner: { type: 'string' },
          due: { type: 'string' },
          status: { type: 'string' },
          meeting: meetingParam,
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_issue',
      description: `Proposes logging an issue (bug, blocker, escalation) in the tracker and escalating it to the owner on Slack ${config.slackChannel}.`,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short issue title.' },
          owner: { type: 'string', description: 'Contact who should own it.' },
          context: { type: 'string', description: 'One line of detail.' },
          due: { type: 'string' },
          meeting: meetingParam,
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_pending_action',
      description: 'Cancels the action waiting for confirmation, when the user says no or changes their mind.',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

// Models often send null for an optional argument ("owner": null), and Groq
// rejects that against a plain {"type": "string"} schema (tool_use_failed).
// So every optional property, at any depth, also accepts null; handlers read
// arguments through str()/Array.isArray, which treat null as "not given".
type Schema = { type?: unknown; properties?: Record<string, Schema>; required?: string[]; items?: Schema; [k: string]: unknown };
function nullableOptionals(schema: Schema): Schema {
  const out: Schema = { ...schema };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, prop]) => {
        const inner = nullableOptionals(prop);
        const optional = !(schema.required ?? []).includes(name);
        if (optional && typeof inner.type === 'string' && inner.type !== 'null') inner.type = [inner.type, 'null'];
        return [name, inner];
      }),
    );
  }
  if (schema.items) out.items = nullableOptionals(schema.items);
  return out;
}

export const TOOLS = RAW_TOOLS.map((tool) => ({
  ...tool,
  function: { ...tool.function, parameters: nullableOptionals(tool.function.parameters as Schema) },
}));

export { ACTION_KINDS, isActionKind };

/** Meeting mode hides the tools that list or read other meetings. */
export function toolsFor(scope: Scope) {
  return scope.kind === 'meeting' ? TOOLS.filter((t) => t.function.name !== 'list_recent_meetings') : TOOLS;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Runs a read tool, logs it, and returns a compact JSON-able result. */
export async function runReadTool(sessionId: string, name: string, args: Record<string, unknown>, scope: Scope = ALL): Promise<unknown> {
  const started = Date.now();
  try {
    const result = await readTool(sessionId, name, args, scope);
    void logActivity({ sessionId, tool: name, args, status: 'ok', result, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logActivity({ sessionId, tool: name, args, status: 'error', error: message, durationMs: Date.now() - started });
    if (err instanceof OutOfScopeError) return { error: 'out_of_scope', say_exactly: message };
    return { error: message };
  }
}

async function readTool(sessionId: string, name: string, args: Record<string, unknown>, scope: Scope): Promise<unknown> {
  const inMeeting = scope.kind === 'meeting';
  switch (name) {
    case 'search_knowledge': {
      const meeting = inMeeting || str(args.meeting) ? await meetingInScope(scope, str(args.meeting)) : null;
      const hits = await searchKnowledge(str(args.query) ?? '', { count: 6, meetingId: meeting?.id });
      return hits.length ? hits.map(({ meeting_id: _id, ...hit }) => hit) : { results: [], note: 'Nothing relevant in the knowledge base.' };
    }
    case 'list_recent_meetings': {
      if (scope.kind === 'meeting') throw new OutOfScopeError(`I'm focused on ${scope.title} right now. For your other meetings, open Talk to Tatva from the dashboard and I can look across everything.`);
      const limit = Math.min(Number(args.limit) || 5, 10);
      return (await recentMeetings()).slice(0, limit).map((m) => ({ title: m.title, date: dayLabel(m.recorded_at ?? m.created_at) }));
    }
    case 'get_meeting_details': {
      const row = await meetingInScope(scope, str(args.meeting));
      if (!row) return { error: `No meeting matches "${args.meeting}".` };
      const details = await meetingDetails(row.id);
      if (!details) return { error: 'Meeting not found.' };
      const { id: _id, gdoc_url, ...rest } = details;
      return { ...rest, has_google_doc: !!gdoc_url };
    }
    case 'get_open_items': {
      const meeting = inMeeting || str(args.meeting) ? await meetingInScope(scope, str(args.meeting)) : null;
      return openItems({ owner: str(args.owner), meetingId: meeting?.id });
    }
    case 'brief_me': {
      const topic = str(args.topic);
      // "next meeting", "the one we scheduled", "upcoming" are not topics: they mean what's next.
      return briefMe(topic && !/(next|upcoming|scheduled|coming up|planned)/i.test(topic) ? topic : undefined, scope);
    }
    case 'cancel_pending_action': {
      const cancelled = await cancelPending(sessionId);
      return cancelled ? { cancelled: cancelled.summary } : { note: 'Nothing was waiting for confirmation.' };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// ------------------------------------------------------------------ what's next

export interface CalendarEventInfo {
  title: string;
  when: string;
  start: string;
  attendees: string[];
  created_by_tatva: boolean;
  link: string | null;
  meet_link: string | null;
}

/** Google Calendar events with a start time in the next `days` days (Composio). */
export async function calendarEvents(days = 14, max = 15): Promise<CalendarEventInfo[]> {
  const data = await executeTool('googlecalendar', 'GOOGLECALENDAR_EVENTS_LIST', {
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + days * 86_400_000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: max,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = (data as any)?.items ?? (data as any)?.events ?? [];
  return items
    .filter((e) => e?.start?.dateTime)
    .map((event) => ({
      title: String(event.summary ?? 'Untitled event'),
      when: dateTimeLabel(event.start.dateTime),
      start: new Date(event.start.dateTime).toISOString(),
      attendees: (event.attendees ?? []).map((a: { displayName?: string; email: string }) => a.displayName ?? a.email).slice(0, 6),
      created_by_tatva: /tatva/i.test(String(event.description ?? '')),
      link: typeof event.htmlLink === 'string' ? event.htmlLink : null,
      meet_link: typeof event.hangoutLink === 'string' ? event.hangoutLink : null,
    }));
}

export type UpcomingItem = MergedItem;

/**
 * What's coming up: calendar events + planned follow-ups ("discuss later"),
 * sorted by date. Meeting mode: only that meeting's follow-ups (each marked
 * on the calendar or not).
 */
export async function upcoming(scope: Scope): Promise<{ items: UpcomingItem[]; calendar_error?: string }> {
  let calendarError: string | undefined;
  const meetingId = scope.kind === 'meeting' ? scope.meetingId : null;
  let query = supabase
    .from('discuss_later')
    .select('id, meeting_id, topic, people, suggested_at, status')
    .in('status', ['open', 'scheduled'])
    .gte('suggested_at', new Date(Date.now() - 60 * 60_000).toISOString())
    .order('suggested_at', { ascending: true })
    .limit(30);
  if (meetingId) query = query.eq('meeting_id', meetingId);
  const [events, rows, meetings] = await Promise.all([
    calendarEvents().catch((err) => {
      calendarError = err instanceof Error ? err.message : String(err);
      console.warn('[voice] calendar lookup failed:', calendarError);
      return [] as CalendarEventInfo[];
    }),
    query,
    recentMeetings().catch(() => []),
  ]);
  if (rows.error) throw new Error(`Follow-ups: ${rows.error.message}`);
  const titleOf = (id: string) =>
    meetings.find((m) => m.id === id)?.title ?? (scope.kind === 'meeting' && id === scope.meetingId ? scope.title : 'a past meeting');
  // Re-processed meetings can repeat a topic: keep the first of each.
  const seen = new Set<string>();
  const followUps = (rows.data ?? [])
    .filter((r) => {
      const key = `${r.topic.toLowerCase().replace(/[^a-z0-9]/g, '')}|${r.suggested_at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({ id: r.id, topic: r.topic, people: r.people ?? [], suggested_at: r.suggested_at, meeting: titleOf(r.meeting_id) }));
  const items = mergeUpcoming(events, followUps, { onlyFollowUps: !!meetingId }).map((i) => ({ ...i, when: dateTimeLabel(i.start) }));
  return { items, ...(calendarError ? { calendar_error: calendarError } : {}) };
}

/** "Brief me" / "what's next": the merged upcoming list, then context for the next item (or a topic). */
async function briefMe(topic: string | undefined, scope: Scope) {
  const meetingId = scope.kind === 'meeting' ? scope.meetingId : undefined;
  const up: { items: UpcomingItem[]; calendar_error?: string } = topic ? { items: [] } : await upcoming(scope);
  const next = up.items[0] ?? null;
  const subject = topic ?? next?.title;
  if (!subject)
    return {
      note: scope.kind === 'meeting' ? `No upcoming follow-ups were planned in ${scope.title}.` : 'Nothing upcoming on the calendar or in planned follow-ups.',
    };
  const [hits, items] = await Promise.all([searchKnowledge(subject, { count: 4, threshold: 0.3, meetingId }), openItems({ meetingId })]);
  const subjectWords = subject.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const related = (text: string) => subjectWords.some((w) => text.toLowerCase().includes(w));
  const people = next?.people.length ? ` with ${next.people.join(' and ')}` : '';
  return {
    next,
    upcoming: up.items.slice(0, 5),
    ...(next && !next.on_calendar
      ? { say_about_next: `${next.title}${people} is planned for ${next.when} but isn't on the calendar yet. Say exactly that, then ask "Shall I add it?" (if yes: create_calendar_event with its follow_up_id, title, start and people).` }
      : {}),
    topic: subject,
    from_past_meetings: hits.map((h) => `${h.meeting}: ${h.content.slice(0, 250)}`),
    related_open_items: items.action_items.filter((a) => related(a.task)).slice(0, 5),
    all_open_item_count: items.action_items.length,
    ...(up.calendar_error ? { calendar_note: 'Google Calendar could not be read; only planned follow-ups are listed.' } : {}),
  };
}

/** First upcoming item for the dashboard's "Up next" card (calendar events and follow-ups). */
export async function nextUpcoming() {
  const { items, calendar_error } = await upcoming(ALL);
  if (calendar_error && !items.length) throw new Error(calendar_error);
  return items[0] ?? null;
}
