"""BerryGoodTunes server: serves the web app and downloads audio on request.

Run:  uvicorn app:app --host 127.0.0.1 --port 8765
Then expose it privately with:  tailscale serve --bg 8765
"""

import os
import re
from pathlib import Path

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from downloader import Downloader, default_ffmpeg, js_runtime
from library import Library

HERE = Path(__file__).resolve().parent
LIBRARY_DIR = Path(os.environ.get("BERRY_LIBRARY", HERE / "library"))
COOKIES = Path(os.environ.get("BERRY_COOKIES", HERE / "cookies.txt"))
WEB_DIR = HERE.parent / "web"

library = Library(LIBRARY_DIR)
downloader = Downloader(library, cookies=COOKIES, ffmpeg=default_ffmpeg())

app = FastAPI(title="BerryGoodTunes")


class JobRequest(BaseModel):
    url: str


class RetryRequest(BaseModel):
    ids: list[str]


class PlaylistRequest(BaseModel):
    name: str


class PlaylistTrackRequest(BaseModel):
    track_id: str


def public(track: dict) -> dict:
    return {
        k: track.get(k)
        for k in ("id", "title", "artist", "duration", "source_url", "size", "added_at")
    } | {"has_cover": bool(track.get("cover_file"))}


@app.get("/api/health")
def health():
    return {"ok": True, "yt_dlp": yt_dlp.version.__version__, "cookies": COOKIES.exists(), "js_runtime": js_runtime()}


@app.get("/api/tracks")
def list_tracks():
    return [public(t) for t in library.list()]


@app.get("/api/tracks/{track_id}/audio")
def track_audio(track_id: str):
    track = library.get(track_id) or _404()
    return FileResponse(library.audio_path(track), media_type="audio/mp4")


@app.get("/api/tracks/{track_id}/cover")
def track_cover(track_id: str):
    track = library.get(track_id) or _404()
    cover = library.cover_path(track)
    if not cover or not cover.exists():
        _404()
    return FileResponse(cover, media_type="image/jpeg")


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str):
    # Idempotent so offline deletes can be replayed safely.
    library.delete(track_id)
    return {"ok": True}


@app.get("/api/jobs")
def list_jobs():
    return downloader.list_jobs()


@app.post("/api/jobs", status_code=201)
def create_job(req: JobRequest):
    # Share sheets sometimes send "Check this out https://..." rather than a bare link.
    match = re.search(r"https?://\S+", req.url)
    if not match:
        raise HTTPException(400, "That doesn't look like a link.")
    return downloader.submit(match.group(0))


@app.post("/api/jobs/retry")
def retry_jobs(req: RetryRequest):
    return {"retried": downloader.retry(req.ids)}


@app.delete("/api/jobs/queued")
def cancel_queued():
    return {"cancelled": downloader.cancel_queued()}


@app.get("/api/playlists")
def list_playlists():
    return library.list_playlists()


def _playlist_name(name: str) -> str:
    name = name.strip()[:80]
    if not name:
        raise HTTPException(400, "Give the playlist a name.")
    return name


@app.post("/api/playlists", status_code=201)
def create_playlist(req: PlaylistRequest):
    return library.create_playlist(_playlist_name(req.name))


@app.patch("/api/playlists/{playlist_id}")
def rename_playlist(playlist_id: str, req: PlaylistRequest):
    return library.rename_playlist(playlist_id, _playlist_name(req.name)) or _404()


@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str):
    library.delete_playlist(playlist_id)
    return {"ok": True}


@app.post("/api/playlists/{playlist_id}/tracks")
def add_to_playlist(playlist_id: str, req: PlaylistTrackRequest):
    return library.add_to_playlist(playlist_id, req.track_id) or _404()


@app.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def remove_from_playlist(playlist_id: str, track_id: str):
    return library.remove_from_playlist(playlist_id, track_id) or _404()


def _404():
    raise HTTPException(404, "Not found")


# The service worker must never be served stale, or app updates never land.
@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(WEB_DIR / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
