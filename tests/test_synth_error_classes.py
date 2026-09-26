"""#1227 / #1221: two synth failures that dead-ended in the catch-all.

``_oom_friendly_reraise`` classifies every known way a generate can die and
re-raises with the real remedy; anything it doesn't recognize surfaces as
"TTS engine stopped mid-generation with an error OmniVoice doesn't recognize".
Two real reports landed there:

* #1227 — ``OSError: [WinError 4551] An Application Control policy has blocked
  this file``. Windows Smart App Control refused to load an engine binary;
  nothing about memory, and the Flush button can't help.
* #1221 — ``LibsndfileError: System error.``, libsndfile's bare wording for an
  OS-level audio read/write failure. No path, no errno, no next step.

These tests pin both classes, the shared docs taxonomy, and the write-path
diagnosis that turns "System error." into a message naming the target file.
"""
from __future__ import annotations

import os

import pytest

from core.failure import _HINTS, classify


@pytest.fixture
def reraise(monkeypatch):
    """`_oom_friendly_reraise` with its cache-flush side effects stubbed out."""
    from api.routers import generation as gen

    import types

    fake_torch = types.SimpleNamespace(
        backends=types.SimpleNamespace(
            mps=types.SimpleNamespace(is_available=lambda: False)
        ),
        cuda=types.SimpleNamespace(is_available=lambda: False),
    )
    monkeypatch.setitem(__import__("sys").modules, "torch", fake_torch)
    return gen._oom_friendly_reraise


# ── #1227: Windows Application Control ───────────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        "[WinError 4551] An Application Control policy has blocked this file",
        "OSError: [WinError 1260] This program is blocked by group policy",
        # Localised Windows: the message text is translated, the code is not.
        "OSError: [WinError 4551] Politique de contrôle des applications",
    ],
)
def test_app_control_block_is_named_not_called_unrecognized(reraise, raw):
    with pytest.raises(RuntimeError) as excinfo:
        reraise(OSError(raw))
    msg = str(excinfo.value)
    assert "doesn't recognize" not in msg
    assert "Smart App Control" in msg
    assert "Flush button won't help" in msg


def test_app_control_block_has_a_docs_class_and_hint():
    raw = "[WinError 4551] An Application Control policy has blocked this file"
    assert classify(raw) == "WINDOWS_APP_CONTROL_BLOCKED"
    assert "Smart App Control" in _HINTS["WINDOWS_APP_CONTROL_BLOCKED"]


def test_app_control_block_is_not_reported_as_out_of_memory(reraise):
    """The #880 class bug: an unknown error used to claim OOM. It must not
    come back for this one."""
    with pytest.raises(RuntimeError) as excinfo:
        reraise(OSError("[WinError 4551] An Application Control policy has blocked this file"))
    assert "out of memory" not in str(excinfo.value).lower()


# ── #1221: libsndfile ────────────────────────────────────────────────────


def test_libsndfile_failure_is_named_not_called_unrecognized(reraise):
    with pytest.raises(RuntimeError) as excinfo:
        reraise(RuntimeError("LibsndfileError: System error."))
    msg = str(excinfo.value)
    assert "doesn't recognize" not in msg
    assert "not a memory one" in msg
    assert "antivirus" in msg


def test_libsndfile_failure_has_a_docs_class_and_hint():
    assert classify("LibsndfileError: System error.") == "AUDIO_IO_FAILED"
    assert "writable" in _HINTS["AUDIO_IO_FAILED"]


# ── #1221: the write path names the target ───────────────────────────────


def test_write_failure_names_the_target_and_its_drive(tmp_path):
    """A bare libsndfile error must come back naming the file, the folder's
    writability, and the free space — the facts that identify the cause."""
    import soundfile as sf

    from services.audio_io import _describe_write_failure

    target = tmp_path / "out" / "speech.wav"
    err = sf.LibsndfileError(1)  # takes an int code, not a message

    described = _describe_write_failure(err, str(target))

    assert isinstance(described, RuntimeError)
    msg = str(described)
    assert str(target) in msg
    assert "LibsndfileError" in msg
    assert "does not exist" in msg  # tmp_path/out was never created


def test_write_failure_reports_free_space_for_a_real_folder(tmp_path):
    from services.audio_io import _describe_write_failure

    described = _describe_write_failure(OSError("System error."), str(tmp_path / "a.wav"))
    assert "MB free" in str(described)


