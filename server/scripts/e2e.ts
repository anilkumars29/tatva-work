// pnpm run test:e2e -- <path-to-recording.webm> [search question]
//
// Uploads a recording to the running server (http://localhost:4000), follows
// its status until ready/failed, prints the extracted knowledge, then runs a
// RAG search against it.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const [filePath, question = 'Who owns the next steps and when are they due?'] = process.argv.slice(2).filter((a) => a !== '--');

async function main() {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Usage: pnpm run test:e2e -- <path-to-recording.webm> ["search question"]');
  }
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Server not reachable at ${BASE}. Start it with: pnpm run dev`);

  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.ogg' ? 'audio/ogg' : ext === '.wav' ? 'audio/wav' : ext === '.mp3' ? 'audio/mpeg' : 'audio/webm';
  const form = new FormData();
  form.append('audio', await fs.openAsBlob(filePath, { type }), path.basename(filePath));
  form.append('title_hint', 'E2E test upload');
  form.append('recorded_at', new Date().toISOString());

  console.log(`Uploading ${filePath} …`);
  const created = await fetch(`${BASE}/api/meetings`, { method: 'POST', body: form });
  const createdBody = (await created.json()) as { id?: string; error?: string };
  if (!created.ok || !createdBody.id) throw new Error(`Upload failed (${created.status}): ${createdBody.error}`);
  const id = createdBody.id;
  console.log(`Meeting ${id} created (202). Following status…`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meeting: any;
  let lastStatus = '';
  const started = Date.now();
  for (;;) {
    const response = await fetch(`${BASE}/api/meetings/${id}?transcript=false`);
    meeting = ((await response.json()) as { meeting: unknown }).meeting;
    if (meeting.status !== lastStatus) {
      console.log(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s  ${meeting.status}`);
      lastStatus = meeting.status;
    }
    if (meeting.status === 'ready' || meeting.status === 'failed') break;
    if (Date.now() - started > 15 * 60_000) throw new Error('Timed out after 15 minutes.');
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (meeting.status === 'failed') throw new Error(`Pipeline failed: ${meeting.error}`);

  console.log(`\nTitle:       ${meeting.title}`);
  console.log(`Summary:     ${meeting.summary}`);
  console.log(`Time saved:  ${meeting.time_saved_minutes} min`);
  console.log(`Decisions:   ${meeting.decisions.length}`);
  for (const d of meeting.decisions) console.log(`  - ${d.decision}`);
  console.log(`Action items: ${meeting.action_items.length}`);
  for (const a of meeting.action_items) console.log(`  - [${a.owner ?? '?'}] ${a.task} (due: ${a.due_text ?? '-'}${a.due_date ? `, ${a.due_date}` : ''})`);
  console.log(`Stats:       ${meeting.stats_mentioned.map((s: { value: string }) => s.value).join(', ') || '-'}`);
  console.log(`Key moments: ${meeting.key_moments.length}`);
  console.log(`Discuss later: ${meeting.discuss_later.length}`);
  for (const d of meeting.discuss_later) console.log(`  - ${d.topic} (${d.suggested_time_text ?? '-'}; ${d.people.join(', ') || '-'})`);
  console.log(`Audio:       ${meeting.audio_path ?? '(not stored)'}`);
  console.log(`Google Doc:  ${meeting.gdoc_url ?? '(none)'}`);
  if (meeting.warnings?.length) console.log(`Warnings:    ${meeting.warnings.join(' | ')}`);

  console.log(`\nRAG search: "${question}"`);
  const search = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: question, match_count: 3, meeting_id: id }),
  });
  const { results, error } = (await search.json()) as { results?: { similarity: number; source_type: string; content: string }[]; error?: string };
  if (!search.ok || !results) throw new Error(`Search failed: ${error}`);
  for (const r of results) {
    console.log(`  ${r.similarity.toFixed(3)} [${r.source_type}] ${r.content.split('\n').slice(1).join(' ').slice(0, 140)}`);
  }
  if (!results.length) throw new Error('Search returned no results.');
  console.log('\nE2E passed.');
}

main().catch((err) => {
  console.error(`\nE2E failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
