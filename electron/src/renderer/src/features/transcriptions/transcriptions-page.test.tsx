import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import { TRANSCRIPTIONS_KEY } from '../../../../../../frontend/src/utils/transcriptionsStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadStories: vi.fn(() => true),
  loadAudiobook: vi.fn(() => true),
  occupiedStories: vi.fn(() => false),
  occupiedAudiobook: vi.fn(() => false),
  canCreate: vi.fn(() => true),
  liveSnapshot: { stage: 'idle', text: '', paused: false },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('./live-dictation', () => ({
  LiveDictation: class {
    subscribe() {
      return () => {};
    }
    getSnapshot() {
      return mocks.liveSnapshot;
    }
    cancel() {}
    start() {}
    pause() {}
    stop() {}
  },
}));
vi.mock('./dictation-setup', () => ({ DictationSetup: () => null }));
vi.mock('@/components/recording-inputs', () => ({ RecordingInputs: () => null }));
vi.mock('@/components/agent-fix-button', () => ({ AgentFixButton: () => null }));
vi.mock('@/components/waveform-player', () => ({ WaveformPlayer: () => null }));
vi.mock('@/components/workspace-sidebar', () => ({
  SecondarySidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/hooks/use-recording', () => {
  const recording = {
    isStarting: false,
    isRecording: false,
    isCleaning: false,
    seconds: 0,
    start: vi.fn(),
    stop: vi.fn(),
    selectedInputId: null,
  };
  return { useRecording: () => recording };
});
vi.mock('@/hooks/use-dictation-selection', () => ({
  useDictationSelection: () => ({ data: { model: { label: 'Tiny' } } }),
}));
vi.mock('@/hooks/use-engines', () => ({
  useEngines: () => ({ data: { asr: { active_model: 'x' } } }),
}));
vi.mock('@/features/settings/model-catalogue-query', () => ({
  useModelCatalogue: () => ({ data: { models: [] } }),
}));
vi.mock('@/hooks/use-native-dictation', () => ({
  useNativeShortcut: () => ({ data: { accelerator: '' } }),
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: vi.fn().mockResolvedValue({ ready: true }),
  describeError: (error: unknown) => String(error),
}));
vi.mock('@/lib/app-activity', () => ({ beginAppActivity: () => () => {} }));
vi.mock('@/lib/report-breadcrumb', () => ({ recordActionBreadcrumb: vi.fn() }));
vi.mock('@/lib/local-export', () => ({ saveLocalFile: vi.fn() }));
vi.mock('@/lib/store/clone-settings', () => ({ setCloneSetting: vi.fn() }));
vi.mock('@/lib/global-error-recovery', () => ({
  runRendererTask: (_label: string, task: () => void) => task(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: { ready: true }, isPending: false, refetch: vi.fn() }),
  };
});
vi.mock('../longform/longform-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../longform/longform-session')>();
  const session = {
    active: null as string | null,
    drafts: actual.longformSession.state.drafts,
  };
  return {
    ...actual,
    useLongformSession: () => session,
  };
});
vi.mock('./transcription-to-longform', () => ({
  canCreateLongformFromTranscription: mocks.canCreate,
  loadTranscriptionIntoStories: mocks.loadStories,
  loadTranscriptionIntoAudiobook: mocks.loadAudiobook,
  storiesDraftOccupied: mocks.occupiedStories,
  audiobookDraftOccupied: mocks.occupiedAudiobook,
}));

import { TranscriptionsPage } from './transcriptions-page';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  mocks.navigate.mockReset();
  mocks.loadStories.mockReturnValue(true);
  mocks.loadAudiobook.mockReturnValue(true);
  mocks.occupiedStories.mockReturnValue(false);
  mocks.occupiedAudiobook.mockReturnValue(false);
  mocks.canCreate.mockReturnValue(true);
  localStorage.setItem(
    TRANSCRIPTIONS_KEY,
    JSON.stringify([
      {
        id: 1,
        text: 'Dictated chapter one.',
        language: 'en',
        duration_s: 3,
        segments: [{ start: 0, text: 'Dictated chapter one.' }],
        timestamp: new Date().toISOString(),
      },
    ]),
  );
});

it('navigates to Stories after a successful load', () => {
  render(<TranscriptionsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Use in Stories' }));
  expect(mocks.loadStories).toHaveBeenCalled();
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/stories' });
});

it('navigates to Audiobook after a successful load', () => {
  render(<TranscriptionsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Use in Audiobook' }));
  expect(mocks.loadAudiobook).toHaveBeenCalled();
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/audiobook' });
});
