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

/** A comma-separated model list from the environment, then the defaults as further fallbacks (no repeats). */
function modelList(raw: string | undefined, defaults: string[]): string[] {
  const listed = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...listed, ...defaults].filter((m, i, all) => all.indexOf(m) === i);
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

  // Meeting extraction model chain (Groq limits each model separately). It
  // prefers different models from the voice agent, so processing meetings can't
  // use up Pooja's daily budget before a demo. Override: LLM_EXTRACT_MODELS.
  // Measured on a real 6-minute meeting (21 Nov): qwen3.8-27b ~2.5k tokens,
  // gpt-oss-20b ~7.9k (mostly reasoning) with the same owners and dates.
  extractModels: modelList(process.env.LLM_EXTRACT_MODELS ?? process.env.GROQ_LLM_MODEL, ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b']),
  // Transcripts longer than this are extracted part by part, then merged
  // (keeps each request under Groq free-tier tokens-per-minute limits).
  // ~10k chars ≈ 3k tokens, leaving room for the prompt and a full answer.
  llmMaxTranscriptChars: optionalNumber('LLM_MAX_TRANSCRIPT_CHARS', 10000),
  // Upper bound on the output budget per extraction call (reasoning + JSON).
  llmMaxCompletionTokens: optionalNumber('LLM_MAX_COMPLETION_TOKENS', 6000),
  // Groq tokens-per-minute limit for the LLM (free tier 8000). Input plus the
  // output budget must fit under it, so the budget shrinks for long inputs.
  llmTpmLimit: optionalNumber('GROQ_LLM_TPM_LIMIT', 8000),
  // gpt-oss reasoning effort for extraction when it falls back to gpt-oss-20b:
  // 'low' (reasoning tokens count against the daily token limit; 'medium'
  // spent ~5.9k on one 1.5-minute meeting for the same result).
  llmReasoningEffort: process.env.GROQ_LLM_REASONING_EFFORT?.trim() || 'low',

  embeddingModel: process.env.EMBEDDING_MODEL?.trim() || 'Xenova/all-MiniLM-L6-v2',

  // Meeting attachments: images are read by a Groq vision model.
  visionModel: process.env.GROQ_VISION_MODEL?.trim() || 'qwen/qwen3.8-27b',
  attachmentsBucket: process.env.SUPABASE_ATTACHMENTS_BUCKET?.trim() || 'attachments',

  composioApiKey: required('COMPOSIO_API_KEY'),
  composioUserId: process.env.COMPOSIO_USER_ID?.trim() || 'hack_user',

  // ---- Voice agent (custom LLM for Agora Conversational AI) ----
  // Shared secret Agora sends as "Authorization: Bearer <key>". The endpoint
  // refuses requests while this is unset, because the tunnel makes it public.
  voiceApiKey: process.env.VOICE_LLM_API_KEY?.trim() || '',
  // Voice chain: gpt-oss-120b first (best tool calling), then the others.
  voiceModels: modelList(
    [process.env.VOICE_LLM_MODEL, process.env.VOICE_LLM_FALLBACK_MODELS].filter(Boolean).join(','),
    ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
  ),
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
