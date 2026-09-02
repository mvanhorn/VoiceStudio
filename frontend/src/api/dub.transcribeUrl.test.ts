import { describe, it, expect } from 'vitest';
import { dubBurnQuery, transcribeStreamUrl } from './dub';

// #274: the optional speaker-count hint is appended only when it's a positive
// integer; otherwise the backend auto-detects.
describe('transcribeStreamUrl', () => {
  it('omits num_speakers when not provided', () => {
    expect(transcribeStreamUrl('job1')).toMatch(/\/dub\/transcribe-stream\/job1$/);
  });

  it('omits num_speakers for null / 0 / negative / NaN', () => {
    for (const v of [null, undefined, 0, -3, NaN] as (number | null | undefined)[]) {
      expect(transcribeStreamUrl('j', v)).not.toContain('num_speakers');
    }
  });

  it('appends a positive integer hint', () => {
    expect(transcribeStreamUrl('j', 3)).toContain('num_speakers=3');
  });

  it('floors a fractional hint', () => {
    expect(transcribeStreamUrl('j', 2.9)).toContain('num_speakers=2');
  });
});

// Hardsub burn options on /dub/download: karaoke only rides along with the
// single-line layout — dual karaoke is unsupported, so the flag drops to 0
// when dual is on (mirrors the backend guard and the disabled Export control).
describe('dubBurnQuery', () => {
  it('is empty when burn-in is off, regardless of the other flags', () => {
    expect(dubBurnQuery(false, false, false)).toBe('');
    expect(dubBurnQuery(false, true, true)).toBe('');
  });

  it('emits the legacy line burn by default', () => {
    expect(dubBurnQuery(true, false, false)).toBe('&burn_subs=1&dual=0&karaoke=0');
  });

  it('passes karaoke=1 for the single-line layout', () => {
    expect(dubBurnQuery(true, false, true)).toBe('&burn_subs=1&dual=0&karaoke=1');
  });

  it('drops karaoke when the dual layout is on', () => {
    expect(dubBurnQuery(true, true, true)).toBe('&burn_subs=1&dual=1&karaoke=0');
    expect(dubBurnQuery(true, true, false)).toBe('&burn_subs=1&dual=1&karaoke=0');
  });
});
