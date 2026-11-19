// Content script on the Tatva web app (localhost:3000): marks the page so the
// app's sidebar can show "Extension connected". Reads nothing from the page.
document.documentElement.dataset.tatvaExtension = chrome.runtime.getManifest().version;
