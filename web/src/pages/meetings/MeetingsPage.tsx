import { Anchor, Badge, Button, Group, ScrollArea, SegmentedControl, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatTime } from '../../lib/format';
import { useMeetings, type MeetingFilter } from '../../lib/meetingsApi';
import { meetingPhase, type MeetingPhase } from '../../lib/types';
import { NewMeetingModal } from './MeetingForm';

const phaseColor: Record<MeetingPhase, string> = {
  DRAFT: 'gray', SCHEDULED: 'blue', ACTIVE: 'green', COMPLETED: 'navy', ARCHIVED: 'gray',
};

export function PhaseBadge({ phase }: { phase: MeetingPhase }) {
  const { t } = useTranslation();
  return <Badge variant="light" color={phaseColor[phase]} size="lg">{t(`phase.${phase}`)}</Badge>;
}

export function MeetingsPage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const [filter, setFilter] = useState<MeetingFilter>('upcoming');
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [creating, setCreating] = useState(() => new URLSearchParams(window.location.search).has('new'));
  const { data = [], isLoading } = useMeetings(filter, debounced);

  return (
    <>
      <PageHeader
        title={t('meetings.title')}
        intro={t('meetings.intro')}
        actions={can('MEETING_MANAGE') && !readOnly && (
          <Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>{t('meetings.new')}</Button>
        )}
      />
      <Group mb="md" justify="space-between">
        <ScrollArea type="never" maw="100%">
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as MeetingFilter)}
            data={[
              { value: 'upcoming', label: t('meetings.filterUpcoming') },
              { value: 'today', label: t('meetings.filterToday') },
              { value: 'past', label: t('meetings.filterPast') },
              { value: 'drafts', label: t('meetings.filterDrafts') },
              { value: 'archived', label: t('meetings.filterArchived') },
              { value: 'all', label: t('meetings.filterAll') },
            ]}
          />
        </ScrollArea>
        <TextInput placeholder={t('meetings.searchPlaceholder')} aria-label={t('common.search')} value={search}
          onChange={(e) => setSearch(e.currentTarget.value)} w={320} />
      </Group>
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('meetings.titleField')}</Table.Th>
              <Table.Th>{t('meetings.when')}</Table.Th>
              <Table.Th>{t('meetings.venue')}</Table.Th>
              <Table.Th>{t('meetings.sessionsCount')}</Table.Th>
              <Table.Th>{t('meetings.status')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && <Table.Tr><Table.Td colSpan={5}>{t('common.loading')}</Table.Td></Table.Tr>}
            {!isLoading && data.length === 0 && <Table.Tr><Table.Td colSpan={5}>{t('meetings.noMeetings')}</Table.Td></Table.Tr>}
            {data.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/meetings/${m.id}`} fw={600}>{m.title}</Anchor>
                  <Text fz="xs" c="dimmed">{m.reference_no}</Text>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(m.starts_at)}<Text fz="sm" c="dimmed">{formatTime(m.starts_at)} – {formatTime(m.ends_at)}</Text>
                </Table.Td>
                <Table.Td>{m.venue ?? '—'}</Table.Td>
                <Table.Td>{m.meeting_sessions[0]?.count ?? 0}</Table.Td>
                <Table.Td><PhaseBadge phase={meetingPhase(m)} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {creating && <NewMeetingModal onClose={() => setCreating(false)} />}
    </>
  );
}
