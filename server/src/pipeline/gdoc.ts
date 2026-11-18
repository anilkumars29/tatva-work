import { executeTool, findDeep } from '../composio.js';
import type { Knowledge } from './extract.js';
import { formatTimestamp, type Segment } from './transcribe.js';

const MAX_TRANSCRIPT_CHARS = 100_000;

function bullets(items: string[], empty: string): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : `_${empty}_`;
}

export function buildMarkdown(
  knowledge: Knowledge,
  segments: Segment[],
  info: { dateLabel: string; durationMinutes: number },
): string {
  let transcript = segments.map((s) => `**[${formatTimestamp(s.start)}]** ${s.text}`).join('\n\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n_(Transcript truncated; full text is stored in Tatva Work.)_`;
  }

  return `# ${knowledge.title}

**Date:** ${info.dateLabel}
**Length:** ${Math.max(1, Math.round(info.durationMinutes))} min
**Time saved by Tatva Work:** ~${knowledge.time_saved.minutes} min

## Summary

${knowledge.summary}

## Decisions

${bullets(
  knowledge.decisions.map((d) => (d.context ? `${d.decision} (${d.context})` : d.decision)),
  'No decisions recorded.',
)}

## Action items

${bullets(
  knowledge.action_items.map(
    (a) => `**${a.owner ?? 'Unassigned'}:** ${a.task}${a.due ? ` (due ${a.due}${a.due_date ? `, ${a.due_date}` : ''})` : ''}`,
  ),
  'No action items.',
)}

## Numbers mentioned

${bullets(
  knowledge.stats_mentioned.map(
    (s) => `**${s.value}**: ${s.context}${s.timestamp_sec != null ? ` [${formatTimestamp(s.timestamp_sec)}]` : ''}`,
  ),
  'No figures mentioned.',
)}

## Key moments

${bullets(
  knowledge.key_moments.map((m) => `**[${formatTimestamp(m.timestamp_sec)}]** ${m.note}`),
  'No key moments.',
)}

## Discuss later

${bullets(
  knowledge.discuss_later.map(
    (d) =>
      `${d.topic}${d.suggested_time ? `, ${d.suggested_time}` : ''}${d.people.length ? ` (with ${d.people.join(', ')})` : ''}`,
  ),
  'Nothing parked for later.',
)}

## Time saved breakdown

${bullets(
  knowledge.time_saved.breakdown.map((b) => `${b.task}: ${b.minutes} min`),
  'No breakdown.',
)}

## Transcript

${transcript}
`;
}

/** Creates the meeting's knowledge doc in Google Docs via Composio. */
export async function createKnowledgeDoc(docTitle: string, markdown: string): Promise<{ id: string; url: string }> {
  const data = await executeTool('googledocs', 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', {
    title: docTitle,
    markdown_text: markdown,
  });
  // Prefer an explicit document id anywhere in the response before a bare `id`.
  const id = findDeep(data, ['documentId', 'document_id']) ?? findDeep(data, ['id']);
  if (!id) throw new Error(`Google Doc created but no document id in response: ${JSON.stringify(data).slice(0, 300)}`);
  return { id, url: `https://docs.google.com/document/d/${id}/edit` };
}
