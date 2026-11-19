# Tatva Work server

Node + TypeScript (Express 5) backend on `http://localhost:4000`. It receives
meeting recordings from the Chrome extension and turns each one into
structured, searchable knowledge. See [../docs/PROJECT_BRIEF.md](../docs/PROJECT_BRIEF.md).

## Pipeline

`POST /api/meetings` stores the upload and returns `202 { id, status }`
immediately. Processing runs in the background, one meeting at a time:

| Status | What happens |
| ------ | ------------ |
| `uploaded` | Audio stored in Supabase Storage (`meeting-audio/<id>/recording.webm`) |
| `transcribing` | Groq Whisper `whisper-large-v3-turbo`, segment timestamps. Files over 24 MB are split with ffmpeg into 10-minute mono 16 kHz Opus chunks; timestamps are offset back to the full recording |
| `extracting` | Groq `openai/gpt-oss-120b` with strict JSON-schema output (validated with zod): title, summary, decisions, action items, stats, key moments, discuss-later, time saved. Transcripts over ~10k chars are extracted in parts and merged; the output budget is sized per request to fit Groq's tokens-per-minute limit (`GROQ_LLM_TPM_LIMIT`, free tier 8000). Saved to Supabase |
| `indexing` | Chunks (summary, each item, ~900-char transcript windows) embedded locally with transformers.js `Xenova/all-MiniLM-L6-v2` (384 dims) into pgvector; Google Doc "Tatva: <title> (<date>)" created via Composio |
| `ready` / `failed` | `failed` stores the error. Storage and Google Doc problems are not fatal; they're recorded in `warnings` |

## API

| Method | Path | Notes |
| ------ | ---- | ----- |
| `POST` | `/api/meetings` | multipart: `audio` (file, required), `title_hint`, `source_url`, `recorded_at` (ISO), `duration_ms` |
| `GET` | `/api/meetings` | newest first, `?limit=` (max 200) |
| `GET` | `/api/meetings/:id` | everything incl. `action_items`, `discuss_later`, `transcript_segments`; `?transcript=false` to skip the transcript |
| `POST` | `/api/meetings/:id/retry` | re-run a `failed` meeting from the stored audio |
| `POST` | `/api/search` | `{ query, match_count?, meeting_id?, similarity_threshold? }`: RAG search via `match_knowledge_chunks` |
| `POST` | `/v1/chat/completions` | Voice agent custom LLM for Agora (OpenAI-compatible SSE). `Authorization: Bearer $VOICE_LLM_API_KEY`, optional `X-Tatva-Session` |
| `GET` | `/health` | `{ ok: true }` |

## Setup

1. `server/.env` needs `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GROQ_API_KEY`,
   `COMPOSIO_API_KEY` (template: [env.example](env.example)).
2. Run [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql) and
   [002_voice_agent.sql](supabase/migrations/002_voice_agent.sql) once in
   the Supabase dashboard → SQL Editor. It creates the tables, pgvector, the
   `meeting-audio` bucket and `match_knowledge_chunks`. RLS is on with no
   policies: only the server's secret key can access the data.
3. Install and check:

   ```bash
   cd server
   pnpm install
   pnpm run check:env       # env, Supabase schema, Groq models, Composio toolkits, ffmpeg
   pnpm run seed:contacts   # demo contacts (Priya, Rahul, Meera, Anil) so "email Priya" resolves
   ```

## Run

```bash
pnpm run dev         # http://localhost:4000, restarts on file changes
pnpm run test:e2e -- "<path to a recording.webm>" ["search question"]
pnpm run typecheck
pnpm test            # unit tests: date resolution, yes/no detection (no secrets needed; also run in CI)
pnpm run tunnel      # cloudflared quick tunnel for the voice agent (see below)
pnpm run test:voice  # plays the demo script against /v1/chat/completions (add -- --no to cancel every action)
```

The first start downloads the embedding model (~90 MB) into
`node_modules/@huggingface/transformers/.cache`.

## Notes

- One meeting is processed at a time. If the server restarts mid-pipeline,
  that meeting is marked `failed` on startup; use the retry endpoint.
