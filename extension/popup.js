// Tatva Recorder — popup.
//
// Shows Start/Stop and a running timer. All recording state lives in the
// service worker (chrome.storage.session), so closing the popup does not stop
// the recording or reset the timer.

const els = {
  dot: document.getElementById('dot'),
  timer: document.getElementById('timer'),
  status: document.getElementById('status'),
  tab: document.getElementById('tab'),
  toggle: document.getElementById('toggle'),
  warning: document.getElementById('warning'),
  error: document.getElementById('error'),
  lastFile: document.getElementById('lastFile'),
  meeting: document.getElementById('meeting'),
  meetingStatus: document.getElementById('meetingStatus'),
  meetingTitle: document.getElementById('meetingTitle'),
  meetingDetail: document.getElementById('meetingDetail'),
  openDoc: document.getElementById('openDoc'),
  openJson: document.getElementById('openJson'),
  dismiss: document.getElementById('dismiss'),
  settingsToggle: document.getElementById('settingsToggle'),
  settings: document.getElementById('settings'),
  customFields: document.getElementById('customFields'),
  serverUrl: document.getElementById('serverUrl'),
  webUrl: document.getElementById('webUrl'),
  accessCode: document.getElementById('accessCode'),
  cloudHint: document.getElementById('cloudHint'),
  testConnection: document.getElementById('testConnection'),
  saveSettings: document.getElementById('saveSettings'),
  settingsMessage: document.getElementById('settingsMessage'),
};

const STAGE_LABELS = {
  uploaded: 'Uploaded',
  transcribing: 'Transcribing',
  extracting: 'Extracting knowledge',
  indexing: 'Indexing + creating Google Doc',
};
let pollHandle = null;

let state = null;
let busy = false;
let tickHandle = null;
let localError = null;

// The service worker may be asleep or restarting: never let a missing reply
// throw out of the popup (it would leave the popup half-drawn).
async function sendToWorker(message) {
  try {
    return await chrome.runtime.sendMessage({ target: 'service-worker', ...message });
  } catch (err) {
    return { ok: false, error: `The recorder service isn't responding (${err.message}). Reload the extension at chrome://extensions.` };
  }
}

