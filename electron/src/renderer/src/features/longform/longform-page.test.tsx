import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import { TranscriptionHistoryPicker } from './longform-page';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

it('shows empty-state copy when there are no transcriptions', () => {
  render(<TranscriptionHistoryPicker open onOpenChange={vi.fn()} onPick={vi.fn()} />);
  expect(
    screen.getByText('No transcriptions yet. Record one in the Transcriptions tab.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/transcriptions');
});
