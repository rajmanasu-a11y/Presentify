import { Alert, AppShell, Avatar, Box, Burger, Group, Menu, NavLink, Text, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuilding, IconChevronDown, IconClipboardList, IconHelp, IconLayoutDashboard, IconLogout, IconPackage,
  IconSettings, IconUserCircle, IconUsers,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { formatDate } from '../lib/format';
import { LanguageSwitch } from './LanguageSwitch';
import { LogoMark } from './Logo';
import { TestModeBanner } from './TestModeBanner';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

function useNavItems(): NavItem[] {
  const { t } = useTranslation();
  const { me, can } = useAuth();
  const i = (Icon: typeof IconHelp) => <Icon size={22} stroke={1.7} aria-hidden />;
  if (me?.role === 'SUPER_ADMIN') {
    return [
      { to: '/console', label: t('nav.dashboard'), icon: i(IconLayoutDashboard), exact: true },
      { to: '/console/organisations', label: t('nav.organisations'), icon: i(IconBuilding) },
      { to: '/console/packages', label: t('nav.packages'), icon: i(IconPackage) },
      { to: '/console/settings', label: t('nav.systemSettings'), icon: i(IconSettings) },
      { to: '/console/audit', label: t('nav.audit'), icon: i(IconClipboardList) },
      { to: '/account', label: t('nav.account'), icon: i(IconUserCircle) },
      { to: '/help', label: t('nav.help'), icon: i(IconHelp) },
    ];
  }
  const items: NavItem[] = [{ to: '/', label: t('nav.dashboard'), icon: i(IconLayoutDashboard), exact: true }];
  if (can('ORG_PROFILE_EDIT')) items.push({ to: '/organisation', label: t('nav.organisation'), icon: i(IconBuilding) });
  if (can('USER_MANAGE')) items.push({ to: '/users', label: t('nav.users'), icon: i(IconUsers) });
  if (can('AUDIT_VIEW')) items.push({ to: '/audit', label: t('nav.audit'), icon: i(IconClipboardList) });
  items.push({ to: '/account', label: t('nav.account'), icon: i(IconUserCircle) });
  items.push({ to: '/help', label: t('nav.help'), icon: i(IconHelp) });
  return items;
}

function OrgAccessBanner() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const org = me?.organisation;
  if (!org || org.access === 'ACTIVE' || !org.expires_at) return null;
  const end = new Date(new Date(org.expires_at).getTime() + org.grace_days * 86400000);
  return (
    <Alert color={org.access === 'GRACE' ? 'orange' : 'red'} mb="lg" role="status">
      {org.access === 'GRACE'
        ? t('banner.grace', { date: formatDate(org.expires_at), end: formatDate(end) })
        : t('banner.readOnly')}
    </Alert>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure();
  const { me, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const items = useNavItems();
  const orgName = me?.organisation?.name ?? t('console.title');

  const isActive = (item: NavItem) =>
    item.exact ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

  return (
    <>
      <a href="#main" className="skip-link">{t('app.skipToContent')}</a>
      <TestModeBanner />
      <AppShell
        header={{ height: 68 }}
        navbar={{ width: 260, breakpoint: 'md', collapsed: { mobile: !opened } }}
        padding={{ base: 'md', sm: 'xl' }}
      >
        <AppShell.Header px="md">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="md" aria-label={t('nav.openMenu')} />
              <Box c="navy.7" component={Link} to="/" aria-label="Presentify" style={{ display: 'flex' }}>
                <LogoMark size={38} />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Text fw={700} lh={1.2} truncate>Presentify</Text>
                <Text fz="sm" c="dimmed" lh={1.2} truncate>{orgName}</Text>
              </Box>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <Box visibleFrom="sm"><LanguageSwitch /></Box>
              <Menu position="bottom-end" width={240}>
                <Menu.Target>
                  <UnstyledButton aria-label={me?.full_name}>
                    <Group gap={6} wrap="nowrap">
                      <Avatar color="navy" radius="xl" size={36}>{me?.full_name?.slice(0, 1).toUpperCase()}</Avatar>
                      <IconChevronDown size={16} aria-hidden />
                    </Group>
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>
                    <Text fw={600} c="dark">{me?.full_name}</Text>
                    <Text fz="xs">{me && t(`roles.${me.role}`)}</Text>
                  </Menu.Label>
                  <Menu.Item leftSection={<IconUserCircle size={18} />} onClick={() => navigate('/account')}>
                    {t('nav.account')}
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item leftSection={<IconLogout size={18} />} onClick={() => void signOut()}>
                    {t('common.signOut')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm" component="nav" aria-label={t('nav.main')}>
          <Box hiddenFrom="sm" mb="sm"><LanguageSwitch /></Box>
          {items.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              leftSection={item.icon}
              active={isActive(item)}
              onClick={close}
              aria-current={isActive(item) ? 'page' : undefined}
              styles={{ label: { fontSize: 'var(--mantine-font-size-md)', fontWeight: 600 } }}
              py="sm"
              style={{ borderRadius: 'var(--mantine-radius-md)' }}
            />
          ))}
          <VisuallyHidden>{t('nav.main')}</VisuallyHidden>
        </AppShell.Navbar>

        <AppShell.Main id="main" tabIndex={-1} style={{ outline: 'none' }}>
          <Box maw={1280} mx="auto">
            <OrgAccessBanner />
            <Outlet />
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