// Any unexpected error is shown in the popup instead of failing silently.
function showFatal(err) {
  localError = `Something went wrong: ${err?.message || err}`;
  const box = document.getElementById('error');
  if (box) {
    box.textContent = localError;
    box.hidden = false;
  }
}
window.addEventListener('error', (event) => showFatal(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => showFatal(event.reason));

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showMessage(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

function render() {
  if (!state) return;
  const recording = state.status === 'recording';

  els.dot.classList.toggle('recording', recording);
  els.timer.textContent = recording && state.startedAt ? formatDuration(Date.now() - state.startedAt) : '00:00:00';

  const statusText = {
    idle: 'Ready to record this tab.',
    starting: 'Starting…',
    recording: state.micIncluded ? 'Recording meeting + your mic' : 'Recording meeting audio',
    saving: 'Saving recording…',
  }[state.status];
  els.status.textContent = statusText;
  els.tab.textContent = state.status === 'idle' ? '' : state.tabTitle || '';

  els.toggle.textContent = recording || state.status === 'saving' ? 'Stop recording' : 'Start recording';
  els.toggle.className = recording || state.status === 'saving' ? 'stop' : 'start';
  els.toggle.disabled = busy || state.status === 'starting' || state.status === 'saving';

  showMessage(els.warning, recording ? state.warning : null);
  showMessage(els.error, localError || state.error);

  const file = state.lastFile;
  showMessage(
    els.lastFile,
    state.status === 'idle' && file
      ? `Backup saved to Downloads/${file.filename} (${formatSize(file.size)}, ${formatDuration(file.durationMs)}).`
      : null,
  );

  renderMeeting(state.upload);

  clearInterval(tickHandle);
  if (recording) tickHandle = setInterval(render, 500);
}

// The last meeting sent to the server: Uploading -> Processing... -> Ready.
function renderMeeting(upload) {
  els.meeting.hidden = !upload;
  if (!upload) return;

  const busy = upload.status === 'uploading' || upload.status === 'processing';
  els.meeting.className = `meeting ${upload.status === 'ready' ? 'ready' : busy ? '' : 'failed'}`;

  let status;
  let detail = '';
  if (upload.status === 'uploading') {
    status = 'Uploading…';
  } else if (upload.status === 'processing') {
    status = 'Processing…';
    detail = upload.checkError || STAGE_LABELS[upload.stage] || '';
  } else if (upload.status === 'ready') {
    status = 'Ready';
    detail = upload.timeSavedMinutes != null ? `~${upload.timeSavedMinutes} min saved` : '';
  } else if (upload.status === 'failed') {
    status = 'Processing failed';
    detail = upload.error || '';
  } else {
    status = 'Upload failed';
    detail = upload.error || '';
  }

  els.meetingStatus.textContent = status;
  els.meetingTitle.textContent = upload.status === 'ready' ? upload.title || '' : '';
  els.meetingTitle.hidden = !els.meetingTitle.textContent;
  els.meetingDetail.textContent = detail;
  els.meetingDetail.hidden = !detail;
  els.openDoc.hidden = !(upload.status === 'ready' && upload.gdocUrl);
  els.openJson.hidden = !upload.meetingId || busy;
  els.dismiss.hidden = busy;

  // Start polling once while busy; render() runs every 0.5 s during a
  // recording, so don't restart the interval on every render.
  if (busy && !pollHandle) pollHandle = setInterval(refresh, 2000);
  if (!busy && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

async function refresh() {
  const response = await sendToWorker({ type: 'get-state' });
  if (response?.ok) state = response.state;
  else if (response?.error) localError = response.error;
  render();
}

// Offscreen documents cannot show a permission prompt, so the mic permission
// for the extension must be granted once from a normal extension page.
async function micPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // granted | prompt | denied
  } catch {
    return 'prompt';
  }
}

async function start() {
  const mic = await micPermission();
  if (mic === 'prompt') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    window.close();
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  if (!/^https?:/.test(tab.url || '')) {
    throw new Error('Open the meeting tab (Google Meet / Teams web) and start from there.');
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const response = await sendToWorker({
    type: 'start',
    streamId,
    tabId: tab.id,
    tabTitle: tab.title,
    tabUrl: tab.url,
    withMic: mic === 'granted',
  });
  if (!response?.ok) throw new Error(response?.error || 'Could not start recording.');
  state = response.state;
}

async function stop() {
  const response = await sendToWorker({ type: 'stop' });
  if (!response?.ok) throw new Error(response?.error || 'Could not stop recording.');
  state = response.state;
}

els.toggle.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  localError = null;
  if (state?.error || state?.warning) await sendToWorker({ type: 'clear-error' });
  render();
  try {
    if (state?.status === 'recording') await stop();
    else await start();
  } catch (err) {
    localError = err.message || String(err);
  } finally {
    busy = false;
    await refresh();
  }
});

els.openDoc.addEventListener('click', (event) => {
  event.preventDefault();
  if (state?.upload?.gdocUrl) chrome.tabs.create({ url: state.upload.gdocUrl });
});

els.openJson.addEventListener('click', async (event) => {
  event.preventDefault();
  const settings = await tatvaSettings();
  if (state?.upload?.meetingId) chrome.tabs.create({ url: `${settings.webUrl}/meetings/${state.upload.meetingId}` });
});

// ---------------------------------------------------------------- settings

const selectedServer = () => document.querySelector('input[name=server]:checked')?.value || 'cloud';

/** Settings as currently entered in the form (not yet saved). */
function formSettings() {
  const server = selectedServer();
  const preset = TATVA_PRESETS[server];
  return {
    server,
    serverUrl: trimSlash(preset ? preset.serverUrl : els.serverUrl.value),
    webUrl: trimSlash(preset ? preset.webUrl : els.webUrl.value),
    accessCode: els.accessCode.value.trim(),
  };
}

function settingsMessage(text, tone = 'info') {
  els.settingsMessage.textContent = text || '';
  els.settingsMessage.className = `message ${tone}`;
  els.settingsMessage.hidden = !text;
}

async function loadSettingsForm() {
  const s = await tatvaSettings();
  for (const radio of document.querySelectorAll('input[name=server]')) radio.checked = radio.value === s.server;
  els.serverUrl.value = s.server === 'custom' ? s.serverUrl : '';
  els.webUrl.value = s.server === 'custom' ? s.webUrl : '';
  els.accessCode.value = s.accessCode;
  els.cloudHint.textContent = new URL(TATVA_PRESETS.cloud.serverUrl).host;
  els.customFields.hidden = s.server !== 'custom';
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Custom URLs need host permission (to upload) and a content script (so the web app sees the extension). */
async function grantCustomOrigins(s) {
  const origins = [originOf(s.serverUrl), originOf(s.webUrl)].filter(Boolean).map((o) => `${o}/*`);
  if (!origins.length) throw new Error('Enter valid https:// URLs.');
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error('Permission to reach that server was not granted.');
  const web = originOf(s.webUrl);
  await chrome.scripting.unregisterContentScripts({ ids: ['tatva-marker-custom'] }).catch(() => {});
  if (web) {
    await chrome.scripting.registerContentScripts([{ id: 'tatva-marker-custom', matches: [`${web}/*`], js: ['page-marker.js'], runAt: 'document_start' }]);
  }
}

async function testConnection(s) {
  settingsMessage(`Checking ${s.serverUrl}… (a sleeping cloud server can take up to a minute)`);
  try {
    const health = await fetch(`${s.serverUrl}/health`);
    if (!health.ok) throw new Error(`health check returned ${health.status}`);
    const api = await fetch(`${s.serverUrl}/api/meetings?limit=1`, { headers: tatvaHeaders(s) });
    if (api.status === 401) return settingsMessage('Server is up, but the access code was refused.', 'error');
    if (!api.ok) return settingsMessage(`Server is up, but returned ${api.status}.`, 'warning');
    settingsMessage('Connected. Recordings will upload here.', 'info');
  } catch (err) {
    settingsMessage(`Can't reach ${s.serverUrl}: ${err.message}`, 'error');
  }
}

els.settingsToggle.addEventListener('click', async () => {
  const open = els.settings.hidden;
  els.settings.hidden = !open;
  els.settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    settingsMessage(null);
    await loadSettingsForm();
  }
});

for (const radio of document.querySelectorAll('input[name=server]')) {
  radio.addEventListener('change', () => {
    els.customFields.hidden = selectedServer() !== 'custom';
  });
}

els.saveSettings.addEventListener('click', async () => {
  const s = formSettings();
  try {
    // Must run first, inside the click (permission prompts need a user gesture).
    if (s.server === 'custom') await grantCustomOrigins(s);
    await saveTatvaSettings(s);
    await testConnection(s);
  } catch (err) {
    settingsMessage(err.message || String(err), 'error');
  }
});

els.testConnection.addEventListener('click', () => testConnection(formSettings()));

els.dismiss.addEventListener('click', async (event) => {
  event.preventDefault();
  const response = await sendToWorker({ type: 'dismiss-upload' });
  if (response?.ok) state = response.state;
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.recState) {
    state = changes.recState.newValue;
    render();
  }
});

refresh();
