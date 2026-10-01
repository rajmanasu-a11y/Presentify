import {
  Alert, Anchor, Badge, Button, Card, Grid, Group, Modal, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text,
  TextInput, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import type { OrgAccess } from '../../auth/AuthProvider';
import { AccessBadge } from '../../components/Badges';
import { ConfirmButton } from '../../components/ConfirmButton';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { notifyError, notifySuccess } from '../../components/notify';
import { endOfDayIso, formatBytes, formatDate, GB, MB, toDateInput } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Organisation, Package } from '../../lib/types';
import { AuditPanel } from '../org/AuditPanel';
import { OrganisationProfileForm, OrganisationSettingsForm, useOrganisation } from '../org/OrganisationForms';
import { UsageCards, useUsage } from '../org/OrgPages';
import { UsersPanel } from '../org/UsersPanel';

type OrgRow = Organisation & { packages: { name: string } | null; profiles: { role: string; is_active: boolean }[] };

/** Same rule as the database (app.org_access), for display only. */
function accessOf(o: Pick<Organisation, 'status' | 'expires_at' | 'grace_days'>): OrgAccess {
  if (o.status === 'INACTIVE') return 'INACTIVE';
  if (!o.expires_at || Date.now() < new Date(o.expires_at).getTime()) return 'ACTIVE';
  if (Date.now() < new Date(o.expires_at).getTime() + o.grace_days * 86400000) return 'GRACE';
  return 'READ_ONLY';
}

function useOrganisations() {
  return useQuery({
    queryKey: ['organisations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('organisations').select('*, packages(name), profiles(role, is_active)').order('name');
      if (error) throw error;
      return data as unknown as OrgRow[];
    },
  });
}

function usePackages() {
  return useQuery({
    queryKey: ['packages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('packages').select('*').order('storage_bytes');
      if (error) throw error;
      return data as Package[];
    },
  });
}

// ---------------------------------------------------------------------------
export function ConsoleDashboardPage() {
  const { t } = useTranslation();
  const { data: orgs = [] } = useOrganisations();
  const soon = Date.now() + 30 * 86400000;
  const expiring = orgs.filter((o) => o.status === 'ACTIVE' && o.expires_at && new Date(o.expires_at).getTime() < soon);
  const staff = orgs.reduce((n, o) => n + o.profiles.filter((p) => p.is_active).length, 0);
  return (
    <>
      <PageHeader title={t('console.title')} intro={t('console.intro')}
        actions={<Button component={Link} to="/console/organisations?new=1" leftSection={<IconPlus size={18} />}>{t('console.newOrganisation')}</Button>} />
      <Stack gap="xl">
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
          <StatCard label={t('console.totalOrgs')} value={orgs.length} />
          <StatCard label={t('console.activeOrgs')} value={orgs.filter((o) => accessOf(o) === 'ACTIVE').length} />
          <StatCard label={t('console.expiringSoon')} value={expiring.length} />
          <StatCard label={t('dashboard.users')} value={staff} />
        </SimpleGrid>
        <Card withBorder padding="lg">
          <Title order={2} fz="lg" mb="sm">{t('console.expiringList')}</Title>
          {expiring.length === 0 ? <Text c="dimmed">{t('common.noRecords')}</Text> : (
            <Stack gap="xs">
              {expiring.map((o) => (
                <Group key={o.id} justify="space-between">
                  <Anchor component={Link} to={`/console/organisations/${o.id}`}>{o.name}</Anchor>
                  <Group gap="sm"><Text>{formatDate(o.expires_at)}</Text><AccessBadge access={accessOf(o)} /></Group>
                </Group>
              ))}
            </Stack>
          )}
        </Card>
      </Stack>
    </>
  );
}

