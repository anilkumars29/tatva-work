// Grants the extension origin microphone access once, from a normal tab.
// The offscreen recorder can then use the mic without a prompt.

const result = document.getElementById('result');
const retry = document.getElementById('retry');

async function requestMic() {
  retry.hidden = true;
  result.className = '';
  result.textContent = 'Click “Allow” in Chrome’s prompt.';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    result.className = 'ok';
    result.textContent =
      'Microphone allowed. Go back to your meeting tab, open Tatva Work and press Start recording. This tab will close.';
    setTimeout(() => window.close(), 4000);
  } catch (err) {
    result.className = 'err';
    result.textContent =
      err.name === 'NotAllowedError'
        ? 'Microphone blocked. Click the camera/mic icon in the address bar, allow the microphone, then press “Ask again”. You can also record meeting audio only: just press Start in the popup.'
        : `Could not access the microphone: ${err.message || err.name}`;
    retry.hidden = false;
  }
}

retry.addEventListener('click', requestMic);
requestMic();
