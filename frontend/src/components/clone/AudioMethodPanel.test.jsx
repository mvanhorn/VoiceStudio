import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { toastMock, mediaApi } = vi.hoisted(() => {
  const error = vi.fn();
  const toast = Object.assign(vi.fn(), { error });
  return {
    toastMock: toast,
    mediaApi: {
      fromMedia: vi.fn(),
      chooseSpeaker: vi.fn(),
      fetchSpeakerAudio: vi.fn(),
    },
  };
});

vi.mock('react-hot-toast', () => ({ toast: toastMock }));

vi.mock('../WaveformPlayer', () => ({
  default: ({ src }) => <div data-testid="reference-waveform">{src.name}</div>,
}));

vi.mock('../../api/profiles', () => mediaApi);

import AudioMethodPanel from './AudioMethodPanel';
import { createInputLevelStore } from '../../utils/audioInput';

const baseProps = {
  t: (key) => key,
  selectedProfile: null,
  setSelectedProfile: vi.fn(),
  profiles: [],
  ingestRefAudio: vi.fn(),
  isCleaning: false,
  isRecording: false,
  isStartingRecording: false,
  recordingTime: 0,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  refText: '',
  setRefText: vi.fn(),
  instruct: '',
  setInstruct: vi.fn(),
  defineMethod: 'audio',
  designSeed: null,
  setDesignSeed: vi.fn(),
  keepSeed: false,
  setKeepSeed: vi.fn(),
  showSaveProfile: false,
  setShowSaveProfile: vi.fn(),
  profileName: '',
  setProfileName: vi.fn(),
  handleSaveProfile: vi.fn(),
  audioInputs: [
    { deviceId: 'built-in', label: 'Built-in microphone' },
    { deviceId: 'usb', label: '' },
  ],
  selectedAudioInputId: '',
  setSelectedAudioInputId: vi.fn(),
  channelMode: 'auto',
  setChannelMode: vi.fn(),
  inputLevelStore: createInputLevelStore(),
};

