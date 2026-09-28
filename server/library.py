"""On-disk music library: audio + cover files plus a tracks.json index."""

import json
import shutil
import threading
import time
from pathlib import Path


class Library:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = root / "tracks.json"
        self._lock = threading.Lock()
        self._tracks: dict[str, dict] = {}
        if self.index_path.exists():
            for t in json.loads(self.index_path.read_text(encoding="utf-8")):
                self._tracks[t["id"]] = t

    def _save(self):
        tmp = self.index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(self._tracks.values()), indent=1), encoding="utf-8")
        tmp.replace(self.index_path)

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
        for name in (track["audio_file"], track.get("cover_file")):
            if name:
                (self.root / name).unlink(missing_ok=True)
        return True
