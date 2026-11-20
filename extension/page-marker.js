// Content script for the Tatva web app (localhost:3000, *.vercel.app, or a
// custom web app URL set in the popup). Lets the app's sidebar show
// "Extension connected". Reads nothing from the page, and stays inert on any
// page that isn't Tatva (it must have <meta name="tatva-app">).
//  1. Marks <html data-tatva-extension="<version>"> and puts the mark back if
//     the page's framework re-renders <html> and drops it.
//  2. Answers a window "tatva:extension-ping" with "tatva:extension-pong", so
//     the app can re-check at any time (e.g. when the tab regains focus).
(() => {
  const version = chrome.runtime.getManifest().version;
  const root = document.documentElement;
  const isTatva = () => !!document.querySelector('meta[name="tatva-app"]');
  let active = false;

  const mark = () => {
    if (root.dataset.tatvaExtension !== version) root.dataset.tatvaExtension = version;
  };

  function activate() {
    if (active || !isTatva()) return;
    active = true;
    mark();
    new MutationObserver(mark).observe(root, { attributes: true, attributeFilter: ['data-tatva-extension'] });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'tatva:extension-ping') return;
    activate();
    if (!active) return;
    window.postMessage({ type: 'tatva:extension-pong', version }, window.location.origin);
  });

  // At document_start the <head> isn't parsed yet: check now and once the DOM is ready.
  activate();
  if (!active) document.addEventListener('DOMContentLoaded', activate, { once: true });
})();
