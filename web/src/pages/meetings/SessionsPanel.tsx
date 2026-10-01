import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, Divider, Group, Menu, Modal, Select, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDots, IconFile, IconFileTypePdf, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmButton } from '../../components/ConfirmButton';
import { notifyError, notifySuccess } from '../../components/notify';
import { formatBytes, formatDateTime, formatTime, fromIstParts, toIstParts } from '../../lib/format';
import { invalidateMeeting, usePresenters, type PresentationWithVersions } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Attachment, Meeting, MeetingSession, Presenter, StoredFile } from '../../lib/types';
import { acceptFor, openStoredFile, removeContent } from '../../lib/upload';
import { UploadButton } from './UploadButton';

const VIEWABLE = ['pdf', 'jpg', 'jpeg', 'png'];

/** Allowed file types and size limit of my organisation, for upload hints. */
function useUploadRules() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['upload-rules', me?.organisation?.id],
    enabled: Boolean(me?.organisation?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [s, l] = await Promise.all([
        supabase.from('organisation_settings').select('allowed_file_types').eq('organisation_id', me!.organisation!.id).single(),
        supabase.from('organisation_limits').select('max_file_bytes').eq('organisation_id', me!.organisation!.id).single(),
      ]);
      if (s.error) throw s.error;
      if (l.error) throw l.error;
      return { types: s.data.allowed_file_types as string[], maxFile: l.data.max_file_bytes as number };
    },
  });
}

function FileLink({ file, label }: { file: StoredFile; label?: string }) {
  const { t } = useTranslation();
  return (
    <Anchor component="button" type="button" fz="sm" onClick={() => openStoredFile(file.object_path).catch(notifyError)}
      aria-label={`${t('presentations.open')}: ${file.original_name}`}>
      {label ?? file.original_name}
    </Anchor>
  );
}

function DownloadsSelect({ value, onChange, disabled, label }: { value: boolean | null; onChange: (v: boolean | null) => void; disabled: boolean; label: string }) {
  const { t } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap">
    <Text fz="sm" c="dimmed" aria-hidden>{t('presentations.downloads')}:</Text>
    <Select
      size="xs" w={150} aria-label={label} disabled={disabled} allowDeselect={false}
      value={value === null ? 'inherit' : value ? 'allow' : 'block'}
      onChange={(v) => onChange(v === 'inherit' ? null : v === 'allow')}
      data={[
        { value: 'inherit', label: t('presentations.followMeeting') },
        { value: 'allow', label: t('presentations.allow') },
        { value: 'block', label: t('presentations.block') },
      ]}
    />
    </Group>
  );
}

