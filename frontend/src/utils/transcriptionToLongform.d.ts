export function hasLongformSource(entry: unknown): boolean;
export function toAudiobookScript(entry: unknown): {
  script: string;
  language: string | null;
};
export function toStoryDraft(
  entry: unknown,
  options?: {
    unknownSpeakerLabel?: unknown;
    newLineId?: () => string;
  },
): {
  cast: { id: string; name: string; color: string; profileId: null }[];
  lines: { id: string; character: string; text: string; profileId: null }[];
};
export function mergeStoryCast(
  existing: unknown,
  incoming: unknown,
): {
  cast: {
    id: string;
    name: string;
    color?: string;
    profileId: string | null;
    [key: string]: unknown;
  }[];
  idMap: Map<string, string>;
};
export function appendStoryLines(
  existing: unknown,
  incoming: unknown,
  idMap?: Map<string, string>,
): {
  id: string;
  character: string;
  text: string;
  profileId: string | null;
  [key: string]: unknown;
}[];
export function appendAudiobookScript(existing: unknown, incoming: unknown): string;
export function loadStoryState(
  existing: { cast?: unknown; lines?: unknown } | null | undefined,
  entry: unknown,
  options?: {
    unknownSpeakerLabel?: unknown;
    newLineId?: () => string;
    mode?: 'replace' | 'append';
  },
): { cast: unknown[]; lines: unknown[]; replace: boolean } | null;
export function loadAudiobookState(
  existingScript: unknown,
  entry: unknown,
  mode?: 'replace' | 'append',
): { script: string; language: string | null; replace: boolean } | null;
