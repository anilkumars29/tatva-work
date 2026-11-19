// Read-side helpers for the voice agent: meetings, open items, contacts, RAG.
import { config } from '../config.js';
import { embed } from '../pipeline/embed.js';
import { supabase } from '../supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MeetingRow {
  id: string;
  title: string | null;
  recorded_at: string | null;
  created_at: string;
}

export interface Contact {
  name: string;
  email: string | null;
  slack_handle: string | null;
  aliases: string[];
}

/** "Wed 18 Nov" style label in the display time zone. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return 'unknown date';
  return new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

/** "Monday 23 November, 11:00 am" in the display time zone. */
export function dateTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: config.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

// Small caches: these are read on every voice turn.
function cached<T>(ttlMs: number, load: () => Promise<T>): (() => Promise<T>) & { reset: () => void } {
  let value: { at: number; data: Promise<T> } | null = null;
  const get = () => {
    if (!value || Date.now() - value.at > ttlMs) {
      const data = load();
      data.catch(() => (value = null));
      value = { at: Date.now(), data };
    }
    return value.data;
  };
  return Object.assign(get, { reset: () => (value = null) });
}

export const recentMeetings = cached(30_000, async (): Promise<MeetingRow[]> => {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, recorded_at, created_at')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`List meetings: ${error.message}`);
  return data;
});

