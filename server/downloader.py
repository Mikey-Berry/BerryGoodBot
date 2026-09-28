"""Background download queue: one job at a time through yt-dlp + ffmpeg."""

import os
import queue
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

from yt_dlp import YoutubeDL

from library import Library

MAX_JOBS_KEPT = 30


class DownloadError(Exception):
    pass


class Downloader:
    def __init__(self, library: Library, cookies: Path | None = None, ffmpeg: str | None = None):
        self.library = library
        self.cookies = cookies
        self.ffmpeg = ffmpeg
        self.jobs: dict[str, dict] = {}
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        threading.Thread(target=self._worker, daemon=True).start()

    # ---- public API -------------------------------------------------------

    def submit(self, url: str) -> dict:
        job = {
            "id": uuid.uuid4().hex[:12],
            "url": url,
            "status": "queued",  # queued | downloading | processing | done | error
            "progress": 0.0,
            "title": None,
            "track_id": None,
            "error": None,
            "duplicate": False,
            "created_at": time.time(),
            "finished_at": None,
        }
        with self._lock:
            self.jobs[job["id"]] = job
            self._trim()
        self._queue.put(job["id"])
        return job

    def list_jobs(self) -> list[dict]:
        with self._lock:
            return sorted((dict(j) for j in self.jobs.values()), key=lambda j: j["created_at"], reverse=True)

    # ---- internals --------------------------------------------------------

    def _trim(self):
        finished = [j for j in self.jobs.values() if j["status"] in ("done", "error")]
        finished.sort(key=lambda j: j["created_at"])
        while len(self.jobs) > MAX_JOBS_KEPT and finished:
            del self.jobs[finished.pop(0)["id"]]

    def _update(self, job_id: str, **fields):
        with self._lock:
            self.jobs[job_id].update(fields)

    def _worker(self):
        while True:
            job_id = self._queue.get()
            try:
                track, duplicate = self._run(job_id)
                self._update(job_id, status="done", progress=1.0, track_id=track["id"], title=track["title"],
                             duplicate=duplicate, finished_at=time.time())
            except Exception as e:  # yt-dlp raises many types; surface them all to the UI
                msg = str(e).removeprefix("ERROR: ").strip() or type(e).__name__
                self._update(job_id, status="error", error=msg, finished_at=time.time())

    def _run(self, job_id: str) -> tuple[dict, bool]:
        url = self.jobs[job_id]["url"]
        track_id = uuid.uuid4().hex[:12]
        tmp = Path(tempfile.mkdtemp(prefix="berry-"))

        def on_progress(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total:
                    self._update(job_id, status="downloading", progress=min(d["downloaded_bytes"] / total, 1.0))
            elif d["status"] == "finished":
                self._update(job_id, status="processing", progress=1.0)

        opts = {
            # Prefer the native AAC stream so nothing gets re-encoded; iOS plays it natively.
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(tmp / f"{track_id}.%(ext)s"),
            "noplaylist": True,
            "writethumbnail": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "progress_hooks": [on_progress],
            "postprocessors": [
                # Remuxes (no quality loss) when the source is already AAC.
                {"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "192"},
                {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
            ],
        }
        if self.cookies and self.cookies.exists():
            opts["cookiefile"] = str(self.cookies)
        if self.ffmpeg:
            opts["ffmpeg_location"] = self.ffmpeg

        try:
            with YoutubeDL(opts) as ydl:
                raw = ydl.extract_info(url, download=False, process=False)
                if raw.get("_type") == "playlist":
                    raise DownloadError("That link is a playlist. Paste a link to a single video.")
                if raw.get("id") and raw.get("extractor_key"):
                    existing = self.library.find_by_source(f"{raw['extractor_key']}:{raw['id']}")
                    if existing:
                        return existing, True
                self._update(job_id, title=raw.get("title"), status="downloading")
                info = ydl.process_ie_result(raw, download=True)

            audio = Path(info["requested_downloads"][0]["filepath"])
            covers = list(tmp.glob(f"{track_id}*.jpg"))
            meta = {
                "title": info.get("track") or info.get("title") or "Untitled",
                "artist": info.get("artist") or info.get("uploader") or info.get("channel") or "",
                "duration": info.get("duration"),
                "source_url": info.get("webpage_url") or url,
                "source_id": f"{info.get('extractor_key')}:{info.get('id')}",
            }
            return self.library.add(track_id, audio, covers[0] if covers else None, meta), False
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def default_ffmpeg() -> str | None:
    """Allow pointing at ffmpeg explicitly (e.g. when it isn't on PATH)."""
    return os.environ.get("BERRY_FFMPEG") or None
