// Sends text turns to the voice agent endpoint, as Agora would, and prints Pooja's replies.
//   node scripts/voice-turns.mjs [--meeting=<id>] [--server=<url>] "question 1" "question 2" ...
// Each run is one conversation (one session id); history is carried between turns.
// Key and URL come from .env.deploy / server/.env.render (VOICE_LLM_API_KEY, RENDER_URL) or the environment.
import fs from 'node:fs';

const env = Object.fromEntries(
  ['.env.deploy', 'server/.env.render']
    .filter((f) => fs.existsSync(f))
    .flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/))
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const questions = args.filter((a) => !a.startsWith('--'));
const server = (flag('server') ?? process.env.TATVA_SERVER_URL ?? env.RENDER_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const key = process.env.VOICE_LLM_API_KEY ?? env.VOICE_LLM_API_KEY;
const meeting = flag('meeting');
const session = `turns-${Date.now()}`;
const history = [];

console.log(`${meeting ? `MEETING MODE (${meeting})` : 'GENERAL MODE'} · session ${session}`);
for (const q of questions) {
  history.push({ role: 'user', content: q });
  const t0 = performance.now();
  const res = await fetch(`${server}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Tatva-Session': session,
      'X-Tatva-Scope': meeting ? `meeting:${meeting}` : 'all',
    },
    body: JSON.stringify({ stream: false, messages: history }),
  });
  const body = await res.json().catch(() => ({}));
  const reply = body.choices?.[0]?.message?.content ?? `(HTTP ${res.status}) ${JSON.stringify(body).slice(0, 200)}`;
  history.push({ role: 'assistant', content: reply });
  console.log(`\nYOU:   ${q}\nPOOJA: ${reply}  [${Math.round(performance.now() - t0)} ms]`);
  await new Promise((r) => setTimeout(r, Number(flag('gap') ?? 6000))); // stay under Groq's per-minute limit
}
