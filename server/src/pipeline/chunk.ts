import type { Knowledge } from './extract.js';
import { formatTimestamp, type Segment } from './transcribe.js';

export interface KnowledgeChunk {
  source_type: 'summary' | 'decision' | 'action_item' | 'stat' | 'key_moment' | 'discuss_later' | 'transcript';
  content: string;
  metadata: Record<string, unknown>;
}

const TRANSCRIPT_WINDOW_CHARS = 900;

/**
 * Builds RAG chunks for one meeting: one chunk per extracted item (precise
 * answers, e.g. "who owns the vendor follow-up?") plus overlapping transcript
 * windows (context and quotes). Every chunk starts with the meeting title and
 * date so retrieved text is self-describing.
 */
export function buildChunks(knowledge: Knowledge, segments: Segment[], dateLabel: string): KnowledgeChunk[] {
  const header = `Meeting: ${knowledge.title} (${dateLabel})`;
  const chunks: KnowledgeChunk[] = [];
  const add = (source_type: KnowledgeChunk['source_type'], body: string, metadata: Record<string, unknown> = {}) =>
    chunks.push({ source_type, content: `${header}\n${body}`, metadata });

  add('summary', `Summary: ${knowledge.summary}`);

  knowledge.decisions.forEach((d, i) =>
    add('decision', `Decision: ${d.decision}${d.context ? `\nContext: ${d.context}` : ''}`, { index: i }),
  );

  knowledge.action_items.forEach((a, i) =>
    add(
      'action_item',
      `Action item: ${a.task}\nOwner: ${a.owner ?? 'unassigned'}\nDue: ${a.due ?? 'no deadline'}${a.due_date ? ` (${a.due_date})` : ''}`,
      { index: i, owner: a.owner, due_date: a.due_date },
    ),
  );

  knowledge.stats_mentioned.forEach((s, i) =>
    add(
      'stat',
      `Figure mentioned: ${s.value}: ${s.context}${s.timestamp_sec != null ? ` (at ${formatTimestamp(s.timestamp_sec)})` : ''}`,
      { index: i, timestamp_sec: s.timestamp_sec },
    ),
  );

  knowledge.key_moments.forEach((m, i) =>
    add('key_moment', `Key moment at ${formatTimestamp(m.timestamp_sec)}: ${m.note}`, {
      index: i,
      timestamp_sec: m.timestamp_sec,
    }),
  );

  knowledge.discuss_later.forEach((d, i) =>
    add(
      'discuss_later',
      `To discuss later: ${d.topic}\nWhen: ${d.suggested_time ?? 'not decided'}${d.suggested_datetime ? ` (${d.suggested_datetime})` : ''}\nPeople: ${d.people.length ? d.people.join(', ') : 'not specified'}`,
      { index: i, suggested_datetime: d.suggested_datetime },
    ),
  );

  // Transcript windows of ~900 chars, overlapping by one segment.
  let window: Segment[] = [];
  let size = 0;
  const flush = () => {
    if (!window.length) return;
    const first = window[0];
    const last = window[window.length - 1];
    add(
      'transcript',
      `Transcript ${formatTimestamp(first.start)}-${formatTimestamp(last.end)}:\n${window.map((s) => s.text).join(' ')}`,
      { start_sec: first.start, end_sec: last.end },
    );
  };
  for (const segment of segments) {
    if (window.length && size + segment.text.length > TRANSCRIPT_WINDOW_CHARS) {
      flush();
      window = [window[window.length - 1]];
      size = window[0].text.length;
    }
    window.push(segment);
    size += segment.text.length + 1;
  }
  flush();

  return chunks;
}
