---
generated_by: osc-newfeature
type: feat
repo: debpalash/VoiceStudio
bulk_run: true
plan_id: 121
plan_date: 2026-09-29
feature_complexity: M
deep_rubric_score: 9
dogfooded_general: false
video_required: false
deep_discovery_report: clone workspace rejects video; dub already extracts per-speaker references from a source clip
Files:
  - backend/services/clone_from_media.py
  - backend/api/routers/profiles.py
  - backend/api/schemas.py
  - backend/services/ffmpeg_utils.py
  - backend/services/speaker_clone.py
  - backend/services/dub_pipeline.py
  - backend/mcp_server.py
  - electron/src/renderer/src/lib/api/profiles.ts
  - electron/src/renderer/src/lib/api/profiles.test.ts
  - electron/src/renderer/src/features/clone/reference-input.tsx
  - electron/src/renderer/src/features/clone/speaker-picker.tsx
  - electron/src/renderer/src/features/clone/speaker-picker.test.tsx
  - electron/src/renderer/src/features/clone/reference-input.test.tsx
  - electron/src/renderer/src/features/clone/edit-profile.tsx
  - frontend/src/components/clone/AudioMethodPanel.jsx
  - frontend/src/components/clone/AudioMethodPanel.test.jsx
  - frontend/src/i18n/locales/en.json
  - frontend/src/i18n/locales/ar.json
  - frontend/src/i18n/locales/de.json
  - frontend/src/i18n/locales/es.json
  - frontend/src/i18n/locales/fr.json
  - frontend/src/i18n/locales/hi.json
  - frontend/src/i18n/locales/id.json
  - frontend/src/i18n/locales/it.json
  - frontend/src/i18n/locales/ja.json
  - frontend/src/i18n/locales/ko.json
  - frontend/src/i18n/locales/nl.json
  - frontend/src/i18n/locales/pl.json
  - frontend/src/i18n/locales/pt.json
  - frontend/src/i18n/locales/ru.json
  - frontend/src/i18n/locales/sv.json
  - frontend/src/i18n/locales/th.json
  - frontend/src/i18n/locales/tr.json
  - frontend/src/i18n/locales/uk.json
  - frontend/src/i18n/locales/vi.json
  - frontend/src/i18n/locales/zh-CN.json
  - frontend/src/i18n/locales/zh-TW.json
  - docs/features/clone-from-video.md
  - docs/feature-catalog.md
  - docs/mcp.md
  - CHANGELOG.md
  - tests/test_clone_from_media.py
  - tests/test_no_audio_track.py
  - tests/test_mcp_clone_voice_media.py
---

# feat: clone a voice from a video and pick the speaker

## Problem

Voice Clone only accepts an audio file or a live recording. A user who has a talking-head clip, an interview MP4, or a page URL must extract audio in another tool first. The drop zone rejects `video/*` with `clone.unsupported_audio`. `POST /profiles` and `PUT /profiles/{id}/audio` allowlist audio extensions only, so a video that has a sound track still cannot become a clone reference.

Dubbing already extracts per-speaker 5–15 s WAVs (ffmpeg, optional vocal isolation, diarisation, `extract_speaker_clones()`). Those clones stay job-scoped. Clone never sees them.

## User-visible behavior

In Voice Clone and the saved-clone replace-sample editor:

1. The drop zone and file picker accept video containers (`mp4`, `mkv`, `mov`, `webm`, `avi`) as well as the existing audio types. A URL field (same native-access rules as Dub ingest) downloads the media locally.
2. The backend extracts the audio track. A video with no sound track uses the existing `NO_AUDIO_TRACK` sentence — never an ffmpeg dump.
3. If vocal isolation is already installed, the mix is isolated to vocals before speaker cutting. If it is not, the mix is used and the UI states that background sound was kept.
4. If a local diarisation runtime is installed and more than one speaker is found, a picker lists each speaker with duration, a short transcript, and Play. Choosing a speaker loads that WAV as the Clone reference (or replacement sample). A single speaker, or missing diarisation, loads the extracted clip and reuses the existing long-reference window.
5. Saving a profile, generating, and replacing a saved clone follow the current paths. The stored reference is always a WAV (or the original audio container when no extract was needed). Audio-only drops are unchanged.

Default behavior is identical on macOS, Windows, and Linux. URL ingest stays behind the existing native-access gate.

## Non-goals

- Downloading models during Clone.
- Promoting Dub `auto:speaker_N` job clones.
- Timeline editing or captions.
- Changing Gallery Imports (it already accepts video files).

## Implementation

### Backend — `services/clone_from_media.py` (new)

Stage the file in a confined temp dir (path-guarded; unlink on success/failure):