// ---------------------------------------------------------------------------
function NewOrganisationModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: packages = [] } = usePackages();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { name: '', short_name: '', package_id: '', expires_on: '', contact_email: '' },
    validate: {
      name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      package_id: (v) => (v ? null : t('common.required')),
      contact_email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : t('common.invalidEmail')),
    },
  });
  return (
    <Modal opened onClose={onClose} title={t('console.newOrganisation')} size="lg" centered>
      <form
        noValidate
        onSubmit={form.onSubmit(async (v) => {
          setBusy(true);
          try {
            const { data, error } = await supabase.from('organisations').insert({
              name: v.name.trim(), short_name: v.short_name.trim() || null, package_id: v.package_id,
              expires_at: v.expires_on ? endOfDayIso(v.expires_on) : null, contact_email: v.contact_email.trim() || null,
            }).select('id').single();
            if (error) throw error;
            await qc.invalidateQueries({ queryKey: ['organisations'] });
            notifySuccess(t('console.orgCreated'));
            navigate(`/console/organisations/${data.id}?tab=staff`);
          } catch (err) {
            notifyError(err);
          } finally {
            setBusy(false);
          }
        })}
      >
        <Stack>
          <TextInput label={t('org.name')} required data-autofocus {...form.getInputProps('name')} />
          <TextInput label={t('org.shortName')} maxLength={30} {...form.getInputProps('short_name')} />
          <Select label={t('console.package')} required data={packages.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name }))} {...form.getInputProps('package_id')} />
          <TextInput type="date" label={t('console.expiresAt')} description={t('console.noExpiry')} {...form.getInputProps('expires_on')} />
          <TextInput type="email" label={t('org.contactEmail')} {...form.getInputProps('contact_email')} />
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" loading={busy}>{t('common.create')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function OrganisationsPage() {
  const { t } = useTranslation();
  const { data: orgs = [], isLoading } = useOrganisations();
  const [creating, setCreating] = useState(() => new URLSearchParams(window.location.search).has('new'));
  const [search, setSearch] = useState('');
  const rows = orgs.filter((o) => !search || o.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader title={t('console.organisations')}
        actions={<Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>{t('console.newOrganisation')}</Button>} />
      <TextInput placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={300} mb="md" />
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('org.name')}</Table.Th><Table.Th>{t('console.package')}</Table.Th><Table.Th>{t('console.admins')}</Table.Th>
              <Table.Th>{t('console.users')}</Table.Th><Table.Th>{t('console.expires')}</Table.Th><Table.Th>{t('common.status')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && <Table.Tr><Table.Td colSpan={6}>{t('common.loading')}</Table.Td></Table.Tr>}
            {!isLoading && rows.length === 0 && <Table.Tr><Table.Td colSpan={6}>{t('common.noRecords')}</Table.Td></Table.Tr>}
            {rows.map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td><Anchor component={Link} to={`/console/organisations/${o.id}`} fw={600}>{o.name}</Anchor></Table.Td>
                <Table.Td>{o.packages?.name}</Table.Td>
                <Table.Td>{o.profiles.filter((p) => p.is_active && p.role === 'ORG_ADMIN').length}</Table.Td>
                <Table.Td>{o.profiles.filter((p) => p.is_active).length}</Table.Td>
                <Table.Td>{o.expires_at ? formatDate(o.expires_at) : t('console.noExpiry')}</Table.Td>
                <Table.Td><AccessBadge access={accessOf(o)} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {creating && <NewOrganisationModal onClose={() => setCreating(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
type LimitKey = 'max_admins' | 'max_users' | 'max_meetings' | 'max_presentations' | 'max_participants_per_meeting' | 'storage_bytes' | 'max_file_bytes';
const LIMITS: { key: LimitKey; label: string; scale?: number }[] = [
  { key: 'max_admins', label: 'console.maxAdmins' },
  { key: 'max_users', label: 'console.maxUsers' },
  { key: 'max_meetings', label: 'console.maxMeetings' },
  { key: 'max_presentations', label: 'console.maxPresentations' },
  { key: 'max_participants_per_meeting', label: 'console.maxParticipants' },
  { key: 'storage_bytes', label: 'console.storage', scale: GB },
  { key: 'max_file_bytes', label: 'console.maxFile', scale: MB },
];

function LimitsForm({ org }: { org: Organisation }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: packages = [] } = usePackages();
  const [busy, setBusy] = useState(false);
  const toUnits = (v: number | null, scale = 1) => (v === null ? '' : Math.round((v / scale) * 100) / 100);
  const form = useForm({
    initialValues: {
      package_id: org.package_id,
      ...Object.fromEntries(LIMITS.map((l) => [l.key, toUnits(org[l.key], l.scale)])) as Record<LimitKey, number | ''>,
    },
  });
  const pkg = packages.find((p) => p.id === form.values.package_id);
  const pkgValue = (l: (typeof LIMITS)[number]) => {
    if (!pkg) return '';
    const v = pkg[l.key];
    return l.scale === GB ? formatBytes(v) : l.scale === MB ? formatBytes(v) : String(v);
  };
  return (
    <form
      noValidate
      onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const patch: Record<string, unknown> = { package_id: v.package_id };
          for (const l of LIMITS) {
            const raw = v[l.key];
            patch[l.key] = raw === '' || raw === null ? null : Math.round(Number(raw) * (l.scale ?? 1));
          }
          const { error } = await supabase.from('organisations').update(patch).eq('id', org.id);
          if (error) throw error;
          await qc.invalidateQueries({ queryKey: ['organisation', org.id] });
          await qc.invalidateQueries({ queryKey: ['usage', org.id] });
          await qc.invalidateQueries({ queryKey: ['organisations'] });
          notifySuccess(t('common.saved'));
        } catch (err) {
          notifyError(err);
        } finally {
          setBusy(false);
        }
      })}
    >
      <Stack>
        <Select label={t('console.package')} data={packages.map((p) => ({ value: p.id, label: p.name }))} allowDeselect={false} maw={360} {...form.getInputProps('package_id')} />
        <Text fw={700}>{t('console.limits')}</Text>
        <Text c="dimmed" fz="sm">{t('console.limitsHelp')}</Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {LIMITS.map((l) => (
            <NumberInput key={l.key} label={t(l.label)} description={t('console.packageValue', { value: pkgValue(l) })}
              min={0} decimalScale={l.scale ? 2 : 0} placeholder={pkgValue(l)} {...form.getInputProps(l.key)} />
          ))}
        </SimpleGrid>
        <Group justify="flex-end"><Button type="submit" loading={busy}>{t('common.saveChanges')}</Button></Group>
      </Stack>
    </form>
  );
}

