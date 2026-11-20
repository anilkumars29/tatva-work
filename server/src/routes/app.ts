// Endpoints for the Tatva web app (Next.js, proxied as /tatva/* -> /api/*).
// Local only: requests through the Cloudflare tunnel never reach /api (see index.ts).
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { isToolkitConnected } from '../composio.js';
import { createKnowledgeDoc } from '../pipeline/gdoc.js';
import { meetingDocMarkdown } from '../pipeline/meeting-doc.js';
import { localYmd, zoneOffset } from '../pipeline/dates.js';
import { actionMinutes } from '../pipeline/timesaved.js';
import { supabase } from '../supabase.js';
import { ACTION_KINDS, executeNow, executePending, isActionKind, prepareAction, setTrackerStatus, trackerSheetUrl, UserFacingError, type PendingAction } from '../voice/actions.js';
import { getProfile, saveProfile } from '../profile.js';
import { logActivity } from '../voice/activity.js';
import { allContacts, recentMeetings } from '../voice/data.js';
import { nextUpcoming } from '../voice/tools.js';

export const appRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Wraps a handler so thrown errors become JSON 500s (400 for UserFacingError). */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      if (!res.headersSent) res.status(err instanceof UserFacingError ? 400 : 500).json({ error: message(err) });
    });

/** Monday 00:00 in the display time zone, as an ISO instant. */
function weekStart(now = new Date()): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short' }).format(now);
  const back = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 7) % 7;
  const monday = localYmd(new Date(now.getTime() - back * 86_400_000));
  return new Date(`${monday}T00:00:00${zoneOffset(new Date(`${monday}T12:00:00Z`))}`).toISOString();
}

// Small TTL cache for slow Composio lookups.
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
function remembered<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  value.catch(() => memo.delete(key));
  memo.set(key, { at: Date.now(), value });
  return value;
}

// ------------------------------------------------------------------ dashboard

