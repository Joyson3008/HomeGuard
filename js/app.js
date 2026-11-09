(() => {
  const configuredCameras = window.HOMEGUARD_CAMERAS || [];
  let cameras = configuredCameras;
  try {
    const saved = JSON.parse(localStorage.getItem("homeguard-cameras") || "null");
    if (Array.isArray(saved)) cameras = saved;
    else localStorage.setItem("homeguard-cameras", JSON.stringify(cameras));
  } catch {}
  const grid = document.getElementById("camera-grid");
  const connectedCount = document.getElementById("connected-count");
  const clean = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const cameraSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.3-2h5.4l1.3 2h3v9H3z"/><circle cx="10" cy="11" r="3"/></svg>';
  const refreshSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8a6.3 6.3 0 0 0-11-2L3 8"/><path d="M3 4v4h4M4 12a6.3 6.3 0 0 0 11 2l2-2"/><path d="M17 16v-4h-4"/></svg>';
  const expandSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4"/></svg>';
  const placeholderSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.3-2h5.4l1.3 2h3v9H3z"/><circle cx="10" cy="11" r="3"/></svg>';
  async function saveCameras() {
    try {
      localStorage.setItem("homeguard-cameras", JSON.stringify(cameras));
      const response = await fetch("/api/cameras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cameras }) });
      if (response.ok) {
        const status = await response.json();
        if (!status.ffmpegAvailable) document.getElementById("device-message").textContent = "Cameras saved. Install FFmpeg to enable local recordings.";
      }
    } catch { /* Dashboard may be opened as a static page during setup. */ }
  }

  function render(camera, index) {
    const id = clean(camera.id || `camera-${index + 1}`);
    const name = clean(camera.name || `Camera ${index + 1}`);
    const addr = camera.ip ? `${camera.ip}${camera.port ? `:${camera.port}` : ""}` : "Address not configured";
    const article = document.createElement("article");
    article.className = "camera-card";
    article.innerHTML = `
      <div class="camera-head">
        <div class="cam-ident"><span class="camera-icon">${cameraSvg}</span><span class="camera-name-wrap"><span class="camera-name">${name}</span><span class="camera-id">CAMERA ${String(index + 1).padStart(2, "0")}</span></span></div>
        <div class="camera-actions"><span class="status connecting"><i class="status-dot"></i><span class="status-label">CONNECTING</span></span>
          <button class="icon-button refresh-button" type="button" aria-label="Refresh ${name} feed" title="Refresh camera">${refreshSvg}</button>
        </div>
      </div>
      <div class="feed" id="feed-${id}">
        <img alt="Live feed from ${name}" loading="eager" referrerpolicy="no-referrer">
        <span class="video-watermark" aria-label="Current date and time"></span>
        <div class="feed-overlay"><div class="overlay-content"><div class="placeholder-icon">${placeholderSvg}</div><div class="overlay-title">Preparing camera</div><div class="overlay-copy">Waiting for connection status…</div></div></div>
        <div class="feed-meta"><span class="feed-state">INITIALIZING</span><span class="local-tag">● &nbsp;LOCAL FEED</span></div>
      </div>
      <div class="camera-foot"><label class="ip-entry"><span>IP</span><input class="ip-input" aria-label="${name} IP address" value="${clean(camera.ip || "")}" placeholder="192.168.137.x" inputmode="decimal"><span>PORT</span><input class="port-input" aria-label="${name} port" value="${clean(camera.port || "8080")}" inputmode="numeric"></label><button class="connect-button" type="button">CONNECT</button><span class="camera-address">${clean(addr)}</span><button class="icon-button fullscreen-btn" type="button" aria-label="View ${name} full screen" title="Full screen">${expandSvg}<span>EXPAND</span></button><button class="remove-camera" type="button" aria-label="Remove ${name}">REMOVE</button></div>`;
    grid.appendChild(article);
    const image = article.querySelector("img");
    const status = article.querySelector(".status");
    const statusLabel = article.querySelector(".status-label");
    const overlay = article.querySelector(".feed-overlay");
    const overlayTitle = article.querySelector(".overlay-title");
    const overlayCopy = article.querySelector(".overlay-copy");
    const feedState = article.querySelector(".feed-state");
    const refresh = article.querySelector(".refresh-button");
    const connect = article.querySelector(".connect-button");
    const ipInput = article.querySelector(".ip-input");
    const portInput = article.querySelector(".port-input");
    const full = article.querySelector(".fullscreen-btn");
    const remove = article.querySelector(".remove-camera");

    function setState(state, message) {
      status.className = `status ${state}`;
      const labels = { live: "LIVE", connecting: "CONNECTING", offline: "OFFLINE", setup: "SETUP NEEDED" };
      statusLabel.textContent = labels[state] || state.toUpperCase();
      feedState.textContent = labels[state] || state.toUpperCase();
      if (state === "live") {
        image.classList.add("visible"); overlay.hidden = true;
        connectedCount.textContent = String(grid.querySelectorAll(".status.live").length);
      } else {
        image.classList.remove("visible"); overlay.hidden = false;
        overlayTitle.textContent = state === "setup" ? "Camera needs configuration" : state === "offline" ? "Camera unavailable" : "Connecting to camera";
        overlayCopy.textContent = message;
        connectedCount.textContent = String(grid.querySelectorAll(".status.live").length);
      }
    }

    refresh.addEventListener("click", () => window.HomeGuardCameraManager.refresh(camera.id || `camera-${index + 1}`));
    connect.addEventListener("click", () => {
      const ip = ipInput.value.trim();
      const port = portInput.value.trim() || "8080";
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split(".").some((part) => Number(part) > 255) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        setState("setup", "Enter a valid local IPv4 address and port."); return;
      }
      camera.ip = ip; camera.port = port; camera.streamUrl = `http://${ip}:${port}/video`;
      article.querySelector(".camera-address").textContent = `${ip}:${port}`;
      saveCameras();
      window.HomeGuardCameraManager.setUrl(camera.id || `camera-${index + 1}`, camera.streamUrl);
    });
    full.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await article.requestFullscreen();
        else await document.exitFullscreen();
      } catch { overlayCopy.textContent = "Full-screen mode is unavailable in this browser."; }
    });
    remove.addEventListener("click", () => {
      window.HomeGuardCameraManager.remove(camera.id);
      cameras = cameras.filter((item) => item.id !== camera.id);
      article.remove();
      saveCameras();
      grid.querySelectorAll(".camera-id").forEach((label, i) => label.textContent = `CAMERA ${String(i + 1).padStart(2, "0")}`);
      connectedCount.textContent = String(grid.querySelectorAll(".status.live").length);
    });
    window.HomeGuardCameraManager.start({ ...camera, id: camera.id || `camera-${index + 1}` }, { image }, setState);
  }

  cameras.forEach(render);
  if (!cameras.length) grid.innerHTML = '<p class="empty-state">No cameras are configured. Add camera entries in js/camera-config.js.</p>';

  document.getElementById("add-camera-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const ip = String(data.get("ip")).trim();
    const port = String(data.get("port")).trim();
    const message = document.getElementById("device-message");
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split(".").some((part) => Number(part) > 255) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      message.textContent = "Enter a valid IPv4 address and port."; return;
    }
    const camera = { id: `camera-${crypto.randomUUID()}`, name, ip, port, streamUrl: `http://${ip}:${port}/video` };
    cameras.push(camera); render(camera, cameras.length - 1);
    saveCameras();
    message.textContent = `${name} added. Camera settings are saved in this browser.`;
    form.reset(); form.elements.port.value = "8080";
  });
  saveCameras();
  async function refreshUploadStatus() {
    const label = document.getElementById("upload-status");
    try {
      const response = await fetch("/api/recordings/status", { cache: "no-store" });
      if (!response.ok) { label.textContent = "Recording/upload status unavailable. Check that HomeGuard is running and signed in."; return; }
      const state = await response.json();
      const upload = state.upload || {};
      const messages = {
        waiting_admin: "Uploads paused: sign in to HomeGuard.", offline: "Uploads queued: waiting for internet.",
        unavailable: "Uploads unavailable: MEGAcmd was not found.", not_signed_in: "Uploads paused: sign in to MEGAcmd.",
        uploading: `Uploading to MEGA: ${upload.file || "in progress"}…`, error: `Upload issue: ${upload.message || "check MEGAcmd"}`,
        idle: "MEGA upload ready; no completed segments waiting.", uploaded: upload.message || "Upload complete."
      };
      let text = state.ffmpegAvailable ? `Recording ${state.segmentMinutes}-minute segments` : "Recording disabled (FFmpeg missing)";
      text += ` · ${messages[upload.state] || upload.message || "Checking MEGA upload…"}`;
      if (state.completedWaiting > 0 && upload.state !== "uploading") text += ` · ${state.completedWaiting} completed segment(s) queued`;
      if (state.lastUploaded) text += ` · Last upload ${new Date(state.lastUploaded.uploaded_at * 1000).toLocaleString()}`;
      label.textContent = text;
      label.dataset.state = upload.state || "waiting";
    } catch { label.textContent = "Could not read recording/upload status."; }
  }
  refreshUploadStatus(); setInterval(refreshUploadStatus, 5000);
  fetch("/api/recordings/status").then((response) => response.ok ? response.json() : null).then((state) => {
    if (!state) return;
    const notes = [];
    notes.push(state.ffmpegAvailable ? `Recording: ${state.segmentMinutes}-minute segments on this PC; 48-hour retention.` : "Recording disabled: FFmpeg is not available on PATH.");
    notes.push(state.megaAvailable ? (state.megaLoggedIn ? "MEGA client is signed in; uploads run while an admin session and internet are available." : "MEGAcmd is installed but not signed in.") : "Cloud upload disabled: install MEGAcmd.");
    document.getElementById("device-message").textContent = notes.join(" ");
  }).catch(() => {});

  function tickClock() {
    const now = new Date();
    document.getElementById("clock-time").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
    document.getElementById("clock-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(now).toUpperCase();
    document.querySelectorAll(".video-watermark").forEach((mark) => {
      mark.textContent = new Intl.DateTimeFormat(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(now);
    });
  }
  tickClock(); setInterval(tickClock, 1000);
})();
