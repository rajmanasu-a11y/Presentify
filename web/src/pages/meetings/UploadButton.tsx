import { Button, FileButton, Group, Progress, Stack, Text, type ButtonProps } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError, notifySuccess } from '../../components/notify';
import { uploadFile, type UploadPurpose, type UploadResult } from '../../lib/upload';

/** Chooses one or more files and uploads them one after another, showing progress. */
export function UploadButton({ purpose, targetId, accept, multiple, label, details, onUploaded, buttonProps, testId }: {
  purpose: UploadPurpose;
  targetId: string;
  accept: string;
  multiple?: boolean;
  label: string;
  details?: { title?: string; change_notes?: string };
  onUploaded: (r: UploadResult) => void | Promise<void>;
  buttonProps?: ButtonProps;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

  const run = async (files: File[]) => {
    for (const file of files) {
      setProgress({ name: file.name, pct: 0 });
      try {
        const r = await uploadFile({ purpose, targetId, file, details, onProgress: (pct) => setProgress({ name: file.name, pct }) });
        notifySuccess(t('upload.done', { name: file.name }));
        await onUploaded(r);
      } catch (err) {
        notifyError(err);
      }
    }
    setProgress(null);
  };

  return (
    <Stack gap={4}>
      <FileButton onChange={(f) => { const list = Array.isArray(f) ? f : f ? [f] : []; if (list.length) void run(list); }}
        accept={accept} multiple={multiple} inputProps={{ 'data-testid': testId } as Record<string, string>}>
        {(props) => (
          <Button {...props} {...buttonProps} leftSection={<IconUpload size={18} />} disabled={Boolean(progress) || buttonProps?.disabled}>
            {label}
          </Button>
        )}
      </FileButton>
      {progress && (
        <Group gap="xs" wrap="nowrap" role="status" aria-live="polite">
          <Progress value={progress.pct} w={160} animated={progress.pct === 100} aria-hidden />
          <Text fz="sm">
            {progress.pct < 100 ? t('upload.uploading', { name: progress.name, pct: progress.pct }) : t('upload.checking', { name: progress.name })}
          </Text>
        </Group>
      )}
    </Stack>
  );
}
