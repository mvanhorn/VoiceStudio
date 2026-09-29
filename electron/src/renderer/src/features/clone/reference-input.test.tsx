import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  probes: new Map<string, (seconds: number) => void>(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { error: mock.toastError, warning: mock.toastWarning } }));
vi.mock('@/hooks/use-engines', () => ({ useEngines: () => ({ activeTts: null }) }));
vi.mock('@/lib/audio/probe', () => ({
  probeAudioDuration: (file: File) =>
    new Promise<number>((resolve) => mock.probes.set(file.name, resolve)),
}));
vi.mock('@/lib/store/reference', () => ({ setReferenceFile: vi.fn() }));
vi.mock('@/hooks/use-recording', () => ({ useRecording: vi.fn() }));
vi.mock('@/components/recording-inputs', () => ({ RecordingInputs: () => null }));
vi.mock('@/lib/api/client', () => ({
  describeError: (err: Error) => err.message,
  apiPath: (p: string) => p,
}));
const mediaApi = vi.hoisted(() => ({
  fromMedia: vi.fn(),
  chooseSpeaker: vi.fn(),
  fetchSpeakerAudio: vi.fn(),
}));
vi.mock('@/lib/api/profiles', () => mediaApi);
vi.mock('./speaker-picker', () => ({
  SpeakerPicker: ({
    speakers,
    onPick,
  }: {
    speakers: { id: string }[];
    onPick: (id: string) => void;
  }) => (
    <div>
      {speakers.map((speaker) => (
        <button key={speaker.id} type="button" onClick={() => onPick(speaker.id)}>
          pick-{speaker.id}
        </button>
      ))}
    </div>
  ),
}));
import { ReferenceSourcePicker, UploadZone } from './reference-input';
import { useRecording } from '@/hooks/use-recording';

afterEach(() => {
  cleanup();
  mock.probes.clear();
  vi.clearAllMocks();
});

const clip = (name: string) => new File(['audio'], name, { type: 'audio/wav' });

it('keeps the latest pick when an earlier clip finishes probing last', async () => {
  const onAccept = vi.fn();
  const { container } = render(<UploadZone onAccept={onAccept} />);
  const input = container.querySelector('input[type="file"]')!;

  fireEvent.change(input, { target: { files: [clip('first.wav')] } });
  fireEvent.change(input, { target: { files: [clip('second.wav')] } });
  mock.probes.get('second.wav')!(5);
  await vi.waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
  mock.probes.get('first.wav')!(90);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onAccept).toHaveBeenCalledOnce();
  expect(onAccept.mock.calls[0][0].name).toBe('second.wav');
  // The stale clip's too-long error is not shown for the clip the user kept.
  expect(mock.toastError).not.toHaveBeenCalled();
  expect(mock.toastWarning).not.toHaveBeenCalled();
});

it('shows no trim toast for an accepted long clip; the usage note covers it', async () => {
  const onAccept = vi.fn();
  const { container } = render(<UploadZone onAccept={onAccept} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [clip('long.wav')] },
  });
  mock.probes.get('long.wav')!(40);
  await vi.waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
  expect(mock.toastWarning).not.toHaveBeenCalled();
  expect(mock.toastError).not.toHaveBeenCalled();
});

it('shows the drop zone and the record button together, with no mode toggle', () => {
  vi.mocked(useRecording).mockReturnValue({
    level: 0,
    seconds: 0,
    isStarting: false,
    isCleaning: false,
    isRecording: false,
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as ReturnType<typeof useRecording>);
  const view = render(<ReferenceSourcePicker />);
  expect(view.getByText('clone.drop_audio')).toBeTruthy();
  expect(view.getByRole('button', { name: 'clone.record' })).toBeTruthy();
  expect(view.queryByRole('tablist')).toBeNull();
});

function mockRecorder() {
  let finish: (file: File) => void = () => {};
  vi.mocked(useRecording).mockImplementation(((onDone: (file: File) => void) => {
    finish = onDone;
    return {
      level: 0,
      seconds: 0,
      isStarting: false,
      isCleaning: false,
      isRecording: false,
      start: vi.fn(),
      stop: vi.fn(),
    };
  }) as unknown as typeof useRecording);
  return (file: File) => finish(file);
}

it('never lets a slow upload probe replace a newer recording', async () => {
  const record = mockRecorder();
  const onAccept = vi.fn();
  const { container } = render(<ReferenceSourcePicker onAccept={onAccept} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [clip('upload.wav')] },
  });
  record(clip('recording.wav'));
  mock.probes.get('recording.wav')!(6);
  await vi.waitFor(() => expect(onAccept).toHaveBeenCalledOnce());
  mock.probes.get('upload.wav')!(7);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onAccept).toHaveBeenCalledOnce();
  expect(onAccept.mock.calls[0][0].name).toBe('recording.wav');
});

it('drops a probe that finishes after the picker closes', async () => {
  mockRecorder();
  const onAccept = vi.fn();
  const { container, unmount } = render(<ReferenceSourcePicker onAccept={onAccept} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [clip('late.wav')] },
  });
  unmount();
  mock.probes.get('late.wav')!(5);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onAccept).not.toHaveBeenCalled();
});

const video = (name: string) => new File(['video'], name, { type: 'video/mp4' });

it('loads an audio drop through setReferenceFile and does not post from-media', async () => {
  const { setReferenceFile } = await import('@/lib/store/reference');
  vi.mocked(setReferenceFile).mockResolvedValue({ ok: true, durationSeconds: 5, tooLong: false });
  const { container } = render(<UploadZone />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [clip('voice.wav')] },
  });
  await vi.waitFor(() => expect(setReferenceFile).toHaveBeenCalledOnce());
  expect(vi.mocked(setReferenceFile).mock.calls[0][0]?.name).toBe('voice.wav');
  expect(mediaApi.fromMedia).not.toHaveBeenCalled();
});

it('posts from-media for a video drop and does not toast unsupported_audio', async () => {
  mediaApi.fromMedia.mockResolvedValue({
    media_id: 'aabbccddeeff00112233445566778899',
    isolation: 'skipped',
    speakers: [
      {
        id: 'mix',
        duration: 4,
        ref_text: '',
        audio_url: '/profiles/from-media/aabbccddeeff00112233445566778899/audio/mix',
      },
    ],
  });
  mediaApi.fetchSpeakerAudio.mockResolvedValue(clip('mix.wav'));
  mediaApi.chooseSpeaker.mockResolvedValue({ speaker_id: 'mix', duration: 4, ref_text: '' });
  const { container } = render(<UploadZone />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [video('talk.mp4')] },
  });
  await vi.waitFor(() => expect(mediaApi.fromMedia).toHaveBeenCalledOnce());
  expect(mediaApi.fromMedia.mock.calls[0][0].file.name).toBe('talk.mp4');
  expect(mock.toastError).not.toHaveBeenCalledWith('clone.unsupported_audio');
  await vi.waitFor(() =>
    expect(mediaApi.chooseSpeaker).toHaveBeenCalledWith('aabbccddeeff00112233445566778899', 'mix'),
  );
  mock.probes.get('mix.wav')?.(4);
});
