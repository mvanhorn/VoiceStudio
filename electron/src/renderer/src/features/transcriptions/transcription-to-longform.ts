/**
 * Carrying a saved transcription into Stories or Audiobook.
 *
 * The transform itself is shared with the browser app
 * (`frontend/src/utils/transcriptionToLongform`); this is the Electron wiring
 * around it, kept out of the pages so replace/append/occupied rules can be
 * tested without mounting them.
 */
import {
  hasLongformSource,
  loadAudiobookState,
  loadStoryState,
} from '../../../../../../frontend/src/utils/transcriptionToLongform';
import { storiesDraftOccupied } from '../dub/dub-to-story';
import {
  editLongform,
  longformSession,
  storiesImportEpoch,
  type Draft,
} from '../longform/longform-session';
import { clearedScriptPatch, scriptSize } from '../longform/story-clear';

export { storiesDraftOccupied };

export function canCreateLongformFromTranscription(entry: unknown): boolean {
  return hasLongformSource(entry);
}

/** Whether loading into Audiobook would overwrite work. */
export function audiobookDraftOccupied(draft: Draft): boolean {
  return (
    scriptSize('audiobook', draft) > 0 ||
    Object.keys(draft.voiceCast).length > 0 ||
    Boolean(draft.output || draft.outputScript || draft.outputChapters.length)
  );
}

function mintLineId(newLineId?: () => string): () => string {
  return newLineId ?? (() => crypto.randomUUID());
}

/**
 * Replace or append the Stories draft from a transcription.
 *
 * Returns false and changes nothing when there is nothing to load, or when a
 * longform render is running — `editLongform` is a no-op then, so the caller
 * must not navigate to an editor that would still be showing the old script.
 *
 * Replace drops the project link so a later save cannot overwrite a saved
 * project with dictation text.
 */
export function loadTranscriptionIntoStories(
  entry: unknown,
  options: {
    unknownSpeakerLabel: string;
    newLineId?: () => string;
    mode?: 'replace' | 'append';
  },
): boolean {
  if (longformSession.state.active) return false;
  const draft = longformSession.state.drafts.stories;
  const next = loadStoryState(draft, entry, {
    unknownSpeakerLabel: options.unknownSpeakerLabel,
    newLineId: mintLineId(options.newLineId),
    mode: options.mode === 'append' ? 'append' : 'replace',
  });
  if (!next) return false;
  storiesImportEpoch.current += 1;
  if (!next.replace) {
    editLongform('stories', {
      cast: next.cast as Draft['cast'],
      lines: next.lines as Draft['lines'],
      output: '',
      outputScript: '',
      outputChapters: [],
      outputCachedChapters: 0,
      outputFailedChapters: 0,
    });
    return true;
  }
  editLongform('stories', {
    ...clearedScriptPatch('stories'),
    cast: next.cast as Draft['cast'],
    lines: next.lines as Draft['lines'],
    voiceCast: {},
    projectId: null,
    output: '',
    outputScript: '',
    outputChapters: [],
    outputCachedChapters: 0,
    outputFailedChapters: 0,
  });
  return true;
}

/**
 * Replace or append the Audiobook manuscript from a transcription.
 * Append inserts a blank line, then the new text.
 */
export function loadTranscriptionIntoAudiobook(
  entry: unknown,
  options: {
    newLineId?: () => string;
    mode?: 'replace' | 'append';
  } = {},
): boolean {
  if (longformSession.state.active) return false;
  const mode = options.mode === 'append' ? 'append' : 'replace';
  const draft = longformSession.state.drafts.audiobook;
  const next = loadAudiobookState(draft.script, entry, mode);
  if (!next) return false;
  const patch: Partial<Draft> = {
    script: next.script,
    output: '',
    outputScript: '',
    outputChapters: [],
    outputCachedChapters: 0,
    outputFailedChapters: 0,
  };
  if (next.language) patch.language = next.language;
  if (next.replace) patch.projectId = null;
  editLongform('audiobook', patch);
  return true;
}
