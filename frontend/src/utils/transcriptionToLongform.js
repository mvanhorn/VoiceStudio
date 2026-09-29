/**
 * Turn a saved transcription into a Stories draft or an Audiobook script.
 *
 * Pure and framework-free, like `dubToStory`: no React, no i18n, no store.
 * Callers pass the localized Narrator/Speaker label and mint line ids.
 * Never throws — junk input yields an empty draft.
 */

import { preferredTranscript } from './transcriptionFormat.js';
import { nextCastColor } from './storyCast.js';

const UNATTRIBUTED = '\u0000unattributed';

function emptyStory() {
  return { cast: [], lines: [] };
}

function speechOf(segment) {
  const text = segment?.text;
  return typeof text === 'string' || typeof text === 'number' ? String(text) : '';
}

function speakerKeyOf(source) {
  const raw = source?.speaker_id ?? source?.speaker;
  const name = (raw == null ? '' : String(raw)).trim();
  return name === '' ? UNATTRIBUTED : name;
}

function castIdFor(name, taken) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'char';
  let id = base;
  let suffix = 2;
  while (taken.has(id)) id = `${base}-${suffix++}`;
  taken.add(id);
  return id;
}

function languageOf(entry) {
  const raw = entry?.language;
  if (typeof raw !== 'string') return null;
  const language = raw.trim();
  if (!language || language.toLowerCase() === 'unknown') return null;
  return language;
}

function fallbackTranscript(entry) {
  const preferred = preferredTranscript(entry);
  if (String(preferred || '').trim()) return String(preferred);
  if (!Array.isArray(entry?.segments)) return '';
  return entry.segments
    .map((segment) => speechOf(segment).trim())
    .filter(Boolean)
    .join('\n');
}

function lineIdAt(index, newLineId) {
  if (typeof newLineId === 'function') {
    try {
      const id = newLineId();
      if (id != null && String(id)) return String(id);
    } catch {
      /* fall through to a stable fallback id */
    }
  }
  return `line-${index + 1}`;
}

/**
 * Whether a transcription has anything Stories or Audiobook can load.
 * @param {unknown} entry
 * @returns {boolean}
 */
export function hasLongformSource(entry) {
  try {
    if (String(preferredTranscript(entry) || '').trim()) return true;
    if (!Array.isArray(entry?.segments)) return false;
    return entry.segments.some((segment) => speechOf(segment).trim() !== '');
  } catch {
    return false;
  }
}

/**
 * Preferred transcript as an Audiobook manuscript.
 * @param {unknown} entry
 * @returns {{script: string, language: string|null}}
 */
export function toAudiobookScript(entry) {
  try {
    return { script: fallbackTranscript(entry), language: languageOf(entry) };
  } catch {
    return { script: '', language: null };
  }
}

/**
 * Timed segments become Stories lines; speakers become cast members.
 *
 * @param {unknown} entry
 * @param {{unknownSpeakerLabel?: unknown, newLineId?: () => string}} [options]
 * @returns {{cast: {id: string, name: string, color: string, profileId: null}[], lines: {id: string, character: string, text: string, profileId: null}[]}}
 */
export function toStoryDraft(entry, options = {}) {
  try {
    const unknownSpeakerLabel =
      typeof options.unknownSpeakerLabel === 'string' && options.unknownSpeakerLabel.trim()
        ? options.unknownSpeakerLabel.trim()
        : 'Speaker';
    const newLineId = options.newLineId;

    const segments = Array.isArray(entry?.segments) ? entry.segments : [];
    const ordered = segments
      .map((segment, index) => {
        const start = Number(segment?.start);
        return { segment, index, start: Number.isFinite(start) ? start : 0 };
      })
      .sort((a, b) => a.start - b.start || a.index - b.index);

    const cast = [];
    const castIdBySpeaker = new Map();
    const taken = new Set();
    const lines = [];

    const ensureMember = (key) => {
      if (castIdBySpeaker.has(key)) return castIdBySpeaker.get(key);
      const name = key === UNATTRIBUTED ? unknownSpeakerLabel : key;
      const member = {
        id: castIdFor(name, taken),
        name,
        color: nextCastColor(cast),
        profileId: null,
      };
      cast.push(member);
      castIdBySpeaker.set(key, member.id);
      return member.id;
    };

    for (const { segment } of ordered) {
      const text = speechOf(segment).trim();
      if (!text) continue;
      const character = ensureMember(speakerKeyOf(segment));
      lines.push({
        id: lineIdAt(lines.length, newLineId),
        character,
        text,
        profileId: null,
      });
    }

    if (lines.length === 0) {
      const text = fallbackTranscript(entry).trim();
      if (!text) return emptyStory();
      const character = ensureMember(UNATTRIBUTED);
      return {
        cast,
        lines: [{ id: lineIdAt(0, newLineId), character, text, profileId: null }],
      };
    }

    return { cast, lines };
  } catch {
    return emptyStory();
  }
}

