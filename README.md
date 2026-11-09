# HomeGuard — Prototype 2

Static, offline-first CCTV dashboard for two local IP Webcam feeds. It uses native browser `<img>` streaming for MJPEG and has no framework or package dependencies.

## Configure the cameras

Edit `js/camera-config.js`. For each phone, enter its actual local IP, port, display name, and the complete stream URL shown by that phone's IP Webcam setup. The URL endpoint is installation-specific; retain its exact path and query parameters. The supplied stream URL is used as the source without guessing an endpoint.

Keep the laptop and phones connected to the same existing Wi-Fi hotspot. The local-network badge describes the dashboard's intended LAN-only mode; `navigator.onLine` and a green badge cannot prove that a phone is reachable or that the internet is unavailable.

## Run locally

From this folder, run `py -m http.server 8000 --bind 0.0.0.0`, then open `http://127.0.0.1:8000` on the laptop. The server and camera streams remain on the local network; no cloud service is involved. To open the dashboard on another monitoring laptop later, use the server laptop's LAN address and allow the local server through Windows Firewall for private networks.

External font downloads are intentionally avoided. The interface uses system fonts and works without internet access.

## Connection behavior and limits

- A camera becomes **LIVE** after the browser reports the image stream loaded. Initial connection attempts time out after 12 seconds.
- On image errors or connection timeout, the dashboard retries with exponential delays (2.5, 5, 10, and 20 seconds), then pauses. Use that camera's refresh control to retry immediately.
- Browsers do not expose a dependable per-frame heartbeat for a continuous MJPEG image element. After the first successful image load, the UI cannot reliably detect a stream that silently freezes; **LIVE** means the browser loaded the stream, not that every later frame is healthy.
- Camera reachability, simultaneous viewing, and offline operation still need verification with the supplied phones and their actual stream URLs.

## Troubleshooting

1. Confirm both phones remain on the laptop's hotspot and IP Webcam is still serving each feed.
2. Open each exact stream URL directly in the laptop browser to check it independently.
3. Verify the full URL, local address, port, and endpoint in `js/camera-config.js`.
4. If the dashboard reports **OFFLINE**, check Windows Firewall, the phone's screen/battery behavior, and whether its IP address changed; use the individual refresh control after correcting the cause.
5. If a URL contains a password or token, keep `camera-config.js` private; this static prototype stores settings in the local project file.
