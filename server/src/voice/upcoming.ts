// "What's next" = calendar events + planned follow-ups, merged (pure, unit-tested).
// A follow-up from a meeting ("let's discuss store training on Thursday at 3")
// may or may not be on the calendar yet; Pooja must say which.

export interface EventLike {
  title: string;
  start: string; // ISO
  attendees: string[];
  link: string | null;
}

export interface FollowUpLike {
  id: string;
  topic: string;
  people: string[];
  suggested_at: string | null; // ISO
  meeting: string | null;
}

export interface MergedItem {
  kind: 'calendar_event' | 'follow_up';
  title: string;
  when: string; // filled in by the caller (display time zone)
  start: string;
  people: string[];
  /** For follow-ups: whether a matching calendar event exists. Calendar events are always true. */
  on_calendar: boolean;
  /** The meeting a follow-up came from. */
  from_meeting: string | null;
  follow_up_id: string | null;
  link: string | null;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);

/** A follow-up is on the calendar when an event shares its words (both, for two-word topics), or its time slot and a word. */
export function sameEvent(topic: string, followUpAt: string | null, event: { title: string; start: string }): boolean {
  const t = words(topic);
  const e = new Set(words(event.title));
  const shared = t.filter((w) => e.has(w)).length;
  const sameSlot = !!followUpAt && Math.abs(Date.parse(followUpAt) - Date.parse(event.start)) <= 30 * 60_000;
  return (t.length > 0 && shared >= Math.min(2, t.length)) || (sameSlot && shared >= 1);
}

/**
 * Calendar events and follow-ups in one list, earliest first. A follow-up that
 * matches an event becomes one item (on_calendar: true); past follow-ups
 * (over an hour ago) are dropped. `onlyFollowUps` (meeting mode) leaves out
 * calendar events that aren't one of the follow-ups.
 */
export function mergeUpcoming(events: EventLike[], followUps: FollowUpLike[], opts: { onlyFollowUps: boolean; now?: number }): MergedItem[] {
  const now = opts.now ?? Date.now();
  const items: MergedItem[] = [];
  const matched = new Set<EventLike>();
  for (const f of followUps) {
    if (!f.suggested_at || Date.parse(f.suggested_at) < now - 60 * 60_000) continue;
    const event = events.find((e) => !matched.has(e) && sameEvent(f.topic, f.suggested_at, e));
    if (event) matched.add(event);
    items.push({
      kind: 'follow_up',
      title: event?.title ?? f.topic,
      when: '',
      start: event?.start ?? new Date(f.suggested_at).toISOString(),
      people: f.people.length ? f.people : (event?.attendees ?? []),
      on_calendar: !!event,
      from_meeting: f.meeting,
      follow_up_id: f.id,
      link: event?.link ?? null,
    });
  }
  if (!opts.onlyFollowUps)
    for (const e of events)
      if (!matched.has(e) && Date.parse(e.start) >= now - 60 * 60_000)
        items.push({ kind: 'calendar_event', title: e.title, when: '', start: e.start, people: e.attendees, on_calendar: true, from_meeting: null, follow_up_id: null, link: e.link });
  return items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