1. `require_audio_stream(path)`.
2. `extract_audio_wav(path)` — lift the ffmpeg `-vn -acodec pcm_s16le` pattern from `dub_pipeline.ingest_pipeline` into `ffmpeg_utils` so Dub, Batch, and Clone share one extract. `raise_for_audio_extract_failure` maps no-stream stderr.
3. Optional vocals: existing Demucs two-stem helper **only when importable**; else return the mix plus `isolation: "skipped"`.
4. Optional speakers: if `engines.diarisation_status()` reports an installed runtime, run Dub's transcribe+diarise path (no Hub download; missing weights become a single-speaker fallback plus warning). Then `extract_speaker_clones(vocals, segments, out_dir)`.
5. Return `{ isolation, speakers: [{ id, duration, ref_text, audio_url }], warning? }`. Omit speakers below `MIN_REF_DURATION_S`.

Do not call `mark_synthetic` on extracted reference audio.

### HTTP (`api/routers/profiles.py`)

- `POST /profiles/from-media` (`UploadFile` or `url`, not both). `require_native_access` when `url` is set. yt-dlp reuse from gallery/dub with a confined output dir. Returns speakers plus a short-lived `media_id`.
- `GET /profiles/from-media/{media_id}/audio/{speaker_id}` so the renderer can `setReferenceFile` without writing a profile yet.
- `POST /profiles/from-media/{media_id}/choose` records the choice and expires the scratch dir (also TTL about 30 min).

`POST /profiles` and `PUT /profiles/{id}/audio` keep the audio allowlist. The client always uploads the chosen WAV, never the original MP4.

### MCP

`clone_voice` already posts to `/profiles`. A video under `OMNIVOICE_MCP_BASE_PATH` runs through `from-media` first: one speaker creates the profile; several speakers return `{ error, speakers: [...] }` so the agent retries with `speaker_id`. Confined-path rules unchanged.

### Electron

- `reference-input.tsx`: widen `ACCEPT` / file check to video; ingest video/URL via `fromMedia` instead of `setReferenceFile` on the raw container.
- New `speaker-picker.tsx`: playable speaker rows (not a native `<select>`). Localized `ariaLabel`. One speaker skips the dialog.
- `edit-profile.tsx` replace-sample uses the same ingest.
- `lib/api/profiles.ts`: `fromMedia`, `chooseSpeaker`, typed responses.

### Web (still shared)

`AudioMethodPanel.jsx` currently toasts `clone.unsupported_audio` for non-audio. Accept video and call the new endpoint so the browser UI does not diverge.

### i18n + docs

New keys in all 21 locale files (real translations): `clone.drop_audio` (mention video), `clone.unsupported_media`, `clone.from_url_placeholder`, `clone.speakers_title`, `clone.speakers_pick`, `clone.speakers_play`, `clone.isolation_skipped`, `clone.diarisation_skipped`.

Docs: `docs/features/clone-from-video.md`; one line on `docs/feature-catalog.md`; MCP note in `docs/mcp.md`. CHANGELOG Unreleased `### Added` one-liner.

## Test plan

Fail-before / pass-after. No GPU and no Hub in CI: mock diarisation and Demucs; ffmpeg fixtures match `test_no_audio_track.py`. `HF_HUB_OFFLINE=1` with an empty `HF_HUB_CACHE`.

| Case | Where | Assert |
|---|---|---|
| Video with audio extracts a non-silent WAV | `tests/test_clone_from_media.py` | fixture MP4 from `_make(..., audio=True)` |
| Video-only MP4 | same + `tests/test_no_audio_track.py` | `NO_AUDIO_TRACK` sentence; no ffmpeg dump |
| Two speakers then picker; choose writes that speaker's WAV | `test_clone_from_media.py` + `extract_speaker_clones` fixtures | energy only in the chosen slice |
| Diarisation unavailable | unit, mocked status | one speaker, `warning` set, mix used |
| Isolation unavailable | unit | `isolation == "skipped"`, extract still succeeds |
| URL without native access | API | 403 from `require_native_access` |
| Audio-only drop | Electron + `AudioMethodPanel.test.jsx` | still `setReferenceFile` / `ingestRefAudio`; no from-media |
| Video drop | `reference-input.test.tsx` | does not toast `unsupported_audio`; posts from-media |
| `POST /profiles` still rejects `.mp4` | profiles tests | 415 unchanged |
| MCP video, one speaker | `tests/test_mcp_clone_voice_media.py` | profile created; confined path enforced |
| MCP video, two speakers | same | JSON error + speaker ids; no profile row |
| Locale keys | `tests/test_locale_parity.py` | all 21 files |
