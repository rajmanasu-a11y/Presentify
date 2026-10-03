// Create-meeting wizard: one step at a time instead of one large form.
//   1 Details → 2 Presenters & sessions → 3 Presentations → 4 Supporting material →
//   5 Access & downloads → 6 QR code → 7 Review & publish → "Meeting published successfully".
// Every step saves at once, so the organiser can stop and continue later (the meeting
// stays a draft until it is published). Steps reuse the screens of the meeting page.
import { Alert, Anchor, Badge, Button, Card, CopyButton, Group, List, Stack, Stepper, Text, TextInput, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCopy, IconDownload, IconPlayerPlay, IconPrinter, IconScreenShare } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { notifyError, notifySuccess } from '../../components/notify';
import { formatDate, formatDateTime, formatTime } from '../../lib/format';
import { invalidateMeeting, useMeeting, useMeetingContent, usePresenters, type MeetingContent } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Meeting } from '../../lib/types';
import { NotFoundPage } from '../AccountPages';
import { MeetingDetailsForm } from './MeetingForm';
import { AccessSettings, accessWindow, participantLink, QrCard, useActiveQr, useQrImage } from './QrPanel';
import { SessionsPanel } from './SessionsPanel';
import { SharingSettings } from './SharingSettings';

const STEPS = ['details', 'sessions', 'presentations', 'attachments', 'access', 'qr', 'review'] as const;
const VIEWABLE = ['pdf', 'jpg', 'jpeg', 'png', 'mp4'];

type Check = { level: 'error' | 'warning' | 'ok'; text: string };

/** What the review step reports before publishing. */
function reviewChecks(m: Meeting, c: MeetingContent, t: (k: string, o?: Record<string, unknown>) => string): Check[] {
  const checks: Check[] = [];
  if (c.sessions.length === 0) checks.push({ level: 'error', text: t('wizard.checkNoSessions') });
  for (const s of c.sessions) {
    const pres = c.presentations.filter((p) => p.session_id === s.id);
    if (!s.presenter_id) checks.push({ level: 'warning', text: t('wizard.checkNoPresenter', { session: s.title }) });
    if (pres.length === 0) checks.push({ level: 'warning', text: t('wizard.checkNoPresentation', { session: s.title }) });
    if (s.starts_at < m.starts_at || s.ends_at > m.ends_at) checks.push({ level: 'warning', text: t('wizard.checkOutside', { session: s.title }) });
    for (const p of pres) {
      const current = p.versions.find((v) => v.id === p.current_version_id);
      if (!current) checks.push({ level: 'warning', text: t('wizard.checkNoFile', { title: p.title }) });
      else if (!VIEWABLE.includes(current.original.extension) && !current.view_pdf) {
        checks.push({ level: 'warning', text: t('wizard.checkNoPdfCopy', { title: p.title }) });
      }
    }
  }
  for (const a of c.attachments) {
    if (!VIEWABLE.includes(a.file.extension) && !a.view_pdf) checks.push({ level: 'warning', text: t('wizard.checkNoPdfCopy', { title: a.title }) });
  }
  if (checks.length === 0) checks.push({ level: 'ok', text: t('wizard.checkAllGood') });
  return checks;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap">
      <Text fw={600} w={200} style={{ flexShrink: 0 }}>{label}</Text>
      <div style={{ minWidth: 0 }}>{children}</div>
    </Group>
  );
}

