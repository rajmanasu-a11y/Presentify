import { Button, Group, Modal, Text, type ButtonProps } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** A button that asks for confirmation in plain words before acting. */
export function ConfirmButton({ children, message, onConfirm, confirmLabel, ...props }: ButtonProps & {
  children: ReactNode;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>{children}</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('common.confirm')} centered>
        <Text mb="lg">{message}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button
            color={props.color}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel ?? children}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
