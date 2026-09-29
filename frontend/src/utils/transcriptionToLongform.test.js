import { describe, it, expect } from 'vitest';
import { CAST_COLORS } from './storyCast';
import {
  appendAudiobookScript,
  hasLongformSource,
  mergeStoryCast,
  toAudiobookScript,
  toStoryDraft,
} from './transcriptionToLongform';

const ids = () => {
  let n = 0;
  return () => `line-${++n}`;
};

const entry = (fields) => ({
  id: 1,
  text: '',
  language: 'en',
  duration_s: 0,
  segments: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  ...fields,
});

describe('segments become Stories lines', () => {
  it('orders by start and drops blank segments', () => {
    const { lines, cast } = toStoryDraft(
      entry({
        text: 'ignored when segments exist',
        segments: [
          { start: 9, text: 'later', speaker_id: 'Ann' },
          { start: 1, text: '   ' },
          { start: 2, text: 'earlier', speaker_id: 'Ann' },
          { start: 3, text: '', speaker_id: 'Ann' },
        ],
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(lines.map((line) => line.text)).toEqual(['earlier', 'later']);
    expect(cast.map((member) => member.name)).toEqual(['Ann']);
  });

  it('keeps arrival order when start is missing', () => {
    const { lines } = toStoryDraft(
      entry({
        segments: [{ text: 'first' }, { text: 'second' }, { text: 'third' }],
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(lines.map((line) => line.text)).toEqual(['first', 'second', 'third']);
  });
});

describe('no usable segments', () => {
  it('uses refined text as a single line when segments are missing', () => {
    const { lines, cast } = toStoryDraft(
      entry({
        text: 'raw asr',
        refined_text: 'Cleaned chapter.',
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(cast.map((member) => member.name)).toEqual(['Narrator']);
    expect(lines).toEqual([
      { id: 'line-1', character: 'narrator', text: 'Cleaned chapter.', profileId: null },
    ]);
  });

  it('uses refined text when every segment is blank', () => {
    const { lines } = toStoryDraft(
      entry({
        refined_text: 'Only the cleaned text.',
        text: 'raw',
        segments: [{ start: 0, text: '   ' }],
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(lines.map((line) => line.text)).toEqual(['Only the cleaned text.']);
  });
});

describe('speakers become cast members', () => {
  it('makes one character per speaker_id and attributes each line', () => {
    const { cast, lines } = toStoryDraft(
      entry({
        segments: [
          { start: 0, text: 'Hello.', speaker_id: 'Ada' },
          { start: 1, text: 'Hi.', speaker_id: 'Ben' },
          { start: 2, text: 'Again.', speaker_id: 'Ada' },
        ],
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(cast.map((member) => member.name)).toEqual(['Ada', 'Ben']);
    expect(cast.map((member) => member.id)).toEqual(['ada', 'ben']);
    expect(lines.map((line) => [line.character, line.text])).toEqual([
      ['ada', 'Hello.'],
      ['ben', 'Hi.'],
      ['ada', 'Again.'],
    ]);
    expect(new Set(cast.map((member) => member.color)).size).toBe(2);
    expect(CAST_COLORS).toContain(cast[0].color);
  });

  it('reads speaker when speaker_id is absent', () => {
    const { cast, lines } = toStoryDraft(
      entry({
        segments: [{ start: 0, text: 'Quoted.', speaker: 'Casey' }],
      }),
      { unknownSpeakerLabel: 'Narrator', newLineId: ids() },
    );
    expect(cast[0].name).toBe('Casey');
    expect(lines[0].character).toBe('casey');
  });

  it('collects unlabeled speech under the caller’s name', () => {
    const { cast, lines } = toStoryDraft(
      entry({
        segments: [
          { text: 'one' },
          { text: 'two', speaker_id: '' },
          { text: 'three', speaker: '  ' },
        ],
      }),
      { unknownSpeakerLabel: 'Sprecher', newLineId: ids() },
    );
    expect(cast).toHaveLength(1);
    expect(cast[0].name).toBe('Sprecher');
    expect(new Set(lines.map((line) => line.character)).size).toBe(1);
  });
});

describe('Audiobook script', () => {
  it('prefers refined text and copies a known language', () => {
    expect(
      toAudiobookScript(entry({ text: 'raw', refined_text: 'Chapter one.', language: 'en' })),
    ).toEqual({ script: 'Chapter one.', language: 'en' });
  });

  it('omits unknown language', () => {
    expect(toAudiobookScript(entry({ text: 'Hi.', language: 'unknown' })).language).toBeNull();
    expect(toAudiobookScript(entry({ text: 'Hi.', language: '  ' })).language).toBeNull();
  });

  it('joins segment text when the preferred transcript is empty', () => {
    expect(
      toAudiobookScript(
        entry({
          text: '',
          segments: [{ text: 'First.' }, { text: 'Second.' }],
        }),
      ).script,
    ).toBe('First.\nSecond.');
  });
});

describe('append helpers', () => {
  it('merges cast by name and keeps the existing voice', () => {
    const existing = [{ id: 'ada', name: 'Ada', color: '#111', profileId: 'voice-ada' }];
    const { cast, idMap } = mergeStoryCast(existing, [
      { id: 'ada-new', name: 'Ada', profileId: null },
      { id: 'ben', name: 'Ben', color: '#222', profileId: null },
    ]);
    expect(cast.map((member) => [member.id, member.name, member.profileId])).toEqual([
      ['ada', 'Ada', 'voice-ada'],
      ['ben', 'Ben', null],
    ]);
    expect(idMap.get('ada-new')).toBe('ada');
    expect(idMap.get('ben')).toBe('ben');
  });

  it('inserts a blank line before appended Audiobook text', () => {
    expect(appendAudiobookScript('Chapter one.', 'Chapter two.')).toBe(
      'Chapter one.\n\nChapter two.',
    );
    expect(appendAudiobookScript('  ', 'Only new.')).toBe('Only new.');
  });
});

describe('input it must survive', () => {
  it('never throws', () => {
    for (const junk of [null, undefined, 7, 'x', {}, { segments: 'nope' }]) {
      expect(() => toStoryDraft(junk)).not.toThrow();
      expect(() => toAudiobookScript(junk)).not.toThrow();
      expect(hasLongformSource(junk)).toBe(false);
    }
  });

  it('does not mutate the entry it was given', () => {
    const source = entry({
      segments: [
        { start: 2, text: 'b', speaker_id: 'B' },
        { start: 1, text: 'a', speaker_id: 'A' },
      ],
    });
    const snapshot = JSON.parse(JSON.stringify(source));
    toStoryDraft(source, { unknownSpeakerLabel: 'Narrator' });
    expect(source).toEqual(snapshot);
  });
});
