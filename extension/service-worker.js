// Tatva Work Recorder — service worker.
//
// Coordinates recording. The popup gets a tab-capture stream ID and asks this
// worker to start; the worker opens an offscreen document (the only extension
// context that can hold a MediaRecorder for long), forwards the request, and
// keeps the shared state in chrome.storage.session so the popup's timer
// survives the popup closing.
//
// On stop, the offscreen document hands back a blob: URL. This worker saves it
// with chrome.downloads (local backup; offscreen documents can only use
// chrome.runtime) and asks the offscreen document to upload it to the Tatva
// Work server. While the server processes the meeting, the popup polls status
// through 'get-state'.

const SERVER_URL = 'http://localhost:4000';
const OFFSCREEN_URL = 'offscreen.html';

const IDLE_STATE = {
  status: 'idle', // idle | starting | recording | saving
  startedAt: null,
  tabId: null,
  tabTitle: null,
  tabUrl: null,
  micIncluded: false,
  warning: null,
  error: null,
  lastFile: null, // { filename, size, durationMs, downloadId }
  // Last meeting sent to the server:
  // { status: uploading | processing | ready | failed | upload_failed,
  //   meetingId, stage, title, gdocUrl, timeSavedMinutes, error }
  upload: null,
  // Offscreen document stays open until both are done (it owns the blob).
  cleanup: null, // { downloadId, downloadDone, uploadDone }
};

async function getState() {
  const { recState } = await chrome.storage.session.get('recState');
  return { ...IDLE_STATE, ...(recState ?? {}) };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ recState: next });
  return next;
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Record meeting tab audio and microphone with MediaRecorder.',
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

function setBadge(recording) {
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  if (recording) chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

function timestampForFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

// Closes the offscreen document once the download and the upload are both
// finished. Never closes it while a new recording is running.
async function maybeCleanup(patch) {
  const state = await getState();
  const cleanup = { ...(state.cleanup ?? {}), ...patch };
  if (cleanup.downloadDone && cleanup.uploadDone) {
    await setState({ cleanup: null });
    if (state.status === 'idle') await closeOffscreenDocument();
  } else {
    await setState({ cleanup });
  }
}

// If the extension was reloaded or the offscreen document died, a stale
// "recording" state would leave the popup stuck. Reset it.
async function reconcileState() {
  const state = await getState();
  if (state.status !== 'idle' && !(await hasOffscreenDocument())) {
    setBadge(false);
    return setState({
      ...IDLE_STATE,
      lastFile: state.lastFile,
      upload: state.upload,
      error: 'Recording was interrupted (extension or browser restarted).',
    });
  }
  if (state.upload?.status === 'uploading' && !(await hasOffscreenDocument())) {
    return setState({
      upload: { ...state.upload, status: 'upload_failed', error: 'Upload was interrupted. The recording is in your Downloads.' },
      cleanup: null,
    });
  }
  return state;
}

// Asks the server for the meeting's progress (called while the popup polls).
async function refreshMeetingStatus(state) {
  const upload = state.upload;
  if (upload?.status !== 'processing' || !upload.meetingId) return state;
  try {
    const response = await fetch(`${SERVER_URL}/api/meetings/${upload.meetingId}?transcript=false`);
    if (!response.ok) throw new Error(`Server responded ${response.status}`);
    const { meeting } = await response.json();
    const finished = meeting.status === 'ready' || meeting.status === 'failed';
    return setState({
      upload: {
        ...upload,
        status: finished ? meeting.status : 'processing',
        stage: meeting.status,
        title: meeting.title,
        gdocUrl: meeting.gdoc_url,
        timeSavedMinutes: meeting.time_saved_minutes,
        error: meeting.error,
        checkError: null,
      },
    });
  } catch (err) {
    // Keep polling; show why the status is stale.
    return setState({ upload: { ...upload, checkError: `Can't reach the server (${err.message}).` } });
  }
}

async function startRecording({ streamId, tabId, tabTitle, tabUrl, withMic }) {
  const state = await reconcileState();
  if (state.status !== 'idle') {
    throw new Error('A recording is already in progress.');
  }

  await setState({ status: 'starting', tabId, tabTitle, tabUrl, error: null, warning: null });
  try {
    await ensureOffscreenDocument();
    const result = await sendToOffscreen({ type: 'start', streamId, withMic });
    if (!result?.ok) throw new Error(result?.error || 'Offscreen recorder failed to start.');

    setBadge(true);
    return await setState({
      status: 'recording',
      startedAt: Date.now(),
      micIncluded: result.micIncluded,
      warning: result.micIncluded
        ? null
        : `Microphone not included: ${result.micError || 'unavailable'}. Recording meeting audio only.`,
    });
  } catch (err) {
    if (!(await getState()).cleanup) await closeOffscreenDocument();
    setBadge(false);
    await setState({ status: 'idle', startedAt: null, error: err.message });
    throw err;
  }
}

// Saves a finished recording locally and uploads it. Called both for
// user-initiated stops and when the recorder stops by itself (tab closed).
async function finishRecording({ url, size, durationMs }) {
  const state = await getState();
  const filename = `Tatva Work/meeting_${timestampForFilename(new Date())}.webm`;
  const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });

  setBadge(false);
  const next = await setState({
    ...IDLE_STATE,
    tabTitle: state.tabTitle,
    lastFile: { filename, size, durationMs, downloadId },
    upload: { status: 'uploading' },
    cleanup: { downloadId, downloadDone: false, uploadDone: false },
  });

  await sendToOffscreen({ type: 'upload', serverUrl: SERVER_URL, tabTitle: state.tabTitle, tabUrl: state.tabUrl });
  return next;
}

async function stopRecording() {
  const state = await reconcileState();
  if (state.status !== 'recording') {
    throw new Error('No recording in progress.');
  }
  await setState({ status: 'saving' });
  try {
    const result = await sendToOffscreen({ type: 'stop' });
    if (!result?.ok) throw new Error(result?.error || 'Offscreen recorder failed to stop.');
    return await finishRecording(result);
  } catch (err) {
    await closeOffscreenDocument();
    setBadge(false);
    await setState({ ...IDLE_STATE, upload: state.upload, error: err.message });
    throw err;
  }
}

async function onUploadFinished({ ok, meetingId, error }) {
  await setState({
    upload: ok
      ? { status: 'processing', meetingId, stage: 'uploaded' }
      : { status: 'upload_failed', error: `${error} The recording is saved in your Downloads.` },
  });
  await maybeCleanup({ uploadDone: true });
  return getState();
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;
  if (delta.state.current !== 'complete' && delta.state.current !== 'interrupted') return;
  const state = await getState();
  if (state.cleanup?.downloadId === delta.id) await maybeCleanup({ downloadDone: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'service-worker') return false;

  const respond = (promise) => {
    promise
      .then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the channel open for the async response
  };

  switch (message.type) {
    case 'get-state':
      return respond(reconcileState().then(refreshMeetingStatus));
    case 'start':
      return respond(startRecording(message));
    case 'stop':
      return respond(stopRecording());
    case 'auto-stopped':
      // The offscreen recorder ended on its own (e.g. the meeting tab closed).
      return respond(finishRecording(message));
    case 'upload-finished':
      return respond(onUploadFinished(message));
    case 'clear-error':
      return respond(setState({ error: null, warning: null }));
    case 'dismiss-upload':
      return respond(setState({ upload: null }));
    default:
      return false;
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.set({ recState: { ...IDLE_STATE } });
  setBadge(false);
});