- **Owners.** Speakers are not labelled (Whisper has no diarization). An action
  item gets an owner when a name is said with it ("Priya, can you…", "Rahul
  will…", "Meera should…"); otherwise it stays unassigned. "I will…" right
  after someone is addressed by name is sometimes attributed to them, not always.
- **Discuss later.** Every topic planned for a future meeting or review goes into
  `discuss_later`, even if it is also a decision or action item, and always gets
  a suggested date/time: the spoken time when given; otherwise defaults (a day
  alone → 11:00, morning 10:00, afternoon 15:00, "next week" → Monday 11:00, no
  timing → 2 working days later at 11:00, never a weekend).
  `suggested_time_text` keeps what was actually said (null = the time is a default).
- **Date checks.** The LLM resolves relative dates, then
  [src/pipeline/dates.ts](src/pipeline/dates.ts) checks them against the spoken
  phrase and fixes weekday mistakes (e.g. "Monday" resolved to a Sunday).

## Voice agent (Milestone 3)

Agora Conversational AI uses this server as its **custom LLM**
(`POST /v1/chat/completions`, OpenAI-compatible SSE). Each turn
([src/voice/agent.ts](src/voice/agent.ts)):

1. **Understand:** embeds the user's last message and adds the top pgvector
   matches, recent meetings, contacts, and facts from earlier in the call to a
   short system prompt. Only the last 10 messages of history are sent, to keep latency low.
2. **Execute:** Groq `openai/gpt-oss-120b` (reasoning `low`) with tool calling,
   up to 4 rounds. Read tools run immediately: `search_knowledge`,
   `list_recent_meetings`, `get_meeting_details`, `get_open_items`, `brief_me`
   (next Google Calendar event, else the next parked topic, plus related notes
   and open items).
3. **Confirm:** action tools (`send_email`, `post_to_slack` to `#hack`,
   `create_calendar_event`, `add_tracker_row` in the "Tatva Tracker" sheet) never
   run directly. The server resolves contacts, meeting content and dates, stores
   a `pending_actions` row, and speaks a fixed read-back ("I'll email Priya
   Sharma the action items from ... Should I send it?"). The next turn runs it
   through Composio (`user_id` `hack_user`) only on a clear yes ("yes",
   "go ahead", "haan, send it"). A yes with changes goes back to the model;
   "no" cancels. Pending actions expire after 10 minutes.
4. **Errors:** a failed action is read out with a reason and an offer to retry
   ("try again" re-runs it). Missing info ("I don't have an email for Kiran")
   is asked for.
5. **Follow up:** after an email or event the agent offers the next step (add to
   the tracker, post in Slack). Scheduling an event marks matching
   `discuss_later` topics as `scheduled`.

Every tool call (reads, proposals, confirmations, cancellations, errors) is
logged in `activity_log`. Replies are plain spoken text, one to three sentences,
with markdown stripped. On a Groq 429 the next model in `VOICE_LLM_FALLBACK_MODELS` is
tried; if all are limited, the agent says "One moment" and waits once (up to
12 s). The Groq free tier allows 8k tokens per minute per model, and a turn uses about 2k.

### Run web app + server + tunnel (localhost)

Three terminals:

```bash
# 1. Server (port 4000)
cd server
pnpm run dev

# 2. Tunnel, so Agora's cloud can reach localhost:4000
cd server
pnpm run tunnel
#   Starts `cloudflared tunnel --url http://localhost:4000`, prints
#   https://<random>.trycloudflare.com, writes
#   CUSTOM_LLM_URL=https://<random>.trycloudflare.com/v1/chat/completions
#   into the root .env.local, and checks /health through the tunnel.
#   Keep it running. The URL changes every time it starts.

# 3. Web app (port 3000), from the repo root
pnpm run dev
```

Open http://localhost:3000 and start a call. Next.js reloads `.env.local` when
it changes. If you restart the tunnel, start a new call so the new URL is used.

One-time setup: `cloudflared` on PATH (`winget install --id Cloudflare.cloudflared`),
`VOICE_LLM_API_KEY` in `server/.env` with the same value as `CUSTOM_LLM_API_KEY`
in the root `.env.local`, both migrations run, and `pnpm run seed:contacts`.

Without the script: run `cloudflared tunnel --url http://localhost:4000` and
set `CUSTOM_LLM_URL` by hand. Tunnelled requests (they carry `cf-ray`) can
reach only `/v1/*` and `/health`; the meeting API stays local.

To check without a microphone, run `pnpm run test:voice -- --url "<CUSTOM_LLM_URL>"`.
It sends the demo script through the tunnel the same way Agora does.

### Voice test script

Say these in order. Every action is read back first. Answer "yes" to run it
or "no" to cancel it.

| You say | Expected |
| ------- | -------- |
| "What did we decide in the performance review?" | Decisions from *Anil Performance Review*, from the knowledge base |
| "Email the action items to Priya." | Read-back (Priya Sharma, subject), then "yes": real Gmail to the demo address, then it offers the tracker |
| "Add them to the tracker." | Read-back, then "yes": row appended to the *Tatva Tracker* sheet |
| "Schedule the budget review for next week." | Read-back (Monday 11:00 IST, 30 min), then "yes": real Google Calendar event, then it offers Slack |
| "Post the summary in Slack." | Read-back, then "yes": message in `#hack` |
| "Email the summary to Kiran." | Error handling: no such contact, so it asks for the email |
| "What's still pending?" | Open action items and parked topics across all meetings |
| "Brief me for my next meeting." | Next calendar event plus related notes and open items |