def test_write_failure_diagnosis_is_skipped_for_buffers_and_self_describing_errors(tmp_path):
    import io

    from services.audio_io import _describe_write_failure

    err = OSError("System error.")
    assert _describe_write_failure(err, io.BytesIO()) is err

    path = str(tmp_path / "a.wav")
    already = FileNotFoundError(2, "No such file", path)
    assert _describe_write_failure(already, path) is already


def test_write_failure_diagnosis_never_replaces_the_real_error():
    """Best-effort: a broken path argument must not mask the failure."""
    from services.audio_io import _describe_write_failure

    err = OSError("System error.")
    assert _describe_write_failure(err, os.devnull) is not None


def test_save_reraises_with_the_target_named(tmp_path, monkeypatch):
    """End-to-end through _safe_torchaudio_save, the #1221 code path."""
    import torch

    from services import audio_io

    def _boom(*_a, **_k):
        raise RuntimeError("Error opening 'x': System error.")

    monkeypatch.setattr(audio_io.torchaudio, "save", _boom)
    target = tmp_path / "speech.wav"

    with pytest.raises(RuntimeError) as excinfo:
        audio_io._safe_torchaudio_save(str(target), torch.zeros(1, 100), 24000)

    assert str(target) in str(excinfo.value)
    # Review finding (#1233): this used to allow "" as a pass, which hid the
    # fact that the ENRICHED message no longer contains the word "libsndfile"
    # and so classified as nothing — leaving bug reports and docs links
    # unclassified for exactly the failure this PR is about.
    assert classify(str(excinfo.value)) == "AUDIO_IO_FAILED"


def test_unrelated_open_failures_keep_their_own_guidance(reraise):
    """Review finding (#1233): matching the generic phrase "error opening"
    handed the audio-file remedy to ANY failure that mentioned it — a model,
    archive or config file that won't open. Classification keys off a marker
    audio_io emits, not on wording other subsystems share."""
    raw = "Error opening model archive: /models/x/config.json is corrupt"
    assert classify(raw) != "AUDIO_IO_FAILED"

    with pytest.raises(RuntimeError) as excinfo:
        reraise(RuntimeError(raw))
    msg = str(excinfo.value)
    assert "libsndfile" not in msg
    assert "antivirus" not in msg


def test_the_marker_is_shared_not_duplicated():
    """core/ cannot import services/, so the marker lives in audio_io and
    failure.py matches its lowercased text. Pinned through classify() itself,
    not through getsource — the literal could survive in a comment while the
    classifier stopped using it (#1221 review)."""
    from services.audio_io import AUDIO_WRITE_FAILED_MARKER

    assert classify(AUDIO_WRITE_FAILED_MARKER) == "AUDIO_IO_FAILED"
    assert classify(AUDIO_WRITE_FAILED_MARKER.upper()) == "AUDIO_IO_FAILED"


# ── #2320: missing reference ASR stays a validation error ────────────────


def test_classifier_sentence_is_the_model_diagnostic(monkeypatch):
    """The owned sentence is OmniVoice._load_cached_reference_asr's, not a
    paraphrase. A sidecar test that copied a shorter phrase could pass while
    the real diagnostic still fell through."""
    from unittest.mock import Mock

    from huggingface_hub.errors import LocalEntryNotFoundError

    from api.routers.generation import _MISSING_REFERENCE_ASR_MESSAGE
    from omnivoice.models.omnivoice import OmniVoice

    model = OmniVoice.__new__(OmniVoice)
    monkeypatch.setattr(
        "huggingface_hub.snapshot_download",
        Mock(side_effect=LocalEntryNotFoundError("not cached")),
    )
    with pytest.raises(ValueError) as raised:
        model._load_cached_reference_asr()
    assert str(raised.value) == _MISSING_REFERENCE_ASR_MESSAGE
    assert type(raised.value.__cause__).__name__ == "LocalEntryNotFoundError"


def _reported_sidecar_error(message: str) -> RuntimeError:
    """The parent keeps the child's ``{type}: {message}`` and drops the cause.

    ``SubprocessBackend`` raises ``RuntimeError(f"{id} sidecar {stage} error:
    {message}")`` with no ``from``. On MPS the engine id is ``omnivoice``.
    """
    return RuntimeError(
        f"omnivoice sidecar synthesize error: ValueError: {message}"
    )


