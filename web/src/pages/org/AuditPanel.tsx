import { Badge, Button, Code, Group, Popover, ScrollArea, Select, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { AuditRow, LoginEvent } from '../../lib/types';

const PAGE = 50;

function Changes({ details }: { details: Record<string, unknown> | null }) {
  const { t } = useTranslation();
  if (!details || Object.keys(details).length === 0) return null;
  return (
    <Popover width={420} position="bottom-end" withArrow shadow="md">
      <Popover.Target><Button size="xs" variant="subtle">{t('audit.changes')}</Button></Popover.Target>
      <Popover.Dropdown>
        <ScrollArea.Autosize mah={320}>
          <Code block fz="xs">{JSON.stringify(details, null, 2)}</Code>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

function dayStart(d: string) { return d ? new Date(`${d}T00:00:00+05:30`).toISOString() : null; }
function dayEnd(d: string) { return d ? new Date(`${d}T23:59:59.999+05:30`).toISOString() : null; }

/** Audit log and sign-in activity; RLS limits rows to what the viewer may see. */
export function AuditPanel({ orgId, organisations }: { orgId?: string; organisations?: { value: string; label: string }[] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [org, setOrg] = useState<string | null>(orgId ?? null);

  const activity = useQuery({
    queryKey: ['audit', org, action, from, to, page],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*').order('occurred_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
      if (org) q = q.eq('organisation_id', org);
      if (action) q = q.eq('action', action);
      if (from) q = q.gte('occurred_at', dayStart(from)!);
      if (to) q = q.lte('occurred_at', dayEnd(to)!);
      const { data, error } = await q;
      if (error) throw error;
      return data as AuditRow[];
    },
  });

  const logins = useQuery({
    queryKey: ['login-events', org, from, to],
    queryFn: async () => {
      let q = supabase.from('login_events').select('*').order('occurred_at', { ascending: false }).limit(200);
      if (org) q = q.eq('organisation_id', org);
      if (from) q = q.gte('occurred_at', dayStart(from)!);
      if (to) q = q.lte('occurred_at', dayEnd(to)!);
      const { data, error } = await q;
      if (error) throw error;
      return data as LoginEvent[];
    },
  });

  const rows = activity.data ?? [];
  const actions = ['ORGANISATION_CREATED', 'ORGANISATION_UPDATED', 'ORGANISATION_SETTINGS_UPDATED', 'USER_CREATED', 'USER_UPDATED',
    'USER_PASSWORD_RESET', 'USER_MFA_RESET', 'PACKAGE_CREATED', 'PACKAGE_UPDATED', 'SYSTEM_SETTING_UPDATED'];

  return (
    <Stack>
      <Group align="flex-end" wrap="wrap">
        {organisations && (
          <Select label={t('users.organisation')} data={organisations} value={org} onChange={(v) => { setOrg(v); setPage(0); }} clearable searchable w={260} />
        )}
        <TextInput type="date" label={t('audit.from')} value={from} onChange={(e) => { setFrom(e.currentTarget.value); setPage(0); }} />
        <TextInput type="date" label={t('audit.to')} value={to} onChange={(e) => { setTo(e.currentTarget.value); setPage(0); }} />
      </Group>
      <Tabs defaultValue="activity" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="activity">{t('audit.activityTab')}</Tabs.Tab>
          <Tabs.Tab value="signin">{t('audit.signInTab')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="activity" pt="md">
          <Select
            label={t('audit.filterAction')} data={actions} value={action} onChange={(v) => { setAction(v); setPage(0); }} clearable w={320} mb="md"
          />
          <ScrollArea>
            <Table striped verticalSpacing="xs" miw={820}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('audit.when')}</Table.Th>
                  <Table.Th>{t('audit.who')}</Table.Th>
                  <Table.Th>{t('audit.action')}</Table.Th>
                  <Table.Th>{t('audit.record')}</Table.Th>
                  <Table.Th>{t('audit.ip')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {activity.isLoading && <Table.Tr><Table.Td colSpan={6}>{t('common.loading')}</Table.Td></Table.Tr>}
                {!activity.isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={6}>{t('common.noRecords')}</Table.Td></Table.Tr>}
                {rows.slice(0, PAGE).map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.occurred_at)}</Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={600}>{r.actor_name ?? t('audit.system')}</Text>
                      {r.actor_role && <Text fz="xs" c="dimmed">{t(`roles.${r.actor_role}`, { defaultValue: r.actor_role })}</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color="gray">{r.action}</Badge>
                      {r.summary && <Text fz="sm" mt={4}>{r.summary}</Text>}
                    </Table.Td>
                    <Table.Td><Text fz="sm">{r.entity_type}</Text></Table.Td>
                    <Table.Td><Text fz="sm">{r.ip ?? '—'}</Text></Table.Td>
                    <Table.Td><Changes details={r.details} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group justify="space-between" mt="md">
            <Button variant="default" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</Button>
            <Text fz="sm">{t('common.page', { page: page + 1 })}</Text>
            <Button variant="default" disabled={rows.length <= PAGE} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</Button>
          </Group>
        </Tabs.Panel>
        <Tabs.Panel value="signin" pt="md">
          <ScrollArea>
            <Table striped verticalSpacing="xs" miw={560}>
              <Table.Thead>
                <Table.Tr><Table.Th>{t('audit.when')}</Table.Th><Table.Th>{t('auth.email')}</Table.Th><Table.Th>{t('audit.event')}</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(logins.data ?? []).length === 0 && <Table.Tr><Table.Td colSpan={3}>{t('common.noRecords')}</Table.Td></Table.Tr>}
                {(logins.data ?? []).map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{formatDateTime(e.occurred_at)}</Table.Td>
                    <Table.Td>{e.email ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={/FAILED|LOCKED|BLOCKED/.test(e.event) ? 'red' : 'green'}>
                        {t(`audit.events.${e.event}`, { defaultValue: e.event })}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
