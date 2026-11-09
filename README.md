# HomeGuard — Local CCTV Dashboard

Offline-first CCTV dashboard with a local Python service for login, camera configuration, recording, retention, and optional MEGA uploads. The dashboard uses native browser `<img>` streaming for IP Webcam MJPEG feeds.

## Configure the cameras

Edit `js/camera-config.js`. For each phone, enter its actual local IP, port, display name, and the complete stream URL shown by that phone's IP Webcam setup. The URL endpoint is installation-specific; retain its exact path and query parameters. The supplied stream URL is used as the source without guessing an endpoint.

Keep the laptop and phones connected to the same existing Wi-Fi hotspot. The local-network badge describes the dashboard's intended LAN-only mode; `navigator.onLine` and a green badge cannot prove that a phone is reachable or that the internet is unavailable.

## Run the secured local service

Install FFmpeg and make sure `ffmpeg` runs from PowerShell. For cloud uploads, install the official MEGAcmd client and sign in to the MEGA account using MEGAcmd. Then run `start-homeguard.ps1` (or `py server.py`) and open `http://127.0.0.1:8000`. On first run, create an administrator password of at least 12 characters. The local service binds to localhost and is not exposed to other devices. Do not use `py -m http.server`; it bypasses the login and recording service.

Recording starts when the dashboard submits its camera list to the service. For the current integration test, each MJPEG feed is saved as three-minute MKV segments under `data/recordings/<camera-id>/`. Set `SEGMENT_MINUTES = 180` in `server.py` after the test to restore three-hour segments. Files older than 48 hours are removed at service startup, after successful login, and hourly while the service runs. Admin password and camera list are stored under `data/`; recordings remain on this PC. These files are excluded from Git.

When a HomeGuard admin session is active and the PC can reach MEGA, the background queue uploads completed segments through MEGAcmd. Upload checks run once per minute, so completed segments are sent shortly after their recording closes. The remote folder is `/Root/HomeGuard/<camera-id>/`. HomeGuard tracks its own uploaded objects in `data/mega-upload-index.json` and removes the oldest tracked uploads when their total exceeds 6,000,000,000 bytes (6 GB decimal). Local recordings are still deleted at 48 hours as configured, regardless of upload status. MEGAcmd must be installed and signed in under the same Windows user running HomeGuard. The MEGA account password is not stored in HomeGuard source files.

To set up MEGA, install MEGAcmd from [mega.nz/cmd](https://mega.nz/cmd), start its shell, and sign in with its `login` command. Confirm `mega-whoami` succeeds in PowerShell opened as the same Windows user, then restart HomeGuard. MEGAcmd keeps its own local session; don’t put your MEGA password in JavaScript or commit it to this project.

FFmpeg and MEGAcmd are external prerequisites. If either is unavailable, the dashboard still runs but the corresponding recording or upload feature is disabled. Uploading also requires an active HomeGuard admin session and internet access. Recordings depend on the phones staying reachable and IP Webcam remaining active. Verify that `.mkv` files appear in `data/recordings` and that MEGAcmd reports a logged-in session before relying on cloud uploads.

External font downloads are intentionally avoided. The interface uses system fonts and works without internet access.

## Connection behavior and limits

- A camera becomes **LIVE** after the browser reports the image stream loaded. Initial connection attempts time out after 12 seconds.
- On image errors or connection timeout, the dashboard retries with exponential delays (2.5, 5, 10, and 20 seconds), then pauses. Use that camera's refresh control to retry immediately.
- Browsers do not expose a dependable per-frame heartbeat for a continuous MJPEG image element. After the first successful image load, the UI cannot reliably detect a stream that silently freezes; **LIVE** means the browser loaded the stream, not that every later frame is healthy.
- Camera reachability, recording format, disk use, simultaneous recording, and offline operation still need verification on the laptop with the supplied phones.

## Troubleshooting

1. Confirm both phones remain on the laptop's hotspot and IP Webcam is still serving each feed.
2. Open each exact stream URL directly in the laptop browser to check it independently.
3. Verify the full URL, local address, port, and endpoint in `js/camera-config.js`.
4. If the dashboard reports **OFFLINE**, check Windows Firewall, the phone's screen/battery behavior, and whether its IP address changed; use the individual refresh control after correcting the cause.
5. Camera URLs are local network addresses and are sent to the local service. Keep the `data` folder private because it contains the password verifier, camera list, and recordings.