export const allContacts = cached(15_000, async (): Promise<Contact[]> => {
  const { data, error } = await supabase.from('contacts').select('name, email, slack_handle, aliases').order('name');
  if (error) {
    console.warn(`[voice] contacts unavailable: ${error.message}`);
    return [];
  }
  return data;
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolves "Priya", "priya sharma", or a literal address to a contact/email. */
export async function resolveContact(nameOrEmail: string): Promise<{ name: string; email: string; contact?: Contact } | null> {
  const raw = nameOrEmail.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { name: raw, email: raw };
  const wanted = norm(raw);
  if (!wanted) return null;
  const contacts = await allContacts();
  const names = (c: Contact) => [c.name, ...c.aliases].map(norm);
  const match =
    contacts.find((c) => names(c).includes(wanted)) ??
    contacts.find((c) => names(c).some((n) => n.split(' ')[0] === wanted.split(' ')[0]));
  if (!match?.email) return null;
  return { name: match.name, email: match.email, contact: match };
}

/** Finds a meeting by id, title words, or (fallback) semantic match. Defaults to the latest. */
export async function resolveMeeting(ref: string | undefined | null): Promise<MeetingRow | null> {
  const meetings = await recentMeetings();
  if (!meetings.length) return null;
  const text = ref?.trim();
  if (!text || /^(latest|last|recent|most recent|today'?s?)( meeting)?$/i.test(text)) return meetings[0];
  if (UUID.test(text)) return meetings.find((m) => m.id === text) ?? null;

  const stop = new Set(['the', 'a', 'an', 'meeting', 'call', 'sync', 'of', 'on', 'in', 'about', 'with', 'our', 'my']);
  const words = norm(text).split(' ').filter((w) => w.length > 1 && !stop.has(w));
  let best: { meeting: MeetingRow; score: number } | null = null;
  for (const meeting of meetings) {
    const title = norm(meeting.title ?? '');
    const score = words.filter((w) => title.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { meeting, score };
  }
  if (best) return best.meeting;

  const hits = await searchKnowledge(text, { count: 3 });
  const id = hits.find((h) => h.meeting_id)?.meeting_id;
  return meetings.find((m) => m.id === id) ?? null;
}

export interface KnowledgeHit {
  meeting_id: string | null;
  meeting: string;
  source_type: string;
  content: string;
  similarity: number;
}

/** pgvector search; returns compact hits labelled with their meeting title. */
export async function searchKnowledge(
  query: string,
  opts: { count?: number; meetingId?: string | null; threshold?: number } = {},
): Promise<KnowledgeHit[]> {
  const [vector] = await embed([query]);
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: JSON.stringify(vector),
    match_count: opts.count ?? 5,
    similarity_threshold: opts.threshold ?? 0.25,
    filter_meeting_id: opts.meetingId ?? null,
  });
  if (error) throw new Error(`Knowledge search: ${error.message}`);
  const meetings = await recentMeetings();
  const titleOf = (row: { meeting_id: string | null; metadata?: Record<string, unknown> | null }) => {
    if (!row.meeting_id) {
      const name = typeof row.metadata?.name === 'string' ? row.metadata.name : null;
      return name ? `document "${name}"${typeof row.metadata?.page === 'number' ? ` p.${row.metadata.page}` : ''}` : 'company document';
    }
    const m = meetings.find((x) => x.id === row.meeting_id);
    return m ? `${m.title ?? 'Untitled'} (${dayLabel(m.recorded_at ?? m.created_at)})` : 'older meeting';
  };
  return (data as Array<{ meeting_id: string | null; source_type: string; content: string; similarity: number; metadata?: Record<string, unknown> | null }>).map((row) => ({
    meeting_id: row.meeting_id,
    meeting: titleOf(row),
    source_type: row.source_type,
    content: row.content.length > 450 ? `${row.content.slice(0, 450)}…` : row.content,
    similarity: Math.round(row.similarity * 100) / 100,
  }));
}

export interface MeetingDetails {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  decisions: string[];
  action_items: { task: string; owner: string | null; due: string | null; status: string }[];
  discuss_later: { topic: string; people: string[]; when: string | null; status: string }[];
  stats: string[];
  time_saved_minutes: number | null;
  gdoc_url: string | null;
}

export async function meetingDetails(id: string): Promise<MeetingDetails | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select(
      'id, title, recorded_at, created_at, summary, decisions, stats_mentioned, time_saved_minutes, gdoc_url, ' +
        'action_items(position, task, owner, due_text, due_date, status), ' +
        'discuss_later(position, topic, people, suggested_time_text, suggested_at, status)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Meeting details: ${error.message}`);
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = data;
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position;
  return {
    id: m.id,
    title: m.title ?? 'Untitled meeting',
    date: dayLabel(m.recorded_at ?? m.created_at),
    summary: m.summary,
    decisions: (m.decisions ?? []).map((d: { decision: string; context?: string }) =>
      d.context ? `${d.decision} (${d.context})` : d.decision,
    ),
    action_items: (m.action_items ?? []).sort(byPos).map((a: Record<string, string | null>) => ({
      task: a.task,
      owner: a.owner,
      due: a.due_text ?? a.due_date,
      status: a.status,
    })),
    discuss_later: (m.discuss_later ?? []).sort(byPos).map((d: Record<string, unknown>) => ({
      topic: d.topic as string,
      people: d.people as string[],
      when: d.suggested_at ? dateTimeLabel(d.suggested_at as string) : ((d.suggested_time_text as string) ?? null),
      status: d.status as string,
    })),
    stats: (m.stats_mentioned ?? []).map((s: { value: string; context: string }) => `${s.value}: ${s.context}`),
    time_saved_minutes: m.time_saved_minutes,
    gdoc_url: m.gdoc_url,
  };
}

export interface OpenItems {
  action_items: { task: string; owner: string | null; due: string | null; meeting: string }[];
  discuss_later: { topic: string; people: string[]; when: string | null; meeting: string }[];
}

/** Open action items and parked topics, de-duplicated across re-processed meetings. */
export async function openItems(opts: { owner?: string; meetingId?: string } = {}): Promise<OpenItems> {
  let actions = supabase
    .from('action_items')
    .select('task, owner, due_text, due_date, meeting_id, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(60);
  let later = supabase
    .from('discuss_later')
    .select('topic, people, suggested_time_text, suggested_at, meeting_id, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(30);
  if (opts.meetingId) {
    actions = actions.eq('meeting_id', opts.meetingId);
    later = later.eq('meeting_id', opts.meetingId);
  }
  const [a, l, meetings] = await Promise.all([actions, later, recentMeetings()]);
  if (a.error) throw new Error(`Open action items: ${a.error.message}`);
  if (l.error) throw new Error(`Open discuss-later items: ${l.error.message}`);
  const titleOf = (id: string) => meetings.find((m) => m.id === id)?.title ?? 'a past meeting';
  const key = (s: string) => norm(s).replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, '');

  const seen = new Set<string>();
  const owner = opts.owner ? norm(opts.owner) : null;
  const action_items = a.data
    .filter((row) => !owner || norm(row.owner ?? '').includes(owner.split(' ')[0]))
    .filter((row) => !seen.has(key(row.task)) && seen.add(key(row.task)))
    .map((row) => ({ task: row.task, owner: row.owner, due: row.due_text ?? row.due_date, meeting: titleOf(row.meeting_id) }));
  const discuss_later = l.data
    .filter((row) => !seen.has(key(row.topic)) && seen.add(key(row.topic)))
    .map((row) => ({
      topic: row.topic,
      people: row.people,
      when: row.suggested_at ? dateTimeLabel(row.suggested_at) : row.suggested_time_text,
      meeting: titleOf(row.meeting_id),
    }));
  return { action_items, discuss_later };
}
