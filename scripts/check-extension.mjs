// Static checks for the Tatva Recorder extension (no browser needed; part of `pnpm run verify`).
// Catches the mistakes that make the toolbar popup fail to open or open broken:
//  - manifest.json is valid and every file it references exists
//  - the action has a popup, and popup.html's scripts/styles exist
//  - every element id popup.js looks up exists in popup.html
//  - popup.css keeps `[hidden] { display: none }` (component display rules must not un-hide panels)
//  - the extension version matches the one the web app expects (AppShell EXTENSION_VERSION)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('extension');
const problems = [];
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(dir, f));

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
} catch (e) {
  console.error(`FAIL  extension/manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) problems.push(`version "${manifest.version}" is not x.y.z`);

const popup = manifest.action?.default_popup;
if (!popup) problems.push('action.default_popup is missing (the toolbar icon would open nothing)');

const referenced = [
  popup,
  manifest.background?.service_worker,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);
for (const f of referenced) if (!exists(f)) problems.push(`manifest references missing file: ${f}`);

// importScripts() in the service worker
if (manifest.background?.service_worker && exists(manifest.background.service_worker)) {
  for (const m of read(manifest.background.service_worker).matchAll(/importScripts\(([^)]*)\)/g))
    for (const f of m[1].match(/['"]([^'"]+)['"]/g) ?? []) if (!exists(f.slice(1, -1))) problems.push(`service worker imports missing file: ${f}`);
}

// Pages: their scripts and stylesheets must exist.
for (const page of [popup, 'offscreen.html', 'permission.html'].filter((p) => p && exists(p))) {
  const html = read(page);
  for (const m of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^https?:/.test(ref)) problems.push(`${page} loads a remote file (blocked in MV3): ${ref}`);
    else if (!exists(ref)) problems.push(`${page} references missing file: ${ref}`);
  }
  if (/<script(?![^>]*\ssrc=)[^>]*>\s*\S/.test(html)) problems.push(`${page} has an inline <script> (blocked by the MV3 content security policy)`);
}

if (popup && exists(popup) && exists('popup.js')) {
  const ids = new Set([...read(popup).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of read('popup.js').matchAll(/getElementById\('([^']+)'\)/g)) if (!ids.has(m[1])) problems.push(`popup.js looks up #${m[1]}, which popup.html doesn't have`);
}

if (exists('popup.css') && !/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(read('popup.css')))
  problems.push('popup.css must keep `[hidden] { display: none !important; }` so hidden panels stay hidden');

const shell = fs.readFileSync(path.resolve('components/tatva/AppShell.tsx'), 'utf8').match(/EXTENSION_VERSION = '([^']+)'/)?.[1];
if (shell && shell !== manifest.version) problems.push(`web app expects extension ${shell} but manifest.json is ${manifest.version} (update EXTENSION_VERSION in AppShell.tsx)`);

if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  process.exit(1);
}
console.log(`PASS  extension ${manifest.version}: manifest, ${referenced.length} referenced files, popup ids, [hidden] rule, web app version`);
