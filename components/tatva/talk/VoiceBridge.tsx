'use client';

// Headless voice session: joins the RTC channel, publishes the mic, starts
// AgoraVoiceAI and reports transcript + agent state to the Talk page.
// Same lifecycle rules as ConversationComponent (see AGENTS.md): the isReady
// StrictMode guard, useJoin owns leave(), the mic hook owns the track, and
// muting uses track.setEnabled().
import { useCallback, useEffect, useRef, useState } from 'react';
import AgoraRTC, { RemoteUser, useClientEvent, useJoin, useLocalMicrophoneTrack, usePublish, useRemoteUsers, useRTCClient } from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessagePriority,
  ChatMessageType,
  TranscriptHelperMode,
  type AgentState,
  type AgentTranscription,
  type TranscriptHelperItem,
  type UserTranscription,
} from 'agora-agent-client-toolkit';
import type { RTMClient } from 'agora-rtm';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { normalizeTranscript } from '@/lib/conversation';
import type { AgoraRenewalTokens, AgoraTokenData } from '@/types/conversation';

export type TranscriptItem = TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>;

export interface VoiceState {
  joined: boolean;
  agentConnected: boolean;
  agentState: AgentState | null;
  connectionState: string;
  transcript: TranscriptItem[];
  localUid: string;
  issue: string | null;
}

export interface VoiceApi {
  /** Text in as a user turn: our custom LLM answers and Pooja speaks the reply. */
  sendText: (text: string, opts?: { queue?: boolean }) => Promise<void>;
  /** Pooja reads this text aloud without the LLM. */
  speak: (text: string) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  ready: boolean;
}

type AgoraRtcWithParameters = typeof AgoraRTC & { setParameter?: (key: string, value: unknown) => void };

export default function VoiceBridge({
  agoraData,
  rtmClient,
  onTokenWillExpire,
  onState,
  onApi,
}: {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
  onState: (s: VoiceState) => void;
  onApi: (api: VoiceApi) => void;
}) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const agentUID = String(DEFAULT_AGENT_UID);
  const [connectionState, setConnectionState] = useState('CONNECTING');
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [rawTranscript, setRawTranscript] = useState<TranscriptItem[]>([]);
  const [aiReady, setAiReady] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  // StrictMode guard (see AGENTS.md): only the real mount's timer fires.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  const { isConnected: joinSuccess } = useJoin(
    { appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!, channel: agoraData.channel, token: agoraData.token, uid: parseInt(agoraData.uid, 10) },
    isReady,
  );
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);
  usePublish([localMicrophoneTrack]);

  useEffect(() => {
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.('ENABLE_AUDIO_PTS', true);
    } catch {}
  }, []);

  // AgoraVoiceAI: exactly once, after join (isReady && joinSuccess).
  useEffect(() => {
    if (!isReady || !joinSuccess) return;
    let cancelled = false;
    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({ rtcEngine: client, rtmEngine: rtmClient, renderMode: TranscriptHelperMode.TEXT, enableLog: false });
        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }
        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => setRawTranscript([...t]));
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) => setAgentState(event.state));
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_, error) => setIssue(`${error.type}: ${error.message}`));
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (_, error) => setIssue(error.message));
        ai.subscribeMessage(agoraData.channel);
        setAiReady(true);
      } catch (error) {
        if (!cancelled) setIssue(`Voice toolkit failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
      setAiReady(false);
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  useClientEvent(client, 'connection-state-change', (cur) => setConnectionState(cur));

  const handleTokenWillExpire = useCallback(async () => {
    const uid = client.uid;
    if (uid == null) return;
    try {
      const { rtcToken, rtmToken } = await onTokenWillExpire(String(uid));
      await client.renewToken(rtcToken);
      await rtmClient.renewToken(rtmToken);
    } catch (error) {
      console.error('Failed to renew Agora token:', error);
    }
  }, [client, onTokenWillExpire, rtmClient]);
  useClientEvent(client, 'token-privilege-will-expire', handleTokenWillExpire);

  const agentConnected = remoteUsers.some((u) => u.uid.toString() === agentUID);

  // Report state upward.
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  useEffect(() => {
    onStateRef.current({
      joined: joinSuccess,
      agentConnected,
      agentState,
      connectionState,
      transcript: normalizeTranscript(rawTranscript, String(client.uid ?? agoraData.uid)),
      localUid: String(client.uid ?? agoraData.uid),
      issue,
    });
  }, [joinSuccess, agentConnected, agentState, connectionState, rawTranscript, issue, client.uid, agoraData.uid]);

  // Expose the API.
  const trackRef = useRef(localMicrophoneTrack);
  trackRef.current = localMicrophoneTrack;
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;
  useEffect(() => {
    onApiRef.current({
      ready: aiReady && agentConnected,
      sendText: async (text, opts) => {
        const ai = AgoraVoiceAI.getInstance();
        if (!ai) throw new Error('Voice session is not ready yet.');
        await ai.sendText(agentUID, {
          messageType: ChatMessageType.TEXT,
          priority: opts?.queue ? ChatMessagePriority.APPEND : ChatMessagePriority.INTERRUPTED,
          responseInterruptable: true,
          text,
        });
      },
      speak: async (text) => {
        const ai = AgoraVoiceAI.getInstance();
        if (!ai) throw new Error('Voice session is not ready yet.');
        await ai.speak(agentUID, { text, priority: ChatMessagePriority.APPEND, interruptable: true });
      },
      setMuted: async (muted) => {
        await trackRef.current?.setEnabled(!muted);
      },
    });
  }, [aiReady, agentConnected, agentUID]);

  // Remote audio (Pooja) must be rendered to play.
  return (
    <div className="hidden" aria-hidden="true">
      {remoteUsers.map((user) => (
        <RemoteUser key={user.uid} user={user} />
      ))}
    </div>
  );
}
