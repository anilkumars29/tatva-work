# Deploying Tatva (Milestone 5b)

| Part | Where | Config |
| ---- | ----- | ------ |
| `server/` (API, pipeline, voice LLM) | Render, Singapore | [`render.yaml`](../render.yaml) |
| Web app (Next.js) | Vercel, region `sin1` (Singapore) | [`vercel.json`](../vercel.json), [`proxy.ts`](../proxy.ts) |
| Recorder | Chrome extension (unpacked) | [`extension/`](../extension) settings |

## Security model

- **Web app:** every page and API route needs a session cookie (`tatva_session`,
  httpOnly, Secure, SameSite=Lax, 7 days) obtained on `/login` with
  `TATVA_ACCESS_CODE`. Without the code set in production, the app serves a 503
  (fails closed). Login attempts are rate-limited (10 per 10 min per IP).
- **Server:** `/health` is public; `/v1/*` (the voice LLM Agora calls) needs its
  own Bearer key (`VOICE_LLM_API_KEY`); everything under `/api/*` needs one of:
  - `x-tatva-key: TATVA_SERVER_KEY`: added by the web app's `proxy.ts` when it
    forwards `/tatva/*`; the browser never sees it;
  - `x-tatva-access-code: TATVA_ACCESS_CODE`: the Chrome extension;
  - `x-tatva-upload: <token>`: a 10-minute HMAC token from the web app's
    `/api/upload-target`, valid only on the two upload routes. Files go straight
    from the browser to Render because Vercel caps request bodies at 4.5 MB.
- **CORS:** localhost, `chrome-extension://*`, and `WEB_ORIGINS` (your Vercel URL) only.

## Which Render plan

Measured on the production build (`node dist/index.js`) with the embedding model loaded:

| Moment | Memory |
| ------ | ------ |
| Idle, model loaded | ~320–340 MB |
| After searches + voice turns | ~230 MB (peak 342 MB) |
| While indexing an image (vision) + a PDF | ~270 MB (peak 342 MB) |

- **Free: the plan in `render.yaml`.** 512 MB (fits, ~170 MB headroom) but a tenth
  of a CPU, and it sleeps after 15 minutes without traffic, so it **needs the
  UptimeRobot monitor below** to stay awake.
- **Starter (512 MB, $7/month, always on)** is the better choice once a card is
  available: change `plan: free` to `plan: starter` in `render.yaml`.
- **Standard (2 GB)** if you want no doubt, e.g. hour-long recordings (Whisper runs
  at Groq, but transcript embedding and ffmpeg chunking add memory for long files).

### Keeping the free plan awake (UptimeRobot)

Waking a sleeping free service takes about a minute, and during that time Agora's
calls to `/v1` time out, so Pooja would go silent mid-demo. A request every
5 minutes counts as traffic and keeps it awake:

