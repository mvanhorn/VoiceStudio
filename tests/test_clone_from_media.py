"""Clone a voice from a local video or audio file."""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.failure import NO_AUDIO_TRACK_MESSAGE
from services.clone_from_media import (
    ISOLATION_SKIPPED,
    MIX_SPEAKER_ID,
    WARNING_DIARISATION,
    isolate_vocals,
    process_media,
)
from services.ffmpeg_utils import extract_audio_wav
from services.speaker_clone import MIN_REF_DURATION_S

FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg is not installed")


def _make_video(path: Path, *, audio: bool) -> Path:
    cmd = [
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1",
    ]
    if audio:
        cmd += ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest"]
    cmd += ["-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    return path


def wav_bytes(frames: int = 4000, rate: int = 16000) -> bytes:
    data = io.BytesIO()
    with wave.open(data, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x01\x00" * frames)
    return data.getvalue()


def _tone_wav(path: Path, seconds: float, freq: float, rate: int = 16000) -> Path:
    t = np.arange(int(seconds * rate), dtype=np.float32) / float(rate)
    sf.write(str(path), (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32), rate)
    return path


def _rms(path: str) -> float:
    data, _sr = sf.read(path, dtype="float32")
    if data.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(data))))


@pytest.fixture
def video_only(tmp_path) -> Path:
    return _make_video(tmp_path / "silent.mp4", audio=False)


@pytest.fixture
def video_with_audio(tmp_path) -> Path:
    return _make_video(tmp_path / "speech.mp4", audio=True)


@pytest.fixture
def isolated_profiles(tmp_path, monkeypatch):
    from api.routers import profiles

    monkeypatch.setattr(profiles, "DATA_DIR", str(tmp_path))
    profiles._media_sessions.clear()
    app = FastAPI()
    app.include_router(profiles.router)
    client = TestClient(app, client=("127.0.0.1", 50001))
    yield client, profiles
    profiles._media_sessions.clear()


def _skip_optional_stages(monkeypatch):
    import services.clone_from_media as cfm

    monkeypatch.setattr(
        cfm, "isolate_vocals",
        lambda wav, out: (wav, ISOLATION_SKIPPED),
    )
    monkeypatch.setattr(
        cfm, "transcribe_and_diarise",
        lambda path: ([], None, WARNING_DIARISATION),
    )


@needs_ffmpeg
def test_video_with_audio_extracts_a_non_silent_wav(video_with_audio, tmp_path, monkeypatch):
    _skip_optional_stages(monkeypatch)
    dest = tmp_path / "direct.wav"
    extract_audio_wav(str(video_with_audio), str(dest))
    assert dest.stat().st_size > 1000
    assert _rms(str(dest)) > 0.01

    out = tmp_path / "from-media"
    result = process_media(str(video_with_audio), str(out))
    assert result["isolation"] == ISOLATION_SKIPPED
    assert result["speakers"][0]["id"] == MIX_SPEAKER_ID
    mix = result["speakers"][0]["path"]
    assert Path(mix).is_file()
    assert _rms(mix) > 0.01
    assert "234" not in str(result)
    assert "Invalid argument" not in str(result)


@needs_ffmpeg
def test_video_only_mp4_raises_no_audio_track(video_only, tmp_path, monkeypatch):
    _skip_optional_stages(monkeypatch)
    dest = tmp_path / "none.wav"
    with pytest.raises(ValueError, match="has no audio track"):
        extract_audio_wav(str(video_only), str(dest))
    with pytest.raises(ValueError, match="has no audio track") as exc:
        process_media(str(video_only), str(tmp_path / "out"))
    assert NO_AUDIO_TRACK_MESSAGE in str(exc.value)
    assert "234" not in str(exc.value)
    assert "Invalid argument" not in str(exc.value)


@needs_ffmpeg
def test_two_speakers_then_choose_keeps_that_slice(tmp_path, monkeypatch):
    import services.clone_from_media as cfm

    rate = 16000
    seconds = 14.0
    t = np.arange(int(seconds * rate), dtype=np.float32) / float(rate)
    audio = np.zeros_like(t)
    audio[: 6 * rate] = 0.35 * np.sin(2 * np.pi * 440 * t[: 6 * rate])
    audio[7 * rate : 13 * rate] = 0.35 * np.sin(2 * np.pi * 880 * t[7 * rate : 13 * rate])
    src = tmp_path / "dialogue.wav"
    sf.write(str(src), audio, rate)

    monkeypatch.setattr(
        cfm, "isolate_vocals",
        lambda wav, out: (wav, ISOLATION_SKIPPED),
    )
    segments = [
        {"start": 0.0, "end": 6.0, "speaker_id": "Speaker 1", "text": "hello there friends today"},
        {"start": 7.0, "end": 13.0, "speaker_id": "Speaker 2", "text": "and goodbye everyone now"},
    ]
    monkeypatch.setattr(
        cfm, "transcribe_and_diarise",
        lambda path: (segments, "pyannote", None),
    )
    result = process_media(str(src), str(tmp_path / "out"))
    by_id = {item["id"]: item for item in result["speakers"]}
    assert set(by_id) == {"speaker_1", "speaker_2"}
    first = by_id["speaker_1"]
    second = by_id["speaker_2"]
    assert first["duration"] >= MIN_REF_DURATION_S
    assert second["duration"] >= MIN_REF_DURATION_S
    assert _rms(first["path"]) > 0.02
    assert _rms(second["path"]) > 0.02
    left, sr = sf.read(first["path"], dtype="float32")
    right, _ = sf.read(second["path"], dtype="float32")
    assert abs(len(left) / sr - 6.0) < 0.3
    assert abs(len(right) / sr - 6.0) < 0.3
    # Each clone is one speaker's slice, not the full mix.
    assert abs(len(left) / sr - seconds) > 4


