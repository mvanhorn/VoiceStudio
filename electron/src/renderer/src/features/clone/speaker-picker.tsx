import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AudioPreviewButton } from '@/components/audio-preview-button';
import { apiPath } from '@/lib/api/client';
import type { CloneSpeaker } from '@/lib/api/profiles';

export function SpeakerPicker({
  speakers,
  onPick,
  isolationSkipped,
  diarisationSkipped,
  busy,
}: {
  speakers: CloneSpeaker[];
  onPick: (speakerId: string) => void;
  isolationSkipped?: boolean;
  diarisationSkipped?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={t('clone.speakers_title')}>
      <p className="text-[length:var(--text-label)] font-medium">{t('clone.speakers_title')}</p>
      {isolationSkipped ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground" role="status">
          {t('clone.isolation_skipped')}
        </p>
      ) : null}
      {diarisationSkipped ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground" role="status">
          {t('clone.diarisation_skipped')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {speakers.map((speaker) => (
          <li key={speaker.id} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[length:var(--text-label)] font-medium">{speaker.id}</p>
                <p className="text-[length:var(--text-caption)] text-muted-foreground">
                  {t('clone.duration_seconds', { seconds: Math.round(speaker.duration) })}
                </p>
              </div>
              <AudioPreviewButton
                src={apiPath(speaker.audio_url)}
                source={`clone-speaker-${speaker.id}`}
                disabled={busy}
                disabledLabel={t('clone.speakers_play')}
              />
            </div>
            {speaker.ref_text ? (
              <p className="line-clamp-2 text-[length:var(--text-caption)] text-muted-foreground">
                {speaker.ref_text}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={busy}
              aria-label={t('clone.speakers_pick')}
              onClick={() => onPick(speaker.id)}
            >
              {t('clone.speakers_pick')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
