'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RTMClient } from 'agora-rtm';
import { useApi } from '@/hooks/use-api';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { api, downloadText, eventDateTime, plural } from '@/lib/tatva';
import type { AgentResponse, AgoraRenewalTokens, AgoraTokenData } from '@/types/conversation';
import { ACTION_KINDS, ACTION_VERB, describe, type Activity } from '../activity';
import { ComingSoon, Icon, Spinner, useTatvaUi } from '../ui';
import type { TranscriptItem, VoiceApi, VoiceState } from './VoiceBridge';

const VoiceBridge = dynamic(() => import('./VoiceBridge'), { ssr: false });

// RTC provider (browser only). useRef keeps a single client across StrictMode remounts.
const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } = await import('agora-rtc-react');
    return {
      default: function AgoraProviders({ children }: { children: ReactNode }) {
        const clientRef = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(null);
        if (!clientRef.current) clientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        return <AgoraRTCProvider client={clientRef.current}>{children}</AgoraRTCProvider>;
      },
    };
  },
  { ssr: false },
);

const AGENT_UID = String(DEFAULT_AGENT_UID);
const CHIPS = [
  { text: 'Brief me for my next meeting', icon: 'auto_awesome', color: 'text-primary-container' },
  { text: "What's still pending?", icon: 'check_circle', color: 'text-tertiary-fixed' },
  { text: 'Post the summary in Slack', icon: 'tag', color: 'text-secondary' },
  { text: 'Schedule a follow-up', icon: 'calendar_add_on', color: 'text-primary-fixed' },
];
// Meeting mode: everything is about the meeting in focus.
const MEETING_CHIPS = [
  { text: 'What was decided?', icon: 'gavel', color: 'text-primary-container' },
  { text: "What's still pending from this meeting?", icon: 'check_circle', color: 'text-tertiary-fixed' },
  { text: "What's our next meeting about?", icon: 'event_upcoming', color: 'text-primary-fixed' },
  { text: 'Post the summary in Slack', icon: 'tag', color: 'text-secondary' },
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Pending {
  id: string;
  created_at: string;
  session_id: string;
  kind: string;
  args: Record<string, unknown>;
  summary: string;
  status: 'pending' | 'failed';
  error: string | null;
}
interface Bubble {
  id: string;
  who: 'you' | 'pooja';
  text: string;
  time: number;
  live?: boolean;
  typed?: boolean;
}

const timeOf = (ms: number) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
const stamp = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(iso));
const msOf = (t: number | undefined) => (!t ? Date.now() : t > 1e12 ? t : t * 1000);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function PendingPreview({ p }: { p: Pending }) {
  const a = p.args;
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-start gap-1.5 font-caption text-caption text-on-surface-variant">
      <span className="shrink-0 font-medium text-on-surface">{label}:</span>
      <span className="min-w-0 break-words text-secondary-fixed">{value}</span>
    </div>
  );
  if (p.kind === 'send_email') {
    const items = str(a.body)
      .split('\n')
      .filter((l) => /^- /.test(l))
      .map((l) => l.slice(2));
    return (
      <>
        <div className="flex flex-col gap-1 pb-2">
          {row('Recipient', `${str(a.to_name)} <${str(a.to)}>`)}
          {row('Subject', str(a.subject))}
        </div>
        {items.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="font-caption text-caption font-semibold uppercase tracking-wider text-primary-container">Included items:</span>
            <ul className="flex flex-col gap-1 pl-1 font-body-sm text-body-sm text-on-surface-variant">
              {items.slice(0, 6).map((it, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="font-bold text-primary-container">•</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }
  if (p.kind === 'post_to_slack')
    return (
      <>
        {row('Channel', str(a.channel))}
        <p className="line-clamp-6 whitespace-pre-line font-body-sm text-body-sm text-on-surface-variant">{str(a.text).replace(/[*_]/g, '')}</p>
      </>
    );
  if (p.kind === 'create_calendar_event')
    return (
      <>
        {row('Event', str(a.title))}
        {row('When', `${eventDateTime(str(a.start))} · ${str(a.duration_minutes)} min`)}
        {row('Invites', Array.isArray(a.attendees) && a.attendees.length ? (a.attendees as { name: string }[]).map((x) => x.name).join(', ') : 'Nobody (just you)')}
      </>
    );
  if (p.kind === 'add_tracker_row')
    return (
      <ul className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
        {((a.rows as { task: string; owner: string; due: string }[]) ?? []).map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="font-bold text-primary-container">•</span>
            <span>
              {r.task}
              {r.owner ? ` · ${r.owner}` : ''}
              {r.due ? ` (due ${r.due})` : ''}
            </span>
          </li>
        ))}
      </ul>
    );
  if (p.kind === 'log_issue')
    return (
      <>
        {row('Issue', str(a.title))}
        {a.owner ? row('Owner', str(a.owner)) : null}
        {a.context ? row('Detail', str(a.context)) : null}
      </>
    );
  return <p className="font-body-sm text-body-sm text-on-surface-variant">{p.summary}</p>;
}

export default function TalkToTatva() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useTatvaUi();

  // ------------------------------------------------------------- scope
  // /talk?meeting=<id> ("Ask Tatva about this meeting") = meeting mode: Pooja
  // only uses that meeting. /talk = all meetings. The server enforces it.
  const meetingParam = params.get('meeting');
  const scopeId = meetingParam && UUID_RE.test(meetingParam) ? meetingParam : null;
  const scopeMeeting = useApi<{ meeting: { id: string; title: string | null; status: string } }>(scopeId ? `/meetings/${scopeId}?transcript=false` : null);
  const focus = scopeId && scopeMeeting.data?.meeting.status === 'ready' ? { id: scopeId, title: scopeMeeting.data.meeting.title || 'this meeting' } : null;
  const chips = scopeId ? MEETING_CHIPS : CHIPS;

  // ------------------------------------------------------------- session
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live' | 'ending'>('idle');
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null);
  const [rtm, setRtm] = useState<RTMClient | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [voiceApi, setVoiceApi] = useState<VoiceApi | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [typed, setTyped] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const queue = useRef<{ text: string; queue: boolean }[]>([]);

  useEffect(() => {
    import('agora-rtc-react').catch(() => {});
    import('agora-rtm').catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const start = useCallback(async () => {
    if (phase === 'starting' || phase === 'live') return;
    setPhase('starting');
    try {
      const tokenRes = await fetch('/api/generate-agora-token');
      const token = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(token.error ?? 'Could not get an Agora token');
      const [agent, rtmClient] = await Promise.all([
        fetch('/api/invite-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requester_id: token.uid, channel_name: token.channel, meeting_id: scopeId }),
        }).then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? 'Could not start Pooja');
          return body as AgentResponse;
        }),
        (async () => {
          const { default: AgoraRTM } = await import('agora-rtm');
          const client: RTMClient = new AgoraRTM.RTM(process.env.NEXT_PUBLIC_AGORA_APP_ID!, token.uid);
          await client.login({ token: token.token });
          await client.subscribe(token.channel);
          return client;
        })(),
      ]);
      setRtm(rtmClient);
      setAgoraData({ ...token, agentId: agent.agent_id });
      setSession(token.channel);
      setStartedAt(Date.now());
      setTyped([]);
      setMuted(false);
      setPhase('live');
    } catch (e) {
      setPhase('idle');
      toast(`Couldn't start the conversation: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [phase, toast, scopeId]);

  const end = useCallback(async () => {
    setPhase('ending');
    if (agoraData?.agentId) {
      await fetch('/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agoraData.agentId }),
      }).catch(() => {});
    }
    rtm?.logout().catch(() => {});
    setRtm(null);
    setAgoraData(null);
    setVoiceApi(null);
    setVoice((v) => (v ? { ...v, agentConnected: false, joined: false, agentState: null } : v));
    setPhase('idle');
    queue.current = [];
  }, [agoraData, rtm]);

  const renewTokens = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      const channel = agoraData?.channel;
      if (!channel) throw new Error('Missing channel');
      const [rtc, rtmT] = await Promise.all([
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${uid}`).then((r) => r.json()),
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${agoraData.uid}`).then((r) => r.json()),
      ]);
      return { rtcToken: rtc.token, rtmToken: rtmT.token };
    },
    [agoraData],
  );

  // ------------------------------------------------------- sending text
  const sendNow = useCallback(
    async (text: string, opts: { queue?: boolean } = {}) => {
      setTyped((t) => [...t, { id: `typed-${Date.now()}-${t.length}`, who: 'you', text, time: Date.now(), typed: true }]);
      try {
        await voiceApi!.sendText(text, opts);
      } catch (e) {
        toast(`Couldn't send to Pooja: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
    [voiceApi, toast],
  );

  /** Sends now when Pooja is in the call; otherwise starts the call and sends once she joins. */
  const ask = useCallback(
    (text: string, opts: { queue?: boolean } = {}) => {
      const clean = text.trim();
      if (!clean) return;
      if (voiceApi?.ready) void sendNow(clean, opts);
      else {
        queue.current.push({ text: clean, queue: opts.queue ?? false });
        if (phase === 'idle') void start();
      }
    },
    [voiceApi, sendNow, phase, start],
  );

  // Flush queued text once Pooja has joined (queued intents wait for her greeting).
  useEffect(() => {
    if (!voiceApi?.ready || queue.current.length === 0) return;
    const items = queue.current.splice(0);
    const t = setTimeout(() => items.forEach((q) => void sendNow(q.text, { queue: true })), 1500);
    return () => clearTimeout(t);
  }, [voiceApi, sendNow]);

  // ?brief=1 (the dashboard's "Brief me") starts the call with that question.
  // ?meeting=<id> only sets the scope: Pooja greets and waits, no summary until asked.
  const intentHandled = useRef(false);
  useEffect(() => {
    if (intentHandled.current || !params.get('brief')) return;
    intentHandled.current = true;
    ask('Brief me for my next meeting.', { queue: true });
  }, [params, ask]);

  /** Leaves meeting mode: a live call ends first, because the scope is fixed when Pooja joins. */
  const switchToAll = useCallback(async () => {
    if (phase === 'live' || phase === 'starting') await end();
    router.replace('/talk');
  }, [phase, end, router]);

  // ------------------------------------------------------------- mute / PTT
  const applyMute = useCallback(
    async (next: boolean) => {
      setMuted(next);
      await voiceApi?.setMuted(next).catch(() => {});
    },
    [voiceApi],
  );
  const pttActive = useRef(false);
  useEffect(() => {
    if (phase !== 'live') return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e) || e.repeat || !muted) return;
      e.preventDefault();
      pttActive.current = true;
      void voiceApi?.setMuted(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pttActive.current) return;
      pttActive.current = false;
      void voiceApi?.setMuted(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [phase, muted, voiceApi]);

  // ------------------------------------------------------------- transcript
  const bubbles = useMemo<Bubble[]>(() => {
    const items: TranscriptItem[] = voice?.transcript ?? [];
    const fromVoice: Bubble[] = items
      .filter((i) => typeof i.text === 'string' && i.text.trim())
      .map((i) => ({
        id: `t-${i.turn_id}-${i.uid}`,
        who: i.uid === AGENT_UID ? 'pooja' : 'you',
        text: String(i.text),
        time: msOf(i._time),
        live: String(i.status) === 'in_progress' || String(i.status) === '0',
      }));
    const spoken = new Set(fromVoice.filter((b) => b.who === 'you').map((b) => b.text.trim().toLowerCase()));
    return [...fromVoice, ...typed.filter((t) => !spoken.has(t.text.trim().toLowerCase()))].sort((a, b) => a.time - b.time);
  }, [voice?.transcript, typed]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  const downloadTranscript = () => {
    const lines = bubbles.map((b) => `[${timeOf(b.time)}] ${b.who === 'you' ? 'You' : 'Pooja'}: ${b.text}`);
    downloadText(`tatva-conversation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, lines.join('\n'), 'text/plain');
  };

  // ------------------------------------------------------------- timeline
  const timeline = useApi<{ activity: Activity[]; pending: Pending | null }>(`/voice/timeline${session ? `?session=${encodeURIComponent(session)}` : ''}`, {
    refreshMs: phase === 'live' ? 1500 : 15_000,
  });
  const stats = useApi<{ recordings: number; transcript_lines: number; documents: number; chunks: number }>('/voice/stats', { refreshMs: 60_000 });
  const status = useApi<{ composio: Record<string, boolean> }>('/status');
  const pending = timeline.data?.pending ?? null;
  const steps = (timeline.data?.activity ?? []).filter((a) => !(a.status === 'pending' && pending && a.tool === pending.kind && pending.status === 'pending'));
  const [deciding, setDeciding] = useState<'approve' | 'cancel' | null>(null);

  const decide = async (choice: 'approve' | 'cancel') => {
    if (!pending) return;
    setDeciding(choice);
    try {
      if (voiceApi?.ready && pending.session_id === session) {
        // In the call: answer Pooja, so she runs it (or cancels) and says the result.
        await sendNow(choice === 'approve' ? 'Yes, go ahead.' : 'No, cancel that.');
      } else {
        const r = await api<{ ok: boolean; say: string }>(`/voice/pending/${pending.id}/${choice === 'approve' ? 'confirm' : 'cancel'}`, { method: 'POST', json: {} });
        toast(r.say, r.ok ? 'success' : 'error');
      }
      setTimeout(() => timeline.reload(), 600);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setTimeout(() => setDeciding(null), 1200);
    }
  };

  // ------------------------------------------------------------- render bits
  const live = phase === 'live';
  const poojaHere = !!voice?.agentConnected && live;
  const state = voice?.agentState;
  const statusLine =
    phase === 'starting'
      ? 'Connecting to Pooja…'
      : phase === 'ending'
        ? 'Ending the conversation…'
        : !live
          ? 'Start a conversation, or pick a suggestion above'
          : !poojaHere
            ? 'Pooja is joining the call…'
            : muted
              ? 'Your mic is muted'
              : state === 'speaking'
                ? 'Pooja is speaking…'
                : state === 'thinking'
                  ? 'Thinking…'
                  : 'Listening…';
  const speaking = poojaHere && state === 'speaking';
  const listening = poojaHere && (state === 'listening' || state === 'idle' || !state) && !muted;
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const connected = Object.entries(status.data?.composio ?? {})
    .filter(([, v]) => v)
    .map(([k]) => ({ gmail: 'Gmail', slack: 'Slack', googlecalendar: 'Calendar', googlesheets: 'Sheets', googledocs: 'Docs', googledrive: 'Drive' })[k] ?? k);

  return (
    <div className="flex w-full flex-col">
      {live && agoraData && rtm && (
        <AgoraProvider>
          <VoiceBridge agoraData={agoraData} rtmClient={rtm} onTokenWillExpire={renewTokens} onState={setVoice} onApi={setVoiceApi} />
        </AgoraProvider>
      )}
      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-space-lg p-space-lg lg:p-space-xl">
        <header className="flex flex-col justify-between gap-space-md pb-space-xs md:flex-row md:items-center">
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center gap-space-sm">
              <h1 className="font-headline-lg text-headline-lg font-extrabold tracking-tight text-on-surface">Talk to Tatva</h1>
              {live && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-sm text-label-sm uppercase tracking-wider text-tertiary-fixed">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tertiary-fixed" />
                  In call · {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            <p className="flex items-center gap-2 font-body-md text-body-md text-on-surface-variant">
              Voice intelligence powered by <span className="font-medium text-primary-container">Pooja</span>
              <span className="inline-block h-1 w-1 rounded-full bg-outline" />
              {poojaHere ? 'Meeting knowledge base connected' : 'Answers from your meetings and documents'}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-space-sm" aria-live="polite">
            {scopeId ? (
              <>
                <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-primary-container/40 bg-primary-container/10 px-3 py-1.5 font-label-md text-label-md text-on-surface">
                  <Icon name="center_focus_strong" className="text-body-md text-primary-container" />
                  <span className="text-on-surface-variant">Focused on:</span>
                  {focus ? (
                    <Link href={`/meetings/${focus.id}`} data-hover="parent" className="max-w-[22rem] truncate font-semibold hover:text-primary-fixed" title={focus.title}>
                      {focus.title}
                    </Link>
                  ) : scopeMeeting.error ? (
                    <span className="text-error">meeting not found</span>
                  ) : (
                    <span className="text-on-surface-variant">loading…</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void switchToAll()}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-surface-container-high px-3 py-1.5 font-label-md text-label-md text-on-surface hover:border-hairline-strong hover:bg-surface-bright"
                >
                  <Icon name="travel_explore" className="text-body-md text-on-surface-variant" />
                  <span>Switch to all meetings</span>
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-container-low px-3 py-1.5 font-label-md text-label-md text-on-surface">
                <Icon name="travel_explore" className="text-body-md text-on-surface-variant" />
                All meetings
              </span>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-space-lg xl:grid-cols-12">
          <section className="flex min-w-0 flex-col gap-space-lg xl:col-span-8">
            <div className="flex flex-wrap items-center gap-space-sm">
              {chips.map((c) => (
                <button
                  key={c.text}
                  type="button"
                  disabled={phase === 'starting' || phase === 'ending'}
                  onClick={() => ask(c.text)}
                  className="group flex items-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-surface-container-low px-space-md py-2 text-on-surface shadow-sm transition-all hover:border-hairline-strong hover:bg-surface-container-high disabled:opacity-50"
                >
                  <Icon name={c.icon} className={`text-body-md ${c.color} transition-transform group-hover:rotate-12`} />
                  <span className="font-label-md text-label-md">{c.text}</span>
                </button>
              ))}
            </div>

            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-surface-container-lowest p-space-xl text-center shadow-md border border-hairline">
              <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-container/10 blur-[90px]" />
              <div className="relative z-10 mb-space-md flex h-44 w-44 items-center justify-center">
                {(speaking || listening) && <div className="absolute inset-0 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-primary-container/10" />}
                <div className={`absolute inset-2 rounded-full bg-primary-container/20 blur-md ${speaking ? 'animate-pulse' : ''}`} />
                {poojaHere && <div className="absolute inset-4 animate-[spin_8s_linear_infinite] rounded-full bg-gradient-to-tr from-primary-container/40 via-transparent to-primary-container/60 opacity-75" />}
                <button
                  type="button"
                  onClick={() => (live ? applyMute(!muted) : start())}
                  disabled={phase === 'starting' || phase === 'ending'}
                  aria-label={live ? (muted ? 'Unmute microphone' : 'Mute microphone') : 'Start conversation'}
                  className={`relative flex h-28 w-28 items-center justify-center rounded-full transition-transform hover:scale-105 ${live && muted ? 'bg-surface-container-high' : 'bg-primary-container'}`}
                >
                  {phase === 'starting' ? (
                    <Spinner className="text-[44px] text-on-primary" />
                  ) : (
                    <Icon name={live && muted ? 'mic_off' : 'mic'} filled className={`text-[44px] ${live && muted ? 'text-on-surface' : 'text-on-primary'}`} />
                  )}
                  <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/30 to-black/20" />
                </button>
              </div>
              <div className="relative z-10 mb-space-lg flex flex-col items-center gap-1.5">
                <h2 className="font-headline-md text-headline-md font-bold tracking-tight text-on-surface">Pooja</h2>
                <div className="my-1 flex h-5 items-center gap-1 rounded-full bg-surface-container-low px-3 py-1">
                  {[2, 4, 3, 5, 2, 4, 1.5].map((h, i) => (
                    <span
                      key={i}
                      className={`w-0.5 rounded-full ${speaking ? 'bg-primary-container' : 'bg-on-surface-variant/40'}`}
                      style={{ height: `${h * 4}px`, animation: speaking ? `pulse ${0.5 + (i % 4) * 0.1}s ease-in-out infinite` : undefined }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${poojaHere ? 'animate-pulse bg-primary-container' : 'bg-on-surface-variant/50'}`} />
                  <span className="font-body-sm text-body-sm font-medium tracking-wide text-on-surface-variant">{statusLine}</span>
                </div>
                {voice?.issue && live && <span className="font-caption text-caption text-error">{voice.issue}</span>}
              </div>
              <div className="relative z-10 flex w-full flex-col items-center justify-center gap-space-md sm:flex-row">
                <div className="flex items-center gap-3">
                  {live || phase === 'ending' ? (
                    <button
                      type="button"
                      onClick={end}
                      disabled={phase === 'ending'}
                      className="group flex items-center gap-2.5 rounded-xl bg-error-container px-6 py-3 text-on-error-container shadow-md transition-all hover:bg-error active:scale-[0.98] disabled:opacity-60"
                    >
                      <Icon name="call_end" className="text-body-lg text-on-error-container transition-colors group-hover:text-on-error" />
                      <span className="font-label-md text-label-md font-bold transition-colors group-hover:text-on-error">End conversation</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={start}
                      disabled={phase === 'starting'}
                      className="flex items-center gap-2.5 rounded-xl bg-primary-container px-6 py-3 text-on-primary transition-all hover:bg-primary-fixed active:scale-[0.98] disabled:opacity-60"
                    >
                      {phase === 'starting' ? <Spinner className="text-body-lg" /> : <Icon name="call" className="text-body-lg" />}
                      <span className="font-label-md text-label-md font-bold">{phase === 'starting' ? 'Connecting…' : 'Start conversation'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                    aria-pressed={muted}
                    disabled={!live}
                    onClick={() => applyMute(!muted)}
                    className={`flex h-12 w-12 items-center justify-center rounded-xl shadow-sm transition-all disabled:opacity-40 ${muted ? 'bg-primary-container text-on-primary hover:bg-primary-fixed' : 'bg-surface-container-high text-on-surface hover:bg-surface-variant'}`}
                  >
                    <Icon name={muted ? 'mic_off' : 'mic'} className="text-headline-sm" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-hairline bg-surface-container-low px-3 py-1.5 font-caption text-caption text-on-surface-variant">
                  <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-on-surface">SPACE</kbd>
                  <span>to push-to-talk while muted</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-space-lg rounded-2xl bg-surface-container-low p-space-lg shadow-sm border border-hairline">
              <div className="flex items-center justify-between pb-space-sm">
                <div className="flex items-center gap-2.5">
                  <Icon name="notes" className="text-body-lg text-on-surface-variant" />
                  <h3 className="font-headline-sm text-headline-sm tracking-tight text-on-surface">Live Session Transcript</h3>
                </div>
                <div className="flex items-center gap-2">
                  {startedAt && <span className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">Today, {timeOf(startedAt)}</span>}
                  <button
                    type="button"
                    aria-label="Download transcript"
                    title="Download transcript"
                    disabled={bubbles.length === 0}
                    onClick={downloadTranscript}
                    className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                  >
                    <Icon name="download" className="text-body-md" />
                  </button>
                </div>
              </div>
              <div ref={scrollRef} className="flex max-h-[480px] flex-col gap-space-md overflow-y-auto pr-1">
                {bubbles.length === 0 && (
                  <p className="py-space-lg text-center font-body-md text-body-md text-on-surface-variant">
                    {live ? 'Say hello to Pooja, or type below.' : 'Your conversation with Pooja will appear here.'}
                  </p>
                )}
                {bubbles.map((b) =>
                  b.who === 'you' ? (
                    <div key={b.id} className="flex max-w-[85%] items-end justify-end gap-2 self-end">
                      <div className="flex flex-col items-end gap-1">
                        <div className={`rounded-2xl rounded-br-[4px] bg-surface-container-lowest p-space-md text-on-surface shadow-sm ${b.live ? 'opacity-70' : ''} border border-hairline`}>
                          <p className="font-body-md text-body-md leading-relaxed">{b.text}</p>
                        </div>
                        <span className="mr-1 font-caption text-caption text-on-surface-variant">
                          {timeOf(b.time)} · You{b.typed ? ' (typed)' : ''}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div key={b.id} className="flex max-w-[88%] items-start justify-start gap-space-sm self-start">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-sm">
                        <span className="font-label-sm text-label-sm font-black">P</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="relative rounded-2xl rounded-tl-[4px] bg-surface-container-high p-space-md text-on-surface shadow-sm">
                          <div className="mb-1 flex items-center justify-between gap-4">
                            <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary-container">
                              Pooja{/(Should|Shall) I [^?]*\?\s*$/.test(b.text) ? ' · Needs your yes' : ''}
                            </span>
                            {b.live && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 font-caption text-caption text-primary-fixed">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
                                Speaking
                              </span>
                            )}
                          </div>
                          <p className="font-body-md text-body-md leading-relaxed text-secondary-fixed">{b.text}</p>
                        </div>
                        <span className="ml-1 font-caption text-caption text-on-surface-variant">{timeOf(b.time)} · Pooja</span>
                      </div>
                    </div>
                  ),
                )}
              </div>
              <form
                className="relative mt-space-sm flex items-center rounded-xl bg-surface-container-lowest shadow-inner transition-all focus-within:ring-2 focus-within:ring-primary-container"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(draft);
                  setDraft('');
                }}
              >
                <div className="flex items-center pl-4 pr-2">
                  <Icon name="graphic_eq" className="text-body-lg text-on-surface-variant" />
                </div>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full bg-transparent px-2 py-3.5 font-body-md text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/60"
                  placeholder={live ? 'Ask or reply to Pooja...' : 'Ask Pooja (starts a call)...'}
                  type="text"
                />
                <div className="flex items-center gap-1.5 pr-2">
                  <button
                    aria-label="Send"
                    type="submit"
                    disabled={!draft.trim() || phase === 'starting' || phase === 'ending'}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-container text-on-primary shadow-sm transition-all hover:bg-primary-fixed disabled:opacity-40"
                  >
                    <Icon name="keyboard_return" className="text-body-lg font-bold" />
                  </button>
                </div>
              </form>
            </div>
          </section>

          <aside className="flex w-full flex-col gap-space-md xl:col-span-4">
            <div className="flex flex-col gap-space-lg rounded-2xl bg-surface-container-low p-space-lg shadow-sm border border-hairline">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">What Tatva is doing</h3>
                  <p className="font-caption text-caption tracking-wide text-on-surface-variant">
                    {session ? (live ? 'This conversation, updating live' : 'Your last conversation') : 'Recent activity'}
                  </p>
                </div>
                {live && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-1 font-label-sm text-label-sm text-primary-fixed">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container" />
                    Live Sync
                  </span>
                )}
              </div>

              <div className="relative flex flex-col gap-space-lg">
                {steps.length === 0 && !pending && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {session ? 'Nothing yet. Ask Pooja a question and each step she takes shows up here.' : 'No activity yet.'}
                  </p>
                )}
                {steps.map((a, i) => {
                  const d = describe(a);
                  const last = i === steps.length - 1 && !pending;
                  return (
                    <div key={a.id} className="relative flex items-start gap-space-md">
                      {!last && <div className="absolute bottom-0 left-4 top-8 -mb-space-lg w-0.5 bg-surface-container-highest" />}
                      <div
                        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${
                          d.tone === 'error' ? 'bg-error-container/40 text-error' : d.tone === 'muted' ? 'bg-surface-container-highest text-on-surface-variant' : 'bg-surface-container-highest text-tertiary-fixed'
                        }`}
                      >
                        <Icon name={d.tone === 'done' && !ACTION_KINDS.includes(a.tool) ? 'check' : d.icon} className="text-body-lg font-bold" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate font-label-md text-label-md font-semibold ${d.tone === 'error' ? 'text-error' : 'text-on-surface'}`} title={d.title}>
                            {d.title}
                          </span>
                          <span className="shrink-0 whitespace-nowrap font-mono text-caption text-on-surface-variant">{stamp(a.created_at)}</span>
                        </div>
                        {d.detail && <p className="line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">{d.detail}</p>}
                        {!session && a.session_id && <span className="font-caption text-caption text-on-surface-variant/70">{a.session_id === 'web' ? 'From the app' : 'Voice'}</span>}
                      </div>
                    </div>
                  );
                })}

                {pending && (
                  <>
                    <div className="relative flex items-start gap-space-md">
                      <div className="absolute bottom-0 left-4 top-8 -mb-space-lg w-0.5 bg-surface-container-highest" />
                      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary">
                        <Icon name="pending_actions" className="text-body-lg font-bold" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-surface-container p-space-md shadow-lg border border-hairline">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="font-label-md text-label-md font-bold text-on-surface">{pending.status === 'failed' ? 'Failed, try again?' : 'Waiting for your approval'}</span>
                            <span className="font-caption text-caption text-on-surface-variant">{pending.status === 'failed' ? (pending.error ?? 'The action failed') : 'Drafted, nothing sent yet'}</span>
                          </div>
                          <span className="shrink-0 rounded bg-primary-container/20 px-2 py-0.5 font-label-sm text-label-sm uppercase tracking-wide text-primary-container">Action Required</span>
                        </div>
                        <div className="flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3 shadow-inner border border-hairline">
                          <PendingPreview p={pending} />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!!deciding}
                            aria-busy={deciding === 'approve'}
                            onClick={() => decide('approve')}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-4 py-2.5 font-label-md text-label-md font-bold text-on-primary transition-all hover:bg-primary-fixed active:scale-[0.98] disabled:opacity-60"
                          >
                            {deciding === 'approve' ? <Spinner className="text-body-md" /> : <Icon name="send" className="text-body-md font-bold" />}
                            <span>{pending.status === 'failed' ? 'Try again' : 'Approve & Send'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={!!deciding}
                            onClick={() => decide('cancel')}
                            aria-busy={deciding === 'cancel'}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-variant disabled:opacity-60"
                          >
                            {deciding === 'cancel' && <Spinner className="text-body-md" />}
                            Cancel
                          </button>
                        </div>
                        <button type="button" disabled title="Coming soon" className="flex items-center justify-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
                          <Icon name="edit" className="text-body-sm" /> Edit draft <ComingSoon />
                        </button>
                      </div>
                    </div>
                    <div className="relative flex items-start gap-space-md opacity-60">
                      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
                        <Icon name={pending.kind === 'send_email' ? 'mail' : pending.kind === 'post_to_slack' ? 'tag' : pending.kind === 'create_calendar_event' ? 'event' : 'table_rows'} className="text-body-lg" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-label-md text-label-md font-semibold text-on-surface">{ACTION_VERB[pending.kind] ?? pending.kind}</span>
                          <span className="font-caption text-caption text-on-surface-variant">Queued</span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">Runs as soon as you approve (by voice or here)</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-space-sm flex flex-col gap-space-sm pt-space-md">
                <div className="flex items-center gap-2 px-space-sm py-1.5 font-caption text-caption text-on-surface-variant">
                  <Icon name="lock" className="text-body-sm text-on-surface-variant" />
                  <span>{connected.length ? `Authorized via Composio: ${connected.join(', ')}` : 'Checking Composio connections…'}</span>
                </div>
              </div>
            </div>

            <Link href="/knowledge" className="tatva-card group flex items-center justify-between rounded-2xl border border-hairline bg-surface-container-low p-space-md shadow-sm transition-colors hover:border-hairline-strong hover:bg-surface-container">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-high text-primary-container">
                  <Icon name="folder_open" className="text-headline-sm" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-label-md text-label-md font-semibold text-on-surface">Meeting Artifacts Loaded</span>
                  <span className="font-caption text-caption text-on-surface-variant">
                    {stats.data
                      ? `${plural(stats.data.recordings, 'recording')} · ${plural(stats.data.transcript_lines, 'transcript line')} · ${plural(stats.data.documents, 'document')}`
                      : 'Loading…'}
                  </span>
                </div>
              </div>
              <Icon name="chevron_right" className="text-body-md text-on-surface-variant transition-transform group-hover:translate-x-0.5" />
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
