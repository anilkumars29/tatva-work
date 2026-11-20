import { NextRequest, NextResponse } from 'next/server';
import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  ExpiresIn,
  MurfTTS,
  OpenAI,
  type MurfTts,
} from 'agora-agents';
import { ClientStartRequest, AgentResponse } from '@/types/conversation';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { serverKey, serverUrl } from '@/lib/auth';

// Tatva voice agent. When CUSTOM_LLM_URL is set, Agora calls the Tatva
// server (server/, POST /v1/chat/completions, usually via a cloudflared tunnel)
// as its LLM. That server owns the real system prompt, RAG over the meeting
// knowledge base, Composio tools, and the confirm-before-acting step; this
// prompt is only used by the managed-LLM fallback when CUSTOM_LLM_URL is unset.
const POOJA_PROMPT = `You are Pooja, the voice assistant of Tatva, a meeting assistant. This is a voice call: reply in one or two short spoken sentences, no lists or markdown. The meeting knowledge base and actions are not connected right now, so if asked about meetings or to send, post or schedule anything, say that the Tatva server isn't connected yet.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET from the Tatva server with the shared key (server to server); null on any failure. */
async function tatva<T>(path: string): Promise<T | null> {
  try {
    const key = serverKey();
    const res = await fetch(`${serverUrl()}/api${path}`, {
      headers: key ? { 'x-tatva-key': key } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The conversation's scope and the first thing Pooja says: short, formal, by
 * the user's first name, and no summary until asked.
 *   meeting: "Hello Anil. I have the Q4 Vendor Review open. What would you like to know or do?"
 *   general: "Hello Anil, I'm Pooja from Tatva. How can I help you today?"
 */
async function scopeAndGreeting(meetingId: string | null) {
  const [profile, found] = await Promise.all([
    tatva<{ profile?: { name?: string | null } }>('/profile'),
    meetingId ? tatva<{ meeting?: { title?: string | null; status?: string } }>(`/meetings/${meetingId}?transcript=false`) : null,
  ]);
  const first = profile?.profile?.name?.trim().split(/\s+/)[0] ?? '';
  const meeting = meetingId && found?.meeting?.status === 'ready' ? { id: meetingId, title: found.meeting.title || 'this meeting' } : null;
  const greeting = meeting
    ? `Hello${first ? ` ${first}` : ''}. I have the ${meeting.title} open. What would you like to know or do?`
    : `Hello${first ? ` ${first}` : ''}, I'm Pooja from Tatva. How can I help you today?`;
  return { meeting, greeting };
}

// agentUid identifies the AI in the RTC channel and shares its default with the client.
const agentUid = String(DEFAULT_AGENT_UID);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// MurfTTSOptions has no `style` field, so add it to the outgoing params
// (MurfTtsParams accepts additional properties).
class MurfWithStyleTTS extends MurfTTS {
  constructor(
    options: ConstructorParameters<typeof MurfTTS>[0],
    private readonly style: string,
  ) {
    super(options);
  }

  toConfig(): ReturnType<MurfTTS['toConfig']> {
    const config = super.toConfig() as MurfTts & { vendor: 'murf' };
    return { ...config, params: { ...config.params, style: this.style } };
  }
}

