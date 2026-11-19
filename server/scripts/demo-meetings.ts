// pnpm run seed:demo-meetings [-- --only 2]
// Generates three demo meetings with Murf Falcon (one Indian English voice per
// speaker; Pooja is reserved for the assistant), joins each into one WebM/Opus
// recording like the extension's, and uploads it to POST /api/meetings so it
// goes through the real pipeline. Then waits for each to be ready and prints
// what was extracted. Needs MURF_API_KEY (read from ../.env.local).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const SERVER = `http://localhost:${process.env.PORT || 4000}`;
const MURF_KEY = process.env.MURF_API_KEY?.trim();
const PAUSE_SECONDS = 0.45;

// Distinct Falcon en-IN voices; en-IN-pooja is the assistant and not used here.
const VOICES: Record<string, string> = {
  Anil: 'en-IN-aarav',
  Rahul: 'en-IN-nikhil',
  Priya: 'en-IN-anisha',
  Meera: 'en-IN-anusha',
};

const MEETINGS: { title: string; lines: [string, string][] }[] = [
  {
    title: 'Q4 Vendor Review',
    lines: [
      ['Anil', "Let's start. Priya, where are we with CloudOps?"],
      ['Priya', 'They agreed to a 12 percent reduction on the monthly tier. That brings it to 40,000 rupees a month. The total approved budget stays at 2 lakh for the quarter.'],
      ['Rahul', "Engineering is fine with that, as long as the API integration deadline moves to December 15."],
      ['Anil', 'Okay, decision: we renew with CloudOps at the reduced tier, and the API deadline moves to December 15. Priya, can you send the revised contract by Friday?'],
      ['Priya', "Yes, I'll send it by Friday."],
      ['Anil', 'Meera, please update the pricing sheet with the new rate by Monday.'],
      ['Meera', "Sure, I'll do it by Monday."],
      ['Rahul', "We're 60 percent done on the integration so far."],
      ['Anil', "Good. Let's discuss the Q1 budget review next Wednesday at 10 AM with Meera and Priya."],
    ],
  },
  {
    title: 'Hiring Plan Sync',
    lines: [
      ['Anil', 'We need to close the frontend roles this quarter.'],
      ['Rahul', 'We have 18 candidates in the pipeline and 4 in final rounds. We need 2 senior frontend engineers.'],
      ['Meera', 'The approved hiring budget is 45 lakh for the year.'],
      ['Anil', "Decision: we'll run 2 onsite loops next week. Rahul, can you prepare the interview scorecard by Thursday?"],
      ['Rahul', 'Yes, by Thursday.'],
      ['Anil', 'Priya, please share the offer letter template with HR by Tuesday.'],
      ['Priya', 'Will do.'],
      ['Anil', "Let's discuss campus hiring next Monday afternoon with Rahul."],
    ],
  },
  {
    title: 'Client Escalation: Login Bug',
    lines: [
      ['Rahul', 'The client reported the login bug again. Users get stuck in an SSO loop on the EU servers. About 300 users are affected.'],
      ['Anil', "That's critical. What's the cause?"],
      ['Rahul', 'A token expiry mismatch. The hotfix is ready on staging.'],
      ['Anil', 'Decision: we ship the hotfix to production today after a staging check. Rahul, you own this. Please deploy by 5 PM today.'],
      ['Rahul', 'Understood, by 5 PM.'],
      ['Anil', 'Priya, please email the client a status update by 3 PM.'],
      ['Priya', "I'll send it by 3."],
      ['Anil', "Let's do a post-mortem on Friday at 11 AM with Rahul and Priya."],
    ],
  },
];

