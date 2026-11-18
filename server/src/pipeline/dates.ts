// Deterministic checks on dates the LLM resolved. LLMs are unreliable at
// weekday arithmetic, so when the spoken phrase names a weekday or says
// "next week", make sure the resolved date actually matches it.
// Read directly (not via config.ts) so this module and its tests need no secrets.
const TIME_ZONE = process.env.TZ_DISPLAY?.trim() || 'Asia/Kolkata';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ymdFormat = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayFormat = () => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'long' });

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localYmd(date: Date): string {
  return ymdFormat().format(date);
}

/** Local weekday index (0 = Sunday) of an instant. */
function localWeekday(date: Date): number {
  return WEEKDAYS.indexOf(weekdayFormat().format(date).toLowerCase());
}

/** Offset of TIME_ZONE at the given instant, e.g. "+05:30". */
export function zoneOffset(date: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : '+00:00';
}

/** First weekday mentioned in a phrase ("by Friday", "next Tuesday afternoon"), or null. */
function mentionedWeekday(phrase: string): number | null {
  const match = phrase.toLowerCase().match(/\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/);
  if (!match) return null;
  const prefix = match[1].slice(0, 3);
  return WEEKDAYS.findIndex((d) => d.startsWith(prefix));
}

/**
 * The calendar date a spoken phrase should resolve to, if it is one we can
 * check: a weekday ("Friday", "next Tuesday") -> the first such day after the
 * meeting (a week later if "next week <day>" / "<day> next week"); optionally
 * "next week" alone -> Monday of next week (for follow-up meetings, not for
 * deadlines like "by the end of next week"). Returns null when there is no cue.
 */
export function expectedDate(
  phrase: string | null,
  recordedAt: Date,
  opts: { nextWeekMeansMonday: boolean },
): string | null {
  if (!phrase) return null;
  const text = phrase.toLowerCase();
  const today = localWeekday(recordedAt);
  const weekday = mentionedWeekday(text);

  if (weekday !== null) {
    let ahead = (weekday - today + 7) % 7 || 7; // strictly after the meeting day
    if (/\bnext week\b/.test(text) && ahead <= 7 - today) ahead += 7; // "Friday next week" -> next week's Friday
    return localYmd(new Date(recordedAt.getTime() + ahead * DAY_MS));
  }
  if (opts.nextWeekMeansMonday && /\bnext week\b/.test(text) && !/\b(end|mid|late|later)\b/.test(text)) {
    const toMonday = ((1 - today + 7) % 7) || 7;
    return localYmd(new Date(recordedAt.getTime() + toMonday * DAY_MS));
  }
  return null;
}

/** Corrects a YYYY-MM-DD due date against its spoken phrase. */
export function fixDueDate(dueDate: string | null, phrase: string | null, recordedAt: Date): string | null {
  return expectedDate(phrase, recordedAt, { nextWeekMeansMonday: false }) ?? dueDate;
}

/**
 * Corrects an ISO date-time against its spoken phrase, keeping the LLM's time
 * of day (or 11:00 if it has none).
 */
export function fixDateTime(value: string | null, phrase: string | null, recordedAt: Date): string | null {
  const expected = expectedDate(phrase, recordedAt, { nextWeekMeansMonday: true });
  if (!expected) return value;
  const time = value?.match(/T(\d{2}:\d{2})(?::\d{2})?/)?.[1] ?? '11:00';
  const probe = new Date(`${expected}T12:00:00Z`);
  return `${expected}T${time}:00${zoneOffset(probe)}`;
}
