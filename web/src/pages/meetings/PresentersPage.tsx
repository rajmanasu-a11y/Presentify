import { Button, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { ActiveBadge } from '../../components/Badges';
import { PageHeader } from '../../components/PageHeader';
import { notifyError, notifySuccess } from '../../components/notify';
import { usePresenters, useStaff } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Presenter } from '../../lib/types';

export function PresenterModal({ presenter, onClose, onSaved }: { presenter: Presenter | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const staff = useStaff(me?.organisation?.id);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      full_name: presenter?.full_name ?? '', designation: presenter?.designation ?? '', office: presenter?.office ?? '',
      email: presenter?.email ?? '', phone: presenter?.phone ?? '', user_id: presenter?.user_id ?? '',
    },
    validate: {
      full_name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : t('common.invalidEmail')),
      phone: (v) => (!v || /^[0-9+()\- ]{6,20}$/.test(v) ? null : t('common.invalidPhone')),
    },
  });
  const logins = (staff.data ?? []).filter((p) => p.is_active && p.role === 'PRESENTER')
    .map((p) => ({ value: p.user_id, label: `${p.full_name} (${p.email})` }));
  return (
    <Modal opened onClose={onClose} title={presenter ? t('presenters.edit') : t('presenters.add')} size="lg" centered>
      <form noValidate onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const row = {
            full_name: v.full_name.trim(), designation: v.designation.trim() || null, office: v.office.trim() || null,
            email: v.email.trim() || null, phone: v.phone.trim() || null, user_id: v.user_id || null,
          };
          const { data, error } = presenter
            ? await supabase.from('presenters').update(row).eq('id', presenter.id).select('id').single()
            : await supabase.from('presenters').insert(row).select('id').single();
          if (error) throw error;
          await qc.invalidateQueries({ queryKey: ['presenters'] });
          notifySuccess(t('presenters.saved'));
          onSaved?.(data.id);
          onClose();
        } catch (err) { notifyError(err); } finally { setBusy(false); }
      })}>
        <Stack>
          <TextInput label={t('presenters.fullName')} required data-autofocus {...form.getInputProps('full_name')} />
          <Group grow>
            <TextInput label={t('presenters.designation')} {...form.getInputProps('designation')} />
            <TextInput label={t('presenters.office')} {...form.getInputProps('office')} />
          </Group>
          <Group grow>
            <TextInput label={t('presenters.email')} type="email" {...form.getInputProps('email')} />
            <TextInput label={t('presenters.phone')} type="tel" {...form.getInputProps('phone')} />
          </Group>
          <Select label={t('presenters.login')} description={t('presenters.loginHelp')} placeholder={t('presenters.noLogin')}
            data={logins} clearable searchable {...form.getInputProps('user_id')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={busy}>{t('common.save')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function PresentersPage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const qc = useQueryClient();
  const { data = [], isLoading } = usePresenters(true);
  const [editing, setEditing] = useState<Presenter | 'new' | null>(() => (new URLSearchParams(window.location.search).has('new') ? 'new' : null));
  const [search, setSearch] = useState('');
  const editable = can('PRESENTER_MANAGE') && !readOnly;
  const rows = data.filter((p) => !search || `${p.full_name} ${p.designation ?? ''} ${p.office ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader title={t('presenters.title')} intro={t('presenters.intro')}
        actions={editable && <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>{t('presenters.add')}</Button>} />
      <TextInput placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={300} mb="md" />
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={680}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('presenters.fullName')}</Table.Th><Table.Th>{t('presenters.office')}</Table.Th>
              <Table.Th>{t('presenters.login')}</Table.Th><Table.Th>{t('common.status')}</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && <Table.Tr><Table.Td colSpan={5}>{t('common.loading')}</Table.Td></Table.Tr>}
            {!isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={5}>{t('presenters.none')}</Table.Td></Table.Tr>}
            {rows.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td><Text fw={600}>{p.full_name}</Text>{p.designation && <Text fz="sm" c="dimmed">{p.designation}</Text>}</Table.Td>
                <Table.Td>{p.office ?? '—'}</Table.Td>
                <Table.Td>{p.user_id ? t('common.yes') : t('common.no')}</Table.Td>
                <Table.Td><ActiveBadge active={p.is_active} /></Table.Td>
                <Table.Td>
                  {editable && (
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(p)}>{t('common.edit')}</Button>
                      <Button size="xs" variant="subtle" color={p.is_active ? 'red' : undefined} onClick={async () => {
                        const { error } = await supabase.from('presenters').update({ is_active: !p.is_active }).eq('id', p.id);
                        if (error) notifyError(error); else await qc.invalidateQueries({ queryKey: ['presenters'] });
                      }}>{p.is_active ? t('presenters.deactivate') : t('presenters.activate')}</Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {editing && <PresenterModal presenter={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