// ---------------------------------------------------------------------------
function SessionModal({ meeting, session, onClose }: { meeting: Meeting; session: MeetingSession | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const presenters = usePresenters();
  const [busy, setBusy] = useState(false);
  const mStart = toIstParts(meeting.starts_at);
  const mEnd = toIstParts(meeting.ends_at);
  const s = toIstParts(session?.starts_at);
  const e = toIstParts(session?.ends_at);
  const form = useForm({
    initialValues: {
      title: session?.title ?? '',
      presenter_id: session?.presenter_id ?? '',
      date: s.date || mStart.date,
      start_time: s.time || mStart.time,
      end_time: e.time || mEnd.time,
      notes: session?.notes ?? '',
    },
    validate: {
      title: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      end_time: (v, values) => (v <= values.start_time ? t('meetings.endBeforeStart') : null),
    },
  });
  const startIso = form.values.date && form.values.start_time ? fromIstParts(form.values.date, form.values.start_time) : null;
  const endIso = form.values.date && form.values.end_time ? fromIstParts(form.values.date, form.values.end_time) : null;
  const outside = startIso && endIso && (startIso < new Date(meeting.starts_at).toISOString() || endIso > new Date(meeting.ends_at).toISOString());

  return (
    <Modal opened onClose={onClose} title={session ? t('sessions.edit') : t('sessions.add')} size="lg" centered>
      <form noValidate onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const row = {
            title: v.title.trim(), presenter_id: v.presenter_id || null, notes: v.notes.trim() || null,
            starts_at: fromIstParts(v.date, v.start_time), ends_at: fromIstParts(v.date, v.end_time),
          };
          const { error } = session
            ? await supabase.from('meeting_sessions').update(row).eq('id', session.id)
            : await supabase.from('meeting_sessions').insert({ ...row, meeting_id: meeting.id });
          if (error) throw error;
          await invalidateMeeting(qc, meeting.id);
          notifySuccess(t('common.saved'));
          onClose();
        } catch (err) { notifyError(err); } finally { setBusy(false); }
      })}>
        <Stack>
          <TextInput label={t('sessions.titleField')} required data-autofocus {...form.getInputProps('title')} />
          <Select
            label={t('sessions.presenter')} clearable searchable placeholder={t('sessions.noPresenter')}
            data={(presenters.data ?? []).map((p: Presenter) => ({ value: p.id, label: `${p.full_name}${p.designation ? `, ${p.designation}` : ''}` }))}
            {...form.getInputProps('presenter_id')}
          />
          <Group grow>
            <TextInput type="date" label={t('meetings.date')} {...form.getInputProps('date')} />
            <TextInput type="time" label={t('meetings.startTime')} {...form.getInputProps('start_time')} />
            <TextInput type="time" label={t('meetings.endTime')} {...form.getInputProps('end_time')} />
          </Group>
          {outside && <Alert color="yellow">{t('sessions.outsideMeeting')}</Alert>}
          <Textarea label={t('sessions.notes')} {...form.getInputProps('notes')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={busy}>{t('common.save')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function NewPresentationModal({ sessionId, meetingId, onClose }: { sessionId: string; meetingId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { title: '', category: '', description: '' },
    validate: { title: (v) => (v.trim().length >= 2 ? null : t('common.required')) },
  });
  return (
    <Modal opened onClose={onClose} title={t('presentations.add')} centered>
      <form noValidate onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const { error } = await supabase.from('presentations').insert({
            session_id: sessionId, title: v.title.trim(), category: v.category.trim() || null, description: v.description.trim() || null,
          });
          if (error) throw error;
          await invalidateMeeting(qc, meetingId);
          onClose();
        } catch (err) { notifyError(err); } finally { setBusy(false); }
      })}>
        <Stack>
          <TextInput label={t('presentations.titleField')} required data-autofocus {...form.getInputProps('title')} />
          <TextInput label={t('presentations.category')} {...form.getInputProps('category')} />
          <Textarea label={t('presentations.description')} {...form.getInputProps('description')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={busy}>{t('common.create')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function VersionsModal({ presentation, canRestore, meetingId, onClose }: {
  presentation: PresentationWithVersions; canRestore: boolean; meetingId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return (
    <Modal opened onClose={onClose} title={`${t('presentations.versions')}: ${presentation.title}`} size="xl" centered>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('presentations.version', { n: '' }).trim()}</Table.Th>
            <Table.Th>{t('presentations.uploadedAt')}</Table.Th>
            <Table.Th>{t('presentations.open')}</Table.Th>
            <Table.Th>{t('presentations.changeNotes').replace(/\s*\(.*\)$/, '')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {presentation.versions.map((v) => (
            <Table.Tr key={v.id}>
              <Table.Td>
                <Group gap={6}>{v.version_no}{v.id === presentation.current_version_id && <Badge size="sm" color="green" variant="light">{t('presentations.current')}</Badge>}</Group>
              </Table.Td>
              <Table.Td>{formatDateTime(v.created_at)}</Table.Td>
              <Table.Td>
                <Stack gap={2}>
                  <FileLink file={v.original} />
                  {v.view_pdf && v.view_pdf.id !== v.original.id && <FileLink file={v.view_pdf} label={`PDF: ${v.view_pdf.original_name}`} />}
                </Stack>
              </Table.Td>
              <Table.Td><Text fz="sm">{v.change_notes ?? '—'}</Text></Table.Td>
              <Table.Td>
                {canRestore && v.id !== presentation.current_version_id && (
                  <ConfirmButton size="xs" variant="light" message={t('presentations.confirmRestore', { n: v.version_no })}
                    onConfirm={async () => {
                      const { error } = await supabase.rpc('restore_presentation_version', { p_version: v.id });
                      if (error) { notifyError(error); return; }
                      await invalidateMeeting(qc, meetingId);
                      notifySuccess(t('presentations.restored'));
                      onClose();
                    }}>
                    {t('presentations.restoreVersion')}
                  </ConfirmButton>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}

function NewVersionModal({ presentation, meetingId, accept, onClose }: { presentation: PresentationWithVersions; meetingId: string; accept: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  return (
    <Modal opened onClose={onClose} title={`${t('presentations.uploadNew')}: ${presentation.title}`} centered>
      <Stack>
        <TextInput label={t('presentations.changeNotes')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={1000} data-autofocus />
        <UploadButton purpose="PRESENTATION" targetId={presentation.id} accept={accept} label={t('upload.chooseFile')}
          details={{ change_notes: notes }} testId="new-version-input"
          onUploaded={async () => { await invalidateMeeting(qc, meetingId); onClose(); }} />
      </Stack>
    </Modal>
  );
}

function PresentationItem({ p, meetingId, canEditMeeting, canUpload, accept }: {
  p: PresentationWithVersions; meetingId: string; canEditMeeting: boolean; canUpload: boolean; accept: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [modal, setModal] = useState<'versions' | 'newVersion' | 'remove' | null>(null);
  const [removing, setRemoving] = useState(false);
  const current = p.versions.find((v) => v.id === p.current_version_id) ?? null;
  const viewable = current && (VIEWABLE.includes(current.original.extension) || current.view_pdf);
  const update = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('presentations').update(patch).eq('id', p.id);
    if (error) notifyError(error);
    else await invalidateMeeting(qc, meetingId);
  };

  return (
    <Card withBorder padding="md" data-testid={`presentation-${p.title}`}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
          <IconFile size={26} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <Text fw={700}>{p.title}</Text>
            {current ? (
              <Text fz="sm">
                <FileLink file={current.original} /> · {formatBytes(current.original.size_bytes)} · {t('presentations.version', { n: current.version_no })}
              </Text>
            ) : <Text fz="sm" c="dimmed">{t('presentations.noFile')}</Text>}
            {current && (viewable
              ? <Group gap={6} mt={4} wrap="nowrap" align="flex-start">
                  <IconFileTypePdf size={18} color="var(--mantine-color-green-light-color)" aria-hidden style={{ flexShrink: 0 }} />
                  <Text fz="sm" fw={600} c="var(--mantine-color-green-light-color)">
                    {t('presentations.viewCopyReady')}
                    {current.view_pdf && current.view_pdf.id !== current.original.id && <> · <FileLink file={current.view_pdf} label={t('presentations.open')} /></>}
                  </Text>
                </Group>
              : <Alert color="orange" p="xs" mt={6}>{t('presentations.viewCopyMissing')}</Alert>)}
            {!p.is_visible && <Badge mt={4} color="gray" variant="light">{t('presentations.hidden')}</Badge>}
          </div>
        </Group>
        {canUpload && (
          <Menu position="bottom-end">
            <Menu.Target><ActionIcon variant="subtle" size="lg" aria-label={`${t('common.actions')}: ${p.title}`}><IconDots /></ActionIcon></Menu.Target>
            <Menu.Dropdown>
              {current && <Menu.Item onClick={() => setModal('newVersion')}>{t('presentations.uploadNew')}</Menu.Item>}
              {p.versions.length > 0 && <Menu.Item onClick={() => setModal('versions')}>{t('presentations.versions')}</Menu.Item>}
              <Menu.Item onClick={() => void update({ is_visible: !p.is_visible })}>{p.is_visible ? t('presentations.hidden') : t('presentations.visible')}</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => setModal('remove')}>{t('presentations.remove')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {canUpload && (
        <Group mt="sm" gap="sm" align="flex-start">
          {!current && (
            <UploadButton purpose="PRESENTATION" targetId={p.id} accept={accept} label={t('presentations.uploadFirst')} testId={`upload-${p.title}`}
              onUploaded={() => invalidateMeeting(qc, meetingId)} />
          )}
          {current && !VIEWABLE.includes(current.original.extension) && (
            <UploadButton purpose="VIEW_PDF" targetId={current.id} accept=".pdf" testId={`pdf-${p.title}`}
              label={current.view_pdf ? t('presentations.replacePdfCopy') : t('presentations.uploadPdfCopy')}
              buttonProps={{ variant: current.view_pdf ? 'default' : 'filled' }}
              onUploaded={() => invalidateMeeting(qc, meetingId)} />
          )}
          <DownloadsSelect label={`${t('presentations.downloads')}: ${p.title}`} value={p.downloads_allowed} disabled={false}
            onChange={(v) => void update({ downloads_allowed: v })} />
        </Group>
      )}
      {modal === 'versions' && <VersionsModal presentation={p} meetingId={meetingId} canRestore={canEditMeeting} onClose={() => setModal(null)} />}
      {modal === 'newVersion' && <NewVersionModal presentation={p} meetingId={meetingId} accept={accept} onClose={() => setModal(null)} />}
      <Modal opened={modal === 'remove'} onClose={() => setModal(null)} title={t('common.confirm')} centered>
        <Text mb="lg">{t('presentations.confirmRemove', { title: p.title })}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setModal(null)}>{t('common.cancel')}</Button>
          <Button color="red" loading={removing} onClick={async () => {
            setRemoving(true);
            try { await removeContent('presentation', p.id); await invalidateMeeting(qc, meetingId); notifySuccess(t('presentations.removed')); setModal(null); }
            catch (err) { notifyError(err); }
            finally { setRemoving(false); }
          }}>{t('presentations.remove')}</Button>
        </Group>
      </Modal>
    </Card>
  );
}

function AttachmentRow({ a, meetingId, canUpload }: { a: Attachment; meetingId: string; canUpload: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const needsPdf = !VIEWABLE.includes(a.file.extension);
  const update = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('attachments').update(patch).eq('id', a.id);
    if (error) notifyError(error); else await invalidateMeeting(qc, meetingId);
  };
  return (
    <Group justify="space-between" align="flex-start" gap="sm" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
      <div style={{ minWidth: 200, flex: '1 1 240px' }}>
        <Text fw={600} fz="sm">{a.title}</Text>
        <Text fz="xs"><FileLink file={a.file} /> · {formatBytes(a.file.size_bytes)}</Text>
        {needsPdf && !a.view_pdf && <Text fz="xs" c="orange.9">{t('presentations.viewCopyMissing')}</Text>}
        {needsPdf && a.view_pdf && <Text fz="xs" fw={600} c="var(--mantine-color-green-light-color)">{t('presentations.viewCopyReady')}</Text>}
      </div>
      {canUpload && (
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <DownloadsSelect label={`${t('presentations.downloads')}: ${a.title}`} value={a.downloads_allowed} disabled={false} onChange={(v) => void update({ downloads_allowed: v })} />
          {needsPdf && (
            <UploadButton purpose="VIEW_PDF" targetId={a.id} accept=".pdf" buttonProps={{ size: 'xs', variant: 'light' }}
              label={a.view_pdf ? t('presentations.replacePdfCopy') : t('presentations.uploadPdfCopy')}
              onUploaded={() => invalidateMeeting(qc, meetingId)} />
          )}
          <ConfirmButton size="xs" variant="subtle" color="red" message={t('attachments.confirmRemove', { title: a.title })}
            onConfirm={async () => {
              try { await removeContent('attachment', a.id); await invalidateMeeting(qc, meetingId); notifySuccess(t('attachments.removed')); }
              catch (err) { notifyError(err); }
            }}>{t('attachments.remove')}</ConfirmButton>
        </Group>
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
export function SessionsPanel({ meeting, sessions, presentations, attachments, canEdit }: {
  meeting: Meeting;
  sessions: MeetingSession[];
  presentations: PresentationWithVersions[];
  attachments: Attachment[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const presenters = usePresenters(true);
  const rules = useUploadRules();
  const [editing, setEditing] = useState<MeetingSession | 'new' | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const accept = acceptFor(rules.data?.types ?? ['pdf']);
  const archived = meeting.status === 'ARCHIVED';
  const presenterOf = (s: MeetingSession) => presenters.data?.find((p) => p.id === s.presenter_id);
  const canUploadTo = (s: MeetingSession) => !archived && (canEdit || (presenterOf(s)?.user_id === me?.user_id && Boolean(me?.user_id)));

  const overlaps = (s: MeetingSession) => sessions.some((o) => o.id !== s.id && o.starts_at < s.ends_at && s.starts_at < o.ends_at);

  return (
    <Stack gap="lg">
      {rules.data && (
        <Text fz="sm" c="dimmed">
          {t('upload.allowedTypes', { types: rules.data.types.map((x) => x.toUpperCase()).join(', '), size: formatBytes(rules.data.maxFile) })}
        </Text>
      )}
      {sessions.length === 0 && <Alert color="blue">{t('sessions.none')}</Alert>}
      {sessions.map((s, i) => {
        const presenter = presenterOf(s);
        const sp = presentations.filter((p) => p.session_id === s.id);
        const sa = attachments.filter((a) => a.session_id === s.id);
        const upload = canUploadTo(s);
        return (
          <Card key={s.id} withBorder padding="lg" data-testid={`session-${i + 1}`}>
            <Group justify="space-between" align="flex-start" mb="sm">
              <div>
                <Text c="dimmed" fz="sm" fw={600}>{formatTime(s.starts_at)} – {formatTime(s.ends_at)}</Text>
                <Title order={3} fz="lg">{s.title}</Title>
                <Text fz="sm">{presenter ? `${presenter.full_name}${presenter.designation ? `, ${presenter.designation}` : ''}` : t('sessions.noPresenter')}</Text>
                {(s.starts_at < meeting.starts_at || s.ends_at > meeting.ends_at) && <Text fz="xs" c="orange.9">{t('sessions.outsideMeeting')}</Text>}
                {overlaps(s) && <Text fz="xs" c="orange.9">{t('sessions.overlaps')}</Text>}
              </div>
              {canEdit && !archived && (
                <Group gap="xs">
                  <Button size="xs" variant="light" onClick={() => setEditing(s)}>{t('common.edit')}</Button>
                  <ConfirmButton size="xs" variant="subtle" color="red" message={t('sessions.confirmDelete')}
                    onConfirm={async () => {
                      if (sp.length || sa.length) { notifyError(new Error(t('sessions.hasContent'))); return; }
                      const { error } = await supabase.from('meeting_sessions').delete().eq('id', s.id);
                      if (error) notifyError(error); else await invalidateMeeting(qc, meeting.id);
                    }}>{t('sessions.delete')}</ConfirmButton>
                </Group>
              )}
            </Group>

            <Stack gap="sm">
              {sp.map((p) => (
                <PresentationItem key={p.id} p={p} meetingId={meeting.id} canEditMeeting={canEdit && !archived} canUpload={upload} accept={accept} />
              ))}
              {upload && (
                <Group><Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => setAddingTo(s.id)}>{t('presentations.add')}</Button></Group>
              )}
            </Stack>

            <Divider my="md" label={t('attachments.title')} labelPosition="left" />
            {sa.length === 0 && <Text fz="sm" c="dimmed" mb="sm">{t('attachments.none')}</Text>}
            {sa.length > 0 && (
              <Stack gap={0} mb="sm">
                {sa.map((a) => <AttachmentRow key={a.id} a={a} meetingId={meeting.id} canUpload={upload} />)}
              </Stack>
            )}
            {upload && (
              <UploadButton purpose="ATTACHMENT" targetId={s.id} accept={accept} multiple label={t('attachments.add')}
                buttonProps={{ variant: 'default' }} testId={`attach-${i + 1}`} onUploaded={() => invalidateMeeting(qc, meeting.id)} />
            )}
          </Card>
        );
      })}
      {canEdit && !archived && (
        <Group><Button leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>{t('sessions.add')}</Button></Group>
      )}
      {editing && <SessionModal meeting={meeting} session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {addingTo && <NewPresentationModal sessionId={addingTo} meetingId={meeting.id} onClose={() => setAddingTo(null)} />}
    </Stack>
  );
}