appRouter.get(
  '/dashboard',
  handle(async (_req, res) => {
    const since = weekStart();
    const today = localYmd(new Date());
    const weekEnd = localYmd(new Date(Date.parse(since) + 7 * 86_400_000 - 1));
    const [meetings, open, actions, contacts] = await Promise.all([
      supabase
        .from('meetings')
        .select('id, title, source_title, status, error, recorded_at, created_at, processing_finished_at, duration_seconds, time_saved_minutes, summary, gdoc_url, action_items(count)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('action_items')
        .select('id, task, owner, due_text, due_date, kind, meeting_id, created_at, meetings(title)')
        .eq('status', 'open')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('activity_log').select('tool, args, created_at').eq('status', 'confirmed').gte('created_at', since),
      allContacts(),
    ]);
    for (const r of [meetings, open, actions]) if (r.error) throw new Error(r.error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = meetings.data ?? [];
    const ready = rows.filter((m) => m.status === 'ready');
    const thisWeek = ready.filter((m) => (m.recorded_at ?? m.created_at) >= since);
    // Actions not tied to a meeting (pings, standalone issues) still save time.
    const unlinkedMinutes = (actions.data ?? [])
      .filter((a) => !(a.args as Record<string, unknown> | null)?.meeting_id)
      .reduce((sum, a) => sum + actionMinutes(a.tool, a.args as Record<string, unknown>), 0);
    const byTool: Record<string, number> = {};
    for (const a of actions.data ?? []) byTool[a.tool] = (byTool[a.tool] ?? 0) + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openRows: any[] = open.data ?? [];
    const handleOf = (owner: string | null) => {
      if (!owner) return null;
      const first = owner.toLowerCase().split(' ')[0];
      const c = contacts.find((x) => [x.name, ...x.aliases].some((n) => n.toLowerCase().split(' ')[0] === first));
      return c ? { name: c.name, slack_handle: c.slack_handle } : null;
    };

    res.json({
      stats: {
        meetings_recorded: ready.length,
        meetings_this_week: thisWeek.length,
        open_action_items: openRows.length,
        due_this_week: openRows.filter((a) => a.due_date && a.due_date >= today && a.due_date <= weekEnd).length,
        overdue: openRows.filter((a) => a.due_date && a.due_date < today).length,
        actions_by_tatva_this_week: (actions.data ?? []).length,
        actions_by_tool: byTool,
        time_saved_this_week_minutes: thisWeek.reduce((sum, m) => sum + (m.time_saved_minutes ?? 0), 0) + unlinkedMinutes,
        time_saved_other_actions_minutes: unlinkedMinutes,
        time_saved_total_minutes: ready.reduce((sum, m) => sum + (m.time_saved_minutes ?? 0), 0),
        week_start: since,
      },
      meetings: rows.map((m) => ({
        id: m.id,
        title: m.title ?? m.source_title ?? 'Untitled meeting',
        status: m.status,
        error: m.error,
        recorded_at: m.recorded_at ?? m.created_at,
        duration_seconds: m.duration_seconds,
        time_saved_minutes: m.time_saved_minutes,
        action_count: m.action_items?.[0]?.count ?? 0,
        summary: m.summary ? (m.summary.length > 240 ? `${m.summary.slice(0, 240)}…` : m.summary) : null,
        gdoc_url: m.gdoc_url,
        indexed_at: m.processing_finished_at,
      })),
      pending: openRows.slice(0, 50).map((a) => ({
        id: a.id,
        task: a.task,
        owner: a.owner,
        owner_contact: handleOf(a.owner),
        due_text: a.due_text,
        due_date: a.due_date,
        kind: a.kind,
        meeting_id: a.meeting_id,
        meeting: a.meetings?.title ?? null,
      })),
    });
  }),
);

appRouter.get(
  '/calendar/next',
  handle(async (_req, res) => {
    // The same "what's next" Pooja uses: calendar events + planned follow-ups, by date.
    const item = await remembered('next-event', 60_000, () => nextUpcoming());
    res.json({
      event: item && {
        title: item.title,
        when: item.when,
        start: item.start,
        attendees: item.people,
        kind: item.kind,
        on_calendar: item.on_calendar,
        from_meeting: item.from_meeting,
        link: item.link,
      },
    });
  }),
);

appRouter.get(
  '/status',
  handle(async (req, res) => {
    const toolkits = ['gmail', 'slack', 'googlecalendar', 'googlesheets', 'googledocs', 'googledrive'];
    // ?fresh=1 (profile menu "Refresh") re-checks Composio instead of using the 5-minute cache.
    if (req.query.fresh === '1') memo.delete('status');
    const status = await remembered('status', 5 * 60_000, async () =>
      Object.fromEntries(await Promise.all(toolkits.map(async (t) => [t, await isToolkitConnected(t).catch(() => false)]))),
    );
    res.json({ composio: status, user_id: config.composioUserId, slack_channel: config.slackChannel, tracker: config.trackerSheetName });
  }),
);

// ------------------------------------------------------------------- profile

appRouter.get(
  '/profile',
  handle(async (_req, res) => {
    res.json({ profile: await getProfile() });
  }),
);

appRouter.put(
  '/profile',
  handle(async (req, res) => {
    try {
      res.json({ profile: await saveProfile(req.body ?? {}) });
    } catch (err) {
      res.status(/^(Could not save|Profile saved, but)/.test(message(err)) ? 500 : 400).json({ error: message(err) });
    }
  }),
);

// ------------------------------------------------------------------ meetings

appRouter.get(
  '/meetings/:id/audio',
  handle(async (req, res) => {
    if (!UUID.test(String(req.params.id))) {
      res.status(400).json({ error: 'Invalid meeting id.' });
      return;
    }
    const { data, error } = await supabase.from('meetings').select('audio_path, audio_mime').eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.audio_path) {
      res.status(404).json({ error: 'No stored recording for this meeting.' });
      return;
    }
    const signed = await supabase.storage.from(config.audioBucket).createSignedUrl(data.audio_path, 3600);
    if (signed.error) throw new Error(signed.error.message);
    res.json({ url: signed.data.signedUrl, mime: data.audio_mime, expires_in: 3600 });
  }),
);

/** Creates the meeting's Google Doc when the pipeline couldn't (or it was never made). */
appRouter.post(
  '/meetings/:id/gdoc',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid meeting id.' });
      return;
    }
    const built = await meetingDocMarkdown(id);
    if (!built) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }
    const { meeting: m, markdown } = built;
    if (m.gdoc_url) {
      res.json({ url: m.gdoc_url, created: false });
      return;
    }
    const started = Date.now();
    try {
      const doc = await createKnowledgeDoc(built.title, markdown);
      await supabase.from('meetings').update({ gdoc_id: doc.id, gdoc_url: doc.url }).eq('id', id);
      void logActivity({ sessionId: 'web', tool: 'create_google_doc', args: { meeting_id: id }, status: 'confirmed', result: doc, durationMs: Date.now() - started });
      res.json({ url: doc.url, created: true });
    } catch (err) {
      void logActivity({ sessionId: 'web', tool: 'create_google_doc', args: { meeting_id: id }, status: 'error', error: message(err) });
      throw err;
    }
  }),
);

