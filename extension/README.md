# Tatva Recorder (Chrome extension)

Manifest V3 extension that records a browser meeting (Google Meet / Teams web):
the meeting tab's audio **and** your microphone, mixed into one WebM/Opus file.
The meeting stays audible while it records.

On Stop it saves a local backup to `Downloads/Tatva/meeting_<date>_<time>.webm`
and uploads the recording to the Tatva server (`http://localhost:4000`, see
[../server/README.md](../server/README.md)). The popup then shows Uploading… →
Processing… (stage) → Ready with the meeting title, time saved, and links to the
Google Doc and the meeting JSON.

No build step: plain JavaScript, load the folder unpacked. Requires Chrome 116+.

### Reloading after an update

After pulling changes (current version **0.4.0**): open `chrome://extensions`,
find **Tatva Recorder** and press its reload icon (or *Load unpacked* → this
`extension/` folder if it isn't installed). Then reload the Tatva web app tab
(`http://localhost:3000`): content scripts only attach to pages loaded after
the extension. The sidebar shows **Extension connected**, and the avatar menu
shows the version. If it still says *not detected*, check the extension's
*Details → Site access* allows `localhost` (or is "On all sites").

## Files

| File | Role |
| ---- | ---- |
| `manifest.json` | Permissions: `tabCapture`, `offscreen`, `downloads`, `storage`, `activeTab`; host permission `http://localhost:4000/*` (upload + status, no CORS needed) |
| `popup.html/js/css` | Start/Stop button, running timer, status and messages |
| `service-worker.js` | Owns recording + upload state (`chrome.storage.session`), creates/closes the offscreen document, saves the backup with `chrome.downloads`, polls meeting status from the server, shows the `REC` badge |
| `offscreen.html/js` | Captures tab audio (tab-capture stream ID) and mic, mixes them with Web Audio, records with `MediaRecorder` (Opus 48 kbps), plays tab audio back so you can hear the meeting, uploads the recording |
| `page-marker.js` | Content script on `localhost:3000` only: marks `<html data-tatva-extension="<version>">` (re-applied if the page re-renders it) and answers a `tatva:extension-ping` window message, so the web app can show "Extension connected". Reads nothing from the page |
| `icons/` | Tatva mark at 16/32/48/128 px (generated from `public/brand`) |
| `permission.html/js` | One-time page that grants the extension microphone access (offscreen documents cannot show a permission prompt) |

## How it works

1. Popup → `chrome.tabCapture.getMediaStreamId({ targetTabId })` for the active tab.
2. Popup → service worker `start` → creates the offscreen document (reason `USER_MEDIA`).
3. Offscreen: `getUserMedia` for the tab stream and the mic → `AudioContext`:
   tab → speakers + mix; mic → mix only (no echo) → `MediaRecorder` (1 s chunks).
4. Popup → `stop` → offscreen returns a `blob:` URL → service worker downloads it and
   asks the offscreen document to `POST /api/meetings`. The offscreen document closes
   once both the download and the upload are finished.
5. While the popup is open it polls `GET /api/meetings/:id` (via the service worker)
   until the meeting is `ready` or `failed`.
6. If the meeting tab closes, the recording stops and is saved automatically.

## Known limitations

- Use headphones. With speakers, your mic also picks up the meeting audio, so
  other people's voices are recorded twice (slightly delayed).
- `MediaRecorder` WebM files have no duration in their header, so some players
  show an unknown length or can't seek. Chrome and VLC play them fine.
- If the server is down, the popup shows "Upload failed"; the local backup is still
  in Downloads and can be uploaded with `pnpm run test:e2e -- <file>` in `server/`.
- Chrome pages (`chrome://`, the Web Store) can't be captured.
- Only one capture per tab: another extension or screen share capturing the
  same tab makes Start fail with an error in the popup.