async function tts(voiceId: string, text: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://global.api.murf.ai/v1/speech/stream', {
      method: 'POST',
      headers: { 'api-key': MURF_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, text, model: 'FALCON', multiNativeLocale: 'en-IN', format: 'WAV', sampleRate: 24000, style: 'Conversational' }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`Murf ${res.status}: ${body.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Joins WAV lines with short pauses into one mono 48 kHz Opus WebM (like the extension's recordings). */
async function join(files: string[], out: string): Promise<number> {
  const inputs = files.flatMap((f) => ['-i', f]);
  const pads = files.map((_, i) => `[${i}:a]aresample=48000,apad=pad_dur=${PAUSE_SECONDS}[a${i}]`).join(';');
  const concat = `${files.map((_, i) => `[a${i}]`).join('')}concat=n=${files.length}:v=0:a=1[out]`;
  await run(ffmpegPath as unknown as string, ['-y', ...inputs, '-filter_complex', `${pads};${concat}`, '-map', '[out]', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', out]);
  // Duration from ffmpeg's own probe output.
  const probe = await run(ffmpegPath as unknown as string, ['-i', out]).catch((e) => e as { stderr: string });
  const m = String(probe.stderr ?? '').match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function waitUntilDone(id: string) {
  let last = '';
  for (;;) {
    const r = await fetch(`${SERVER}/api/meetings/${id}?transcript=false`);
    const { meeting } = (await r.json()) as { meeting: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (meeting.status !== last) {
      console.log(`  status: ${meeting.status}`);
      last = meeting.status;
    }
    if (meeting.status === 'ready' || meeting.status === 'failed') return meeting;
    await new Promise((r2) => setTimeout(r2, 3000));
  }
}

async function main() {
  if (!MURF_KEY) throw new Error('MURF_API_KEY is not set (run with --env-file=../.env.local).');
  const only = process.argv.includes('--only') ? Number(process.argv[process.argv.indexOf('--only') + 1]) : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tatva-demo-'));

  for (const [index, meeting] of MEETINGS.entries()) {
    if (only && only !== index + 1) continue;
    console.log(`\n=== ${meeting.title}`);
    const files: string[] = [];
    for (const [i, [speaker, text]] of meeting.lines.entries()) {
      const file = path.join(dir, `${index}-${String(i).padStart(2, '0')}.wav`);
      fs.writeFileSync(file, await tts(VOICES[speaker], text));
      files.push(file);
      process.stdout.write(`  voiced ${speaker} (${VOICES[speaker]})\n`);
    }
    const out = path.join(dir, `${meeting.title.replace(/[^\w]+/g, '-')}.webm`);
    const seconds = await join(files, out);
    console.log(`  joined ${files.length} lines → ${seconds.toFixed(1)} s, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);

    const form = new FormData();
    form.append('audio', new Blob([fs.readFileSync(out)], { type: 'audio/webm' }), 'recording.webm');
    form.append('title_hint', `${meeting.title} - Google Meet`);
    form.append('recorded_at', new Date().toISOString());
    form.append('duration_ms', String(Math.round(seconds * 1000)));
    const res = await fetch(`${SERVER}/api/meetings`, { method: 'POST', body: form });
    const created = (await res.json()) as { id: string; error?: string };
    if (!res.ok) throw new Error(`Upload failed: ${created.error}`);
    console.log(`  uploaded → meeting ${created.id}`);

    const m = await waitUntilDone(created.id);
    if (m.status === 'failed') {
      console.log(`  FAILED: ${m.error}`);
      continue;
    }
    const full = (await (await fetch(`${SERVER}/api/meetings/${created.id}?transcript=false`)).json()).meeting;
    console.log(`  title: ${full.title}`);
    console.log(`  decisions:\n${full.decisions.map((d: { decision: string }) => `    - ${d.decision}`).join('\n')}`);
    console.log(`  action items:\n${full.action_items.map((a: { task: string; owner: string; due_text: string; due_date: string }) => `    - [${a.owner ?? 'unassigned'}] ${a.task} (due ${a.due_text ?? '-'} → ${a.due_date ?? '-'})`).join('\n')}`);
    console.log(`  numbers: ${full.stats_mentioned.map((s: { value: string }) => s.value).join(' | ')}`);
    console.log(`  discuss later:\n${full.discuss_later.map((d: { topic: string; people: string[]; suggested_time_text: string; suggested_at: string }) => `    - ${d.topic} [${d.people.join(', ')}] "${d.suggested_time_text ?? ''}" → ${d.suggested_at}`).join('\n')}`);
    console.log(`  time saved: ${full.time_saved_minutes} min · gdoc: ${full.gdoc_url ? 'yes' : 'no'} · warnings: ${full.warnings.join('; ') || 'none'}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

main().then(
  () => (process.exitCode = 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
