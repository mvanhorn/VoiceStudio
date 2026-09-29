import { beforeEach, describe, expect, it } from 'vitest';
import { longformSession, type Draft } from '../longform/longform-session';
import {
  audiobookDraftOccupied,
  canCreateLongformFromTranscription,
  loadTranscriptionIntoAudiobook,
  loadTranscriptionIntoStories,
  storiesDraftOccupied,
} from './transcription-to-longform';

const storiesDraft = () => longformSession.state.drafts.stories;
const audiobookDraft = () => longformSession.state.drafts.audiobook;
const baseline = JSON.parse(JSON.stringify(longformSession.state.drafts));
const ids = () => {
  let n = 0;
  return () => `line-${++n}`;
};

const chapter = {
  id: 7,
  text: 'raw asr',
  refined_text: 'Once upon a time.',
  language: 'en',
  duration_s: 4,
  timestamp: '2026-01-01T00:00:00.000Z',
  segments: [
    { start: 0, text: 'Once upon a time.', speaker_id: 'Ada' },
    { start: 2, text: 'The next morning.', speaker_id: 'Ben' },
  ],
};

beforeEach(() => {
  longformSession.setState((s) => ({
    ...s,
    active: null,
    drafts: JSON.parse(JSON.stringify(baseline)),
  }));
});

describe('whether the user is asked first', () => {
  it('is not asked when Stories is empty', () => {
    expect(storiesDraftOccupied(storiesDraft())).toBe(false);
  });

  it.each([
    ['lines', { lines: [{ id: 'l1', text: 'Hello', profileId: null }] }],
    ['a cast', { cast: [{ id: 'c1', name: 'Mara', profileId: null }] }],
    ['saved voice assignments', { voiceCast: { Anna: 'voice-1' } }],
    ['a completed render', { output: 'old-render.mp3' }],
  ])('is asked when Stories holds %s', (_label, patch) => {
    expect(storiesDraftOccupied({ ...storiesDraft(), ...patch } as Draft)).toBe(true);
  });

  it('is asked when Audiobook holds a script or a render', () => {
    expect(audiobookDraftOccupied(audiobookDraft())).toBe(false);
    expect(audiobookDraftOccupied({ ...audiobookDraft(), script: 'Chapter one.' })).toBe(true);
    expect(audiobookDraftOccupied({ ...audiobookDraft(), output: 'book.m4b' })).toBe(true);
  });
});

describe('loading a transcription into Stories', () => {
  it('replaces the cast and lines, and gives every line an id', () => {
    expect(
      loadTranscriptionIntoStories(chapter, {
        unknownSpeakerLabel: 'Narrator',
        newLineId: ids(),
      }),
    ).toBe(true);
    const draft = storiesDraft();
    expect(draft.cast.map((c) => c.name)).toEqual(['Ada', 'Ben']);
    expect(draft.lines).toEqual([
      { id: 'line-1', character: 'ada', text: 'Once upon a time.', profileId: null },
      { id: 'line-2', character: 'ben', text: 'The next morning.', profileId: null },
    ]);
  });

  it('detaches the open project, so a later save cannot overwrite it', () => {
    longformSession.setState((s) => ({
      ...s,
      drafts: { ...s.drafts, stories: { ...s.drafts.stories, projectId: 'book-7' } },
    }));
    loadTranscriptionIntoStories(chapter, { unknownSpeakerLabel: 'Narrator', newLineId: ids() });
    expect(storiesDraft().projectId).toBeNull();
  });

  it('appends lines and merges cast by name without wiping an existing voice', () => {
    longformSession.setState((s) => ({
      ...s,
      drafts: {
        ...s.drafts,
        stories: {
          ...s.drafts.stories,
          cast: [{ id: 'ada', name: 'Ada', profileId: 'voice-ada' }],
          lines: [{ id: 'keep', character: 'ada', text: 'Older line.', profileId: null }],
        },
      },
    }));
    expect(
      loadTranscriptionIntoStories(chapter, {
        unknownSpeakerLabel: 'Narrator',
        newLineId: ids(),
        mode: 'append',
      }),
    ).toBe(true);
    const draft = storiesDraft();
    expect(draft.cast.map((c) => [c.name, c.profileId])).toEqual([
      ['Ada', 'voice-ada'],
      ['Ben', null],
    ]);
    expect(draft.lines.map((l) => [l.character, l.text])).toEqual([
      ['ada', 'Older line.'],
      ['ada', 'Once upon a time.'],
      ['ben', 'The next morning.'],
    ]);
    expect(draft.projectId).toBeNull();
  });

  it('keeps the open project when appending', () => {
    longformSession.setState((s) => ({
      ...s,
      drafts: { ...s.drafts, stories: { ...s.drafts.stories, projectId: 'book-7' } },
    }));
    loadTranscriptionIntoStories(chapter, {
      unknownSpeakerLabel: 'Narrator',
      newLineId: ids(),
      mode: 'append',
    });
    expect(storiesDraft().projectId).toBe('book-7');
  });

  it('refuses while a longform render is running, rather than half-applying', () => {
    longformSession.setState((s) => ({ ...s, active: 'stories' }));
    expect(loadTranscriptionIntoStories(chapter, { unknownSpeakerLabel: 'Narrator' })).toBe(false);
    expect(storiesDraft().lines).toEqual([]);
  });

  it('refuses a transcription with nothing speakable', () => {
    expect(
      loadTranscriptionIntoStories(
        { text: '   ', segments: [] },
        { unknownSpeakerLabel: 'Narrator' },
      ),
    ).toBe(false);
    expect(canCreateLongformFromTranscription({ text: '   ', segments: [] })).toBe(false);
  });
});

describe('loading a transcription into Audiobook', () => {
  it('puts the preferred transcript in the script and copies language', () => {
    expect(loadTranscriptionIntoAudiobook(chapter)).toBe(true);
    expect(audiobookDraft().script).toBe('Once upon a time.');
    expect(audiobookDraft().language).toBe('en');
    expect(audiobookDraft().projectId).toBeNull();
  });

  it('appends after a blank line', () => {
    longformSession.setState((s) => ({
      ...s,
      drafts: { ...s.drafts, audiobook: { ...s.drafts.audiobook, script: 'Chapter one.' } },
    }));
    loadTranscriptionIntoAudiobook(chapter, { mode: 'append' });
    expect(audiobookDraft().script).toBe('Chapter one.\n\nOnce upon a time.');
  });

  it('refuses while a longform render is running', () => {
    longformSession.setState((s) => ({ ...s, active: 'audiobook' }));
    expect(loadTranscriptionIntoAudiobook(chapter)).toBe(false);
    expect(audiobookDraft().script).toBe('');
  });
});
