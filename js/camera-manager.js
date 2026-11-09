/* Native <img> MJPEG monitor. Browsers expose initial load and errors, but
   do not provide a portable per-frame heartbeat for a long-running MJPEG img. */
window.HomeGuardCameraManager = (() => {
  const CONNECT_TIMEOUT_MS = 12000;
  const MAX_RETRIES = 4;
  const RETRY_BASE_MS = 2500;
  const slots = new Map();

  function start(camera, elements, onState) {
    const slot = { camera, elements, onState, retry: 0, timer: null, timeout: null, generation: 0, stopped: false };
    slots.set(camera.id, slot);
    connect(slot);
    return () => { slot.stopped = true; clearTimeout(slot.timer); clearTimeout(slot.timeout); elements.image.onload = null; elements.image.onerror = null; elements.image.removeAttribute("src"); };
  }

  function connect(slot) {
    if (slot.stopped) return;
    clearTimeout(slot.timer); clearTimeout(slot.timeout);
    const { camera, elements, onState } = slot;
    if (!camera.streamUrl) { onState("setup", "Add the actual stream URL in js/camera-config.js to connect this camera."); return; }
    let url;
    try { url = new URL(camera.streamUrl); }
    catch { onState("setup", "The configured stream URL is not valid. Check js/camera-config.js."); return; }
    if (!/^https?:$/.test(url.protocol)) { onState("setup", "Use the local HTTP or HTTPS URL provided by IP Webcam."); return; }

    const generation = ++slot.generation;
    onState("connecting", "Waiting for the camera stream…");
    elements.image.onload = () => {
      if (slot.stopped || generation !== slot.generation) return;
      clearTimeout(slot.timeout); slot.retry = 0;
      onState("live", "Stream image received. The browser cannot confirm ongoing MJPEG frame health.");
    };
    elements.image.onerror = () => {
      if (slot.stopped || generation !== slot.generation) return;
      clearTimeout(slot.timeout); elements.image.classList.remove("visible");
      scheduleRetry(slot, "offline", "Could not load the stream. Retrying with a short delay…");
    };
    slot.timeout = setTimeout(() => {
      if (slot.stopped || generation !== slot.generation) return;
      elements.image.removeAttribute("src"); elements.image.classList.remove("visible");
      scheduleRetry(slot, "offline", "No stream image received before the connection timeout.");
    }, CONNECT_TIMEOUT_MS);
    // Preserve the exact endpoint: IP Webcam paths and query parameters vary by setup.
    elements.image.src = camera.streamUrl;
  }

  function scheduleRetry(slot, state, message) {
    slot.onState(state, message);
    if (slot.retry >= MAX_RETRIES) { slot.onState("offline", "Reconnect attempts paused. Use refresh to try again."); return; }
    const delay = RETRY_BASE_MS * (2 ** slot.retry++);
    slot.timer = setTimeout(() => connect(slot), delay);
  }

  function refresh(id) { const slot = slots.get(id); if (slot) { slot.retry = 0; connect(slot); } }
  function setUrl(id, url) { const slot = slots.get(id); if (slot) { slot.camera.streamUrl = url; slot.retry = 0; connect(slot); } }
  function remove(id) {
    const slot = slots.get(id);
    if (!slot) return;
    slot.stopped = true; clearTimeout(slot.timer); clearTimeout(slot.timeout);
    slot.elements.image.onload = null; slot.elements.image.onerror = null;
    slot.elements.image.removeAttribute("src"); slots.delete(id);
  }
  return { start, refresh, setUrl, remove };
})();
