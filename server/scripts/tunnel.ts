// pnpm run tunnel: opens a Cloudflare quick tunnel to this server so Agora's
// cloud can reach the custom LLM, then writes the URL into the web app's
// .env.local (CUSTOM_LLM_URL). Keep it running; Ctrl+C closes the tunnel.
// Quick tunnel URLs change on every start, so re-run this before each session.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.PORT) || 4000;
const webEnv = path.resolve(import.meta.dirname, '../../.env.local');

function setEnvLine(file: string, key: string, value: string) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  fs.writeFileSync(file, re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`);
}

const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.on('error', (err) => {
  console.error(`Could not start cloudflared (${err.message}). Install it: winget install --id Cloudflare.cloudflared`);
  process.exit(1);
});
child.on('exit', (code) => {
  console.log(`cloudflared exited (${code}).`);
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill('SIGINT'));

let found = false;
const onOutput = async (data: Buffer) => {
  const text = data.toString();
  if (process.env.TUNNEL_VERBOSE) process.stderr.write(text);
  const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url || found) return;
  found = true;
  const llmUrl = `${url}/v1/chat/completions`;
  setEnvLine(webEnv, 'CUSTOM_LLM_URL', llmUrl);
  console.log(`Tunnel: ${url} -> http://localhost:${port}`);
  console.log(`Wrote CUSTOM_LLM_URL=${llmUrl} to ${webEnv}`);

  // DNS for a new quick tunnel can take a few seconds to propagate.
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        console.log('Health check through the tunnel: OK. Start a call in the web app.');
        return;
      }
      // 530/502 while the tunnel is still connecting; keep trying.
    } catch {
      // not resolvable yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn('Tunnel is up but /health did not answer. Check that `pnpm run dev` is running in server/.');
};
child.stdout.on('data', onOutput);
child.stderr.on('data', onOutput);