describe('AudioMethodPanel', () => {
  afterEach(() => vi.clearAllMocks());

  it('starts with a clean upload choice and hides recording controls', () => {
    const { container } = render(<AudioMethodPanel {...baseProps} />);

    expect(screen.getByRole('radio', { name: 'clone.upload_audio' })).toHaveAttribute(
      'data-state',
      'on',
    );
    expect(container.querySelector('#audio-upload')).toHaveClass('sr-only');
    expect(screen.queryByLabelText('recording.input_device')).not.toBeInTheDocument();
  });

  it('keeps the stop control mounted while recording', () => {
    render(<AudioMethodPanel {...baseProps} isRecording />);

    const upload = screen.getByRole('radio', { name: 'clone.upload_audio' });
    expect(upload).toBeDisabled();
    fireEvent.click(upload);
    expect(screen.getByRole('radio', { name: 'clone.record' })).toBeChecked();
    expect(screen.getByRole('button', { name: '0s' })).toBeInTheDocument();
  });

  it('locks the source choice while microphone startup is pending', () => {
    render(<AudioMethodPanel {...baseProps} isStartingRecording />);

    const upload = screen.getByRole('radio', { name: 'clone.upload_audio' });
    expect(upload).toBeDisabled();
    fireEvent.click(upload);
    expect(screen.getByRole('radio', { name: 'clone.record' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Starting…');
  });

  it('explains how to recover from unsupported picker and drop files', () => {
    toastMock.error.mockClear();
    const { container } = render(<AudioMethodPanel {...baseProps} />);
    const invalid = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(container.querySelector('#audio-upload'), { target: { files: [invalid] } });
    fireEvent.drop(screen.getByText('clone.drop_audio').closest('label'), {
      dataTransfer: { files: [invalid] },
    });

    expect(toastMock.error).toHaveBeenNthCalledWith(1, 'clone.unsupported_media');
    expect(toastMock.error).toHaveBeenNthCalledWith(2, 'clone.unsupported_media');
  });

  it('loads an audio drop through ingestRefAudio and does not post from-media', () => {
    const ingestRefAudio = vi.fn();
    const audio = new File(['audio'], 'voice.wav', { type: 'audio/wav' });
    const { container } = render(
      <AudioMethodPanel {...baseProps} ingestRefAudio={ingestRefAudio} />,
    );

    fireEvent.change(container.querySelector('#audio-upload'), { target: { files: [audio] } });

    expect(ingestRefAudio).toHaveBeenCalledWith(audio);
    expect(mediaApi.fromMedia).not.toHaveBeenCalled();
  });

  it('posts from-media for a video drop and does not toast unsupported_audio', async () => {
    const ingestRefAudio = vi.fn();
    const wav = new File(['wav'], 'mix.wav', { type: 'audio/wav' });
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
    mediaApi.fetchSpeakerAudio.mockResolvedValue(wav);
    mediaApi.chooseSpeaker.mockResolvedValue({ speaker_id: 'mix', duration: 4, ref_text: '' });
    const video = new File(['video'], 'talk.mp4', { type: 'video/mp4' });
    const { container } = render(
      <AudioMethodPanel {...baseProps} ingestRefAudio={ingestRefAudio} />,
    );

    fireEvent.change(container.querySelector('#audio-upload'), { target: { files: [video] } });

    await vi.waitFor(() => expect(mediaApi.fromMedia).toHaveBeenCalledOnce());
    expect(mediaApi.fromMedia.mock.calls[0][0].file.name).toBe('talk.mp4');
    expect(toastMock.error).not.toHaveBeenCalledWith('clone.unsupported_audio');
    await vi.waitFor(() => expect(ingestRefAudio).toHaveBeenCalledWith(wav));
  });

  it('previews the cleaned reference with the shared waveform player', () => {
    const refAudio = new File(['clean'], 'recording_clean.wav', { type: 'audio/wav' });
    render(<AudioMethodPanel {...baseProps} refAudio={refAudio} />);

    expect(screen.getByTestId('reference-waveform')).toHaveTextContent('recording_clean.wav');
  });

  it('selects an input device and channel mode', async () => {
    const setDevice = vi.fn();
    const setChannels = vi.fn();
    render(
      <AudioMethodPanel
        {...baseProps}
        setSelectedAudioInputId={setDevice}
        setChannelMode={setChannels}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'clone.record' }));

    fireEvent.keyDown(screen.getByLabelText('recording.input_device'), { key: 'Enter' });
    expect(screen.getByRole('option', { name: 'recording.microphone_number' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Built-in microphone' }));
    fireEvent.keyDown(screen.getByLabelText('recording.channels'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'recording.channels_mono' }));
    expect(setDevice).toHaveBeenCalledWith('built-in');
    expect(setChannels).toHaveBeenCalledWith('mono');
  });

  it('locks recording settings while microphone startup is pending', () => {
    const setDevice = vi.fn();
    const setChannels = vi.fn();
    render(
      <AudioMethodPanel
        {...baseProps}
        isStartingRecording
        setSelectedAudioInputId={setDevice}
        setChannelMode={setChannels}
      />,
    );

    const device = screen.getByLabelText('recording.input_device');
    const channels = screen.getByLabelText('recording.channels');
    expect(device).toBeDisabled();
    expect(channels).toBeDisabled();
    fireEvent.click(device);
    fireEvent.click(channels);
    expect(setDevice).not.toHaveBeenCalled();
    expect(setChannels).not.toHaveBeenCalled();
  });

  it('shows whether live microphone input is detected', () => {
    const inputLevelStore = createInputLevelStore(0.01);
    render(<AudioMethodPanel {...baseProps} isRecording inputLevelStore={inputLevelStore} />);
    expect(screen.getByText('recording.no_input_detected')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'recording.input_level' })).toHaveValue(0.01);

    act(() => inputLevelStore.set(0.3));
    expect(screen.getByText('recording.input_detected')).toBeInTheDocument();
  });

  it('keeps reference metadata behind an optional disclosure', () => {
    const refAudio = new File(['clean'], 'speaker.wav', { type: 'audio/wav' });
    render(<AudioMethodPanel {...baseProps} refAudio={refAudio} />);

    const disclosure = screen.getByText('clone.optional_details').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('clone.optional_details'));
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: 'clone.transcript' })).toBeInTheDocument();
  });

  it('clears a selected reference from its compact ready state', () => {
    const ingestRefAudio = vi.fn();
    const refAudio = new File(['clean'], 'speaker.wav', { type: 'audio/wav' });
    render(<AudioMethodPanel {...baseProps} refAudio={refAudio} ingestRefAudio={ingestRefAudio} />);

    fireEvent.click(screen.getByRole('button', { name: 'clone.clear' }));
    expect(ingestRefAudio).toHaveBeenCalledWith(null);
  });
});
