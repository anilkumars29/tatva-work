// Deployment environment helper. Never prints secret values.
//
//   node scripts/deploy-env.mjs                 create .env.deploy (shared key + access code)
//                                               and server/.env.render (paste into Render)
//   node scripts/deploy-env.mjs --vercel        push the web app's variables to the linked
//                                               Vercel project (production) with the Vercel CLI
//   node scripts/deploy-env.mjs --check         list which variables are filled
//
// .env.deploy holds the deployment-only values: TATVA_SERVER_KEY, TATVA_ACCESS_CODE,
// RENDER_URL and VERCEL_URL (edit the two URLs if Render/Vercel gave you other names).
// All three files are gitignored (.env*).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const DEPLOY = '.env.deploy';
const RENDER_FILE = 'server/.env.render';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function writeEnv(file, values, header) {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.writeFileSync(file, `${header}\n${body}\n`);
}

// Readable but strong: tatva-xxxx-xxxx-xxxx (60 bits).
const accessCode = () => `tatva-${randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12).match(/.{1,4}/g).join('-')}`;

function ensureDeploy() {
  const d = readEnv(DEPLOY);
  const next = {
    TATVA_SERVER_KEY: d.TATVA_SERVER_KEY || randomBytes(32).toString('base64url'),
    TATVA_ACCESS_CODE: d.TATVA_ACCESS_CODE || accessCode(),
    RENDER_URL: (d.RENDER_URL || 'https://tatva-server.onrender.com').replace(/\/$/, ''),
    VERCEL_URL: (d.VERCEL_URL || 'https://tatva-work.vercel.app').replace(/\/$/, ''),
  };
  writeEnv(DEPLOY, next, '# Deployment values (gitignored). Same TATVA_SERVER_KEY and TATVA_ACCESS_CODE on Render and Vercel.');
  return next;
}

const web = readEnv('.env.local');
const server = readEnv('server/.env');
const deploy = ensureDeploy();

const RENDER_VARS = {
  SUPABASE_URL: server.SUPABASE_URL,
  SUPABASE_SECRET_KEY: server.SUPABASE_SECRET_KEY,
  GROQ_API_KEY: server.GROQ_API_KEY,
  COMPOSIO_API_KEY: server.COMPOSIO_API_KEY,
  VOICE_LLM_API_KEY: server.VOICE_LLM_API_KEY,
  DEMO_OWNER_EMAIL: server.DEMO_OWNER_EMAIL,
  TATVA_SERVER_KEY: deploy.TATVA_SERVER_KEY,
  TATVA_ACCESS_CODE: deploy.TATVA_ACCESS_CODE,
  WEB_ORIGINS: deploy.VERCEL_URL,
};

const VERCEL_VARS = {
  NEXT_PUBLIC_AGORA_APP_ID: { value: web.NEXT_PUBLIC_AGORA_APP_ID, sensitive: false },
  NEXT_AGORA_APP_CERTIFICATE: { value: web.NEXT_AGORA_APP_CERTIFICATE, sensitive: true },
  MURF_API_KEY: { value: web.MURF_API_KEY, sensitive: true },
  MURF_VOICE_ID: { value: web.MURF_VOICE_ID, sensitive: false },
  MURF_VOICE_STYLE: { value: web.MURF_VOICE_STYLE, sensitive: false },
  // Agora calls the Render server instead of the tunnel.
  CUSTOM_LLM_URL: { value: `${deploy.RENDER_URL}/v1/chat/completions`, sensitive: false },
  CUSTOM_LLM_API_KEY: { value: web.CUSTOM_LLM_API_KEY, sensitive: true },
  TATVA_SERVER_URL: { value: deploy.RENDER_URL, sensitive: false },
  TATVA_SERVER_KEY: { value: deploy.TATVA_SERVER_KEY, sensitive: true },
  TATVA_ACCESS_CODE: { value: deploy.TATVA_ACCESS_CODE, sensitive: true },
  // Use the pnpm version pinned in package.json ("packageManager") for installs.
  ENABLE_EXPERIMENTAL_COREPACK: { value: '1', sensitive: false },
};

const mode = process.argv[2] ?? '';
const status = (vars) => Object.entries(vars).map(([k, v]) => `  ${(typeof v === 'object' ? v?.value : v) ? '✓' : '✗ MISSING'}  ${k}`).join('\n');

if (web.CUSTOM_LLM_API_KEY && server.VOICE_LLM_API_KEY && web.CUSTOM_LLM_API_KEY !== server.VOICE_LLM_API_KEY) {
  console.warn('! CUSTOM_LLM_API_KEY (.env.local) differs from VOICE_LLM_API_KEY (server/.env): the voice agent would be refused.');
}

if (mode === '--vercel') {
  let failed = 0;
  for (const [name, { value, sensitive }] of Object.entries(VERCEL_VARS)) {
    if (!value) {
      console.log(`  ✗ ${name}: no value, skipped`);
      failed++;
      continue;
    }
    const args = ['env', 'add', name, 'production', '--force', ...(sensitive ? ['--sensitive'] : [])];
    const r = spawnSync('vercel', args, { input: value, encoding: 'utf8', shell: process.platform === 'win32' });
    const ok = r.status === 0;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `: ${(r.stderr || r.stdout).trim().split('\n').pop()}`}`);
  }
  console.log(failed ? `\n${failed} variable(s) not set.` : '\nAll Vercel variables set for production. Redeploy for them to apply: vercel --prod');
  process.exit(failed ? 1 : 0);
}

writeEnv(RENDER_FILE, RENDER_VARS, '# Paste into Render -> tatva-server -> Environment -> "Add from .env". Gitignored; delete after use.');
console.log(`Render variables  (${RENDER_FILE}):\n${status(RENDER_VARS)}`);
console.log(`\nVercel variables  (push with: node scripts/deploy-env.mjs --vercel):\n${status(VERCEL_VARS)}`);
console.log(`\nRender URL: ${deploy.RENDER_URL}\nVercel URL: ${deploy.VERCEL_URL}\n(edit them in ${DEPLOY} if your services got other names, then re-run)`);
console.log(`Your access code is TATVA_ACCESS_CODE in ${DEPLOY}.`);
