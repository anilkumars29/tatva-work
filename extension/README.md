# Tatva Work Recorder (Chrome extension)

Manifest V3 extension that records a browser meeting (Google Meet / Teams web):
the meeting tab's audio **and** your microphone, mixed into one WebM/Opus file.
The meeting stays audible while it records.

On Stop it saves a local backup to `Downloads/Tatva Work/meeting_<date>_<time>.webm`
and uploads the recording to the Tatva Work server (`http://localhost:4000`, see
[../server/README.md](../server/README.md)). The popup then shows Uploading… →
Processing… (stage) → Ready with the meeting title, time saved, and links to the
Google Doc and the meeting JSON.

No build step: plain JavaScript, load the folder unpacked. Requires Chrome 116+.

## Files

| File | Role |
| ---- | ---- |
| `manifest.json` | Permissions: `tabCapture`, `offscreen`, `downloads`, `storage`, `activeTab`; host permission `http://localhost:4000/*` (upload + status, no CORS needed) |
| `popup.html/js/css` | Start/Stop button, running timer, status and messages |
| `service-worker.js` | Owns recording + upload state (`chrome.storage.session`), creates/closes the offscreen document, saves the backup with `chrome.downloads`, polls meeting status from the server, shows the `REC` badge |
| `offscreen.html/js` | Captures tab audio (tab-capture stream ID) and mic, mixes them with Web Audio, records with `MediaRecorder` (Opus 48 kbps), plays tab audio back so you can hear the meeting, uploads the recording |
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
