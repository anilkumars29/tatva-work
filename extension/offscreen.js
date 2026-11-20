// Tatva Recorder — offscreen document.
//
// Captures the meeting tab's audio (from a tabCapture stream ID) and the
// user's microphone, mixes them with Web Audio, and records the mix with
// MediaRecorder as WebM/Opus.
//
// Capturing a tab mutes it for the user, so the tab audio is also routed to
// the AudioContext's speakers. The mic is NOT routed to the speakers (that
// would echo the user's own voice back to them).

const MIME_TYPE = 'audio/webm;codecs=opus';
// 48 kbps Opus is clear for speech and keeps 1 hour at ~22 MB (under Groq's
// 25 MB upload limit and Supabase's 50 MB free-tier file limit).
const BITRATE = 48000;

let session = null; // { recorder, chunks, streams, audioContext, startedAt, stopping }
let lastRecording = null; // { blob, startedAt, durationMs } kept for upload

function stopStreams(streams) {
  for (const stream of streams) {
    for (const track of stream.getTracks()) track.stop();
  }
}

async function start({ streamId, withMic }) {
  if (session) throw new Error('Already recording.');

  // 1. Meeting tab audio.
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // 2. Microphone (optional: fall back to tab-only if it is unavailable).
  let micStream = null;
  let micError = null;
  if (withMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      micError = err.name === 'NotAllowedError' ? 'permission not granted' : err.message || err.name;
    }
  } else {
    micError = 'permission not granted';
  }

  // 3. Mix.
  const audioContext = new AudioContext();
  await audioContext.resume();
  const mixDestination = audioContext.createMediaStreamDestination();

  const tabSource = audioContext.createMediaStreamSource(tabStream);
  tabSource.connect(audioContext.destination); // keep the meeting audible
  tabSource.connect(mixDestination);

  if (micStream) {
    audioContext.createMediaStreamSource(micStream).connect(mixDestination);
  }

  // 4. Record.
  const recorder = new MediaRecorder(mixDestination.stream, {
    mimeType: MediaRecorder.isTypeSupported(MIME_TYPE) ? MIME_TYPE : 'audio/webm',
    audioBitsPerSecond: BITRATE,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000); // 1 s chunks, so little is lost if something crashes

  session = {
    recorder,
    chunks,
    streams: micStream ? [tabStream, micStream] : [tabStream],
    audioContext,
    startedAt: Date.now(),
    stopping: false,
  };

  // If the meeting tab closes or capture ends, stop and save automatically.
  tabStream.getAudioTracks()[0]?.addEventListener('ended', async () => {
    if (!session || session.stopping) return;
    try {
      const result = await stop();
      await chrome.runtime.sendMessage({ target: 'service-worker', type: 'auto-stopped', ...result });
    } catch (err) {
      console.error('Auto-stop failed', err);
    }
  });

  return { micIncluded: Boolean(micStream), micError };
}

function stop() {
  if (!session) return Promise.reject(new Error('Not recording.'));
  const current = session;
  current.stopping = true;

  return new Promise((resolve, reject) => {
    current.recorder.onerror = (event) => reject(event.error || new Error('MediaRecorder error'));
    current.recorder.onstop = () => {
      stopStreams(current.streams);
      current.audioContext.close();
      session = null;

      const blob = new Blob(current.chunks, { type: 'audio/webm' });
      if (blob.size === 0) {
        reject(new Error('Recording is empty.'));
        return;
      }
      const durationMs = Date.now() - current.startedAt;
      lastRecording = { blob, startedAt: current.startedAt, durationMs };
      // The URL stays valid while this document is open; the service worker
      // closes the document once the download and the upload have finished.
      resolve({
        url: URL.createObjectURL(blob),
        size: blob.size,
        durationMs,
      });
    };
    current.recorder.stop();
  });
}

// Uploads the last recording to the Tatva server. Reports the outcome
// with an 'upload-finished' message (which also wakes the service worker if
// Chrome suspended it during a long upload).
async function upload({ serverUrl, headers, tabTitle, tabUrl }) {
  if (!lastRecording) throw new Error('No recording to upload.');
  const { blob, startedAt, durationMs } = lastRecording;

  let result;
  try {
    const form = new FormData();
    form.append('audio', blob, `meeting_${startedAt}.webm`);
    form.append('title_hint', tabTitle || '');
    form.append('source_url', tabUrl || '');
    form.append('recorded_at', new Date(startedAt).toISOString());
    form.append('duration_ms', String(durationMs));

    const response = await fetch(`${serverUrl}/api/meetings`, { method: 'POST', body: form, headers: headers || {} });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('The server refused the upload: check the access code in the extension settings (gear icon). The recording is in your Downloads.');
    if (!response.ok || !body.id) throw new Error(body.error || `Server responded ${response.status}`);
    result = { ok: true, meetingId: body.id };
  } catch (err) {
    const message = err instanceof TypeError ? `Server not reachable at ${serverUrl}. Is it running? (Change it in the extension settings.)` : err.message;
    result = { ok: false, error: message };
  }
  lastRecording = null;
  await chrome.runtime.sendMessage({ target: 'service-worker', type: 'upload-finished', ...result });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === 'upload') {
    upload(message); // reports back via 'upload-finished'
    sendResponse({ ok: true });
    return false;
  }

  const run = message.type === 'start' ? start(message) : message.type === 'stop' ? stop() : null;
  if (!run) return false;

  run
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});
