# Code tour: 10 files, in order

Open these in VS Code in this order. Each one is a step in the story: a voice
request comes in, gets grounded in meeting knowledge, becomes a confirmed
action, and the knowledge it uses was built from a recording.

0. **`server/src/specialists.ts`**: start here. Pooja and the five specialists
   she orchestrates (Scribe, Analyst, Lens, Librarian, Executor): each one's
   job, model, tools and code. Every file below belongs to one of them.

1. **`app/api/invite-agent/route.ts`**: where the Agora voice agent is created.
   Deepgram `en-IN` STT, our server as a custom OpenAI-compatible LLM (with the
   channel as the session id), and Murf Falcon TTS as Pooja (`MurfWithStyleTTS`
   adds the voice style).

2. **`server/src/routes/chat.ts`**: the endpoint Agora calls,
   `POST /v1/chat/completions`. Bearer-key check, SSE streaming of each piece of
   the reply, and abort when the user interrupts.

3. **`server/src/voice/agent.ts`**: the agent loop, `voiceTurn()`. Confirm step
   first (a spoken yes/no to a waiting action), then `systemPrompt()` with RAG
   matches, then up to 4 rounds of Groq tool calling (`groqRound()`), and the
   server's read-back for actions.

4. **`server/src/voice/tools.ts`**: the 11 tools the model can call and the
   read tools' implementations (`search_knowledge`, `get_meeting_details`,
   `get_open_items`, `brief_me`…). Optional arguments are made nullable so
   Groq doesn't reject them.

5. **`server/src/voice/actions.ts`**: the guardrail at the centre. The model
   only *proposes* (`proposeAction()` → `prepareAction()` validates, resolves
   contacts and writes the read-back); `executePending()` runs the action
   through Composio only after a yes, and explains failures in plain words.

6. **`server/src/voice/untrusted.ts`**: prompt-injection defence. Retrieved
   meeting text and documents are fenced as `<data>`, can't break the fence,
   and instruction-like lines are labelled as quotes. Tested in
   `server/test/untrusted.test.ts`.

7. **`server/src/voice/data.ts`**: retrieval. `searchKnowledge()` embeds the
   query, calls the pgvector function and labels every hit with its source
   (meeting and date, or "the slide "Pricing.png" shared in…") so Pooja can cite
   it; `resolveMeeting()` and `resolveContact()` map spoken names to records.

8. **`server/src/pipeline/process.ts`**: how a recording becomes knowledge:
   store audio, Finch speech-to-text (Whisper fallback), extraction, tables, chunks + embeddings, Google Doc.
   One job at a time, a heartbeat, and automatic resume after a restart.

9. **`server/src/pipeline/extract.ts`**: the extraction prompt and strict JSON
   schema (owners without speaker labels, Indian units, follow-ups always get
   a bookable time), long meetings split and merged, dates checked afterwards
   by `pipeline/dates.ts`.

10. **`server/src/pipeline/chunk.ts`** (with `server/supabase/migrations/004_meeting_attachments.sql`):
    how RAG chunks are built (one per decision / action item / figure /
    follow-up, plus overlapping transcript windows, each starting with the
    meeting title and date) and the `match_knowledge_chunks` cosine search
    over the HNSW index.

If there's time for one more: **`extension/service-worker.js`** and
**`extension/offscreen.js`** record the meeting tab plus the microphone
(`chrome.tabCapture` + an offscreen document) and upload it, and
**`components/tatva/talk/TalkToTatva.tsx`** is the voice page with the live
"What Tatva is doing" timeline.

The full reference is [AGENT.md](AGENT.md).