def test_sidecar_missing_reference_asr_is_validation_not_unrecognized(reraise):
    """#2320: the reported sidecar RuntimeError must come back as the model's
    ValueError, with the transcript / Model Catalogue remedy, and without the
    unrecognized-error retry."""
    from api.routers import generation as gen

    message = gen._MISSING_REFERENCE_ASR_MESSAGE
    sidecar = _reported_sidecar_error(message)
    with pytest.raises(ValueError) as excinfo:
        reraise(sidecar)
    msg = str(excinfo.value)
    assert msg == message
    assert "reference transcript" in msg
    assert "Model Catalogue" in msg
    assert "doesn't recognize" not in msg
    assert "Retry once" not in msg
    assert excinfo.value.__cause__ is sidecar


def test_direct_missing_reference_asr_keeps_its_message_and_cause(reraise):
    """A ValueError chained from the cache miss is validation, not a download
    failure. LocalEntryNotFoundError is otherwise a network signature."""
    from huggingface_hub.errors import LocalEntryNotFoundError

    from api.routers import generation as gen

    message = gen._MISSING_REFERENCE_ASR_MESSAGE
    try:
        raise LocalEntryNotFoundError("not cached")
    except LocalEntryNotFoundError as exc:
        try:
            raise ValueError(message) from exc
        except ValueError as caught:
            direct = caught
    assert any(
        type(item).__name__ == "LocalEntryNotFoundError"
        for item in gen._exception_chain(direct)
    )
    with pytest.raises(ValueError) as excinfo:
        reraise(direct)
    assert str(excinfo.value) == message
    assert excinfo.value.__cause__ is direct
    assert "network problem" not in str(excinfo.value)
    assert "doesn't recognize" not in str(excinfo.value)


def test_nested_missing_reference_asr_is_found_by_the_chain_helper(reraise):
    """A wrapper whose own text says nothing still carries the diagnostic on
    ``__cause__``. Classification walks ``_exception_chain``."""
    from api.routers import generation as gen

    message = gen._MISSING_REFERENCE_ASR_MESSAGE
    try:
        raise ValueError(message)
    except ValueError as caught:
        diagnostic = caught
        try:
            raise RuntimeError("engine wrapper") from caught
        except RuntimeError as outer:
            nested = outer
    assert any(
        isinstance(item, ValueError) and str(item) == message
        for item in gen._exception_chain(nested)
    )
    with pytest.raises(ValueError) as excinfo:
        reraise(nested)
    assert str(excinfo.value) == message
    assert excinfo.value.__cause__ is nested
    assert diagnostic in list(gen._exception_chain(excinfo.value))


@pytest.mark.parametrize(
    "raw",
    [
        "ValueError: ASR model is not loaded. Call model.load_asr_model() first.",
        "speech-to-text model failed to download",
        "Automatic reference transcription failed: tensor shape mismatch",
        "install a speech-to-text model in Model Catalogue",
        "ValueError: the reference model weights are missing",
    ],
)
def test_broad_asr_wording_stays_unrecognized(reraise, raw):
    """ASR, model, or ValueError alone is not this validation error."""
    with pytest.raises(RuntimeError) as excinfo:
        reraise(RuntimeError(raw))
    msg = str(excinfo.value)
    # The catch-all quotes the original text, and "reference transcription"
    # contains the letters "reference transcript", so match the remedy sentence.
    assert "doesn't recognize" in msg
    assert "Provide a matching reference transcript" not in msg
    assert "Retry once" in msg


@pytest.mark.parametrize(
    ("exc", "marker"),
    [
        (RuntimeError("CUDA out of memory. Tried to allocate 2 GiB"), "ran out of memory"),
        (
            RuntimeError("Cannot send a request, as the client has been closed."),
            "network problem",
        ),
        (TimeoutError(), "time limit"),
        (
            RuntimeError(
                "OMNIVOICE_SHERPA_MODEL not set. Point it to a sherpa-onnx TTS model directory"
            ),
            "isn't set up yet",
        ),
        (RuntimeError("tensor shape mismatch"), "doesn't recognize"),
    ],
)
def test_existing_failure_classes_ignore_this_validation(reraise, exc, marker):
    with pytest.raises(RuntimeError) as excinfo:
        reraise(exc)
    msg = str(excinfo.value)
    assert marker in msg
    assert "reference transcript" not in msg


def test_cache_miss_without_the_validation_sentence_stays_a_network_error(reraise):
    from huggingface_hub.errors import LocalEntryNotFoundError

    with pytest.raises(RuntimeError) as excinfo:
        reraise(LocalEntryNotFoundError("not cached"))
    msg = str(excinfo.value)
    assert "network problem" in msg
    assert "reference transcript" not in msg
    assert "doesn't recognize" not in msg
