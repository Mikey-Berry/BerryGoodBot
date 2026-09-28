"""On-disk music library: audio + cover files, a tracks.json index and playlists.json."""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path


class Library:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = root / "tracks.json"
        self.playlists_path = root / "playlists.json"
        self._lock = threading.RLock()
        self._tracks: dict[str, dict] = {}
        self._playlists: dict[str, dict] = {}
        if self.index_path.exists():
            for t in json.loads(self.index_path.read_text(encoding="utf-8")):
                self._tracks[t["id"]] = t
        if self.playlists_path.exists():
            for pl in json.loads(self.playlists_path.read_text(encoding="utf-8")):
                self._playlists[pl["id"]] = pl

    @staticmethod
    def _write(path: Path, data):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        tmp.replace(path)

    def _save(self):
        self._write(self.index_path, list(self._tracks.values()))

    def _save_playlists(self):
        self._write(self.playlists_path, list(self._playlists.values()))

    def list(self) -> list[dict]:
        with self._lock:
            return sorted(self._tracks.values(), key=lambda t: t["added_at"], reverse=True)

    def get(self, track_id: str) -> dict | None:
        with self._lock:
            return self._tracks.get(track_id)

    def find_by_source(self, source_id: str) -> dict | None:
        with self._lock:
            return next((t for t in self._tracks.values() if t.get("source_id") == source_id), None)

    def audio_path(self, track: dict) -> Path:
        return self.root / track["audio_file"]

    def cover_path(self, track: dict) -> Path | None:
        return self.root / track["cover_file"] if track.get("cover_file") else None

    def add(self, track_id: str, audio: Path, cover: Path | None, meta: dict) -> dict:
        audio_name = f"{track_id}{audio.suffix}"
        shutil.move(str(audio), self.root / audio_name)
        cover_name = None
        if cover and cover.exists():
            cover_name = f"{track_id}{cover.suffix}"
            shutil.move(str(cover), self.root / cover_name)
        track = {
            "id": track_id,
            **meta,
            "audio_file": audio_name,
            "cover_file": cover_name,
            "size": (self.root / audio_name).stat().st_size,
            "added_at": time.time(),
        }
        with self._lock:
            self._tracks[track_id] = track
            self._save()
        return track

    def delete(self, track_id: str) -> bool:
        with self._lock:
            track = self._tracks.pop(track_id, None)
            if not track:
                return False
            self._save()
            for pl in self._playlists.values():
                if track_id in pl["track_ids"]:
                    pl["track_ids"].remove(track_id)
                    pl["positions"].pop(track_id, None)
            self._save_playlists()
        for name in (track["audio_file"], track.get("cover_file")):
            if name:
                (self.root / name).unlink(missing_ok=True)
        return True

    # ---- playlists --------------------------------------------------------

    @staticmethod
    def _public_playlist(pl: dict) -> dict:
        return {k: pl[k] for k in ("id", "name", "track_ids", "created_at")}

    def list_playlists(self) -> list[dict]:
        with self._lock:
            ordered = sorted(self._playlists.values(), key=lambda pl: pl["created_at"])
            return [self._public_playlist(pl) for pl in ordered]

    def create_playlist(self, name: str) -> dict:
        with self._lock:
            pl = {"id": uuid.uuid4().hex[:12], "name": name, "track_ids": [], "positions": {}, "created_at": time.time()}
            self._playlists[pl["id"]] = pl
            self._save_playlists()
            return self._public_playlist(pl)

    def find_playlist(self, name: str) -> dict | None:
        with self._lock:
            pl = next((pl for pl in self._playlists.values() if pl["name"].casefold() == name.casefold()), None)
            return self._public_playlist(pl) if pl else None

    def rename_playlist(self, playlist_id: str, name: str) -> dict | None:
        with self._lock:
            pl = self._playlists.get(playlist_id)
            if not pl:
                return None
            pl["name"] = name
            self._save_playlists()
            return self._public_playlist(pl)

    def delete_playlist(self, playlist_id: str) -> bool:
        """Removes the playlist only; its songs stay in the library."""
        with self._lock:
            if not self._playlists.pop(playlist_id, None):
                return False
            self._save_playlists()
            return True

    def add_to_playlist(self, playlist_id: str, track_id: str, position: int | None = None) -> dict | None:
        """Add a song. With a position (its place in an imported YouTube playlist) it's slotted in
        order even when downloads finish out of order; without one it goes at the end."""
        with self._lock:
            pl = self._playlists.get(playlist_id)
            if not pl or track_id not in self._tracks:
                return None
            if track_id not in pl["track_ids"]:
                ids = pl["track_ids"]
                if position is None:
                    ids.append(track_id)
                else:
                    pl["positions"][track_id] = position
                    at = next((i for i, t in enumerate(ids) if pl["positions"].get(t, float("inf")) > position), len(ids))
                    ids.insert(at, track_id)
                self._save_playlists()
            return self._public_playlist(pl)

    def remove_from_playlist(self, playlist_id: str, track_id: str) -> dict | None:
        with self._lock:
            pl = self._playlists.get(playlist_id)
            if not pl:
                return None
            if track_id in pl["track_ids"]:
                pl["track_ids"].remove(track_id)
                pl["positions"].pop(track_id, None)
                self._save_playlists()
            return self._public_playlist(pl)
