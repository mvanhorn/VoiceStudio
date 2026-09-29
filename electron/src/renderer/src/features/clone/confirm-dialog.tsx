import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  appendLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onAppend?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  appendLabel,
  destructive = true,
  onConfirm,
  onAppend,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={onAppend ? 'sm:max-w-md' : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" onClick={() => void onCancel?.()} />}>
            {cancelLabel ?? t('common.cancel')}
          </DialogClose>
          {onAppend ? (
            <Button
              variant="outline"
              onClick={async () => {
                await onAppend();
                onOpenChange(false);
              }}
            >
              {appendLabel ?? t('audiobook.import_append')}
            </Button>
          ) : null}
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
