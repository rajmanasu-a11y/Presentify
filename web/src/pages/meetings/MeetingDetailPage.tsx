import { Alert, Anchor, Card, Group, Radio, Stack, Switch, Tabs, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmButton } from '../../components/ConfirmButton';
import { PageHeader } from '../../components/PageHeader';
import { notifyError, notifySuccess } from '../../components/notify';
import { formatDate, formatTime } from '../../lib/format';
import { invalidateMeeting, useMeeting, useMeetingContent } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import { meetingPhase, type Meeting } from '../../lib/types';
import { NotFoundPage } from '../AccountPages';
import { MeetingDetailsForm } from './MeetingForm';
import { PhaseBadge } from './MeetingsPage';
import { ParticipantsPanel } from './ParticipantsPanel';
import { QrPanel } from './QrPanel';
import { SessionsPanel } from './SessionsPanel';

function SharingSettings({ meeting, disabled }: { meeting: Meeting; disabled: boolean }) {
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

export function MeetingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { me, can, readOnly } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meeting = useMeeting(id);
  const content = useMeetingContent(id);
  const initialTab = new URLSearchParams(window.location.search).get('tab') ?? 'sessions';

  if (meeting.isLoading) return <Text>{t('common.loading')}</Text>;
  if (!meeting.data) return <NotFoundPage />;
  const m = meeting.data;
  const canManage = !readOnly && can('MEETING_MANAGE') && (me?.role === 'ORG_ADMIN' || m.organiser_user_id === me?.user_id);
  const archived = m.status === 'ARCHIVED';
  const setStatus = async (status: Meeting['status'], message: string) => {
    const { error } = await supabase.from('meetings').update({ status }).eq('id', m.id);
    if (error) { notifyError(error); return; }
    await invalidateMeeting(qc, m.id);
    notifySuccess(message);
  };

  return (
    <>
      <Anchor component={Link} to="/meetings" mb="sm" display="inline-block">← {t('meetings.back')}</Anchor>
      <PageHeader
        title={m.title}
        intro={`${m.reference_no} · ${formatDate(m.starts_at)}, ${formatTime(m.starts_at)} – ${formatTime(m.ends_at)}${m.venue ? ` · ${m.venue}` : ''}`}
        actions={
          <Group gap="sm">
            <PhaseBadge phase={meetingPhase(m)} />
            {canManage && m.status === 'DRAFT' && (
              <ConfirmButton message={t('meetings.confirmPublish')} onConfirm={() => setStatus('PUBLISHED', t('meetings.published'))}>{t('meetings.publish')}</ConfirmButton>
            )}
            {canManage && m.status === 'PUBLISHED' && (
              <ConfirmButton variant="default" message={t('meetings.confirmUnpublish')} onConfirm={() => setStatus('DRAFT', t('common.saved'))}>{t('meetings.unpublish')}</ConfirmButton>
            )}
            {canManage && !archived && (
              <ConfirmButton variant="default" message={t('meetings.confirmArchive')} onConfirm={() => setStatus('ARCHIVED', t('meetings.archived'))}>{t('meetings.archive')}</ConfirmButton>
            )}
            {canManage && archived && (
              <ConfirmButton variant="default" message={t('meetings.confirmRestore')} onConfirm={() => setStatus('PUBLISHED', t('common.saved'))}>{t('meetings.restore')}</ConfirmButton>
            )}
            {canManage && m.status === 'DRAFT' && (
              <ConfirmButton variant="subtle" color="red" message={t('meetings.confirmDelete')} onConfirm={async () => {
                const { error } = await supabase.rpc('delete_draft_meeting', { p_meeting: m.id });
                if (error) { notifyError(error); return; }
                await qc.invalidateQueries({ queryKey: ['meetings'] });
                notifySuccess(t('meetings.deleted'));
                navigate('/meetings');
              }}>{t('meetings.delete')}</ConfirmButton>
            )}
          </Group>
        }
      />
      {archived && <Alert color="gray" mb="md">{t('meetings.archivedNotice')}</Alert>}
      <Tabs defaultValue={initialTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="sessions">{t('meetings.sessionsTab')}</Tabs.Tab>
          {can('QR_DISPLAY') && <Tabs.Tab value="qr">{t('qr.tab')}</Tabs.Tab>}
          {can('PARTICIPANT_VIEW') && <Tabs.Tab value="participants">{t('attendance.tab')}</Tabs.Tab>}
          <Tabs.Tab value="details">{t('meetings.detailsTab')}</Tabs.Tab>
          <Tabs.Tab value="settings">{t('meetings.settingsTab')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sessions">
          {content.isLoading && <Text>{t('common.loading')}</Text>}
          {content.error && <Alert color="red">{t('common.unknownError')}</Alert>}
          {content.data && (
            <SessionsPanel meeting={m} sessions={content.data.sessions} presentations={content.data.presentations}
              attachments={content.data.attachments} canEdit={canManage} />
          )}
        </Tabs.Panel>
        {can('QR_DISPLAY') && (
          <Tabs.Panel value="qr">
            <QrPanel meeting={m} canManage={canManage && can('QR_MANAGE')} canEditContent={canManage} />
          </Tabs.Panel>
        )}
        {can('PARTICIPANT_VIEW') && (
          <Tabs.Panel value="participants"><ParticipantsPanel meetingId={m.id} /></Tabs.Panel>
        )}
        <Tabs.Panel value="details">
          <Card withBorder padding="lg"><MeetingDetailsForm meeting={m} disabled={!canManage || archived} /></Card>
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <SharingSettings meeting={m} disabled={!canManage || archived} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
