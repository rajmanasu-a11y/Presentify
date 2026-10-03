// Participants tab: who registered for the meeting and what they opened.
import { Alert, Badge, ScrollArea, SimpleGrid, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatCard } from '../../components/StatCard';
import { formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { AttendanceRow } from '../../lib/types';

type EventRow = { attendance_id: string | null; action: 'OPEN_MEETING' | 'VIEW' | 'DOWNLOAD' };

function useAttendance(meetingId: string) {
  return useQuery({
    queryKey: ['attendance', meetingId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [a, e] = await Promise.all([
        supabase.from('attendance').select('*').eq('meeting_id', meetingId).order('registered_at', { ascending: false }).limit(5000),
        supabase.from('access_events').select('attendance_id, action').eq('meeting_id', meetingId).in('action', ['VIEW', 'DOWNLOAD']).limit(50000),
      ]);
      if (a.error) throw a.error;
      if (e.error) throw e.error;
      return { rows: a.data as AttendanceRow[], events: e.data as EventRow[] };
    },
  });
}

export function ParticipantsPanel({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const q = useAttendance(meetingId);
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const m = new Map<string, { views: number; downloads: number }>();
    for (const e of q.data?.events ?? []) {
      if (!e.attendance_id) continue;
      const c = m.get(e.attendance_id) ?? { views: 0, downloads: 0 };
      if (e.action === 'VIEW') c.views++; else c.downloads++;
      m.set(e.attendance_id, c);
    }
    return m;
  }, [q.data]);

  if (q.isLoading) return <Text>{t('common.loading')}</Text>;
  if (q.error || !q.data) return <Alert color="red">{t('common.unknownError')}</Alert>;

  const rows = q.data.rows;
  const term = search.trim().toLowerCase();
  const shown = term ? rows.filter((r) => Object.values(r.details).some((v) => String(v).toLowerCase().includes(term))) : rows;
  const registered = rows.filter((r) => !r.anonymous).length;
  const anonymous = rows.length - registered;
  const views = q.data.events.filter((e) => e.action === 'VIEW').length;
  const downloads = q.data.events.length - views;
  const contact = (r: AttendanceRow) => [r.details.mobile, r.details.email].filter(Boolean).join(' · ');

  return (
    <>
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg">
        <StatCard label={t('attendance.registered')} value={registered} />
        <StatCard label={t('attendance.anonymous')} value={anonymous} />
        <StatCard label={t('attendance.views')} value={views} />
        <StatCard label={t('attendance.downloads')} value={downloads} />
      </SimpleGrid>
      <TextInput label={t('common.search')} placeholder={t('attendance.searchPlaceholder')} value={search}
        onChange={(e) => setSearch(e.currentTarget.value)} maw={360} mb="md" />
      {rows.length === 0 ? (
        <Text c="dimmed">{t('attendance.none')}</Text>
      ) : (
        <ScrollArea>
          <Table striped withTableBorder miw={760} aria-label={t('attendance.title')}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('attendance.name')}</Table.Th>
                <Table.Th>{t('attendance.designation')}</Table.Th>
                <Table.Th>{t('attendance.organisation')}</Table.Th>
                <Table.Th>{t('attendance.contact')}</Table.Th>
                <Table.Th>{t('attendance.registeredAt')}</Table.Th>
                <Table.Th>{t('attendance.lastSeen')}</Table.Th>
                <Table.Th>{t('attendance.opened')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((r) => {
                const c = counts.get(r.id);
                return (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      {r.anonymous ? <Badge color="gray" variant="light">{t('attendance.anonymousBadge')}</Badge>
                        : r.anonymised_at ? <Badge color="gray" variant="light">{t('attendance.removedBadge')}</Badge>
                        : r.details.name}
                    </Table.Td>
                    <Table.Td>{r.details.designation ?? ''}</Table.Td>
                    <Table.Td>{r.details.organisation ?? ''}</Table.Td>
                    <Table.Td>{contact(r)}</Table.Td>
                    <Table.Td>{formatDateTime(r.registered_at)}</Table.Td>
                    <Table.Td>{formatDateTime(r.last_access_at)}</Table.Td>
                    <Table.Td>{t('attendance.openedCount', { views: c?.views ?? 0, downloads: c?.downloads ?? 0 })}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Text fz="sm" c="dimmed" mt="md">{t('attendance.privacyNote')}</Text>
    </>
  );
}
