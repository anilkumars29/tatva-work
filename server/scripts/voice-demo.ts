// pnpm run test:voice [-- --url <chat completions url>] [--no]
// Plays the demo script against the custom LLM endpoint exactly like Agora
// does (OpenAI-style messages, SSE stream), saying "yes" to every read-back.
// --no answers "no" instead, so nothing is actually sent.
// --lines "first|second" replaces the script with your own lines.
// Without --url it calls http://localhost:<PORT>/v1/chat/completions.
const argv = process.argv.slice(2);
const urlFlag = argv.indexOf('--url');
const url = urlFlag >= 0 ? argv[urlFlag + 1] : `http://localhost:${process.env.PORT || 4000}/v1/chat/completions`;
const answer = argv.includes('--no') ? 'No, cancel that.' : 'Yes, go ahead.';
const session = `voice-demo-${Date.now()}`;

const linesFlag = argv.indexOf('--lines');
const defaultScript = [
  'What did we decide in the performance review?',
  'Email the action items to Priya.',
  'Add them to the tracker.',
  'Schedule the budget review for next week.',
  'Post the summary in Slack.',
  'Email the summary to Kiran.',
  "What's still pending?",
  'Brief me for my next meeting.',
];
const script = linesFlag >= 0 ? argv[linesFlag + 1].split('|') : defaultScript;

const turns: { role: string; content: string }[] = [];

async function say(text: string): Promise<string> {
  turns.push({ role: 'user', content: text });
  const started = Date.now();
  let firstTokenMs = 0;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOICE_LLM_API_KEY}`,
      'X-Tatva-Session': session,
    },
    body: JSON.stringify({ model: 'tatva-voice', stream: true, messages: [{ role: 'system', content: 'ignored' }, ...turns] }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status}: ${await res.text()}`);
  let reply = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
      if (delta) {
        firstTokenMs ||= Date.now() - started;
        reply += delta;
      }
    }
  }
  reply = reply.trim();
  turns.push({ role: 'assistant', content: reply });
  console.log(`\nYOU:   ${text}\nPOOJA: ${reply}\n       (first words ${firstTokenMs} ms, total ${Date.now() - started} ms)`);
  return reply;
}

const needsConfirm = (reply: string) => /\?\s*$/.test(reply) && /\b(I'll|I will)\b/.test(reply);

for (const line of script) {
  const reply = await say(line);
  if (needsConfirm(reply)) await say(answer);
}
process.exit(0);

export {};
