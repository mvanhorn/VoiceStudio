"""Turn a local audio or video file into one or more clone-reference WAVs.

Voice Clone uses this instead of asking the user to extract a clip first.
Work stays on disk in a caller-supplied directory. Isolation and speaker
splitting run only when those runtimes are already installed — missing
weights never download, and the mix is used as a single speaker.
"""
from __future__ import annotations

import importlib.util
import logging
import os
import shutil
import subprocess
import sys

from core.logging_utils import log_safe
from core.path_security import resolve_within, safe_filename
from services.ffmpeg_utils import extract_audio_wav
from services.speaker_clone import MIN_REF_DURATION_S, extract_speaker_clones, _safe_name

logger = logging.getLogger("omnivoice.clone_from_media")

ISOLATION_APPLIED = "applied"
ISOLATION_SKIPPED = "skipped"
WARNING_DIARISATION = "diarisation_skipped"
MIX_SPEAKER_ID = "mix"


def _confined(out_dir: str, name: str) -> str:
    return str(resolve_within(out_dir, safe_filename(name)))


def _wav_duration(path: str) -> float:
    import soundfile as sf

    info = sf.info(path)
    if info.samplerate <= 0:
        return 0.0
    return float(info.frames) / float(info.samplerate)


def _copy_wav(src: str, dest: str) -> str:
    if os.path.realpath(src) != os.path.realpath(dest):
        shutil.copy2(src, dest)
    return dest


def diarisation_is_installed() -> bool:
    """True when the selected local diarisation runtime is already on disk."""
    try:
        from api.routers.engines import diarisation_status

        return bool(diarisation_status().get("installed"))
    except Exception as exc:  # noqa: BLE001 — missing runtime is a fallback
        logger.info("clone-from-media: diarisation status unavailable: %s", log_safe(exc))
        return False


def isolate_vocals(wav_path: str, out_dir: str) -> tuple[str, str]:
    """Return ``(path, isolation)``. Isolation runs only when Demucs imports."""
    if importlib.util.find_spec("demucs") is None:
        return wav_path, ISOLATION_SKIPPED
    try:
        from services.model_manager import get_best_device

        cmd = [
            sys.executable, "-m", "demucs.separate",
            "--two-stems", "vocals", "-n", "htdemucs",
            "-d", get_best_device(), wav_path, "-o", out_dir,
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=900, check=False)
        if proc.returncode != 0:
            logger.info(
                "clone-from-media: vocal isolation skipped (%s)",
                log_safe((proc.stderr or b"")[-300:]),
            )
            return wav_path, ISOLATION_SKIPPED
        stem = os.path.splitext(os.path.basename(wav_path))[0]
        vocals = os.path.join(out_dir, "htdemucs", stem, "vocals.wav")
        if os.path.isfile(vocals) and os.path.getsize(vocals) > 64:
            return vocals, ISOLATION_APPLIED
    except Exception as exc:  # noqa: BLE001 — isolation is optional
        logger.info("clone-from-media: vocal isolation skipped: %s", log_safe(exc))
    return wav_path, ISOLATION_SKIPPED


def _turns_from_annotation(diarization) -> list[dict]:
    segments: list[dict] = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        start = float(getattr(turn, "start", 0.0) or 0.0)
        end = float(getattr(turn, "end", 0.0) or 0.0)
        if end <= start:
            continue
        label = str(speaker)
        try:
            idx = int(label.split("_")[-1]) + 1
            speaker_id = f"Speaker {idx}"
        except ValueError:
            speaker_id = label
        segments.append({
            "start": start, "end": end, "speaker_id": speaker_id, "text": "",
        })
    return segments


def transcribe_and_diarise(audio_path: str) -> tuple[list[dict], str | None, str | None]:
    """ASR + installed diarisation, with no Hub download.

    Returns ``(segments, labels_source, warning)``. ``labels_source`` is
    ``None`` when speaker splitting cannot run; the caller then uses the mix.
    """
    segments: list[dict] = []
    try:
        import soundfile as sf

        from services.asr_backend import load_active_asr_backend
        from services.segmentation import segment_transcript

        backend = load_active_asr_backend()
        result = backend.transcribe(audio_path, word_timestamps=True)
        duration = float(sf.info(audio_path).frames) / float(sf.info(audio_path).samplerate)
        segments = segment_transcript(result, duration=duration) or []
    except Exception as exc:  # noqa: BLE001 — transcript is optional for splitting
        logger.info("clone-from-media: transcription skipped: %s", log_safe(exc))

    if not diarisation_is_installed():
        return segments, None, WARNING_DIARISATION

    try:
        from services.model_manager import get_diarization_pipeline

        pipeline, _err = get_diarization_pipeline(return_error=True)
        if pipeline is None:
            return segments, None, WARNING_DIARISATION
        diar = pipeline(audio_path)
        if segments:
            from services.segmentation import assign_speakers_from_diarization

            assigned = assign_speakers_from_diarization(segments, diar)
            return assigned, "pyannote", None
        turns = _turns_from_annotation(diar)
        if not turns:
            return segments, None, WARNING_DIARISATION
        return turns, "pyannote", None
    except Exception as exc:  # noqa: BLE001 — missing weights become one speaker
        logger.info("clone-from-media: diarisation skipped: %s", log_safe(exc))
        return segments, None, WARNING_DIARISATION


def _speaker_payload(speaker_id: str, path: str, ref_text: str, duration: float) -> dict:
    return {
        "id": _safe_name(speaker_id),
        "path": path,
        "duration": float(duration),
        "ref_text": (ref_text or "").strip(),
    }


def process_media(src_path: str, out_dir: str) -> dict:
    """Extract audio, optionally isolate and split speakers.

    ``out_dir`` must already exist and be the confined scratch directory.
    Returns ``{isolation, speakers:[{id, path, duration, ref_text}], warning?}``.
    Does not watermark the extracted reference.
    """
    os.makedirs(out_dir, exist_ok=True)
    mix_path = _confined(out_dir, "audio.wav")
    extract_audio_wav(src_path, mix_path)
    vocals_path, isolation = isolate_vocals(mix_path, out_dir)

    warning = None
    speakers: list[dict] = []
    segments, labels_source, diar_warning = transcribe_and_diarise(vocals_path)
    if labels_source and segments:
        clones = extract_speaker_clones(
            vocals_path, segments, out_dir, labels_source=labels_source,
        )
        for speaker_id, info in clones.items():
            duration = float(info.get("duration") or 0.0)
            if duration < MIN_REF_DURATION_S:
                continue
            ref_path = info.get("ref_audio") or ""
            if not ref_path or not os.path.isfile(ref_path):
                continue
            speakers.append(_speaker_payload(
                speaker_id, ref_path, info.get("ref_text") or "", duration,
            ))
        if len(speakers) < 2:
            speakers = []
            warning = diar_warning or WARNING_DIARISATION
    else:
        warning = diar_warning or WARNING_DIARISATION

    if not speakers:
        dest = _confined(out_dir, "voice_mix.wav")
        _copy_wav(vocals_path, dest)
        text = ""
        if segments:
            text = " ".join(
                (seg.get("text") or "").strip() for seg in segments
            ).strip()
        speakers = [_speaker_payload(
            MIX_SPEAKER_ID, dest, text, _wav_duration(dest),
        )]

    result = {
        "isolation": isolation,
        "speakers": speakers,
    }
    if warning:
        result["warning"] = warning
    return result
