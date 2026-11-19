// Tool schemas the voice model sees, and the server-side read tools.
// Action tools (send/post/create/add) are handled in actions.ts: they only
// create a pending action that the user must confirm.
import { config } from '../config.js';
import { executeTool } from '../composio.js';
import { ACTION_KINDS, cancelPending, isActionKind } from './actions.js';
import { logActivity } from './activity.js';
import { dateTimeLabel, dayLabel, meetingDetails, openItems, recentMeetings, resolveMeeting, searchKnowledge } from './data.js';

const meetingParam = {
  type: 'string',
  description: 'Meeting title words (e.g. "performance review") or "latest". Omit for none.',
};
const sectionsParam = {
  type: 'array',
  items: { type: 'string', enum: ['summary', 'decisions', 'action_items', 'discuss_later', 'stats'] },
  description: 'Which parts of the meeting to include.',
};

export const TOOLS = [
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
      description: 'Prepares a briefing for the next calendar meeting, or for a topic, from past meetings and open items.',
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
      name: 'cancel_pending_action',
      description: 'Cancels the action waiting for confirmation, when the user says no or changes their mind.',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

export { ACTION_KINDS, isActionKind };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Runs a read tool, logs it, and returns a compact JSON-able result. */
export async function runReadTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const started = Date.now();
  try {
    const result = await readTool(sessionId, name, args);
    void logActivity({ sessionId, tool: name, args, status: 'ok', result, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logActivity({ sessionId, tool: name, args, status: 'error', error: message, durationMs: Date.now() - started });
    return { error: message };
  }
}

async function readTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_knowledge': {
      const meeting = str(args.meeting) ? await resolveMeeting(str(args.meeting)) : null;
      const hits = await searchKnowledge(str(args.query) ?? '', { count: 6, meetingId: meeting?.id });
      return hits.length ? hits.map(({ meeting_id: _id, ...hit }) => hit) : { results: [], note: 'Nothing relevant in the knowledge base.' };
    }
    case 'list_recent_meetings': {
      const limit = Math.min(Number(args.limit) || 5, 10);
      return (await recentMeetings()).slice(0, limit).map((m) => ({ title: m.title, date: dayLabel(m.recorded_at ?? m.created_at) }));
    }
    case 'get_meeting_details': {
      const row = await resolveMeeting(str(args.meeting));
      if (!row) return { error: `No meeting matches "${args.meeting}".` };
      const details = await meetingDetails(row.id);
      if (!details) return { error: 'Meeting not found.' };
      const { id: _id, gdoc_url, ...rest } = details;
      return { ...rest, has_google_doc: !!gdoc_url };
    }
    case 'get_open_items': {
      const meeting = str(args.meeting) ? await resolveMeeting(str(args.meeting)) : null;
      return openItems({ owner: str(args.owner), meetingId: meeting?.id });
    }
    case 'brief_me': {
      const topic = str(args.topic);
      return briefMe(topic && !/^(my |the )?(next|upcoming)( meeting| call)?$/i.test(topic) ? topic : undefined);
    }
    case 'cancel_pending_action': {
      const cancelled = await cancelPending(sessionId);
      return cancelled ? { cancelled: cancelled.summary } : { note: 'Nothing was waiting for confirmation.' };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Next calendar event (if no topic), plus related past knowledge and open items. */
async function briefMe(topic: string | undefined) {
  let next: { title: string; when: string; attendees: string[] } | null = null;
  if (!topic) {
    next = await nextCalendarEvent().catch((err) => {
      console.warn('[voice] calendar lookup failed:', err instanceof Error ? err.message : err);
      return null;
    });
    if (!next) {
      const items = await openItems();
      const upcoming = items.discuss_later[0];
      if (upcoming) next = { title: upcoming.topic, when: upcoming.when ?? 'not scheduled yet', attendees: upcoming.people };
    }
  }
  const subject = topic ?? next?.title;
  if (!subject) return { note: 'No upcoming meetings found on the calendar or in follow-ups.' };

  const [hits, items] = await Promise.all([searchKnowledge(subject, { count: 4, threshold: 0.3 }), openItems()]);
  const words = subject.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const related = (text: string) => words.some((w) => text.toLowerCase().includes(w));
  return {
    next_meeting: next,
    topic: subject,
    from_past_meetings: hits.map((h) => `${h.meeting}: ${h.content.slice(0, 250)}`),
    related_open_items: items.action_items.filter((a) => related(a.task)).slice(0, 5),
    all_open_item_count: items.action_items.length,
    parked_topics: items.discuss_later.slice(0, 3),
  };
}

async function nextCalendarEvent() {
  const data = await executeTool('googlecalendar', 'GOOGLECALENDAR_EVENTS_LIST', {
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 5,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = (data as any)?.items ?? (data as any)?.events ?? [];
  const event = items.find((e) => e?.start?.dateTime);
  if (!event) return null;
  return {
    title: String(event.summary ?? 'Untitled event'),
    when: dateTimeLabel(event.start.dateTime),
    attendees: (event.attendees ?? []).map((a: { displayName?: string; email: string }) => a.displayName ?? a.email).slice(0, 6),
  };
}
