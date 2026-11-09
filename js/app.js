(() => {
  const cameras = window.HOMEGUARD_CAMERAS || [];
  const grid = document.getElementById("camera-grid");
  const connectedCount = document.getElementById("connected-count");
  const clean = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const cameraSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.3-2h5.4l1.3 2h3v9H3z"/><circle cx="10" cy="11" r="3"/></svg>';
  const refreshSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8a6.3 6.3 0 0 0-11-2L3 8"/><path d="M3 4v4h4M4 12a6.3 6.3 0 0 0 11 2l2-2"/><path d="M17 16v-4h-4"/></svg>';
  const expandSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4"/></svg>';
  const placeholderSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.3-2h5.4l1.3 2h3v9H3z"/><circle cx="10" cy="11" r="3"/></svg>';

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
        <div class="feed-overlay"><div class="overlay-content"><div class="placeholder-icon">${placeholderSvg}</div><div class="overlay-title">Preparing camera</div><div class="overlay-copy">Waiting for connection status…</div></div></div>
        <div class="feed-meta"><span class="feed-state">INITIALIZING</span><span class="local-tag">● &nbsp;LOCAL FEED</span></div>
      </div>
      <div class="camera-foot"><label class="ip-entry"><span>IP</span><input class="ip-input" aria-label="${name} IP address" value="${clean(camera.ip || "")}" placeholder="192.168.137.x" inputmode="decimal"><span>PORT</span><input class="port-input" aria-label="${name} port" value="${clean(camera.port || "8080")}" inputmode="numeric"></label><button class="connect-button" type="button">CONNECT</button><span class="camera-address">${clean(addr)}</span><button class="icon-button fullscreen-btn" type="button" aria-label="View ${name} full screen" title="Full screen">${expandSvg}<span>EXPAND</span></button></div>`;
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
      try { localStorage.setItem(`homeguard-${camera.id || `camera-${index + 1}`}`, JSON.stringify({ ip, port })); } catch {}
      window.HomeGuardCameraManager.setUrl(camera.id || `camera-${index + 1}`, camera.streamUrl);
    });
    full.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await article.requestFullscreen();
        else await document.exitFullscreen();
      } catch { overlayCopy.textContent = "Full-screen mode is unavailable in this browser."; }
    });
    window.HomeGuardCameraManager.start({ ...camera, id: camera.id || `camera-${index + 1}` }, { image }, setState);
  }

  cameras.slice(0, 7).forEach(render);
  if (!cameras.length) grid.innerHTML = '<p class="empty-state">No cameras are configured. Add camera entries in js/camera-config.js.</p>';

  function tickClock() {
    const now = new Date();
    document.getElementById("clock-time").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
    document.getElementById("clock-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(now).toUpperCase();
  }
  tickClock(); setInterval(tickClock, 1000);
})();
