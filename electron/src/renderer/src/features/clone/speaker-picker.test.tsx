import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/audio-preview-button', () => ({
  AudioPreviewButton: ({ src }: { src: string }) => <button type="button">play:{src}</button>,
}));
vi.mock('@/lib/api/client', () => ({ apiPath: (path: string) => `/api${path}` }));

import { SpeakerPicker } from './speaker-picker';

afterEach(() => cleanup());

const speakers = [
  {
    id: 'speaker_1',
    duration: 8.2,
    ref_text: 'hello there',
    audio_url: '/profiles/from-media/abc/audio/speaker_1',
  },
  {
    id: 'speaker_2',
    duration: 6,
    ref_text: 'and goodbye',
    audio_url: '/profiles/from-media/abc/audio/speaker_2',
  },
];

it('lists playable speaker rows instead of a native select', () => {
  const onPick = vi.fn();
  render(<SpeakerPicker speakers={speakers} onPick={onPick} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.querySelector('select')).toBeNull();
  expect(screen.getByText('hello there')).toBeTruthy();
  expect(screen.getByText('play:/api/profiles/from-media/abc/audio/speaker_1')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'clone.speakers_pick' })[1]);
  expect(onPick).toHaveBeenCalledWith('speaker_2');
});

it('states when isolation was skipped', () => {
  render(<SpeakerPicker speakers={speakers} onPick={vi.fn()} isolationSkipped />);
  expect(screen.getByText('clone.isolation_skipped')).toBeTruthy();
});
