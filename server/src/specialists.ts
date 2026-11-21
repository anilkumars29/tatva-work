// Pooja and her specialists: how Tatva's work is divided.
//
// Pooja is the agent you talk to. She runs the reasoning loop (Groq tool
// calling, voice/agent.ts) and orchestrates five specialists. Two work live
// in the conversation, called as Pooja's tools (Librarian, Executor); three
// work in the background pipeline when a recording or file arrives (Scribe,
// Analyst, Lens). Each specialist owns one job, its own code and, where it
// needs one, its own model. Only Pooja decides what happens next; outward
// actions still need the user's yes (voice/actions.ts).
//
// This file is the single place that names them. Logs, the activity timeline,
// the processing steps and GET /api/specialists all read it.

export type SpecialistId = 'pooja' | 'scribe' | 'analyst' | 'lens' | 'librarian' | 'executor';

export interface Specialist {
  id: SpecialistId;
  name: string;
  role: string;
  /** How it is invoked. */
  works: 'live (the agent)' | 'live (Pooja calls it)' | 'background pipeline';
  /** The model it runs on, if any. */
  model: string;
  /** Pooja's tools that call this specialist. */
  tools: string[];
  /** Entry points in the code. */
  code: string[];
}

export const SPECIALISTS: Specialist[] = [
  {
    id: 'pooja',
    name: 'Pooja',
    role: 'The voice agent you talk to. Understands the request, decides which specialist to call, reads every action back and waits for your yes.',
    works: 'live (the agent)',
    model: 'Groq gpt-oss-120b (tool calling), falling back to gpt-oss-20b and qwen3.8-27b; Agora + Deepgram + Murf Falcon for the voice',
    tools: ['cancel_pending_action'],
    code: ['server/src/voice/agent.ts voiceTurn()', 'server/src/routes/chat.ts', 'app/api/invite-agent/route.ts'],
  },
  {
    id: 'scribe',
    name: 'Scribe',
    role: 'Listens: turns the meeting recording into a timestamped transcript.',
    works: 'background pipeline',
    model: 'Groq whisper-large-v3-turbo (Indian-English vocabulary prompt)',
    tools: [],
    code: ['server/src/pipeline/transcribe.ts transcribe()'],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    role: 'Extracts: title, summary, decisions, action items with owners and due dates, numbers, key moments and follow-ups, as strict JSON with date checks.',
    works: 'background pipeline',
    model: 'Groq gpt-oss-20b, falling back to qwen3.8-27b (never the voice model)',
    tools: [],
    code: ['server/src/pipeline/extract.ts extractKnowledge()', 'server/src/pipeline/dates.ts'],
  },
  {
    id: 'lens',
    name: 'Lens',
    role: 'Reads slides, screenshots and PDFs shared in a meeting or uploaded: all visible text plus what charts and tables show.',
    works: 'background pipeline',
    model: 'Groq qwen3.8-27b (vision); PDF text via unpdf',
    tools: [],
    code: ['server/src/pipeline/attachments.ts readImage()', 'server/src/pipeline/documents.ts'],
  },
  {
    id: 'librarian',
    name: 'Librarian',
    role: 'Remembers and retrieves: indexes every meeting, slide and document in pgvector, then finds, cites and briefs from them.',
    works: 'live (Pooja calls it)',
    model: 'Local all-MiniLM-L6-v2 embeddings + Supabase pgvector',
    tools: ['search_knowledge', 'list_recent_meetings', 'get_meeting_details', 'get_open_items', 'brief_me'],
    code: ['server/src/voice/data.ts searchKnowledge()', 'server/src/voice/tools.ts runReadTool()', 'server/src/pipeline/chunk.ts', 'server/src/pipeline/embed.ts'],
  },
  {
    id: 'executor',
    name: 'Executor',
    role: 'Acts in your tools: Gmail, Google Calendar, Slack, Google Sheets and Docs through Composio, only after Pooja has your yes.',
    works: 'live (Pooja calls it)',
    model: 'No model: validated payloads executed through Composio',
    tools: ['send_email', 'post_to_slack', 'create_calendar_event', 'add_tracker_row', 'log_issue'],
    code: ['server/src/voice/actions.ts prepareAction() / executePending()', 'server/src/composio.ts'],
  },
];

const byTool = new Map(SPECIALISTS.flatMap((s) => s.tools.map((t) => [t, s] as const)));

/** The specialist behind one of Pooja's tools (Pooja herself for anything else). */
export const specialistForTool = (tool: string): Specialist => byTool.get(tool) ?? SPECIALISTS[0];

/** The specialist working on a meeting processing step. */
export const specialistForStep = (status: string): Specialist | null =>
  ({ transcribing: SPECIALISTS[1], extracting: SPECIALISTS[2], indexing: SPECIALISTS[4] })[status] ?? null;

/** Log prefix, e.g. "[Scribe]". */
export const tag = (id: SpecialistId) => `[${SPECIALISTS.find((s) => s.id === id)!.name}]`;