/**
 * Merge incoming cast members into an existing list by name, keeping voice
 * assignments already on matching characters.
 *
 * @param {unknown} existing
 * @param {unknown} incoming
 * @returns {{cast: object[], idMap: Map<string, string>}}
 */
export function mergeStoryCast(existing, incoming) {
  const cast = Array.isArray(existing) ? existing.map((member) => ({ ...member })) : [];
  const taken = new Set(cast.map((member) => member?.id).filter((id) => typeof id === 'string'));
  const byName = new Map();
  for (const member of cast) {
    const name = String(member?.name ?? '').trim();
    if (name && !byName.has(name)) byName.set(name, member);
  }
  const idMap = new Map();
  if (!Array.isArray(incoming)) return { cast, idMap };
  for (const member of incoming) {
    if (!member || typeof member !== 'object') continue;
    const name = String(member.name ?? '').trim();
    const incomingId = member.id == null ? '' : String(member.id);
    const found = name ? byName.get(name) : null;
    if (found) {
      if (incomingId) idMap.set(incomingId, found.id);
      continue;
    }
    const id = incomingId && !taken.has(incomingId) ? incomingId : castIdFor(name || 'char', taken);
    taken.add(id);
    const added = {
      ...member,
      id,
      name: name || String(member.name ?? 'Speaker'),
      color: member.color || nextCastColor(cast),
      profileId: member.profileId ?? null,
    };
    cast.push(added);
    if (name) byName.set(name, added);
    if (incomingId) idMap.set(incomingId, id);
  }
  return { cast, idMap };
}

/**
 * Remap incoming lines onto merged cast ids, then append them.
 * @param {unknown} existing
 * @param {unknown} incoming
 * @param {Map<string, string>} [idMap]
 */
export function appendStoryLines(existing, incoming, idMap) {
  const current = Array.isArray(existing) ? existing.slice() : [];
  if (!Array.isArray(incoming)) return current;
  const remap = idMap instanceof Map ? idMap : new Map();
  for (const line of incoming) {
    if (!line || typeof line !== 'object') continue;
    const character = line.character == null ? '' : String(line.character);
    current.push({
      ...line,
      character: remap.get(character) || character,
    });
  }
  return current;
}

/** Insert a blank line, then the new manuscript, when both sides have text. */
export function appendAudiobookScript(existing, incoming) {
  const a = existing == null ? '' : String(existing);
  const b = incoming == null ? '' : String(incoming);
  if (!b.trim()) return a;
  if (!a.trim()) return b;
  return `${a.replace(/\s+$/, '')}\n\n${b.replace(/^\s+/, '')}`;
}

/**
 * Stories workspace after loading a transcription. `replace: true` means the
 * caller should drop the open project id so a later save cannot overwrite it.
 */
export function loadStoryState(existing, entry, options = {}) {
  const { cast, lines } = toStoryDraft(entry, options);
  if (lines.length === 0) return null;
  if (options.mode === 'append') {
    const merged = mergeStoryCast(existing?.cast, cast);
    return {
      cast: merged.cast,
      lines: appendStoryLines(existing?.lines, lines, merged.idMap),
      replace: false,
    };
  }
  return { cast, lines, replace: true };
}

/** Audiobook manuscript after loading a transcription. */
export function loadAudiobookState(existingScript, entry, mode = 'replace') {
  const { script, language } = toAudiobookScript(entry);
  if (!script.trim()) return null;
  return {
    script: mode === 'append' ? appendAudiobookScript(existingScript, script) : script,
    language,
    replace: mode !== 'append',
  };
}
