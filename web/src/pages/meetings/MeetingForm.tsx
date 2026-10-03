import { Button, Grid, Group, Select, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { notifyError, notifySuccess } from '../../components/notify';
import { fromIstParts, toIstParts, todayIst } from '../../lib/format';
import { invalidateMeeting, useStaff } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Meeting } from '../../lib/types';

/** Create a meeting (wizard step 1) or edit its details. */
export function MeetingDetailsForm({ meeting, onDone, onSaved, disabled, submitLabel }: {
  meeting: Meeting | null;
  onDone?: () => void;
  /** Called with the meeting id after saving (instead of opening the meeting page). */
  onSaved?: (id: string) => void;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const staff = useStaff(me?.organisation?.id);
  const start = toIstParts(meeting?.starts_at);
  const end = toIstParts(meeting?.ends_at);
  const form = useForm({
    initialValues: {
      title: meeting?.title ?? '',
      reference_no: meeting?.reference_no ?? '',
      date: start.date || todayIst(),
      start_time: start.time || '10:00',
      end_time: end.time || '13:00',
      venue: meeting?.venue ?? '',
      organiser_user_id: meeting?.organiser_user_id ?? me?.user_id ?? '',
      chairperson: meeting?.chairperson ?? '',
      unit_label: meeting?.unit_label ?? '',
      description: meeting?.description ?? '',
    },
    validate: {
      title: (v) => (v.trim().length >= 3 ? null : t('common.required')),
      date: (v) => (v ? null : t('common.required')),
      start_time: (v) => (v ? null : t('common.required')),
      end_time: (v, values) => (!v ? t('common.required') : v <= values.start_time ? t('meetings.endBeforeStart') : null),
    },
  });

  const organisers = (staff.data ?? [])
    .filter((p) => p.is_active && (p.role === 'ORG_ADMIN' || p.role === 'ORGANISER'))
    .map((p) => ({ value: p.user_id, label: `${p.full_name}${p.designation ? `, ${p.designation}` : ''}` }));

  return (
    <form
      noValidate
      onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const row = {
            title: v.title.trim(),
            reference_no: v.reference_no.trim() || null,
            starts_at: fromIstParts(v.date, v.start_time),
            ends_at: fromIstParts(v.date, v.end_time),
            venue: v.venue.trim() || null,
            chairperson: v.chairperson.trim() || null,
            unit_label: v.unit_label.trim() || null,
            description: v.description.trim() || null,
            ...(me?.role === 'ORG_ADMIN' && v.organiser_user_id ? { organiser_user_id: v.organiser_user_id } : {}),
          };
          if (meeting) {
            const { error } = await supabase.from('meetings').update(row).eq('id', meeting.id);
            if (error) throw error;
            await invalidateMeeting(qc, meeting.id);
            notifySuccess(t('common.saved'));
            if (onSaved) onSaved(meeting.id); else onDone?.();
          } else {
            const { data, error } = await supabase.from('meetings').insert(row).select('id').single();
            if (error) throw error;
            await qc.invalidateQueries({ queryKey: ['meetings'] });
            notifySuccess(t('meetings.created'));
            if (onSaved) onSaved(data.id); else navigate(`/meetings/${data.id}?tab=sessions`);
          }
        } catch (err) {
          notifyError(err);
        } finally {
          setBusy(false);
        }
      })}
    >
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
        <Grid>
          <Grid.Col span={12}><TextInput label={t('meetings.titleField')} required data-autofocus {...form.getInputProps('title')} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}><TextInput type="date" label={t('meetings.date')} required {...form.getInputProps('date')} /></Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4 }}><TextInput type="time" label={t('meetings.startTime')} required {...form.getInputProps('start_time')} /></Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4 }}><TextInput type="time" label={t('meetings.endTime')} required {...form.getInputProps('end_time')} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label={t('meetings.venue')} {...form.getInputProps('venue')} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput label={t('meetings.reference')} description={meeting ? undefined : t('meetings.referenceHelp')} {...form.getInputProps('reference_no')} />
          </Grid.Col>
          {me?.role === 'ORG_ADMIN' && (
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select label={t('meetings.organiser')} data={organisers} searchable allowDeselect={false} {...form.getInputProps('organiser_user_id')} />
            </Grid.Col>
          )}
          <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label={t('meetings.chairperson')} {...form.getInputProps('chairperson')} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label={t('meetings.unit')} {...form.getInputProps('unit_label')} /></Grid.Col>
          <Grid.Col span={12}><Textarea label={t('meetings.description')} {...form.getInputProps('description')} /></Grid.Col>
        </Grid>
        <Group justify="flex-end" mt="lg">
          {onDone && !meeting && <Button variant="default" onClick={onDone}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={busy}>{submitLabel ?? (meeting ? t('common.saveChanges') : t('common.create'))}</Button>
        </Group>
      </fieldset>
    </form>
  );
}