def test_diarisation_unavailable_uses_mix_and_sets_warning(tmp_path, monkeypatch):
    import services.clone_from_media as cfm

    src = _tone_wav(tmp_path / "mix.wav", 6.0, 440)
    monkeypatch.setattr(
        cfm, "isolate_vocals",
        lambda wav, out: (wav, ISOLATION_SKIPPED),
    )
    monkeypatch.setattr(
        cfm, "transcribe_and_diarise",
        lambda path: ([], None, WARNING_DIARISATION),
    )
    monkeypatch.setattr(cfm, "extract_audio_wav", lambda src_path, dest, **_k: (
        Path(dest).write_bytes(Path(src_path).read_bytes()) or dest
    ))
    result = process_media(str(src), str(tmp_path / "out"))
    assert result["warning"] == WARNING_DIARISATION
    assert result["isolation"] == ISOLATION_SKIPPED
    assert len(result["speakers"]) == 1
    assert result["speakers"][0]["id"] == MIX_SPEAKER_ID
    assert Path(result["speakers"][0]["path"]).is_file()


def test_isolation_unavailable_skips_and_still_extracts(tmp_path, monkeypatch):
    import importlib.util

    import services.clone_from_media as cfm

    orig = importlib.util.find_spec

    def no_demucs(name, package=None):
        if name == "demucs":
            return None
        return orig(name, package)

    monkeypatch.setattr(importlib.util, "find_spec", no_demucs)
    src = _tone_wav(tmp_path / "mix.wav", 2.0, 330)
    path, status = isolate_vocals(str(src), str(tmp_path / "stems"))
    assert status == ISOLATION_SKIPPED
    assert path == str(src)

    monkeypatch.setattr(
        cfm, "transcribe_and_diarise",
        lambda p: ([], None, WARNING_DIARISATION),
    )
    monkeypatch.setattr(cfm, "extract_audio_wav", lambda src_path, dest, **_k: (
        Path(dest).write_bytes(Path(src_path).read_bytes()) or dest
    ))
    result = process_media(str(src), str(tmp_path / "out"))
    assert result["isolation"] == ISOLATION_SKIPPED
    assert result["speakers"][0]["id"] == MIX_SPEAKER_ID


def test_url_without_native_access_is_403(tmp_path, monkeypatch):
    from api.routers import profiles

    monkeypatch.setattr(profiles, "DATA_DIR", str(tmp_path))
    profiles._media_sessions.clear()
    app = FastAPI()
    app.include_router(profiles.router)
    remote = TestClient(app, client=("203.0.113.9", 50000))
    response = remote.post(
        "/profiles/from-media",
        files={"url": (None, "https://example.invalid/talk.mp4")},
    )
    assert response.status_code == 403
    assert profiles._media_sessions == {}


def test_post_profiles_still_rejects_mp4(tmp_path, monkeypatch):
    from api.routers import profiles
    from core import db

    voices = tmp_path / "voices"
    voices.mkdir()
    monkeypatch.setattr(profiles, "VOICES_DIR", str(voices))
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "profiles.db"))
    db.init_db()
    app = FastAPI()
    app.include_router(profiles.router)
    client = TestClient(app, client=("127.0.0.1", 50001))
    response = client.post(
        "/profiles",
        data={"name": "Clip", "kind": "clone"},
        files={"ref_audio": ("talk.mp4", b"not-a-real-mp4" * 80, "video/mp4")},
    )
    assert response.status_code == 415
    assert list(voices.iterdir()) == []


def test_from_media_two_speakers_choose_returns_that_wav(isolated_profiles, tmp_path, monkeypatch):
    client, profiles = isolated_profiles
    out_holder = {}

    def fake_process(src, out_dir):
        one = os.path.join(out_dir, "voice_speaker_1.wav")
        two = os.path.join(out_dir, "voice_speaker_2.wav")
        _tone_wav(Path(one), 6.0, 440)
        _tone_wav(Path(two), 6.0, 880)
        out_holder["dir"] = out_dir
        return {
            "isolation": ISOLATION_SKIPPED,
            "speakers": [
                {"id": "speaker_1", "path": one, "duration": 6.0, "ref_text": "hello"},
                {"id": "speaker_2", "path": two, "duration": 6.0, "ref_text": "bye"},
            ],
        }

    monkeypatch.setattr("services.clone_from_media.process_media", fake_process)
    posted = client.post(
        "/profiles/from-media",
        files={"file": ("talk.mp4", b"fake-mp4-bytes" * 20, "video/mp4")},
    )
    assert posted.status_code == 200, posted.text
    body = posted.json()
    assert body["isolation"] == ISOLATION_SKIPPED
    assert [s["id"] for s in body["speakers"]] == ["speaker_1", "speaker_2"]
    media_id = body["media_id"]
    chosen = client.get(f"/profiles/from-media/{media_id}/audio/speaker_2")
    assert chosen.status_code == 200
    assert chosen.headers["content-type"].startswith("audio/wav")
    saved = tmp_path / "picked.wav"
    saved.write_bytes(chosen.content)
    assert _rms(str(saved)) > 0.02
    pick = client.post(
        f"/profiles/from-media/{media_id}/choose",
        json={"speaker_id": "speaker_2"},
    )
    assert pick.status_code == 200
    assert pick.json()["speaker_id"] == "speaker_2"
    assert client.get(f"/profiles/from-media/{media_id}/audio/speaker_2").status_code == 404
    assert not Path(out_holder["dir"]).exists()