function Review({ meeting, content, onPublished }: { meeting: Meeting; content: MeetingContent; onPublished: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const presenters = usePresenters(true);
  const qr = useActiveQr(meeting.id);
  const [busy, setBusy] = useState(false);
  const checks = reviewChecks(meeting, content, t);
  const blocked = checks.some((c) => c.level === 'error');
  const { opens, closes } = accessWindow(meeting);
  const presenterName = (id: string | null) => presenters.data?.find((p) => p.id === id)?.full_name ?? t('sessions.noPresenter');

  const publish = async () => {
    setBusy(true);
    const { error } = await supabase.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id);
    setBusy(false);
    if (error) { notifyError(error); return; }
    await invalidateMeeting(qc, meeting.id);
    notifySuccess(t('meetings.published'));
    onPublished();
  };

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg">
        <Title order={3} fz="lg" mb="sm">{t('wizard.reviewDetails')}</Title>
        <Stack gap={6}>
          <Row label={t('meetings.titleField')}>{meeting.title}</Row>
          <Row label={t('meetings.reference')}>{meeting.reference_no}</Row>
          <Row label={t('meetings.when')}>{formatDate(meeting.starts_at)}, {formatTime(meeting.starts_at)} – {formatTime(meeting.ends_at)}</Row>
          {meeting.venue && <Row label={t('meetings.venue')}>{meeting.venue}</Row>}
        </Stack>
      </Card>
      <Card withBorder padding="lg">
        <Title order={3} fz="lg" mb="sm">{t('wizard.reviewSessions', { count: content.sessions.length })}</Title>
        <Stack gap="xs">
          {content.sessions.map((s) => {
            const pres = content.presentations.filter((p) => p.session_id === s.id).length;
            const att = content.attachments.filter((a) => a.session_id === s.id).length;
            return (
              <Text key={s.id}>
                <strong>{formatTime(s.starts_at)} – {formatTime(s.ends_at)} · {s.title}</strong> — {presenterName(s.presenter_id)}
                {' · '}{t('wizard.counts', { presentations: pres, attachments: att })}
              </Text>
            );
          })}
        </Stack>
      </Card>
      <Card withBorder padding="lg">
        <Title order={3} fz="lg" mb="sm">{t('wizard.reviewAccess')}</Title>
        <Stack gap={6}>
          <Row label={t('qr.registration')}>{t(`wizard.reg_${meeting.registration_mode}`)}</Row>
          <Row label={t('qr.availability')}>
            {opens ? t('qr.opensAt', { when: formatDateTime(opens) }) : t('qr.opensAlways')} · {closes ? t('qr.closesAt', { when: formatDateTime(closes) }) : t('qr.closesNever')}
          </Row>
          <Row label={t('qr.passcode')}>{meeting.has_passcode ? t('common.yes') : t('common.no')}</Row>
          <Row label={t('meetings.downloadsAllowed')}>{meeting.downloads_allowed ? t('common.yes') : t('common.no')}</Row>
          <Row label={t('meetings.sessionRelease')}>{meeting.session_release === 'ALL' ? t('meetings.releaseAll') : t('meetings.releaseOnStart')}</Row>
          <Row label={t('wizard.qrCode')}>{qr.data ? t('wizard.qrReady') : t('wizard.qrOnPublish')}</Row>
        </Stack>
      </Card>
      <Card withBorder padding="lg" data-testid="review-checks">
        <Title order={3} fz="lg" mb="sm">{t('wizard.reviewChecks')}</Title>
        <List spacing="xs">
          {checks.map((c, i) => (
            <List.Item key={i} icon={<Badge color={c.level === 'error' ? 'red' : c.level === 'warning' ? 'yellow' : 'green'} variant="light" w={90}>
              {t(`wizard.level_${c.level}`)}</Badge>}>{c.text}</List.Item>
          ))}
        </List>
      </Card>
      {meeting.status === 'DRAFT' && (
        <Group justify="flex-end">
          <Button size="lg" onClick={() => void publish()} loading={busy} disabled={blocked}>{t('wizard.publish')}</Button>
        </Group>
      )}
    </Stack>
  );
}

