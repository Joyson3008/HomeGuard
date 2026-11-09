"""HomeGuard local-only web, authentication, retention, and FFmpeg recorder."""
from __future__ import annotations
import hashlib, hmac, http.server, json, os, secrets, shutil, socket, subprocess, threading, time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RECORDINGS = DATA / "recordings"
AUTH_FILE = DATA / "auth.json"
CAMERAS_FILE = DATA / "cameras.json"
RETENTION_SECONDS = 2 * 24 * 60 * 60
# Normal recording interval: three hours per segment.
SEGMENT_MINUTES = 180
SEGMENT_SECONDS = SEGMENT_MINUTES * 60
MEGA_REMOTE_DIR = "/Root/HomeGuard"
MEGA_MAX_BYTES = 6_000_000_000
HOST, PORT = "127.0.0.1", 8000
SESSIONS: dict[str, float] = {}
RECORDERS: dict[str, subprocess.Popen] = {}
LOCK = threading.RLock()
UPLOAD_LOCK = threading.Lock()
UPLOAD_STATUS = {"state":"waiting", "message":"Waiting for a completed segment", "file":None, "updated_at":int(time.time())}

def set_upload_status(state, message, file=None):
    UPLOAD_STATUS.update({"state":state,"message":message,"file":file,"updated_at":int(time.time())})

def derive_password(password: bytes, salt: bytes) -> bytes:
    # Some Python distributions omit hashlib.pbkdf2_hmac; retain PBKDF2-HMAC-SHA256.
    derive = getattr(hashlib, "pbkdf2_hmac", None)
    if derive:
        return derive("sha256", password, salt, 310000)
    block = hmac.new(password, salt + b"\x00\x00\x00\x01", hashlib.sha256).digest()
    result = bytearray(block)
    current = block
    for _ in range(309999):
        current = hmac.new(password, current, hashlib.sha256).digest()
        for index, value in enumerate(current): result[index] ^= value
    return bytes(result)

def load_json(path, default):
    try: return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError): return default

def save_json(path, value):
    DATA.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temp.replace(path)

def cleanup_old():
    cutoff = time.time() - RETENTION_SECONDS
    if RECORDINGS.exists():
        for item in RECORDINGS.rglob("*"):
            try:
                if item.is_file() and item.stat().st_mtime < cutoff: item.unlink()
            except OSError: pass

def admin_session_active():
    now=time.time()
    for token, expiry in list(SESSIONS.items()):
        if expiry <= now: SESSIONS.pop(token, None)
    return bool(SESSIONS)

def mega_command(name, *args, timeout=30):
    exe=shutil.which(name)
    if not exe: return None
    command=[exe,*map(str,args)]
    try:
        if exe.lower().endswith((".bat", ".cmd")):
            completed=subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout)
        else:
            completed=subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        return completed
    except (OSError, subprocess.TimeoutExpired): return None

def internet_available():
    # A site may reject generic urllib requests while normal internet access works.
    # TCP reachability is enough here; MEGAcmd handles authenticated upload errors.
    for host in ("mega.nz", "1.1.1.1", "8.8.8.8"):
        try:
            with socket.create_connection((host,443),timeout=2): return True
        except OSError: pass
    return False

def upload_completed_recordings():
    if not admin_session_active(): set_upload_status("waiting_admin","Sign in to HomeGuard to enable uploads"); return
    if not internet_available(): set_upload_status("offline","Waiting for internet connection"); return
    if not shutil.which("mega-put"): set_upload_status("unavailable","MEGAcmd upload command was not found"); return
    identity=mega_command("mega-whoami")
    if not identity or identity.returncode: set_upload_status("not_signed_in","MEGAcmd is not signed in"); return
    if not UPLOAD_LOCK.acquire(blocking=False): set_upload_status("uploading","An upload is in progress"); return
    try:
        mkdir=mega_command("mega-mkdir", "-p", MEGA_REMOTE_DIR)
        if not mkdir or mkdir.returncode:
            detail=(mkdir.stderr or mkdir.stdout).strip()[:240] if mkdir else "MEGAcmd command failed or timed out"
            set_upload_status("error",f"Could not open MEGA folder {MEGA_REMOTE_DIR}: {detail}"); return
        index=load_json(DATA / "mega-upload-index.json", [])
        if not isinstance(index,list): index=[]
        known={item.get("local") for item in index if isinstance(item,dict)}
        candidates=[]
        for file in RECORDINGS.rglob("*.mkv"):
            try:
                stat=file.stat()
                # Ignore an open/incomplete segment, including zero-byte files created
                # while FFmpeg is opening a new output segment.
                if stat.st_size < 1024 or time.time()-stat.st_mtime < 90 or str(file.resolve()) in known: continue
                candidates.append((stat.st_mtime,file,stat.st_size))
            except OSError: continue
        if not candidates:
            set_upload_status("idle","No completed segments waiting to upload"); return
        for _,file,size in sorted(candidates):
            if not admin_session_active() or not internet_available(): break
            if size > MEGA_MAX_BYTES:
                set_upload_status("error","This segment is larger than the 6 GB cloud cap",file.name); continue
            camera_folder=file.parent.name
            remote_folder=f"{MEGA_REMOTE_DIR}/{camera_folder}"
            mkdir=mega_command("mega-mkdir","-p",remote_folder)
            if not mkdir or mkdir.returncode:
                set_upload_status("error","Could not create the camera folder in MEGA",file.name); continue
            set_upload_status("uploading",f"Uploading {file.name}",file.name)
            put=mega_command("mega-put", str(file), remote_folder, timeout=6*60*60)
            if not put or put.returncode:
                detail=(put.stderr or put.stdout).strip()[:240] if put else "MEGAcmd command failed or timed out"
                set_upload_status("error",f"Upload failed: {detail}",file.name); continue
            index.append({"local":str(file.resolve()),"remote":f"{remote_folder}/{file.name}","size":size,"uploaded_at":int(time.time())})
            # Apply the requested 6 GiB cap by removing oldest HomeGuard uploads first.
            while sum(max(0,int(entry.get("size",0))) for entry in index) > MEGA_MAX_BYTES and index:
                oldest=index[0]
                deleted=mega_command("mega-rm","-f",oldest["remote"])
                if not deleted or deleted.returncode: break
                index.pop(0)
            save_json(DATA / "mega-upload-index.json",index)
            set_upload_status("uploaded",f"Uploaded {file.name} to MEGA",file.name)
    finally: UPLOAD_LOCK.release()

