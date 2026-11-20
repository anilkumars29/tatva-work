// Live processing test: uploads a recording to the server (or retries a failed
// meeting), samples GET /health memory every second, and waits for Ready.
//   node scripts/live-processing.mjs upload <file.webm> [title]
//   node scripts/live-processing.mjs retry <meeting-id>
//   node scripts/live-processing.mjs watch <meeting-id>
//   node scripts/live-processing.mjs fetch <meeting-id> <out.webm> [--minutes=N]   (download; loop to N minutes)
// Server URL and key come from .env.deploy (RENDER_URL, TATVA_SERVER_KEY) or the environment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const env = Object.fromEntries(
  (fs.existsSync('.env.deploy') ? fs.readFileSync('.env.deploy', 'utf8') : '')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const base = (process.env.TATVA_SERVER_URL ?? env.RENDER_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const key = process.env.TATVA_SERVER_KEY ?? env.TATVA_SERVER_KEY ?? '';
const headers = key ? { 'x-tatva-key': key } : {};
const [command, arg, extra] = process.argv.slice(2);
const minutesArg = Number(process.argv.find((a) => a.startsWith('--minutes='))?.split('=')[1]);

async function call(p, init = {}) {
  const res = await fetch(base + p, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${p} → ${res.status} ${body.error ?? ''}`);
  return body;
}

async function watch(id) {
  const started = Date.now();
  const memory = [];
  let health = await call('/health').catch(() => null);
  const baseline = health?.rss_mb;
  let last = '';
  let restarts = 0;
  for (;;) {
    health = await fetch(base + '/health', { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);
    if (health?.rss_mb) {
      if (memory.length && health.rss_mb < memory.at(-1).rss - 120 && health.rss_mb < 200) restarts++;
      memory.push({ t: Math.round((Date.now() - started) / 1000), rss: health.rss_mb });
    }
    const { meeting } = await call(`/api/meetings/${id}?transcript=false`).catch(() => ({ meeting: null }));
    const status = meeting?.status ?? 'unreachable';
    if (status !== last) {
      console.log(`${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s  ${status}${health?.rss_mb ? `  (rss ${health.rss_mb} MB)` : ''}`);
      last = status;
    }
    if (status === 'ready' || status === 'failed') {
      const peak = Math.max(...memory.map((m) => m.rss));
      console.log(`\n${meeting.title ?? id}: ${status}${meeting.error ? ` (${meeting.error})` : ''}`);
      console.log(`duration ${((meeting.duration_seconds ?? 0) / 60).toFixed(1)} min, ${meeting.action_items?.length ?? 0} action items, processed in ${Math.round((Date.now() - started) / 1000)}s`);
      console.log(`server memory: before ${baseline ?? '?'} MB, peak ${peak} MB, after ${memory.at(-1)?.rss} MB (${memory.length} samples${restarts ? `, ${restarts} restart(s) seen` : ''})`);
      if (meeting.warnings?.length) console.log('warnings:', meeting.warnings);
      process.exit(status === 'ready' ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (command === 'upload') {
  const blob = await fs.openAsBlob(arg, { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, path.basename(arg));
  form.append('title_hint', extra ?? `Live test: ${path.basename(arg)}`);
  form.append('recorded_at', new Date().toISOString());
  const meeting = await call('/api/meetings', { method: 'POST', body: form });
  console.log(`uploaded ${(blob.size / 1024 / 1024).toFixed(1)} MB → meeting ${meeting.id}`);
  await watch(meeting.id);
} else if (command === 'retry') {
  await call(`/api/meetings/${arg}/retry`, { method: 'POST' });
  console.log(`retrying ${arg}`);
  await watch(arg);
} else if (command === 'watch') {
  await watch(arg);
} else if (command === 'fetch') {
  const { url } = await call(`/api/meetings/${arg}/audio`);
  const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (!minutesArg) fs.writeFileSync(extra, audio);
  else {
    const tmp = `${extra}.src.webm`;
    fs.writeFileSync(tmp, audio);
    const ffmpeg = createRequire(path.resolve('server/package.json'))('ffmpeg-static');
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-i', tmp, '-t', String(minutesArg * 60), '-c', 'copy', extra]);
    fs.rmSync(tmp);
  }
  console.log(`${extra}: ${(fs.statSync(extra).size / 1024 / 1024).toFixed(1)} MB`);
} else {
  console.error('Usage: node scripts/live-processing.mjs upload <file> [title] | retry <id> | watch <id> | fetch <id> <out> [--minutes=N]');
  process.exit(1);
}