export function PublishedScreen({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const qr = useActiveQr(meeting.id);
  const link = qr.data ? participantLink(qr.data.token) : null;
  const image = useQrImage(link);
  return (
    <Card withBorder padding="xl" maw={760}>
      <Stack align="center" gap="md" ta="center">
        <Title order={2} data-testid="published-title">{t('wizard.publishedTitle')}</Title>
        <Text>{t('wizard.publishedBody')}</Text>
        {image && <img src={image} alt={t('qr.imageAlt', { title: meeting.title })} data-testid="published-qr" style={{ width: 260, height: 260, border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }} />}
        {link && <TextInput label={t('wizard.meetingLink')} value={link} readOnly w="100%" maw={520} onFocus={(e) => e.currentTarget.select()} />}
        <Group justify="center" gap="sm">
          <Button component={Link} to={`/display/meetings/${meeting.id}/qr`} target="_blank" leftSection={<IconScreenShare size={18} />}>{t('wizard.displayQr')}</Button>
          <Button variant="default" component="a" href={image ?? undefined} download={`${meeting.reference_no}-QR.png`} leftSection={<IconDownload size={18} />}>{t('wizard.downloadQr')}</Button>
          <Button variant="default" component={Link} to={`/display/meetings/${meeting.id}/qr?print=1`} target="_blank" leftSection={<IconPrinter size={18} />}>{t('wizard.printQr')}</Button>
          {link && (
            <CopyButton value={link}>
              {({ copied, copy }) => <Button variant="default" leftSection={<IconCopy size={18} />} onClick={copy}>{copied ? t('qr.copied') : t('wizard.copyLink')}</Button>}
            </CopyButton>
          )}
        </Group>
        <Group justify="center" gap="sm" mt="sm">
          <Button variant="light" component={Link} to={`/present/meetings/${meeting.id}`} target="_blank" leftSection={<IconPlayerPlay size={18} />}>{t('present.start')}</Button>
          <Anchor component={Link} to={`/meetings/${meeting.id}`}>{t('wizard.openMeeting')}</Anchor>
        </Group>
      </Stack>
    </Card>
  );
}

export function MeetingWizardPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { me, can, readOnly } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Full step names fit only on wide screens; elsewhere only the current step is named.
  const wide = useMediaQuery('(min-width: 90em)');
  const phone = useMediaQuery('(max-width: 36em)');
  const meeting = useMeeting(id);
  const content = useMeetingContent(id);
  const [published, setPublished] = useState(false);
  const stepParam = Number(params.get('step') ?? (id ? 2 : 1));
  const step = Math.min(Math.max(Number.isFinite(stepParam) ? stepParam : 1, 1), STEPS.length);

  if (!can('MEETING_MANAGE') || readOnly) return <NotFoundPage />;
  if (id && meeting.isLoading) return <Text>{t('common.loading')}</Text>;
  if (id && !meeting.data) return <NotFoundPage />;
  const m = meeting.data ?? null;
  if (m && !(me?.role === 'ORG_ADMIN' || m.organiser_user_id === me?.user_id)) return <NotFoundPage />;
  if (m?.status === 'ARCHIVED') return <NotFoundPage />;

  const go = (n: number, meetingId = id) => {
    if (meetingId && meetingId !== id) navigate(`/meetings/${meetingId}/setup?step=${n}`);
    else setParams({ step: String(n) });
    window.scrollTo(0, 0);
  };

  if (m && (published || (m.status === 'PUBLISHED' && step === STEPS.length))) {
    return (
      <>
        <PageHeader title={m.title} intro={m.reference_no} />
        <PublishedScreen meeting={m} />
      </>
    );
  }

  const key = STEPS[step - 1];
  const nav = (
    <Group justify="space-between" mt="xl">
      <Group gap="sm">
        {step > 1 && <Button variant="default" onClick={() => go(step - 1)}>{t('wizard.back')}</Button>}
        {m && <Anchor component={Link} to={`/meetings/${m.id}`}>{t('wizard.finishLater')}</Anchor>}
      </Group>
      {step > 1 && step < STEPS.length && <Button onClick={() => go(step + 1)}>{t('wizard.next')}</Button>}
    </Group>
  );

  return (
    <>
      <PageHeader title={m ? m.title : t('wizard.title')} intro={t('wizard.intro')} />
      <Stepper active={step - 1} onStepClick={m ? (i) => go(i + 1) : undefined} allowNextStepsSelect={Boolean(m)}
        size="sm" iconSize={wide ? 36 : phone ? 28 : 30} mb="xl"
        styles={phone ? { separator: { marginInline: 4, minWidth: 4 }, steps: { flexWrap: 'nowrap' } } : undefined} aria-label={t('wizard.title')}>
        {STEPS.map((s, i) => (
          <Stepper.Step key={s} aria-label={`${t('wizard.stepN', { n: i + 1 })}: ${t(`wizard.step_${s}`)}`}
            label={wide || (!phone && i === step - 1) ? t(`wizard.step_${s}`) : undefined}
            description={wide ? t('wizard.stepN', { n: i + 1 }) : undefined} />
        ))}
      </Stepper>

      <Title order={2} fz="h3" mb={4}>{t('wizard.stepN', { n: step })}: {t(`wizard.step_${key}`)}</Title>
      <Text c="dimmed" mb="lg">{t(`wizard.help_${key}`)}</Text>

      {key === 'details' && (
        <Card withBorder padding="lg">
          <MeetingDetailsForm meeting={m} submitLabel={t('wizard.saveAndContinue')} onSaved={(newId) => go(2, newId)} />
        </Card>
      )}
      {m && (key === 'sessions' || key === 'presentations' || key === 'attachments') && (
        <>
          {content.isLoading && <Text>{t('common.loading')}</Text>}
          {content.data && (
            <SessionsPanel meeting={m} sessions={content.data.sessions} presentations={content.data.presentations}
              attachments={content.data.attachments} canEdit show={key} />
          )}
          {key !== 'sessions' && content.data?.sessions.length === 0 && (
            <Alert color="yellow" mt="md">{t('wizard.addSessionsFirst')} <Anchor onClick={() => go(2)}>{t('wizard.step_sessions')}</Anchor></Alert>
          )}
        </>
      )}
      {m && key === 'access' && (
        <Stack gap="lg">
          <AccessSettings meeting={m} disabled={false} />
          <Card withBorder padding="lg"><SharingSettings meeting={m} disabled={false} /></Card>
        </Stack>
      )}
      {m && key === 'qr' && <QrCard meeting={m} canManage={can('QR_MANAGE')} />}
      {m && key === 'review' && content.data && <Review meeting={m} content={content.data} onPublished={() => setPublished(true)} />}
      {key !== 'details' && nav}
    </>
  );
}
