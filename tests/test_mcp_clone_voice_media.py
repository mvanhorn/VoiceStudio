"""clone_voice sends video through from-media and keeps the base-path boundary."""
from __future__ import annotations

import asyncio
import json

import pytest

mcp_pkg = pytest.importorskip("mcp")


def _tool_json(result):
    return json.loads(result[0][0].text)


def _wav_bytes() -> bytes:
    # Minimal RIFF header so the profile post sniffs as WAV.
    return b"RIFF" + b"\x24\x00\x00\x00" + b"WAVEfmt " + b"\x00" * 28


def _install_backend(monkeypatch, handler):
    import httpx

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**{**kwargs, "transport": httpx.MockTransport(handler)}),
    )


def test_is_video_media_treats_mp4_not_m4a():
    from mcp_server import _is_video_media

    assert _is_video_media("talk.mp4", b"xxxxftypisom")
    assert not _is_video_media("clip.m4a", b"\x00\x00\x00 ftypM4A ")
    assert not _is_video_media("voice.wav", b"RIFFxxxxWAVE")


def test_clone_voice_video_one_speaker_creates_profile(monkeypatch, tmp_path):
    import httpx
    import mcp_server

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    clip = allowed / "talk.mp4"
    clip.write_bytes(b"xxxxftypisom" + b"\x00" * 32)
    media_id = "aa" * 16
    seen = []

    def backend(request):
        seen.append((request.method, request.url.path))
        if request.url.path == "/profiles/from-media":
            return httpx.Response(200, json={
                "media_id": media_id,
                "isolation": "skipped",
                "speakers": [{
                    "id": "mix",
                    "duration": 6.0,
                    "ref_text": "hello",
                    "audio_url": f"/profiles/from-media/{media_id}/audio/mix",
                }],
            })
        if request.url.path == f"/profiles/from-media/{media_id}/audio/mix":
            return httpx.Response(200, content=_wav_bytes(), headers={"content-type": "audio/wav"})
        if request.url.path == f"/profiles/from-media/{media_id}/choose":
            return httpx.Response(200, json={"speaker_id": "mix", "duration": 6.0, "ref_text": "hello"})
        if request.url.path == "/profiles":
            return httpx.Response(200, json={"id": "p1", "name": "Ada", "kind": "clone"})
        return httpx.Response(404, json={"detail": request.url.path})

    _install_backend(monkeypatch, backend)
    monkeypatch.setenv("OMNIVOICE_MCP_BASE_PATH", str(allowed))
    server = mcp_server.create_mcp_server()
    payload = _tool_json(asyncio.run(server.call_tool("clone_voice", {
        "name": "Ada",
        "ref_audio_path": str(clip),
    })))
    assert payload == {"profile_id": "p1", "name": "Ada", "kind": "clone"}
    assert ("POST", "/profiles/from-media") in seen
    assert ("POST", "/profiles") in seen


def test_clone_voice_video_two_speakers_returns_ids_without_a_profile(monkeypatch, tmp_path):
    import httpx
    import mcp_server

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    clip = allowed / "talk.mp4"
    clip.write_bytes(b"xxxxftypisom" + b"\x00" * 32)
    seen = []

    def backend(request):
        seen.append((request.method, request.url.path))
        if request.url.path == "/profiles/from-media":
            return httpx.Response(200, json={
                "media_id": "bb" * 16,
                "isolation": "skipped",
                "speakers": [
                    {"id": "speaker_1", "duration": 6.0, "ref_text": "a", "audio_url": "/x/1"},
                    {"id": "speaker_2", "duration": 6.0, "ref_text": "b", "audio_url": "/x/2"},
                ],
            })
        return httpx.Response(500, json={"detail": "should not create a profile"})

    _install_backend(monkeypatch, backend)
    monkeypatch.setenv("OMNIVOICE_MCP_BASE_PATH", str(allowed))
    server = mcp_server.create_mcp_server()
    payload = _tool_json(asyncio.run(server.call_tool("clone_voice", {
        "name": "Ada",
        "ref_audio_path": str(clip),
    })))
    assert "error" in payload
    assert [s["id"] for s in payload["speakers"]] == ["speaker_1", "speaker_2"]
    assert ("POST", "/profiles") not in seen
    assert all(path != "/profiles" for _method, path in seen)


def test_clone_voice_refuses_a_path_outside_the_base(monkeypatch, tmp_path):
    import httpx
    import mcp_server

    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "secret.mp4"
    outside.write_bytes(b"xxxxftypisom")
    seen = []

    def backend(request):
        seen.append(request.url.path)
        return httpx.Response(500, json={"detail": "unreachable"})

    _install_backend(monkeypatch, backend)
    monkeypatch.setenv("OMNIVOICE_MCP_BASE_PATH", str(allowed))
    server = mcp_server.create_mcp_server()
    payload = _tool_json(asyncio.run(server.call_tool("clone_voice", {
        "name": "Ada",
        "ref_audio_path": str(outside),
    })))
    assert "error" in payload
    assert "OMNIVOICE_MCP_BASE_PATH" in payload["error"]
    assert seen == []
