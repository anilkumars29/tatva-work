/* eslint-disable @typescript-eslint/no-unused-vars -- these are globals used by popup.js and service-worker.js (importScripts) */
// Tatva Recorder settings, shared by the popup and the service worker
// (importScripts). Stored in chrome.storage.local.
//
//  server:     cloud  = the deployed server on Render (default)
//              local  = http://localhost:4000 with the web app on localhost:3000
//              custom = any URL (the popup asks for permission to reach it)
//  accessCode: the same code used to sign in to the web app; sent to the
//              server as x-tatva-access-code (not needed for local).

const TATVA_PRESETS = {
  cloud: { serverUrl: 'https://tatva-server.onrender.com', webUrl: 'https://tatva-work.vercel.app' },
  local: { serverUrl: 'http://localhost:4000', webUrl: 'http://localhost:3000' },
};

const TATVA_DEFAULTS = {
  server: 'cloud',
  serverUrl: TATVA_PRESETS.cloud.serverUrl,
  webUrl: TATVA_PRESETS.cloud.webUrl,
  accessCode: '',
};

const trimSlash = (url) => String(url || '').trim().replace(/\/+$/, '');

async function tatvaSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...TATVA_DEFAULTS, ...(settings || {}) };
  if (s.server !== 'custom') Object.assign(s, TATVA_PRESETS[s.server] || TATVA_PRESETS.cloud);
  s.serverUrl = trimSlash(s.serverUrl);
  s.webUrl = trimSlash(s.webUrl);
  return s;
}

async function saveTatvaSettings(next) {
  await chrome.storage.local.set({ settings: next });
}

function tatvaHeaders(s) {
  return s.accessCode ? { 'x-tatva-access-code': s.accessCode } : {};
}
