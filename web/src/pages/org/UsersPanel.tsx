import {
  ActionIcon, Alert, Badge, Button, Code, CopyButton, Group, Menu, Modal, Radio, ScrollArea, Stack, Switch, Table, Text, TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, type Role } from '../../auth/AuthProvider';
import { ActiveBadge } from '../../components/Badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { callFunction } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';

const STAFF_ROLES: Role[] = ['ORG_ADMIN', 'ORGANISER', 'PRESENTER'];

function TemporaryPassword({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened onClose={onClose} title={t('users.tempPasswordTitle')} centered closeOnClickOutside={false}>
      <Stack>
        <Text>{t('users.tempPasswordHelp', { name })}</Text>
        <Group wrap="nowrap">
          <Code fz="xl" p="sm" style={{ flex: 1, textAlign: 'center', letterSpacing: 2 }} data-testid="temp-password">{password}</Code>
          <CopyButton value={password}>
            {({ copied, copy }) => <Button variant="light" onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</Button>}
          </CopyButton>
        </Group>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </Stack>
    </Modal>
  );
}

function UserForm({ orgId, user, onClose, onCreated, allowedRoles }: {
  orgId: string;
  user: Profile | null;
  onClose: () => void;
  onCreated: (name: string, password: string) => void;
  allowedRoles: Role[];
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const isSelf = user?.user_id === me?.user_id;
  const form = useForm({
    initialValues: {
      full_name: user?.full_name ?? '',
      email: user?.email ?? '',
      designation: user?.designation ?? '',
      phone: user?.phone ?? '',
      role: (user?.role ?? allowedRoles[allowedRoles.length - 1]) as string,
      can_create_meetings: user?.can_create_meetings ?? true,
      can_view_participant_count: user?.can_view_participant_count ?? false,
    },
    validate: {
      full_name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      email: (v) => (user || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : t('common.invalidEmail')),
      phone: (v) => (!v || /^[0-9+()\- ]{6,20}$/.test(v) ? null : t('common.invalidPhone')),
    },
  });

  return (
    <Modal opened onClose={onClose} title={user ? t('users.editTitle') : t('users.add')} size="lg" centered>
      <form
        noValidate
        onSubmit={form.onSubmit(async (v) => {
          setBusy(true);
          try {
            const details = {
              full_name: v.full_name.trim(),
              designation: v.designation.trim() || null,
              phone: v.phone.trim() || null,
              role: v.role,
              can_create_meetings: v.can_create_meetings,
              can_view_participant_count: v.can_view_participant_count,
            };
            if (user) {
              await callFunction('manage-users', { action: 'update', user_id: user.user_id, ...details });
              notifySuccess(t('common.saved'));
              onClose();
            } else {
              const res = await callFunction<{ temporary_password: string }>('manage-users', {
                action: 'create', organisation_id: orgId, email: v.email.trim(), ...details,
              });
              notifySuccess(t('users.created'));
              onCreated(details.full_name, res.temporary_password);
            }
            await qc.invalidateQueries({ queryKey: ['users', orgId] });
            await qc.invalidateQueries({ queryKey: ['usage', orgId] });
          } catch (err) {
            notifyError(err);
          } finally {
            setBusy(false);
          }
        })}
      >
        <Stack>
          <TextInput label={t('users.fullName')} required {...form.getInputProps('full_name')} data-autofocus />
          <TextInput label={t('auth.email')} type="email" required={!user} disabled={Boolean(user)} {...form.getInputProps('email')} />
          <Group grow>
            <TextInput label={t('users.designation')} {...form.getInputProps('designation')} />
            <TextInput label={t('users.phone')} type="tel" {...form.getInputProps('phone')} />
          </Group>
          <Radio.Group label={t('users.role')} required {...form.getInputProps('role')}>
            <Stack mt="xs" gap="sm">
              {allowedRoles.map((r) => (
                <Radio key={r} value={r} disabled={isSelf && r !== user?.role} label={t(`roles.${r}`)} description={t(`users.roleHelp.${r}`)} />
              ))}
            </Stack>
          </Radio.Group>
          {form.values.role === 'ORGANISER' && (
            <Switch label={t('users.canCreateMeetings')} {...form.getInputProps('can_create_meetings', { type: 'checkbox' })} />
          )}
          {form.values.role === 'PRESENTER' && (
            <Switch label={t('users.canViewCount')} {...form.getInputProps('can_view_participant_count', { type: 'checkbox' })} />
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={busy}>{user ? t('common.saveChanges') : t('common.create')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Staff list and management for one organisation (Organisation Admin or Super Admin). */
export function UsersPanel({ orgId, readOnly, allowedRoles = STAFF_ROLES }: { orgId: string; readOnly: boolean; allowedRoles?: Role[] }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ user: Profile; action: 'deactivate' | 'activate' | 'reset_password' | 'reset_mfa' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users', orgId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('profiles').select('*').eq('organisation_id', orgId).order('full_name');
      if (err) throw err;
      return data as Profile[];
    },
  });

  const filtered = users.filter((u) =>
    !search || `${u.full_name} ${u.email} ${u.designation ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { user, action } = confirm;
      if (action === 'deactivate' || action === 'activate') {
        await callFunction('manage-users', { action: 'set_active', user_id: user.user_id, active: action === 'activate' });
        notifySuccess(action === 'activate' ? t('users.activated') : t('users.deactivated'));
      } else if (action === 'reset_password') {
        const res = await callFunction<{ temporary_password: string }>('manage-users', { action: 'reset_password', user_id: user.user_id });
        setTemp({ name: user.full_name, password: res.temporary_password });
      } else {
        await callFunction('manage-users', { action: 'reset_mfa', user_id: user.user_id });
        notifySuccess(t('users.mfaReset'));
      }
      await qc.invalidateQueries({ queryKey: ['users', orgId] });
      await qc.invalidateQueries({ queryKey: ['usage', orgId] });
      setConfirm(null);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmText = confirm && {
    deactivate: t('users.confirmDeactivate', { name: confirm.user.full_name }),
    activate: t('users.confirmActivate', { name: confirm.user.full_name }),
    reset_password: t('users.confirmResetPassword', { name: confirm.user.full_name }),
    reset_mfa: t('users.confirmResetMfa', { name: confirm.user.full_name }),
  }[confirm.action];

  return (
    <Stack>
      <Group justify="space-between">
        <TextInput placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
        {!readOnly && <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>{t('users.add')}</Button>}
      </Group>
      {error && <Alert color="red">{t('common.unknownError')}</Alert>}
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('users.fullName')}</Table.Th>
              <Table.Th>{t('users.role')}</Table.Th>
              <Table.Th>{t('auth.email')}</Table.Th>
              <Table.Th>{t('users.lastSignIn')}</Table.Th>
              <Table.Th>{t('common.status')}</Table.Th>
              <Table.Th><span className="sr-only">{t('common.actions')}</span></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && <Table.Tr><Table.Td colSpan={6}>{t('common.loading')}</Table.Td></Table.Tr>}
            {!isLoading && filtered.length === 0 && <Table.Tr><Table.Td colSpan={6}>{t('common.noRecords')}</Table.Td></Table.Tr>}
            {filtered.map((u) => {
              const self = u.user_id === me?.user_id;
              return (
                <Table.Tr key={u.user_id}>
                  <Table.Td>
                    <Text fw={600}>{u.full_name}{self && <Text span c="dimmed" fw={400}> ({t('users.you')})</Text>}</Text>
                    {u.designation && <Text fz="sm" c="dimmed">{u.designation}</Text>}
                  </Table.Td>
                  <Table.Td><Badge variant="light">{t(`roles.${u.role}`)}</Badge></Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : t('users.never')}</Table.Td>
                  <Table.Td><ActiveBadge active={u.is_active} /></Table.Td>
                  <Table.Td>
                    {!readOnly && (
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="lg" aria-label={`${t('common.actions')}: ${u.full_name}`}><IconDots /></ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => setEditing(u)}>{t('common.edit')}</Menu.Item>
                          {!self && <Menu.Item onClick={() => setConfirm({ user: u, action: 'reset_password' })}>{t('users.resetPassword')}</Menu.Item>}
                          <Menu.Item onClick={() => setConfirm({ user: u, action: 'reset_mfa' })}>{t('users.resetMfa')}</Menu.Item>
                          {!self && (u.is_active
                            ? <Menu.Item color="red" onClick={() => setConfirm({ user: u, action: 'deactivate' })}>{t('users.deactivate')}</Menu.Item>
                            : <Menu.Item onClick={() => setConfirm({ user: u, action: 'activate' })}>{t('users.activate')}</Menu.Item>)}
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {editing && (
        <UserForm
          orgId={orgId}
          user={editing === 'new' ? null : editing}
          allowedRoles={allowedRoles}
          onClose={() => setEditing(null)}
          onCreated={(name, password) => { setEditing(null); setTemp({ name, password }); }}
        />
      )}
      {temp && <TemporaryPassword name={temp.name} password={temp.password} onClose={() => setTemp(null)} />}
      <Modal opened={Boolean(confirm)} onClose={() => setConfirm(null)} title={t('common.confirm')} centered>
        <Text mb="lg">{confirmText}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button color={confirm?.action === 'deactivate' ? 'red' : undefined} loading={busy} onClick={() => void run()}>{t('common.confirm')}</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