function StatusForm({ org }: { org: Organisation }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { expires_on: toDateInput(org.expires_at), grace_days: org.grace_days } });
  const save = async (patch: Partial<Organisation>) => {
    const { error } = await supabase.from('organisations').update(patch).eq('id', org.id);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ['organisation', org.id] });
    await qc.invalidateQueries({ queryKey: ['organisations'] });
    notifySuccess(t('common.saved'));
  };
  return (
    <Stack gap="xl">
      <Group><Text fw={600}>{t('common.status')}:</Text><AccessBadge access={accessOf(org)} /></Group>
      <form noValidate onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try { await save({ expires_at: v.expires_on ? endOfDayIso(v.expires_on) : null, grace_days: Number(v.grace_days) }); }
        catch (err) { notifyError(err); }
        finally { setBusy(false); }
      })}>
        <Group align="flex-end">
          <TextInput type="date" label={t('console.expiresAt')} description={t('console.noExpiry')} {...form.getInputProps('expires_on')} />
          <NumberInput label={t('console.graceDays')} min={0} max={365} w={260} {...form.getInputProps('grace_days')} />
          <Button type="submit" loading={busy}>{t('common.saveChanges')}</Button>
        </Group>
      </form>
      {org.status === 'ACTIVE' ? (
        <ConfirmButton color="red" variant="light" message={t('console.confirmDeactivateOrg', { name: org.name })}
          onConfirm={async () => { try { await save({ status: 'INACTIVE' }); } catch (err) { notifyError(err); } }}>
          {t('console.deactivateOrg')}
        </ConfirmButton>
      ) : (
        <ConfirmButton message={t('console.confirmActivateOrg', { name: org.name })}
          onConfirm={async () => { try { await save({ status: 'ACTIVE' }); } catch (err) { notifyError(err); } }}>
          {t('console.activateOrg')}
        </ConfirmButton>
      )}
    </Stack>
  );
}

