// Central config. Values come from server/.env (loaded by `tsx --env-file=.env`).

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name} (set it in server/.env)`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export const config = {
  port: optionalNumber('PORT', 4000),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
  audioBucket: process.env.SUPABASE_AUDIO_BUCKET?.trim() || 'meeting-audio',

  groqApiKey: required('GROQ_API_KEY'),
  whisperModel: process.env.GROQ_WHISPER_MODEL?.trim() || 'whisper-large-v3-turbo',
  // Empty string = let Whisper auto-detect the language.
  whisperLanguage: process.env.GROQ_WHISPER_LANGUAGE?.trim() ?? 'en',
  // Groq's free tier accepts uploads up to 25 MB; stay a little under it.
  whisperMaxBytes: optionalNumber('WHISPER_MAX_BYTES', 24 * 1024 * 1024),
  // Length of each chunk when a recording is too big for one request.
  whisperChunkSeconds: optionalNumber('WHISPER_CHUNK_SECONDS', 600),

  llmModel: process.env.GROQ_LLM_MODEL?.trim() || 'openai/gpt-oss-120b',
  // Transcripts longer than this are extracted part by part, then merged
  // (keeps each request under Groq free-tier tokens-per-minute limits).
  // ~10k chars ≈ 3k tokens, leaving room for the prompt and a full answer.
  llmMaxTranscriptChars: optionalNumber('LLM_MAX_TRANSCRIPT_CHARS', 10000),
  // Upper bound on the output budget per extraction call (reasoning + JSON).
  llmMaxCompletionTokens: optionalNumber('LLM_MAX_COMPLETION_TOKENS', 6000),
  // Groq tokens-per-minute limit for the LLM (free tier 8000). Input plus the
  // output budget must fit under it, so the budget shrinks for long inputs.
  llmTpmLimit: optionalNumber('GROQ_LLM_TPM_LIMIT', 8000),
  // gpt-oss reasoning effort: low | medium | high. 'high' hits Groq free-tier
  // rate limits and can exhaust the output budget, so medium is the default.
  llmReasoningEffort: process.env.GROQ_LLM_REASONING_EFFORT?.trim() || 'medium',

  embeddingModel: process.env.EMBEDDING_MODEL?.trim() || 'Xenova/all-MiniLM-L6-v2',

  composioApiKey: required('COMPOSIO_API_KEY'),
  composioUserId: process.env.COMPOSIO_USER_ID?.trim() || 'hack_user',

  // ---- Voice agent (custom LLM for Agora Conversational AI) ----
  // Shared secret Agora sends as "Authorization: Bearer <key>". The endpoint
  // refuses requests while this is unset, because the tunnel makes it public.
  voiceApiKey: process.env.VOICE_LLM_API_KEY?.trim() || '',
  voiceModel: process.env.VOICE_LLM_MODEL?.trim() || 'openai/gpt-oss-120b',
  voiceReasoningEffort: process.env.VOICE_LLM_REASONING_EFFORT?.trim() || 'low',
  voiceMaxTokens: optionalNumber('VOICE_LLM_MAX_TOKENS', 500),
  slackChannel: process.env.SLACK_CHANNEL?.trim() || '#hack',
  trackerSheetName: process.env.TRACKER_SHEET_NAME?.trim() || 'Tatva Tracker',
  // Optional: skip the Drive search for the tracker sheet.
  trackerSpreadsheetId: process.env.TRACKER_SPREADSHEET_ID?.trim() || '',

  maxUploadBytes: optionalNumber('MAX_UPLOAD_BYTES', 200 * 1024 * 1024),
  timeZone: process.env.TZ_DISPLAY?.trim() || 'Asia/Kolkata',
};

export const EMBEDDING_DIMS = 384;