def upload_worker():
    while True:
        try: upload_completed_recordings()
        except Exception: pass
        time.sleep(60)
        for folder in sorted((p for p in RECORDINGS.rglob("*") if p.is_dir()), reverse=True):
            try: folder.rmdir()
            except OSError: pass

def retention_worker():
    while True:
        time.sleep(3600)
        cleanup_old()

def valid_cameras(items):
    if not isinstance(items, list) or len(items) > 32: raise ValueError("Provide at most 32 cameras.")
    result=[]
    for cam in items:
        name=str(cam.get("name", "Camera"))[:40].strip()
        ip=str(cam.get("ip", "")); port=str(cam.get("port", "8080"))
        parts=ip.split(".")
        if len(parts)!=4 or any(not p.isdigit() or int(p)>255 for p in parts): continue
        if not port.isdigit() or not 1 <= int(port) <= 65535: continue
        ident="".join(c for c in str(cam.get("id", "camera")) if c.isalnum() or c in "-_")[:64]
        if not ident: continue
        result.append({"id":ident,"name":name or ident,"ip":ip,"port":str(int(port)),"streamUrl":f"http://{ip}:{int(port)}/video"})
    return result

def sync_recorders(cameras):
    ffmpeg=shutil.which("ffmpeg")
    if not ffmpeg: return
    with LOCK:
        wanted={c["id"]:c for c in cameras}
        for ident, proc in list(RECORDERS.items()):
            if ident not in wanted or proc.poll() is not None:
                if proc.poll() is None: proc.terminate()
                RECORDERS.pop(ident, None)
        for ident, cam in wanted.items():
            if ident in RECORDERS: continue
            folder=RECORDINGS / ident
            folder.mkdir(parents=True, exist_ok=True)
            out=str(folder / "%Y%m%d-%H%M%S.mkv")
            font = "C\\:/Windows/Fonts/arial.ttf"
            watermark = f"drawtext=fontfile='{font}':text='%{{localtime\\:%Y-%m-%d_%H-%M-%S}}':fontcolor=white:fontsize=18:box=1:boxcolor=black@0.60:boxborderw=7:x=w-tw-12:y=12"
            args=[ffmpeg,"-hide_banner","-loglevel","error","-nostdin","-f","mpjpeg","-i",cam["streamUrl"],"-map","0:v:0","-vf",watermark,"-c:v","libx264","-preset","ultrafast","-crf","28","-pix_fmt","yuv420p","-threads","1","-f","segment","-segment_time",str(SEGMENT_SECONDS),"-reset_timestamps","1","-strftime","1",out]
            try: RECORDERS[ident]=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            except OSError: pass