1. Sign up at <https://uptimerobot.com> (free, no card) → **+ New monitor**.
2. Type **HTTP(s)**, URL `https://tatva-server.onrender.com/health`, interval
   **5 minutes** (the free tier's minimum) → **Create monitor**.
3. Check it shows **Up** and Render's **Logs** show `GET /health` every 5 minutes.

Even so, open the site and say one sentence to Pooja about 5 minutes before judging:
a free instance can still restart (deploys, maintenance), and the first model load
on 0.1 CPU is slow. One always-on free service uses ~720 of the 750 free hours a month.

## 0. Prepare the variables (one command)

```bash
node scripts/deploy-env.mjs
```

This creates two gitignored files and prints which variables are filled (never values):

- `.env.deploy`: `TATVA_SERVER_KEY` (random), `TATVA_ACCESS_CODE` (random,
  e.g. `tatva-xxxx-xxxx-xxxx`, **your login code**), `RENDER_URL`, `VERCEL_URL`.
  If Render or Vercel give your services other names, edit the two URLs and re-run.
- `server/.env.render`: the 9 Render variables, ready to paste.

## 1. Render (server)

1. Open <https://dashboard.render.com> → **New +** → **Blueprint**.
2. **Connect GitHub** (first time) → pick **anilkumars29/tatva-work** → **Connect**.
3. Render reads `render.yaml` and shows **tatva-server** (Web Service, Singapore,
   Free). Blueprint name: `tatva`. It asks for the variables marked `sync: false`.
   Fill them from `server/.env.render`:

   | Variable | From |
   | -------- | ---- |
   | `SUPABASE_URL` | server/.env |
   | `SUPABASE_SECRET_KEY` | server/.env |
   | `GROQ_API_KEY` | server/.env |
   | `COMPOSIO_API_KEY` | server/.env |
   | `VOICE_LLM_API_KEY` | server/.env (= `CUSTOM_LLM_API_KEY` on Vercel) |
   | `DEMO_OWNER_EMAIL` | server/.env |
   | `TATVA_SERVER_KEY` | .env.deploy |
   | `TATVA_ACCESS_CODE` | .env.deploy |
   | `WEB_ORIGINS` | your Vercel URL, e.g. `https://tatva-work.vercel.app` |

   (`NODE_VERSION=24`, `NODE_ENV=production`, `TZ_DISPLAY` are set by the Blueprint.)
   Tip: after creation, **tatva-server → Environment → Add from .env** accepts the
   whole `server/.env.render` file at once.
4. **Apply**. The first build takes ~4–6 minutes (install, `tsc`, model download).
5. Note the URL at the top of the service page (e.g. `https://tatva-server.onrender.com`).
   Check: open `<url>/health` → `{"ok":true}`. If the name differs, put it in
   `.env.deploy` (`RENDER_URL`) and re-run step 0.

If the build fails at `corepack enable`, change the Build Command (Settings) to
`npm i -g pnpm@12.21.0 && pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm run prefetch:model`.

## 2. Vercel (web app), mostly CLI

From the repo root:

```bash
vercel login                                  # once (run as: ! vercel login)
vercel link --yes --project tatva-work        # creates/links the project
node scripts/deploy-env.mjs --vercel          # sets all 11 variables (production)
vercel --prod                                 # builds and deploys
```

Variables it sets (names only):

| Variable | Value |
| -------- | ----- |
| `NEXT_PUBLIC_AGORA_APP_ID` | .env.local |
| `NEXT_AGORA_APP_CERTIFICATE` | .env.local (sensitive) |
| `MURF_API_KEY` | .env.local (sensitive) |
| `MURF_VOICE_ID` | .env.local |
| `MURF_VOICE_STYLE` | .env.local |
| `CUSTOM_LLM_URL` | `<RENDER_URL>/v1/chat/completions` (not the tunnel) |
| `CUSTOM_LLM_API_KEY` | .env.local (sensitive) |
| `TATVA_SERVER_URL` | `<RENDER_URL>` |
| `TATVA_SERVER_KEY` | .env.deploy (sensitive) |
| `TATVA_ACCESS_CODE` | .env.deploy (sensitive) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (use the pnpm version pinned in package.json) |

The deployment URL is printed at the end (production alias, e.g.
`https://tatva-work.vercel.app`). If it isn't the one in `WEB_ORIGINS` on Render,
update `WEB_ORIGINS` there (Render redeploys by itself).

Dashboard alternative: <https://vercel.com/new> → **Import** the repo →
Framework **Next.js**, Root Directory **./** → **Environment Variables**: add the
11 names above → **Deploy**.

## 3. Chrome extension

1. `chrome://extensions` → **Tatva Recorder** → reload (version **0.5.0**).
2. Click the extension → the **gear icon** → **Cloud** → paste the access code →
   **Save**. It tests the connection ("Connected").
   (**Local** = `localhost:4000`; **Custom** = any other server/web URL, Chrome asks
   for permission once.)
3. Open the Vercel site and sign in. The sidebar shows **Extension connected**
   (the extension recognises the app by its `<meta name="tatva-app">` tag on
   `*.vercel.app`; on a custom domain, set it under **Custom**).

## 4. Check the live site

```bash
pnpm exec playwright install chromium        # once: Chromium for the extension check
TATVA_URL=https://tatva-work.vercel.app pnpm test:live          # Git Bash
# PowerShell: $env:TATVA_URL='https://tatva-work.vercel.app'; pnpm test:live
```

| Project | File | Checks |
| ------- | ---- | ------ |
| `app` | [`e2e/app.spec.ts`](../e2e/app.spec.ts) | signed-out redirect, wrong/right code, every page, every button that doesn't send a real message (email / Slack / calendar / issue dialogs are opened, read back by the server, and cancelled), downloads, file pickers, profile menu, sign out. Fails on any console error or failed API call |
| `voice` | [`e2e/voice.spec.ts`](../e2e/voice.spec.ts) | one real call through Agora: Pooja's greeting, one question answered by the Render LLM, hang up |
| `extension` | [`e2e/extension.spec.ts`](../e2e/extension.spec.ts) | popup **Cloud** preset: a wrong code is refused, the right code connects; the Vercel site shows "Extension connected" |

The access code comes from `.env.deploy` (or `TATVA_ACCESS_CODE`). Without
`TATVA_URL` the same checks run against a local production build
(`localhost:3100`) and the local extension preset.
