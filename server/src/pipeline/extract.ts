import { z } from 'zod';
import { config } from '../config.js';
import { groqPost } from '../groq.js';
import { fixDateTime, fixDueDate, zoneOffset } from './dates.js';
import { formatTimestamp, type Segment } from './transcribe.js';

// ---- Output contract ---------------------------------------------------------

const nullableString = z.string().nullable();

export const knowledgeSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  decisions: z.array(z.object({ decision: z.string(), context: nullableString })),
  action_items: z.array(
    z.object({
      task: z.string(),
      owner: nullableString,
      due: nullableString, // as said in the meeting, e.g. "by Friday"
      due_date: nullableString, // YYYY-MM-DD when it can be resolved
    }),
  ),
  stats_mentioned: z.array(
    z.object({ value: z.string(), context: z.string(), timestamp_sec: z.number().nullable() }),
  ),
  key_moments: z.array(z.object({ timestamp_sec: z.number(), note: z.string() })),
  discuss_later: z.array(
    z.object({
      topic: z.string(),
      suggested_time: nullableString, // as said, e.g. "next Tuesday afternoon"
      suggested_datetime: nullableString, // ISO 8601 with offset; always filled (server falls back if invalid)
      people: z.array(z.string()),
    }),
  ),
  time_saved: z.object({
    minutes: z.number(),
    breakdown: z.array(z.object({ task: z.string(), minutes: z.number() })),
  }),
});

export type Knowledge = z.infer<typeof knowledgeSchema>;

// JSON Schema for Groq strict structured outputs: every property required,
// no extra properties, optional values expressed as nullable.
const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: 'array', items });

const jsonSchema = obj({
  title: str,
  summary: str,
  decisions: arr(obj({ decision: str, context: nstr })),
  action_items: arr(obj({ task: str, owner: nstr, due: nstr, due_date: nstr })),
  stats_mentioned: arr(obj({ value: str, context: str, timestamp_sec: { type: ['number', 'null'] } })),
  key_moments: arr(obj({ timestamp_sec: { type: 'number' }, note: str })),
  discuss_later: arr(obj({ topic: str, suggested_time: nstr, suggested_datetime: str, people: arr(str) })),
  time_saved: obj({ minutes: { type: 'number' }, breakdown: arr(obj({ task: str, minutes: { type: 'number' } })) }),
});

// ---- Prompts -------------------------------------------------------------------

// LLMs are unreliable at weekday arithmetic, so give them a lookup table:
// the meeting day and the next 14 days, e.g. "Mon 2026-11-23".
function upcomingCalendar(recordedAt: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short' });
  const days: string[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(recordedAt.getTime() + i * 86_400_000);
    days.push(`${i === 0 ? '(today) ' : ''}${weekday.format(d)} ${fmt.format(d)}`);
  }
  return days.join(', ');
}

function systemPrompt(meta: MeetingMeta): string {
  return `You turn workplace meeting transcripts into structured knowledge for "Tatva Work".
Return ONLY JSON matching the schema. Use only facts stated in the transcript; never invent people, numbers or dates.

Context:
- Meeting recorded at: ${meta.recordedAtLocal} (${config.timeZone}). Resolve relative dates ("Friday", "next week") against this.
- Calendar for resolving weekdays (use it; do not compute weekdays yourself): ${upcomingCalendar(meta.recordedAt)}. "Friday" / "by Friday" = the first Friday after today; "next Tuesday" = the first Tuesday after today unless the speaker clearly means the following week.
- Meeting length: ${meta.durationMinutes.toFixed(1)} minutes.${meta.sourceTitle ? `\n- Browser tab title: "${meta.sourceTitle}" (may hint at the meeting name).` : ''}
- Transcript lines start with [mm:ss] or [h:mm:ss] offsets from the start of the recording. Speakers are not labelled.

Fields:
- title: short, specific meeting title (max 8 words). Not "Meeting" or the tab title verbatim.
- summary: 3-6 sentences: purpose, main outcomes, next steps.
- decisions: things agreed or decided. context = why / constraints, or null.
- action_items: concrete tasks someone committed to or was asked to do. due = deadline as spoken, or null. due_date = YYYY-MM-DD if the deadline can be resolved, else null.
  owner rules (speakers are unlabelled):
  * A name said with the task is the owner: "Priya, can you send the deck?" -> Priya; "Rahul will fix the bug" -> Rahul; "Meera should update the sheet" -> Meera; "Ask Karan to check" -> Karan.
  * "I will..." / "I'll..." -> the person who was just addressed by name and is answering (e.g. "Arjun, where are we?" then "...I will finish it by Friday" -> Arjun). If that is not clear, null.
  * "We will..." or no name near the task -> null. Never guess from unrelated mentions.
  Include tasks with no clear owner too (owner null), even vague ones like "someone should check the vendor contract at some point". Do NOT add an action item that only says to discuss/review/revisit something later; that belongs in discuss_later (unless someone must prepare work for it).
- stats_mentioned: every number, amount, percentage, date-bound target or metric, with what it refers to. value = the figure as spoken (e.g. "4.5 lakh", "20%"). timestamp_sec = seconds offset where it was said, or null.
- key_moments: 3-8 important moments (decision made, problem raised, disagreement, commitment). timestamp_sec = seconds offset.
- discuss_later: EVERY topic planned for a future meeting, discussion, review or check-in, including ones that are also a decision or an action item (list them in both places). Triggers include "let's discuss X on Tuesday", "review it next week", "park this", "revisit after the launch", "sync with Priya on Friday", "follow up next month". suggested_time = when, as spoken, or null if no time was given. suggested_datetime = ALWAYS an ISO 8601 date-time with the local offset (e.g. 2026-11-24T15:00:00+05:30), using the calendar above: exact day and time if both were said; a day without a time -> 11:00 that day; "morning" -> 10:00, "afternoon" -> 15:00, "evening" -> 17:00; "next week" -> Monday of next week 11:00; "next month" -> first working day of next month 11:00; "after <event>" -> the working day after that event 11:00 if its date is known; no timing at all -> 2 working days after the meeting at 11:00. Never a weekend. people = names involved (may be empty).
- time_saved: realistic minutes this assistant saves the team versus doing it manually: writing notes, the summary, tracking action items, drafting follow-up emails, scheduling follow-ups. Base it on meeting length and how many items there are. breakdown lists each task with its minutes; minutes = their sum.

Use empty arrays when there is nothing for a field.`;
}

