import { Center, Loader } from '@mantine/core';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AppLayout } from './components/AppLayout';
import { ForcedPasswordChangePage, LoginPage, MfaChallengePage, MfaSetupPage, NotSetUpPage } from './pages/auth/AuthPages';
import { AccountPage, HelpPage, NotFoundPage } from './pages/AccountPages';

const OrgPages = () => import('./pages/org/OrgPages');
const ConsolePages = () => import('./pages/console/ConsolePages');
const MeetingsPages = () => import('./pages/meetings/MeetingsPage');
const MeetingDetail = () => import('./pages/meetings/MeetingDetailPage');
const PresentersPages = () => import('./pages/meetings/PresentersPage');
const PresentationsPages = () => import('./pages/meetings/PresentationsPage');
const lazyPage = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType }));

const OrgDashboardPage = lazyPage(OrgPages, 'OrgDashboardPage');
const OrganisationPage = lazyPage(OrgPages, 'OrganisationPage');
const UsersPage = lazyPage(OrgPages, 'UsersPage');
const AuditPage = lazyPage(OrgPages, 'AuditPage');
const MeetingsPage = lazyPage(MeetingsPages, 'MeetingsPage');
const MeetingDetailPage = lazyPage(MeetingDetail, 'MeetingDetailPage');
const PresentersPage = lazyPage(PresentersPages, 'PresentersPage');
const QrDisplayPage = lazyPage(() => import('./pages/meetings/QrDisplayPage'), 'QrDisplayPage');
const PresentationsPage = lazyPage(PresentationsPages, 'PresentationsPage');
const ConsoleDashboardPage = lazyPage(ConsolePages, 'ConsoleDashboardPage');
const OrganisationsPage = lazyPage(ConsolePages, 'OrganisationsPage');
const OrganisationDetailPage = lazyPage(ConsolePages, 'OrganisationDetailPage');
const PackagesPage = lazyPage(ConsolePages, 'PackagesPage');
const SystemSettingsPage = lazyPage(ConsolePages, 'SystemSettingsPage');
const ConsoleAuditPage = lazyPage(ConsolePages, 'ConsoleAuditPage');

function Loading() {
  return <Center h="60vh"><Loader aria-label="Loading" /></Center>;
}

/** Walks the signed-in person through any pending sign-in step before the app. */
function SignedInGate() {
  const { status } = useAuth();
  switch (status) {
    case 'loading': return <Loading />;
    case 'signedOut': return <LoginPage />;
    case 'notSetUp': return <NotSetUpPage />;
    case 'needsMfa': return <MfaChallengePage />;
    case 'needsPasswordChange': return <ForcedPasswordChangePage />;
    case 'needsMfaSetup': return <MfaSetupPage />;
    default: return <Suspense fallback={<Loading />}><Outlet /></Suspense>;
  }
}

function Require({ when, children }: { when: (a: ReturnType<typeof useAuth>) => boolean; children: ReactNode }) {
  const auth = useAuth();
  return when(auth) ? <>{children}</> : <NotFoundPage />;
}

function Home() {
  const { me } = useAuth();
  return me?.role === 'SUPER_ADMIN' ? <Navigate to="/console" replace /> : <OrgDashboardPage />;
}

const superAdmin = (a: ReturnType<typeof useAuth>) => a.me?.role === 'SUPER_ADMIN';
const perm = (p: string) => (a: ReturnType<typeof useAuth>) => a.me?.role !== 'SUPER_ADMIN' && a.can(p);

export const router = createBrowserRouter([
  {
    element: <SignedInGate />,
    children: [
      // Full-screen pages without the menu (projector / print).
      { path: 'display/meetings/:id/qr', element: <Require when={perm('QR_DISPLAY')}><QrDisplayPage /></Require> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'meetings', element: <Require when={perm('MEETING_VIEW')}><MeetingsPage /></Require> },
          { path: 'meetings/:id', element: <Require when={perm('MEETING_VIEW')}><MeetingDetailPage /></Require> },
          { path: 'presentations', element: <Require when={perm('MEETING_VIEW')}><PresentationsPage /></Require> },
          { path: 'presenters', element: <Require when={perm('PRESENTER_MANAGE')}><PresentersPage /></Require> },
          { path: 'organisation', element: <Require when={perm('ORG_PROFILE_EDIT')}><OrganisationPage /></Require> },
          { path: 'users', element: <Require when={perm('USER_MANAGE')}><UsersPage /></Require> },
          { path: 'audit', element: <Require when={perm('AUDIT_VIEW')}><AuditPage /></Require> },
          { path: 'account', element: <AccountPage /> },
          { path: 'help', element: <HelpPage /> },
          {
            path: 'console',
            element: <Require when={superAdmin}><Outlet /></Require>,
            children: [
              { index: true, element: <ConsoleDashboardPage /> },
              { path: 'organisations', element: <OrganisationsPage /> },
              { path: 'organisations/:id', element: <OrganisationDetailPage /> },
              { path: 'packages', element: <PackagesPage /> },
              { path: 'settings', element: <SystemSettingsPage /> },
              { path: 'audit', element: <ConsoleAuditPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
