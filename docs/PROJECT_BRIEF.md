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

Tatva Work is a voice-first, agentic meeting assistant for teams.

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
| 5+ | Latency polish (see below), demo polish, deployment | Not started |

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