function transcriptLines(segments: Segment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join('\n');
}

// Groq counts input + max_completion_tokens against the tokens-per-minute
// limit before running (free tier: 8000 TPM), so size the output budget to fit.
function completionBudget(system: string, user: string): number {
  const estimatedInput = Math.ceil((system.length + user.length) / 3.2);
  const fits = config.llmTpmLimit - estimatedInput - 300;
  return Math.max(1024, Math.min(config.llmMaxCompletionTokens, fits));
}

async function callLlmOnce(system: string, user: string): Promise<Knowledge> {
  const maxCompletionTokens = completionBudget(system, user);
  const response = (await groqPost('/chat/completions', () => ({
    json: true,
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0,
      // gpt-oss spends part of the budget on reasoning; leave room for the JSON.
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: config.llmReasoningEffort,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'meeting_knowledge', strict: true, schema: jsonSchema },
      },
    }),
  }))) as { choices: { message: { content: string } }[] };

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned an empty response.');
  return knowledgeSchema.parse(JSON.parse(content));
}

// Structured output occasionally fails validation (e.g. truncated); one retry
// usually succeeds.
async function callLlm(system: string, user: string): Promise<Knowledge> {
  try {
    return await callLlmOnce(system, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/json_validate_failed|max completion tokens|JSON|ZodError|invalid_type/i.test(message)) throw err;
    console.warn(`[extract] invalid structured output, retrying once: ${message.slice(0, 160)}`);
    return callLlmOnce(system, user);
  }
}

// Splits segments into parts of at most `maxChars` transcript characters.
function splitSegments(segments: Segment[], maxChars: number): Segment[][] {
  const parts: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const segment of segments) {
    const length = segment.text.length + 12;
    if (current.length && size + length > maxChars) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += length;
  }
  if (current.length) parts.push(current);
  return parts;
}

function isValidSuggestion(value: string | null): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short' }).format(new Date(value));
  return weekday !== 'Sat' && weekday !== 'Sun';
}

/** Fallback: 2 working days after the meeting, 11:00 local time. */
function defaultFollowUp(recordedAt: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short' });
  let day = new Date(recordedAt.getTime());
  let workingDays = 0;
  while (workingDays < 2) {
    day = new Date(day.getTime() + 86_400_000);
    if (!['Sat', 'Sun'].includes(weekday.format(day))) workingDays++;
  }
  return `${ymd.format(day)}T11:00:00${zoneOffset(day)}`;
}

export interface MeetingMeta {
  recordedAt: Date;
  recordedAtLocal: string;
  durationMinutes: number;
  sourceTitle: string | null;
}

export async function extractKnowledge(segments: Segment[], meta: MeetingMeta): Promise<Knowledge> {
  const system = systemPrompt(meta);
  const parts = splitSegments(segments, config.llmMaxTranscriptChars);

  let knowledge: Knowledge;
  if (parts.length === 1) {
    knowledge = await callLlm(system, `Transcript:\n${transcriptLines(segments)}`);
  } else {
    // Long meeting: extract each part, then merge the partial results.
    const partials: Knowledge[] = [];
    for (const [i, part] of parts.entries()) {
      console.log(`[extract] part ${i + 1}/${parts.length}`);
      partials.push(
        await callLlm(
          system,
          `This is part ${i + 1} of ${parts.length} of a longer meeting. Extract only what is in this part; for time_saved estimate this part only.\n\nTranscript:\n${transcriptLines(part)}`,
        ),
      );
    }
    console.log('[extract] merging parts');
    knowledge = await callLlm(
      system,
      `Below are structured extractions from consecutive parts of ONE meeting, in order. Merge them into a single result for the whole meeting: one title and summary, deduplicated decisions / action items / stats / discuss-later items, the 3-8 most important key moments, and one time_saved estimate for the whole meeting. Keep timestamps as given.\n\n${JSON.stringify(partials)}`,
    );
  }

  // Keep the estimate sane and consistent.
  const cap = Math.round(meta.durationMinutes * 3 + 60);
  const minutes = Math.min(Math.max(0, Math.round(knowledge.time_saved.minutes)), cap);
  knowledge.time_saved = { ...knowledge.time_saved, minutes };

  // Check resolved dates against what was said (weekday maths), then make sure
  // every discuss-later item has a usable suggested date/time.
  for (const item of knowledge.action_items) {
    item.due_date = fixDueDate(item.due_date, item.due, meta.recordedAt);
  }
  for (const item of knowledge.discuss_later) {
    item.suggested_datetime = fixDateTime(item.suggested_datetime, item.suggested_time, meta.recordedAt);
    if (!isValidSuggestion(item.suggested_datetime)) item.suggested_datetime = defaultFollowUp(meta.recordedAt);
  }
  return knowledge;
}