/** Logs that the user opened a meeting's Google Doc from the app. */
appRouter.post(
  '/meetings/:id/gdoc/opened',
  handle(async (req, res) => {
    void logActivity({ sessionId: 'web', tool: 'open_google_doc', args: { meeting_id: req.params.id }, status: 'ok' });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------- actions
// The web app's confirm dialog shows `preview`'s summary; "Confirm" calls `execute`.

const actionBody = z.object({ kind: z.enum(ACTION_KINDS), input: z.record(z.string(), z.unknown()).default({}) });

appRouter.post(
  '/actions/preview',
  handle(async (req, res) => {
    const body = actionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Body must be { kind, input }.' });
      return;
    }
    const { summary, args } = await prepareAction(body.data.kind, body.data.input);
    res.json({ summary, args });
  }),
);

appRouter.post(
  '/actions/execute',
  handle(async (req, res) => {
    const body = actionBody.safeParse(req.body);
    if (!body.success || !isActionKind(body.data.kind)) {
      res.status(400).json({ error: 'Body must be { kind, input }.' });
      return;
    }
    const outcome = await executeNow(body.data.kind, body.data.input);
    res.status(outcome.ok ? 200 : 502).json(outcome);
  }),
);

// -------------------------------------------------------------- action items

appRouter.patch(
  '/action-items/:id',
  handle(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ status: z.enum(['open', 'done']) }).safeParse(req.body);
    if (!UUID.test(id) || !body.success) {
      res.status(400).json({ error: 'Body must be { status: "open" | "done" }.' });
      return;
    }
    const { data: item, error } = await supabase
      .from('action_items')
      .update({ status: body.data.status })
      .eq('id', id)
      .select('id, task, owner, due_text, due_date, kind, status, meetings(title)')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) {
      res.status(404).json({ error: 'Action item not found.' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meetingTitle = (item as any).meetings?.title ?? null;
    let sheet: { ok: boolean; error?: string; row?: number | null; appended?: boolean };
    try {
      sheet = { ok: true, ...(await setTrackerStatus({ task: item.task, owner: item.owner, due: item.due_text ?? item.due_date, meeting: meetingTitle, kind: item.kind }, body.data.status === 'done' ? 'Done' : 'Open')) };
    } catch (err) {
      sheet = { ok: false, error: message(err) };
    }
    void logActivity({
      sessionId: 'web',
      tool: body.data.status === 'done' ? 'mark_complete' : 'reopen_item',
      args: { id, task: item.task },
      status: sheet.ok ? 'ok' : 'error',
      result: sheet,
      error: sheet.error,
    });
    res.json({ item, sheet });
  }),
);

// ------------------------------------------------------------------- contacts

const contactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  slack_handle: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s.replace(/^@/, '') || null)
    .nullable()
    .optional(),
  role: z.string().trim().max(120).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

appRouter.get(
  '/contacts',
  handle(async (_req, res) => {
    const { data, error } = await supabase.from('contacts').select('id, name, email, slack_handle, role, aliases, created_at').order('created_at');
    if (error) throw new Error(error.message);
    res.json({ contacts: data });
  }),
);