export async function POST(request: NextRequest) {
  try {
    // --- 1. Parse request ---

    const body: ClientStartRequest = await request.json();
    const { requester_id, channel_name } = body;
    const meetingId = typeof body.meeting_id === 'string' && UUID.test(body.meeting_id) ? body.meeting_id.toLowerCase() : null;

    // Validate required env vars on first request so misconfiguration surfaces
    // with a clear error message rather than a silent failure.
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');

    if (!channel_name || !requester_id) {
      return NextResponse.json(
        { error: 'channel_name and requester_id are required' },
        { status: 400 },
      );
    }

    const { meeting, greeting } = await scopeAndGreeting(meetingId);

    // --- 2. Build and start the agent ---

    // AgoraClient authenticates API calls to the Agora Conversational AI service.
    // area: change to Area.EU or Area.AP for European or Asia-Pacific deployments.
    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    // Pipeline: Deepgram (reseller) STT → Tatva custom LLM (or managed OpenAI
    // fallback) → Murf Falcon (BYOK) TTS.
    // The custom LLM gets CUSTOM_LLM_API_KEY as its bearer token, and the
    // channel name as X-Tatva-Session so pending confirmations stay per call.
    const customLlmUrl = process.env.CUSTOM_LLM_URL?.trim();
    const llm = customLlmUrl
      ? new OpenAI({
          url: customLlmUrl,
          apiKey: requireEnv('CUSTOM_LLM_API_KEY'),
          model: 'tatva-voice',
          // The scope travels with every LLM request; the server enforces it.
          headers: { 'X-Tatva-Session': channel_name, 'X-Tatva-Scope': meeting ? `meeting:${meeting.id}` : 'all' },
          greetingMessage: greeting,
          failureMessage: 'Sorry, I lost my train of thought. Could you say that again?',
          maxHistory: 12,
          params: { max_tokens: 400 },
        })
      : new OpenAI({
          model: 'gpt-4o-mini',
          greetingMessage: greeting,
          failureMessage: 'Please wait a moment.',
          maxHistory: 15,
          params: { max_tokens: 1024, temperature: 0.7, top_p: 0.95 },
        });
    const agent = new Agent({
      client,
      instructions: POOJA_PROMPT,
      greeting,
      failureMessage: 'Please wait a moment.',
      maxHistory: 50,
      // VAD controls how the agent detects the start and end of a user's turn.
      turnDetection: {
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 160, // ms of speech before interruption triggers
              prefix_padding_ms: 300, // audio captured before speech is detected
            },
          },
          end_of_speech: {
            mode: 'vad',
            vad_config: {
              silence_duration_ms: 480, // ms of silence before turn ends
            },
          },
        },
      },
      // RTM is required for transcript events in the browser client.
      // enable_tools is required for MCP tool invocation.
      advancedFeatures: { enable_rtm: true, enable_tools: true },
      // Required for browser RTM events:
      // - data_channel: 'rtm' enables RTM delivery path for state/metrics/errors
      // - enable_error_message emits AGENT_ERROR payloads
      // - enable_metrics emits AGENT_METRICS latency payloads
      parameters: {
        // web client → ultra-low-latency chorus profile
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: 'en-IN', // Indian English, to match the Murf en-IN voice
        }),
        // BYOK: uncomment the following block and set NEXT_DEEPGRAM_API_KEY
        // new DeepgramSTT({
        //   apiKey: requireEnv('NEXT_DEEPGRAM_API_KEY'),
        //   model: 'nova-3',
        //   language: 'en',
        // }),
      )
      .withLlm(llm)
      .withTts(
        // BYOK — Murf Falcon (set MURF_API_KEY, MURF_VOICE_ID, MURF_VOICE_STYLE in .env.local)
        new MurfWithStyleTTS(
          {
            key: requireEnv('MURF_API_KEY'),
            model: 'FALCON',
            voiceId: requireEnv('MURF_VOICE_ID'),
            locale: 'en-IN',
            sampleRate: 24000,
            baseUrl: 'wss://global.api.murf.ai/v1/speech/stream-input',
          },
          requireEnv('MURF_VOICE_STYLE'),
        ),
        // BYOK — ElevenLabs (set NEXT_ELEVENLABS_API_KEY; optional NEXT_ELEVENLABS_VOICE_ID)
        // new (await import('agora-agents')).ElevenLabsTTS({
        //   key: requireEnv('NEXT_ELEVENLABS_API_KEY'),
        //   modelId: 'eleven_flash_v2_5',
        //   voiceId: process.env.NEXT_ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB',
        //   sampleRate: 24000,
        // }),
      );

    // remoteUids restricts the agent to only process audio from this user
    const session = agent.createSession({
      channel: channel_name,
      agentUid,
      remoteUids: [requester_id],
      idleTimeout: 30,
      expiresIn: ExpiresIn.hours(1),
      debug: false, // enable debug to show restful API calls in the console
    });

    const agentId = await session.start();

    return NextResponse.json({
      agent_id: agentId,
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
      scope: meeting ? { kind: 'meeting', meeting_id: meeting.id, title: meeting.title } : { kind: 'all' },
    } as AgentResponse);
  } catch (error) {
    console.error('Error starting conversation:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start conversation',
      },
      { status: 500 },
    );
  }
}
