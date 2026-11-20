# Tatva Work — Project Brief

> Source of truth for what we are building. Every session reads this before
> making changes. If scope, stack, or layout changes, update this file first.

## Hackathon

- **Event:** Build with Agora hackathon
- **Track:** Track 2 (PS31), "From Workplace Assistance to Intelligent Action"
- **Submission deadline:** Saturday 21 Nov 2026, 12:30 PM IST
- **Environment:** everything is built and tested on localhost first;
  deployment comes later.

## Product

Tatva Work (product name in the UI: **Tatva**) is a voice-first, agentic meeting assistant for teams.

- A **Chrome extension** records a browser meeting (Google Meet / Microsoft
  Teams web).
- The **backend** turns the recording into structured knowledge:
  - summary
  - decisions
  - action items with owners
  - stats / numbers mentioned
  - key moments
  - "discuss later" items
- Each meeting becomes a **knowledge doc** (also saved as a Google Doc). All
  meeting docs plus company docs (SOP / project-plan PDFs) form the
  **knowledge base** used for RAG.
- The existing **Agora voice agent** (Murf Falcon TTS, voice Pooja, `en-IN`)
  answers questions from the knowledge base and performs real actions via
  **Composio** (Gmail, Google Calendar, Slack, Google Sheets, Google Docs),
  by voice or with one click.

## Track Requirements (must be visible in the demo)

### Required demo flow

1. **Initiate:** the user speaks to the agent (Agora + Murf Falcon).
2. **Understand:** the agent retrieves enterprise knowledge via RAG.
3. **Execute:** the agent makes tool calls (Composio).
4. **Confirm:** the agent reads back what it will do, asks approval for
   critical actions, and handles errors gracefully.
5. **Follow Up:** the agent updates the tracker, writes summaries, and creates
   follow-up events.

### Before / During / Action / After

| Phase  | What the demo shows |
| ------ | ------------------- |
| Before | "Brief me for my next meeting", built from past meetings and open items |
| During | The extension records the meeting |
| Action | Email / Slack / Calendar / Sheets actions |
| After  | Knowledge doc, tracker, follow-ups |

### Other requirements

- Show measurable efficiency: a **"time saved" counter per meeting**. Computed from the work Tatva automates (notes + Doc: 3 min + 20% of meeting length; 1 min per action item / follow-up; email 4, invite 3, Slack post 2, tracker row 1, issue 3), not an LLM guess. See `server/README.md`.
- **Every visible button must really work.** At most 1-2 items may be labelled
  "Coming soon".

## Layout

| Path         | What lives there |
| ------------ | ---------------- |
| `/` (root)   | Next.js web app: Dashboard, Meetings, Talk to Tatva (Agora voice agent), Knowledge Base, Tracker, Contacts (`components/tatva/`) |
| `extension/` | Chrome extension (Manifest V3) |
| `server/`    | Node + TypeScript backend |

## Stack

| Concern            | Choice |
| ------------------ | ------ |
| Voice agent        | Agora Conversational AI (existing app), Murf Falcon TTS (voice Pooja, `en-IN`), Deepgram STT `en-IN` |
| Server             | Node + TypeScript, Express 5, `http://localhost:4000` (see `server/README.md`) |
| Transcription      | Groq Whisper `whisper-large-v3-turbo` (segment timestamps; ffmpeg chunking for files over 24 MB) |
| LLM                | Groq `openai/gpt-oss-120b` with strict JSON-schema output (extraction); same model, reasoning `low`, with tool calling as the voice agent's custom LLM (`server/` `POST /v1/chat/completions`, fallback `gpt-oss-20b` on rate limits) |
| Tunnel (localhost) | Cloudflare quick tunnel (`cloudflared`, `pnpm run tunnel` in `server/`) so Agora's cloud reaches `localhost:4000` |
| Embeddings         | Local transformers.js `Xenova/all-MiniLM-L6-v2` (384 dims, no API key), stored in pgvector |
| DB / vectors / files | Supabase (Postgres + pgvector + Storage) |
| Actions            | Composio (Gmail, Google Calendar, Slack, Google Sheets, Google Docs), `user_id` = `"hack_user"` |
| Stretch            | Live transcription during recording with Murf STT (beta, India region) |

Secrets live in `.env.local` (web app) or the server's own env file. They must
never be hardcoded or committed.

## Milestones

