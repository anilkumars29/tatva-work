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

- Show measurable efficiency: a **"time saved" counter per meeting**.
- **Every visible button must really work.** At most 1-2 items may be labelled
  "Coming soon".

## Layout

| Path         | What lives there |
| ------------ | ---------------- |
| `/` (root)   | Existing Next.js app (web app + Agora voice agent) |
| `extension/` | Chrome extension (Manifest V3) |
| `server/`    | Node + TypeScript backend |

## Stack

| Concern            | Choice |
| ------------------ | ------ |
| Voice agent        | Agora Conversational AI (existing app), Murf Falcon TTS (voice Pooja, `en-IN`), Deepgram STT `en-IN` |
| Server             | Node + TypeScript, Express 5, `http://localhost:4000` (see `server/README.md`) |
| Transcription      | Groq Whisper `whisper-large-v3-turbo` (segment timestamps; ffmpeg chunking for files over 24 MB) |
| LLM                | Groq `openai/gpt-oss-120b` with strict JSON-schema output |
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
| 2 | `server/`: `POST/GET /api/meetings`; extension uploads on Stop (local backup kept) and shows Processing… → Ready; pipeline: Supabase Storage → Groq Whisper (chunked) → Groq extraction (title, summary, decisions, action items, stats, key moments, discuss-later, time saved) → Supabase tables → local embeddings in pgvector (`match_knowledge_chunks`, `POST /api/search`) → Google Doc via Composio; per-meeting status | Done |
| 3+ | Company docs (SOP / project-plan PDFs) in the knowledge base, voice agent RAG + Composio actions (Gmail, Calendar, Slack, Sheets), Confirm/Follow-up flow, "brief me" for next meeting, time-saved counter in the web app, demo polish | Not started |

Update the status column as milestones land.