appRouter.post(
  '/contacts',
  handle(async (req, res) => {
    const body = contactBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const first = body.data.name.split(' ')[0];
    const { data, error } = await supabase
      .from('contacts')
      .insert({ ...body.data, aliases: body.data.aliases ?? (first !== body.data.name ? [first] : []) })
      .select('id, name, email, slack_handle, role, aliases, created_at')
      .single();
    if (error) {
      res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? `A contact named "${body.data.name}" already exists.` : error.message });
      return;
    }
    allContacts.reset();
    res.status(201).json({ contact: data });
  }),
);

appRouter.patch(
  '/contacts/:id',
  handle(async (req, res) => {
    const body = contactBody.partial().safeParse(req.body);
    if (!UUID.test(String(req.params.id)) || !body.success) {
      res.status(400).json({ error: body.success ? 'Invalid contact id.' : body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const { data, error } = await supabase
      .from('contacts')
      .update(body.data)
      .eq('id', req.params.id)
      .select('id, name, email, slack_handle, role, aliases, created_at')
      .maybeSingle();
    if (error) {
      res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Another contact already has that name.' : error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    allContacts.reset();
    res.json({ contact: data });
  }),
);

// -------------------------------------------------------------------- tracker

appRouter.get(
  '/tracker/sheet',
  handle(async (_req, res) => {
    res.json({ url: await remembered('sheet-url', 10 * 60_000, () => trackerSheetUrl()) });
  }),
);

// ---------------------------------------------------------------- voice page

/** "What Tatva is doing": this call's tool calls plus the action waiting for a yes. */
appRouter.get(
  '/voice/timeline',
  handle(async (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session.slice(0, 120) : '';
    let activity = supabase
      .from('activity_log')
      .select('id, created_at, session_id, tool, args, status, result, error, duration_ms')
      .order('id', { ascending: false })
      .limit(session ? 40 : 8);
    if (session) activity = activity.eq('session_id', session);
    let pending = supabase
      .from('pending_actions')
      .select('id, created_at, session_id, kind, args, summary, status, error')
      .in('status', ['pending', 'failed'])
      .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (session) pending = pending.eq('session_id', session);
    const [a, p] = await Promise.all([activity, pending]);
    if (a.error) throw new Error(a.error.message);
    if (p.error) throw new Error(p.error.message);
    res.json({ session: session || null, activity: (a.data ?? []).reverse(), pending: p.data?.[0] ?? null });
  }),
);

/** Approve a pending action from the app (outside a call, or as a fallback). */
appRouter.post(
  '/voice/pending/:id/confirm',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }
    const { data, error } = await supabase
      .from('pending_actions')
      .select('id, session_id, kind, args, summary, status, created_at')
      .eq('id', id)
      .in('status', ['pending', 'failed'])
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ error: 'That action is no longer waiting for approval.' });
      return;
    }
    const outcome = await executePending(data.session_id, data as PendingAction);
    res.status(outcome.ok ? 200 : 502).json(outcome);
  }),
);

appRouter.post(
  '/voice/pending/:id/cancel',
  handle(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }
    const { data, error } = await supabase
      .from('pending_actions')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .in('status', ['pending', 'failed'])
      .select('session_id, kind, args')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ error: 'That action is no longer waiting for approval.' });
      return;
    }
    void logActivity({ sessionId: data.session_id, tool: data.kind, args: data.args, status: 'cancelled' });
    res.json({ ok: true, say: 'Cancelled.' });
  }),
);

/** Counts for "Meeting Artifacts Loaded". */
appRouter.get(
  '/voice/stats',
  handle(async (_req, res) => {
    const count = async (table: string, filter?: (q: ReturnType<typeof supabase.from>) => unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = filter(q);
      const { count: n, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      return n ?? 0;
    };
    const [recordings, segments, documents, chunks] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count('meetings', (q: any) => q.eq('status', 'ready')),
      count('transcript_segments'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count('documents', (q: any) => q.eq('status', 'ready')),
      count('knowledge_chunks'),
    ]);
    res.json({ recordings, transcript_lines: segments, documents, chunks });
  }),
);

// Meetings changed: callers that cache the recent list should refresh it.
export function invalidateMeetingCaches() {
  recentMeetings.reset();
}