class Handler(http.server.ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=True

class App(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args): pass
    def _json(self, status, data, cookie=None):
        raw=json.dumps(data).encode(); self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(raw))); self.send_header("Cache-Control","no-store")
        if cookie: self.send_header("Set-Cookie",cookie)
        self.end_headers(); self.wfile.write(raw)
    def _body(self):
        n=int(self.headers.get("Content-Length","0"));
        if n>65536: raise ValueError("Request too large")
        return json.loads(self.rfile.read(n) or b"{}")
    def _session(self):
        jar=SimpleCookie(self.headers.get("Cookie","")); token=jar.get("hg_session")
        expiry=SESSIONS.get(token.value) if token else None
        return bool(expiry and expiry>time.time())
    def _auth_config(self): return load_json(AUTH_FILE,{})
    def do_POST(self):
        path=urlparse(self.path).path
        try: data=self._body()
        except Exception as exc: return self._json(400,{"error":str(exc)})
        cfg=self._auth_config()
        if path=="/api/auth/setup":
            password=str(data.get("password",""))
            if cfg: return self._json(409,{"error":"Admin account is already configured."})
            if len(password)<12: return self._json(400,{"error":"Use at least 12 characters."})
            salt=secrets.token_bytes(16); digest=derive_password(password.encode(),salt)
            save_json(AUTH_FILE,{"salt":salt.hex(),"hash":digest.hex()}); return self._login()
        if path=="/api/auth/login":
            try: ok=hmac.compare_digest(derive_password(str(data.get("password"," ")).encode(),bytes.fromhex(cfg["salt"])).hex(),cfg["hash"])
            except (KeyError,ValueError): ok=False
            if not ok: return self._json(401,{"error":"Incorrect password."})
            cleanup_old(); return self._login()
        if not self._session(): return self._json(401,{"error":"Sign in required."})
        if path=="/api/cameras":
            try: cams=valid_cameras(data.get("cameras")); save_json(CAMERAS_FILE,cams); sync_recorders(cams)
            except ValueError as exc: return self._json(400,{"error":str(exc)})
            return self._json(200,{"saved":len(cams),"ffmpegAvailable":bool(shutil.which("ffmpeg")),"megaAvailable":bool(shutil.which("mega-put"))})
        return self._json(404,{"error":"Not found"})
    def _login(self):
        token=secrets.token_urlsafe(32); SESSIONS[token]=time.time()+12*3600
        return self._json(200,{"ok":True},f"hg_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200")
    def do_GET(self):
        path=unquote(urlparse(self.path).path)
        if path=="/api/auth/status": return self._json(200,{"configured":bool(self._auth_config())})
        if path=="/api/auth/session": return self._json(200,{"authenticated":self._session()})
        if path=="/api/recordings/status":
            if not self._session(): return self._json(401,{"error":"Sign in required."})
            mega=mega_command("mega-whoami") if shutil.which("mega-whoami") else None
            index=load_json(DATA / "mega-upload-index.json",[])
            completed=sum(1 for f in RECORDINGS.rglob("*.mkv") if time.time()-f.stat().st_mtime>=90 and str(f.resolve()) not in {x.get("local") for x in index if isinstance(x,dict)}) if RECORDINGS.exists() else 0
            return self._json(200,{"ffmpegAvailable":bool(shutil.which("ffmpeg")),"megaAvailable":bool(shutil.which("mega-put")),"megaLoggedIn":bool(mega and mega.returncode==0),"adminActive":admin_session_active(),"recordingPath":str(RECORDINGS),"retentionDays":2,"segmentMinutes":SEGMENT_MINUTES,"cloudCapBytes":MEGA_MAX_BYTES,"cameras":len(RECORDERS),"upload":UPLOAD_STATUS,"completedWaiting":completed,"lastUploaded":index[-1] if index else None})
        if path=="/api/logout":
            jar=SimpleCookie(self.headers.get("Cookie","")); token=jar.get("hg_session")
            if token: SESSIONS.pop(token.value,None)
            self.send_response(303); self.send_header("Location","/login.html"); self.send_header("Set-Cookie","hg_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); self.end_headers(); return
        if path=="/" and not self._session(): self.send_response(302); self.send_header("Location","/login.html"); self.end_headers(); return
        if path not in ("/login.html","/api/auth/status","/css/style.css") and not self._session(): return self._json(401,{"error":"Sign in required."})
        if path=="/login.html" and self._auth_config() and self._session(): self.send_response(302); self.send_header("Location","/"); self.end_headers(); return
        return super().do_GET()

if __name__=="__main__":
    DATA.mkdir(exist_ok=True); RECORDINGS.mkdir(exist_ok=True); cleanup_old()
    threading.Thread(target=retention_worker,daemon=True).start()
    threading.Thread(target=upload_worker,daemon=True).start()
    cameras=load_json(CAMERAS_FILE,[])
    if cameras: sync_recorders(cameras)
    print(f"HomeGuard local service: http://127.0.0.1:{PORT}")
    print(f"Recording folder: {RECORDINGS}")
    if not shutil.which("ffmpeg"): print("FFmpeg not found: live recording is disabled until FFmpeg is installed and on PATH.")
    if not shutil.which("mega-put"): print("MEGAcmd not found: cloud uploads are disabled until MEGAcmd is installed and logged in.")
    try: Handler((HOST,PORT),App).serve_forever()
    except KeyboardInterrupt: pass
    finally:
        for proc in RECORDERS.values():
            if proc.poll() is None: proc.terminate()
