import { Alert, Anchor, Button, Card, Group, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconBuilding, IconCalendarPlus, IconClipboardList, IconUpload, IconUsers, IconUserStar } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { AccessBadge } from '../../components/Badges';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { formatBytes, formatDate, formatTime } from '../../lib/format';
import { useMeetings, type MeetingRow } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import { meetingPhase, type Usage } from '../../lib/types';
import { PhaseBadge } from '../meetings/MeetingsPage';
import { useRecentPresentations } from '../meetings/PresentationsPage';
import { AuditPanel } from './AuditPanel';
import { OrganisationProfileForm, OrganisationSettingsForm, useOrganisation } from './OrganisationForms';
import { UsersPanel } from './UsersPanel';

export function useUsage(orgId: string | undefined) {
  return useQuery({
    queryKey: ['usage', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('organisation_usage', { p_org: orgId });
      if (error) throw error;
      return data as Usage;
    },
  });
}

export function UsageCards({ usage }: { usage: Usage }) {
  const { t } = useTranslation();
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
      <StatCard label={t('dashboard.meetings')} value={usage.meetings}
        hint={t('dashboard.usedOf', { used: usage.meetings, limit: usage.limits.max_meetings })} percent={pct(usage.meetings, usage.limits.max_meetings)} />
      <StatCard label={t('dashboard.presentations')} value={usage.presentations}
        hint={t('dashboard.usedOf', { used: usage.presentations, limit: usage.limits.max_presentations })}
        percent={pct(usage.presentations, usage.limits.max_presentations)} />
      <StatCard label={t('dashboard.storage')} value={formatBytes(usage.storage_bytes)}
        hint={t('dashboard.usedOf', { used: formatBytes(usage.storage_bytes), limit: formatBytes(usage.limits.storage_bytes) })}
        percent={pct(usage.storage_bytes, usage.limits.storage_bytes)} />
      <StatCard label={t('dashboard.users')} value={usage.users}
        hint={t('dashboard.usedOf', { used: usage.users, limit: usage.limits.max_users })} percent={pct(usage.users, usage.limits.max_users)} />
      <StatCard label={t('dashboard.admins')} value={usage.admins}
        hint={t('dashboard.usedOf', { used: usage.admins, limit: usage.limits.max_admins })} percent={pct(usage.admins, usage.limits.max_admins)} />
    </SimpleGrid>
  );
}