export function OrganisationDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data, isLoading, error } = useOrganisation(id);
  const usage = useUsage(id);
  const initialTab = new URLSearchParams(window.location.search).get('tab') ?? 'profile';
  if (isLoading) return <Text>{t('common.loading')}</Text>;
  if (error || !data) return <Alert color="red">{t('common.unknownError')}</Alert>;
  const { org, settings, limits } = data;
  return (
    <>
      <Anchor component={Link} to="/console/organisations" mb="sm" display="inline-block">← {t('console.organisations')}</Anchor>
      <PageHeader title={org.name} actions={<AccessBadge access={accessOf(org)} />} />
      <Tabs defaultValue={initialTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="profile">{t('org.profileTab')}</Tabs.Tab>
          <Tabs.Tab value="limits">{t('console.limitsTab')}</Tabs.Tab>
          <Tabs.Tab value="status">{t('console.statusTab')}</Tabs.Tab>
          <Tabs.Tab value="staff">{t('console.usersTab')}</Tabs.Tab>
          <Tabs.Tab value="settings">{t('console.settingsTab')}</Tabs.Tab>
          <Tabs.Tab value="usage">{t('console.usageTab')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="profile"><OrganisationProfileForm org={org} settings={settings} disabled={false} /></Tabs.Panel>
        <Tabs.Panel value="limits"><LimitsForm org={org} /></Tabs.Panel>
        <Tabs.Panel value="status"><StatusForm org={org} /></Tabs.Panel>
        <Tabs.Panel value="staff"><UsersPanel orgId={org.id} readOnly={org.status === 'INACTIVE'} /></Tabs.Panel>
        <Tabs.Panel value="settings">
          <Stack gap="xl">
            {(['participants', 'files', 'security'] as const).map((s) => (
              <Card key={s} withBorder padding="lg">
                <Title order={2} fz="lg" mb="md">{t(`org.${s}Tab`)}</Title>
                <OrganisationSettingsForm settings={settings} section={s} maxRetentionDays={limits.max_retention_days} disabled={false} />
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="usage">{usage.data && <UsageCards usage={usage.data} />}</Tabs.Panel>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
function PackageModal({ pkg, onClose }: { pkg: Package | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      code: pkg?.code ?? '', name: pkg?.name ?? '', description: pkg?.description ?? '',
      max_admins: pkg?.max_admins ?? 2, max_users: pkg?.max_users ?? 10, max_meetings: pkg?.max_meetings ?? 50,
      max_presentations: pkg?.max_presentations ?? 100, max_participants_per_meeting: pkg?.max_participants_per_meeting ?? 200,
      storage_gb: pkg ? pkg.storage_bytes / GB : 5, max_file_mb: pkg ? pkg.max_file_bytes / MB : 50,
      indefinite: pkg ? pkg.max_retention_days === null : false, max_retention_days: pkg?.max_retention_days ?? 365,
      is_active: pkg?.is_active ?? true,
    },
    validate: {
      code: (v) => (/^[A-Z0-9_]{2,30}$/.test(v) ? null : 'A–Z, 0–9 and _ only'),
      name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
    },
  });
  return (
    <Modal opened onClose={onClose} title={pkg ? pkg.name : t('console.packages.new')} size="lg" centered>
      <form noValidate onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const row = {
            code: v.code, name: v.name.trim(), description: v.description.trim() || null,
            max_admins: v.max_admins, max_users: v.max_users, max_meetings: v.max_meetings, max_presentations: v.max_presentations,
            max_participants_per_meeting: v.max_participants_per_meeting,
            storage_bytes: Math.round(v.storage_gb * GB), max_file_bytes: Math.round(v.max_file_mb * MB),
            max_retention_days: v.indefinite ? null : v.max_retention_days, is_active: v.is_active,
          };
          const { error } = pkg ? await supabase.from('packages').update(row).eq('id', pkg.id) : await supabase.from('packages').insert(row);
          if (error) throw error;
          await qc.invalidateQueries({ queryKey: ['packages'] });
          notifySuccess(t('common.saved'));
          onClose();
        } catch (err) { notifyError(err); } finally { setBusy(false); }
      })}>
        <Stack>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}><TextInput label={t('console.packages.code')} required disabled={Boolean(pkg)} {...form.getInputProps('code')} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 8 }}><TextInput label={t('console.packages.name')} required {...form.getInputProps('name')} /></Grid.Col>
          </Grid>
          <Textarea label={t('console.packages.description')} {...form.getInputProps('description')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput label={t('console.maxAdmins')} min={1} {...form.getInputProps('max_admins')} />
            <NumberInput label={t('console.maxUsers')} min={1} {...form.getInputProps('max_users')} />
            <NumberInput label={t('console.maxMeetings')} min={0} {...form.getInputProps('max_meetings')} />
            <NumberInput label={t('console.maxPresentations')} min={0} {...form.getInputProps('max_presentations')} />
            <NumberInput label={t('console.maxParticipants')} min={1} {...form.getInputProps('max_participants_per_meeting')} />
            <NumberInput label={t('console.storage')} min={0} decimalScale={2} {...form.getInputProps('storage_gb')} />
            <NumberInput label={t('console.maxFile')} min={1} {...form.getInputProps('max_file_mb')} />
            <NumberInput label={t('console.packages.maxRetention')} min={1} disabled={form.values.indefinite} {...form.getInputProps('max_retention_days')} />
          </SimpleGrid>
          <Switch label={t('console.packages.indefinite')} {...form.getInputProps('indefinite', { type: 'checkbox' })} />
          <Switch label={t('common.active')} {...form.getInputProps('is_active', { type: 'checkbox' })} />
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" loading={busy}>{t('common.save')}</Button></Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function PackagesPage() {
  const { t } = useTranslation();
  const { data: packages = [] } = usePackages();
  const { data: orgs = [] } = useOrganisations();
  const [editing, setEditing] = useState<Package | 'new' | null>(null);
  return (
    <>
      <PageHeader title={t('console.packages.title')} intro={t('console.packages.intro')}
        actions={<Button leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>{t('console.packages.new')}</Button>} />
      <ScrollArea>
        <Table striped verticalSpacing="sm" miw={900}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('console.packages.name')}</Table.Th><Table.Th>{t('console.maxAdmins')}</Table.Th><Table.Th>{t('console.maxUsers')}</Table.Th>
              <Table.Th>{t('console.maxMeetings')}</Table.Th><Table.Th>{t('console.storage')}</Table.Th><Table.Th>{t('console.maxFile')}</Table.Th>
              <Table.Th>{t('console.packages.inUse')}</Table.Th><Table.Th>{t('common.status')}</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {packages.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td><Text fw={600}>{p.name}</Text><Text fz="xs" c="dimmed">{p.code}</Text></Table.Td>
                <Table.Td>{p.max_admins}</Table.Td><Table.Td>{p.max_users}</Table.Td><Table.Td>{p.max_meetings}</Table.Td>
                <Table.Td>{formatBytes(p.storage_bytes)}</Table.Td><Table.Td>{formatBytes(p.max_file_bytes)}</Table.Td>
                <Table.Td>{orgs.filter((o) => o.package_id === p.id).length}</Table.Td>
                <Table.Td><Badge variant="light" color={p.is_active ? 'green' : 'gray'}>{p.is_active ? t('common.active') : t('common.inactive')}</Badge></Table.Td>
                <Table.Td><Button size="xs" variant="subtle" onClick={() => setEditing(p)}>{t('common.edit')}</Button></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {editing && <PackageModal pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
export function SystemSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from('system_settings').select('key, value');
      if (error) throw error;
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
    },
  });
  const form = useForm({
    initialValues: { lockout_threshold: 5, lockout_minutes: 15, ip_retention_days: 90, support_contact: '' },
  });
  const [loaded, setLoaded] = useState(false);
  if (data && !loaded) {
    form.setValues({
      lockout_threshold: Number(data['security.lockout_threshold'] ?? 5),
      lockout_minutes: Number(data['security.lockout_minutes'] ?? 15),
      ip_retention_days: Number(data['security.ip_retention_days'] ?? 90),
      support_contact: String(data['app.support_contact'] ?? ''),
    });
    setLoaded(true);
  }
  return (
    <>
      <PageHeader title={t('console.settings.title')} />
      <Card withBorder padding="lg" maw={640}>
        <form noValidate onSubmit={form.onSubmit(async (v) => {
          setBusy(true);
          try {
            const updates: [string, unknown][] = [
              ['security.lockout_threshold', v.lockout_threshold], ['security.lockout_minutes', v.lockout_minutes],
              ['security.ip_retention_days', v.ip_retention_days], ['app.support_contact', v.support_contact.trim()],
            ];
            for (const [key, value] of updates) {
              const { error } = await supabase.from('system_settings').update({ value }).eq('key', key);
              if (error) throw error;
            }
            await qc.invalidateQueries({ queryKey: ['system-settings'] });
            notifySuccess(t('common.saved'));
          } catch (err) { notifyError(err); } finally { setBusy(false); }
        })}>
          <Stack>
            <NumberInput label={t('console.settings.lockoutThreshold')} min={3} max={20} {...form.getInputProps('lockout_threshold')} />
            <NumberInput label={t('console.settings.lockoutMinutes')} min={1} max={1440} {...form.getInputProps('lockout_minutes')} />
            <NumberInput label={t('console.settings.ipRetention')} min={7} max={365} {...form.getInputProps('ip_retention_days')} />
            <TextInput label={t('console.settings.supportContact')} {...form.getInputProps('support_contact')} />
            <Group justify="flex-end"><Button type="submit" loading={busy}>{t('common.saveChanges')}</Button></Group>
          </Stack>
        </form>
      </Card>
    </>
  );
}

export function ConsoleAuditPage() {
  const { t } = useTranslation();
  const { data: orgs = [] } = useOrganisations();
  return (
    <>
      <PageHeader title={t('audit.title')} intro={t('audit.intro')} />
      <AuditPanel organisations={orgs.map((o) => ({ value: o.id, label: o.name }))} />
    </>
  );
}
