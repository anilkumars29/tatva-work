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
| `GET` | `/health` | `{ ok: true }` |

## Setup

1. `server/.env` needs `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GROQ_API_KEY`,
   `COMPOSIO_API_KEY` (template: [env.example](env.example)).
2. Run [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql) once in
   the Supabase dashboard → SQL Editor. It creates the tables, pgvector, the
   `meeting-audio` bucket and `match_knowledge_chunks`. RLS is on with no
   policies: only the server's secret key can access the data.
3. Install and check:

   ```bash
   cd server
   pnpm install
   pnpm run check:env   # env, Supabase schema, Groq models, Composio Google Docs, ffmpeg
   ```

## Run

```bash
pnpm run dev         # http://localhost:4000, restarts on file changes
pnpm run test:e2e -- "<path to a recording.webm>" ["search question"]
pnpm run typecheck
pnpm test            # unit tests for date resolution (no secrets needed; also run in CI)
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
