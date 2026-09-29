---
generated_by: osc-newfeature
type: feat
repo: debpalash/VoiceStudio
bulk_run: true
plan_id: 122
plan_date: 2026-09-29
feature_complexity: S
deep_rubric_score: 8
dogfooded_general: false
video_required: false
deep_discovery_report: transcriptions can reuse text in Clone; there is no path into Stories or Audiobook. Dub already creates a Story from segments.
Files:
  - frontend/src/utils/transcriptionToLongform.js
  - frontend/src/utils/transcriptionToLongform.test.js
  - frontend/src/utils/transcriptionsStore.js
  - electron/src/renderer/src/features/transcriptions/transcription-to-longform.ts
  - electron/src/renderer/src/features/transcriptions/transcription-to-longform.test.ts
  - electron/src/renderer/src/features/transcriptions/transcriptions-page.tsx
  - electron/src/renderer/src/features/longform/longform-page.tsx
  - electron/src/renderer/src/features/longform/longform-session.ts
  - electron/src/renderer/src/features/longform/story-clear.ts
  - electron/src/renderer/src/features/clone/confirm-dialog.tsx
  - frontend/src/pages/AudiobookTab.jsx
  - frontend/src/components/StoriesEditor.jsx
  - frontend/src/pages/Transcriptions.jsx
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
  - docs/features/dictation.md
  - CHANGELOG.md
---

# feat: turn a transcription into a Stories or Audiobook draft

## Problem

A finished transcription (live dictation or an uploaded clip) already lives in the local history (`omni_transcriptions`). From that detail view the user can send the text to Voice Clone. There is no in-app path into Stories or Audiobook: they copy, switch workspace, and paste.

Stories can already be created from a finished dub (speakers become characters, segments become lines). Audiobook and Stories import files (txt/md/epub/pdf, plus captions on Stories). Neither surface reads transcription history. Dictating a chapter and narrating it is two tools with a clipboard in between.

## User-visible behavior

On a selected transcription:

- **Use in Stories** builds a Stories draft: timed `segments` become lines in time order; the preferred transcript (refined text when present) is the line text. If a segment carries `speaker_id` / `speaker`, each distinct speaker becomes a cast member (same grouping idea as dub-to-story). If there are no speaker labels, one Narrator character owns every line. Empty segments are skipped. Navigate to `/stories`.
- **Use in Audiobook** puts the preferred transcript into the Audiobook script (language copied when it is not `unknown`). Navigate to `/audiobook`.

If that destination draft already has script, lines, cast, or a finished render, show the existing `ConfirmDialog`: Replace, Append, or Cancel. Append on Stories adds lines (and any new cast names) without wiping voice assignments already on other characters. Append on Audiobook inserts a blank line, then the new text.

On Stories and Audiobook themselves, a **From transcriptions** control next to Import opens a picker of the same history (newest first, searchable, duration + language + preview). Empty history still opens the picker with an empty state that points back to Transcriptions. Picking an entry runs the same transform. The history row is not deleted or mutated.

Identical on macOS, Windows, and Linux. No new network, no new backend route, no schema migration.

## Non-goals

- Re-running ASR or diarisation from this action.
- Transcriptions to Dub (out of scope).
- Writing transcriptions into the SQLite projects table.
- Changing `splitStoryText` / `parseScript` / longform render.

## Implementation

Pure transform, then thin Electron wiring — same split as `frontend/src/utils/dubToStory.js` plus `electron/.../dub-to-story.ts`.

### `frontend/src/utils/transcriptionToLongform.js` (new)

Shared by Electron and the web shell. Never throws.

- Input: a transcription entry (`text`, `refined_text?`, `language`, `segments[]`, optional speaker fields).
- `preferredTranscript(entry)` already exists in `frontend/src/utils/transcriptionFormat`.
- `toAudiobookScript(entry) -> { script, language }`.
- `toStoryDraft(entry, { unknownSpeakerLabel, newLineId }) -> { cast, lines }`
  - Expand `segments` in `start` order.
  - If `segments` is missing or empty, one line from `preferredTranscript`.
  - Speaker key: `speaker_id` or `speaker` or `''`.
  - Reuse `nextCastColor` from `storyCast.js`. Cast names fall back to `unknownSpeakerLabel` (the caller passes the localized Narrator/Speaker string).
- Occupied check stays in the Electron wrapper so it can see `output` / `voiceCast` (same as `storiesDraftOccupied`).

### Electron wiring

`transcription-to-longform.ts`:

- `canCreateLongformFromTranscription(entry)` — non-empty preferred text or any segment with text.
- `loadTranscriptionIntoStories(entry, options)` / `loadTranscriptionIntoAudiobook(entry, options)` — `editLongform` no-op while a render is `active` (return false, do not navigate). Drop `projectId` on replace so a later save cannot overwrite a saved project with dictation text (same rule as dub-to-story).
- Append helpers that concat script / concat lines and merge cast by name.

`transcriptions-page.tsx`: two outline buttons beside the existing Clone reuse control.

`longform-page.tsx`: From transcriptions next to the Import label; picker dialog listing `loadTranscriptions()` (already used by the transcriptions page). Reuse `ConfirmDialog`.

Web call sites (`AudiobookTab.jsx`, `StoriesEditor.jsx`, `Transcriptions.jsx`) get the same actions so the browser UI does not diverge.

### i18n + docs

Keys in all 21 locale files: `transcriptions.use_in_stories`, `transcriptions.use_in_audiobook`, `audiobook.from_transcriptions`, `stories.from_transcriptions`, `transcriptionPicker.title`, `transcriptionPicker.search_placeholder`, `transcriptionPicker.empty`, `transcriptionPicker.empty_search`, `audiobook.import_replace_prompt`, `audiobook.import_replace`, `audiobook.import_append`, `audiobook.import_cancel`.

A short subsection on `docs/features/dictation.md` (dictation → narrate). CHANGELOG Unreleased `### Added` one-liner.

## Test plan

Fail-before: Electron today has Clone reuse only; `grep` for `from_transcriptions` is empty. Pass-after: the table below.

| Case | Where | Assert |
|---|---|---|
| Segments in time order become Stories lines | `transcriptionToLongform.test.js` | order by `start`; blank segments dropped |
| No segments → one line from preferred / refined text | same | `refined_text` wins when present |
| Two `speaker_id` values → two cast members, lines attributed | same | names stable; empty speaker → `unknownSpeakerLabel` |
| Occupied Stories draft asks before replace | `transcription-to-longform.test.ts` | `storiesDraftOccupied` true when lines/cast/output exist |
| Replace drops `projectId` | same | matches dub-to-story |
| Append keeps existing lines and adds new ones | same | cast merged by name |
| Active longform render refuses load | same | `editLongform` no-op; return false |
| Empty history picker | longform page test | empty-state copy; no crash |
| Transcriptions page buttons navigate after a successful load | `transcriptions-page` test | `/stories` and `/audiobook` |
| Locale keys | `tests/test_locale_parity.py` | all 21 files |

No backend tests required. No ffmpeg, GPU, or Hub.