function MeetingList({ title, empty, rows }: { title: string; empty: string; rows: MeetingRow[] }) {
  return (
    <Card withBorder padding="lg">
      <Title order={2} fz="lg" mb="sm">{title}</Title>
      {rows.length === 0 ? <Text c="dimmed">{empty}</Text> : (
        <Stack gap="sm">
          {rows.map((m) => (
            <Group key={m.id} justify="space-between" wrap="nowrap" gap="sm">
              <div style={{ minWidth: 0 }}>
                <Anchor component={Link} to={`/meetings/${m.id}`} fw={600}>{m.title}</Anchor>
                <Text fz="sm" c="dimmed">{formatDate(m.starts_at)} · {formatTime(m.starts_at)} – {formatTime(m.ends_at)}{m.venue ? ` · ${m.venue}` : ''}</Text>
              </div>
              <PhaseBadge phase={meetingPhase(m)} />
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

export function OrgDashboardPage() {
  const { t } = useTranslation();
  const { me, can, readOnly } = useAuth();
  const orgId = me?.organisation?.id;
  const showUsage = can('USER_MANAGE') || can('ORG_PROFILE_EDIT') || can('MEETING_MANAGE');
  const usage = useUsage(showUsage ? orgId : undefined);
  const today = useMeetings('today', '');
  const upcoming = useMeetings('upcoming', '');
  const recent = useRecentPresentations(6);
  const pkg = useQuery({
    queryKey: ['my-package', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.from('organisations').select('expires_at, packages(name)').eq('id', orgId!).single();
      if (error) throw error;
      return data as unknown as { expires_at: string | null; packages: { name: string } | null };
    },
  });

  const todayIds = new Set((today.data ?? []).map((m) => m.id));
  const actions = [
    can('MEETING_MANAGE') && !readOnly && { to: '/meetings?new=1', label: t('dashboard.createMeeting'), icon: <IconCalendarPlus size={26} /> },
    can('CONTENT_UPLOAD') && { to: '/meetings', label: t('dashboard.uploadPresentation'), icon: <IconUpload size={26} /> },
    can('PRESENTER_MANAGE') && !readOnly && { to: '/presenters?new=1', label: t('dashboard.addPresenter'), icon: <IconUserStar size={26} /> },
    can('USER_MANAGE') && { to: '/users', label: t('dashboard.manageUsers'), icon: <IconUsers size={26} /> },
    can('ORG_PROFILE_EDIT') && { to: '/organisation', label: t('dashboard.editOrganisation'), icon: <IconBuilding size={26} /> },
    can('AUDIT_VIEW') && { to: '/audit', label: t('dashboard.viewAudit'), icon: <IconClipboardList size={26} /> },
  ].filter(Boolean) as { to: string; label: string; icon: ReactNode }[];

  return (
    <>
      <PageHeader title={t('dashboard.welcome', { name: me?.full_name ?? '' })} intro={t('dashboard.intro')} />
      <Stack gap="xl">
        {actions.length > 0 && (
          <div>
            <Title order={2} fz="lg" mb="sm">{t('dashboard.quickActions')}</Title>
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
              {actions.map((a) => (
                <Button key={a.to} component={Link} to={a.to} variant="light" size="xl" h="auto" mih={84} py="sm"
                  leftSection={a.icon} justify="flex-start" styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.35 } }}>
                  {a.label}
                </Button>
              ))}
            </SimpleGrid>
          </div>
        )}
        {can('MEETING_VIEW') && (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <MeetingList title={t('dashboard.today')} empty={t('dashboard.noneToday')} rows={today.data ?? []} />
            <MeetingList title={t('dashboard.upcoming')} empty={t('dashboard.noneUpcoming')}
              rows={(upcoming.data ?? []).filter((m) => !todayIds.has(m.id)).slice(0, 5)} />
          </SimpleGrid>
        )}
        {can('MEETING_VIEW') && (recent.data ?? []).length > 0 && (
          <Card withBorder padding="lg">
            <Title order={2} fz="lg" mb="sm">{t('dashboard.recentPresentations')}</Title>
            <Stack gap="xs">
              {(recent.data ?? []).map((p) => (
                <Group key={p.id} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{p.title}</Text>
                    <Anchor component={Link} to={`/meetings/${p.session.meeting.id}`} fz="sm">{p.session.meeting.title}</Anchor>
                  </div>
                  <Text fz="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{formatDate(p.updated_at)}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        )}
        {usage.data && <UsageCards usage={usage.data} />}
        {pkg.data && me?.organisation && (
          <Card withBorder padding="lg">
            <Title order={2} fz="lg" mb="sm">{t('dashboard.subscription')}</Title>
            <Group gap="xl">
              <div><Text c="dimmed" fz="sm">{t('dashboard.package')}</Text><Text fw={600}>{pkg.data.packages?.name ?? '—'}</Text></div>
              <div><Text c="dimmed" fz="sm">{t('dashboard.expires')}</Text>
                <Text fw={600}>{pkg.data.expires_at ? formatDate(pkg.data.expires_at) : t('dashboard.noExpiry')}</Text></div>
              <AccessBadge access={me.organisation.access} />
            </Group>
          </Card>
        )}
      </Stack>
    </>
  );
}

export function OrganisationPage() {
  const { t } = useTranslation();
  const { me, readOnly } = useAuth();
  const { data, isLoading, error } = useOrganisation(me?.organisation?.id);
  if (isLoading) return <Text>{t('common.loading')}</Text>;
  if (error || !data) return <Alert color="red">{t('common.unknownError')}</Alert>;
  return (
    <>
      <PageHeader title={t('org.title')} intro={data.org.name} />
      {readOnly && <Alert color="orange" mb="md">{t('org.readOnlyNotice')}</Alert>}
      <Tabs defaultValue="profile" keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="profile">{t('org.profileTab')}</Tabs.Tab>
          <Tabs.Tab value="participants">{t('org.participantsTab')}</Tabs.Tab>
          <Tabs.Tab value="files">{t('org.filesTab')}</Tabs.Tab>
          <Tabs.Tab value="security">{t('org.securityTab')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="profile"><OrganisationProfileForm org={data.org} settings={data.settings} disabled={readOnly} /></Tabs.Panel>
        {(['participants', 'files', 'security'] as const).map((s) => (
          <Tabs.Panel key={s} value={s}>
            <OrganisationSettingsForm settings={data.settings} section={s} maxRetentionDays={data.limits.max_retention_days} disabled={readOnly} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const { me, readOnly } = useAuth();
  if (!me?.organisation) return null;
  return (
    <>
      <PageHeader title={t('users.title')} intro={t('users.intro')} />
      <UsersPanel orgId={me.organisation.id} readOnly={readOnly} />
    </>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  return (
    <>
      <PageHeader title={t('audit.title')} intro={t('audit.intro')} />
      <AuditPanel orgId={me?.organisation?.id} />
    </>
  );
}
