// Sharing settings of a meeting: downloads and when sessions are released to participants.
import { Alert, Radio, Stack, Switch } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError, notifySuccess } from '../../components/notify';
import { invalidateMeeting } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Meeting } from '../../lib/types';

export function SharingSettings({ meeting, disabled }: { meeting: Meeting; disabled: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<Meeting>) => {
    setBusy(true);
    const { error } = await supabase.from('meetings').update(patch).eq('id', meeting.id);
    setBusy(false);
    if (error) notifyError(error);
    else { await invalidateMeeting(qc, meeting.id); notifySuccess(t('common.saved')); }
  };
  return (
    <Stack gap="xl" maw={720}>
      <div>
        <Switch label={t('meetings.downloadsAllowed')} checked={meeting.downloads_allowed} disabled={disabled || busy}
          onChange={(e) => void save({ downloads_allowed: e.currentTarget.checked })} size="md" />
        <Alert color="blue" mt="sm">{t('meetings.downloadsHelp')}</Alert>
      </div>
      <Radio.Group label={t('meetings.sessionRelease')} value={meeting.session_release}
        onChange={(v) => void save({ session_release: v as Meeting['session_release'] })}>
        <Stack mt="xs">
          <Radio value="ALL" label={t('meetings.releaseAll')} disabled={disabled || busy} />
          <Radio value="ON_START" label={t('meetings.releaseOnStart')} disabled={disabled || busy} />
        </Stack>
      </Radio.Group>
    </Stack>
  );
}