| # | Milestone | Status |
| - | --------- | ------ |
| 1 | `extension/`: popup Start/Stop + timer; record tab audio + mic mixed via `chrome.tabCapture` + offscreen document; tab keeps playing; on Stop, download a `.webm` | Done |
| 2 | `server/`: `POST/GET /api/meetings`; extension uploads on Stop (local backup kept) and shows Processing… → Ready; pipeline: Supabase Storage → Groq Whisper (chunked) → Groq extraction (title, summary, decisions, action items, stats, key moments, discuss-later) → Supabase tables → local embeddings in pgvector (`match_knowledge_chunks`, `POST /api/search`) → Google Doc via Composio; per-meeting status | Done |
| 3 | Voice agent on localhost: `server/` `POST /v1/chat/completions` (OpenAI-compatible SSE) as Agora's custom LLM via cloudflared; per-turn pgvector RAG + Groq tool calling; read tools (`search_knowledge`, `list_recent_meetings`, `get_meeting_details`, `get_open_items`, `brief_me`); actions via Composio (`send_email`, `post_to_slack` #hack, `create_calendar_event`, `add_tracker_row` "Tatva Tracker"), each read back and run only after a spoken yes (`pending_actions`); spoken error + retry; follow-up offers; `contacts` table (seeded); every tool call in `activity_log`; web app `invite-agent` uses `CUSTOM_LLM_URL` with Murf Falcon + Deepgram `en-IN` kept. Tested end to end over the tunnel with real Gmail / Calendar / Slack / Sheets actions (`pnpm run test:voice`); Agora accepts the agent config. Voice-tested live for answers, email, calendar and Slack | Done |
| 4 | Web app rebuilt from the Stitch designs (project 950328494615631971, "Studio Obsidian") with real data from `server/` (Next.js proxies `/tatva/*` to `server/` `/api/*`): **Dashboard** (meetings, open items, actions by Tatva and time saved this week, all computed; live processing status; next calendar event; "Brief me"; Ping on Slack; Mark Complete → Supabase + tracker sheet), **Meeting page** (signed-URL audio with decoded waveform, key-moment pins, seekable/searchable transcript; Google Doc, email, Slack, Add to Calendar through confirm dialogs that show the server's read-back), **Talk to Tatva** (Agora + Murf voice agent embedded; live transcript; chips and text box send text to Pooja over RTM and she answers aloud; "What Tatva is doing" timeline from `activity_log` + `pending_actions`; Approve & Send / Cancel), **Knowledge Base** (semantic search across meetings and PDFs; PDF upload → Storage → text → chunks → local embeddings, Pooja answers from it), **Tracker** (real KPIs, filters, sort, search, CSV, pagination, status toggle, activity log with connector filter, Issues via the `log_issue` voice tool or "Log issue" dialog: tracker row + Slack escalation after confirmation), **Contacts** (add/edit/export; roles). Only "Coming soon": Export Jira/Asana, Edit draft. Extension shows as connected via a content-script marker | Done |
| 4.5 | UI polish + branding: product name **Tatva** everywhere (sidebar, tab titles, extension, email/Slack/calendar signatures; Google Docs stay "Tatva: <meeting>"); logo `public/brand/tatva-logo.png` with a traced SVG waveform mark (`public/brand/tatva-mark*.svg`, `components/tatva/brand.tsx`) for favicon and extension icons 16/32/48/128; Geist Sans + Geist Mono (tabular figures), 600-weight headings, neutral surfaces with hairline borders, yellow only for primary actions / active states / key numbers; profile menu (avatar → name, role, email, Edit profile saved via `PUT /api/profile`, live extension + Composio status incl. Drive); extension detection hardened (marker re-applied + ping/pong, re-checked on focus), extension 0.4.0 | Done |
| 4.6 | **Meeting attachments**: PDFs and images (PNG/JPG/WebP) on each meeting page via upload, drag and drop anywhere, or Ctrl+V paste of a screenshot; stored in the private `attachments` bucket (`meeting_attachments`, migration 004); PDFs reuse the document text extraction, images are read by a Groq vision model (`qwen/qwen3.8-27b`: all visible text + chart/table/diagram description + label such as slide/screenshot); chunks embedded with the `meeting_id` and `attachment_id` (search can scope to one meeting or everything); Pooja cites the file ("From the slide \"Pricing.png\" shared in Q4 Vendor Review…"); cards with thumbnail, size, status (processing / indexed / failed), Preview (image + what Tatva read), Download, Delete, Retry; Attachments tab and search hits in the Knowledge Base; the meeting's Google Doc gets an Attachments section (rewritten via Composio when files change). Profile linked to the user's Contacts entry (saving syncs name/email/role; "email me" uses the profile email). Server gets a real production build (`pnpm build` → `dist/`, `pnpm start`) | Done |
| 5b | **Deployment** ([docs/DEPLOY.md](DEPLOY.md)): server on Render Singapore (`render.yaml`, Free plan kept awake by an UptimeRobot `/health` monitor every 5 min; measured ~340 MB peak), web app on Vercel `sin1`; access-code login (httpOnly session cookie, every page + API route via `proxy.ts`), server `/api` only with the web app's `TATVA_SERVER_KEY` / the extension's access code / a 10-min upload token (direct browser uploads, Vercel's 4.5 MB body cap), `/v1` keeps its Bearer key, CORS = Vercel + localhost + extension; extension 0.5.1 with server settings (Cloud / Local / Custom + access code) and detection on `*.vercel.app`; `scripts/deploy-env.mjs` prepares Render/Vercel variables; Playwright live checks (`pnpm test:live`: every page/button + one voice call). Live: web https://tatva-work.vercel.app, server https://tatva-server-iu7c.onrender.com. Verified live (20 Nov): 30/30 security checks, Playwright app 10/10, extension 2/2 (Cloud preset), one voice call (greeting + answered question) | Done |
| 5c | **UI polish pass 2**: Arimo headings + Open Sans body (`next/font`, no layout shift), Geist Mono only for timestamps/codes, tabular figures; no caret outside inputs; pointer/hover/pressed/focus/disabled states on every clickable (global rules in `globals.css`, audited with `scripts/audit-clickables.mjs`); dashboard stat cards link to Meetings / Tracker pending / Tracker activity log / Meetings sorted by time saved (`?sort=`, `?filter=`, `?view=` in the URL); tracker numbers filter the list; skeleton loading, friendly error states with Retry, busy buttons; truncation with tooltips; mobile drawer navigation (< 1024px); custom 404; Open Graph image + metadata (`public/og-image.png`); readable labels for every activity row | Done |
| 5d | **Resilient processing** (21 Nov): a 6-minute live meeting failed with "Server restarted while processing" because embedding 32 transcript windows at once (~180 MB) ran the 512 MB Render instance out of memory during indexing (no deploy at that time). Now: embeddings 4 at a time without the ONNX arena (~16 MB), one shared job queue for meetings and attachments, GC between steps; a heartbeat + minute-by-minute sweep resumes abandoned meetings from stored audio (atomic claim, max 2 automatic resumes); truncated extraction retries with low reasoning; **Retry** button on failed meetings (dashboard, meetings list, meeting page); `/health` reports memory, jobs and commit. Verified live: the failed meeting retried to Ready (peak 309 MB), a 20-minute recording Ready in 4 min (peak 308 MB), a server killed mid-extraction had its meeting resumed by another instance after 75 s | Done |
| 5e | **Conversation scope + what's next** (21 Nov): Talk to Tatva from the dashboard/sidebar/top bar = general mode; from a meeting ("Ask Tatva about this meeting", the meeting page's primary button, or a dashboard row) = meeting mode, shown as "Focused on: <title>" with "Switch to all meetings". The scope travels as `X-Tatva-Scope: meeting:<id>` next to `X-Tatva-Session` and is enforced on the server (`server/src/voice/scope.ts`): RAG filtered to the meeting, `list_recent_meetings` removed, other meetings refused with a polite redirect, actions default to that meeting. Greeting is short and formal by first name, no summary until asked. "What's next" merges calendar events and planned follow-ups by date (`voice/upcoming.ts`), says when a follow-up isn't on the calendar and offers to book it (`follow_up_id`); the dashboard's Up next card uses the same list. Talk to Tatva button in the top bar on every page. Test events removed from the calendar | Done |
| 5+ | Latency polish (see below), demo polish | Not started |

### Polish backlog

- **Voice latency is high** (noted after the live voice test; not fixed yet).
  Measured at the custom LLM: about 1–2 s to first words for simple answers, about
  3.5 s for "brief me", plus Agora STT/TTS on top. Likely causes: two Groq round
  trips when a tool is needed, rounds are buffered rather than streamed, the
  per-turn embedding + DB lookups, and Groq free-tier 8k TPM waits. Ideas:
  stream the final round, speak a short filler while tools run, answer from the
  injected RAG context without a tool round, cache meeting details, trim the
  tool schemas.

Update the status column as milestones land.
