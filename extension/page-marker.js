// Content script on the Tatva web app (localhost:3000). Lets the app's sidebar
// show "Extension connected". Reads nothing from the page.
//  1. Marks <html data-tatva-extension="<version>"> and puts the mark back if
//     the page's framework re-renders <html> and drops it.
//  2. Answers a window "tatva:extension-ping" with "tatva:extension-pong", so
//     the app can re-check at any time (e.g. when the tab regains focus).
const version = chrome.runtime.getManifest().version;
const root = document.documentElement;

const mark = () => {
  if (root.dataset.tatvaExtension !== version) root.dataset.tatvaExtension = version;
};
mark();
new MutationObserver(mark).observe(root, { attributes: true, attributeFilter: ['data-tatva-extension'] });

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'tatva:extension-ping') return;
  mark();
  window.postMessage({ type: 'tatva:extension-pong', version }, window.location.origin);
});
