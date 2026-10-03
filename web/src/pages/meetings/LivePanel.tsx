// "Live" strip on the meeting page while a meeting is on: participants active now,
// total registered, current session and presenter. Refreshes every 5 seconds.
import { Badge, Card, Group, SimpleGrid, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../lib/format';
import { schedule, useLiveStats, useNow } from '../../lib/live';
import { usePresenters } from '../../lib/meetingsApi';
import type { Meeting, MeetingSession } from '../../lib/types';

export function LivePanel({ meeting, sessions }: { meeting: Meeting; sessions: MeetingSession[] }) {
  const { t } = useTranslation();
  const now = useNow(15_000);
  const live = useLiveStats(meeting.id, meeting.status === 'PUBLISHED');
  const presenters = usePresenters(true);
  if (meeting.status !== 'PUBLISHED' || !live.data) return null;
  const s = schedule(sessions, now);
  const presenter = presenters.data?.find((p) => p.id === s.current?.presenter_id);
  const sessionText = s.current
    ? s.current.title
    : s.phase === 'before' ? t('live.notStarted') : s.phase === 'between' ? t('live.break') : t('live.finished');

  return (
    <Card withBorder padding="md" mb="lg" data-testid="live-panel" aria-live="polite">
      <Group gap="xs" mb="sm">
        <Badge color="red" variant="light">{t('live.title')}</Badge>
        <Text fz="sm" c="dimmed">{t('live.refreshes')}</Text>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <div>
          <Text fz="sm" c="dimmed" fw={600}>{t('live.activeNow')}</Text>
          <Text fz={28} fw={700} data-testid="live-active">{live.data.active_now}</Text>
        </div>
        <div>
          <Text fz="sm" c="dimmed" fw={600}>{t('live.total')}</Text>
          <Text fz={28} fw={700} data-testid="live-total">{live.data.total}</Text>
        </div>
        <div>
          <Text fz="sm" c="dimmed" fw={600}>{t('live.currentSession')}</Text>
          <Text fw={700}>{sessionText}</Text>
          {s.current && <Text fz="sm">{formatTime(s.current.starts_at)} – {formatTime(s.current.ends_at)}</Text>}
        </div>
        <div>
          <Text fz="sm" c="dimmed" fw={600}>{t('live.presenter')}</Text>
          <Text fw={700}>{presenter ? presenter.full_name : '—'}</Text>
          {presenter?.designation && <Text fz="sm">{presenter.designation}</Text>}
        </div>
      </SimpleGrid>
    </Card>
  );
}
