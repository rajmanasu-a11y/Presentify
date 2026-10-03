// Full-screen QR code for a projector or TV at the venue (and a print layout).
// It checks for a replaced QR code every minute, so the screen never shows a dead code.
import { Button, Center, Group, Loader, Text } from '@mantine/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { formatDate, formatTime } from '../../lib/format';
import { useMeeting } from '../../lib/meetingsApi';
import { NotFoundPage } from '../AccountPages';
import { participantLink, useActiveQr, useQrImage } from './QrPanel';

export function QrDisplayPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { me } = useAuth();
  const meeting = useMeeting(id);
  const qr = useActiveQr(id, 60_000);
  const link = qr.data ? participantLink(qr.data.token) : null;
  const image = useQrImage(link, 1400);
  const print = new URLSearchParams(window.location.search).has('print');

  useEffect(() => {
    if (print && image) {
      const timer = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [print, image]);

  if (meeting.isLoading || qr.isLoading) return <Center h="100vh"><Loader aria-label={t('common.loading')} /></Center>;
  if (!meeting.data) return <NotFoundPage />;
  const m = meeting.data;
  // The scan instruction is shown in both languages: the audience may read either.
  const tEn = i18n.getFixedT('en');
  const tKn = i18n.getFixedT('kn');

  return (
    <div className={`qr-display${print ? ' qr-print' : ''}`}>
      <div className="qr-display-toolbar">
        <Group gap="sm">
          <Button variant="white" component={Link} to={`/meetings/${m.id}?tab=qr`}>{t('qr.backToMeeting')}</Button>
          <Button variant="white" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>{t('qr.fullScreen')}</Button>
          <Button variant="white" onClick={() => window.print()}>{t('qr.print')}</Button>
        </Group>
      </div>
      <header>
        <div className="qr-display-org">{me?.organisation?.name}</div>
        <h1>{m.title}</h1>
        <p>{formatDate(m.starts_at)} · {formatTime(m.starts_at)} – {formatTime(m.ends_at)}{m.venue ? ` · ${m.venue}` : ''}</p>
      </header>
      {image ? (
        <img className="qr-display-code" src={image} alt={t('qr.imageAlt', { title: m.title })} data-testid="qr-display-image" />
      ) : (
        <Text className="qr-display-off" role="alert">{t('qr.noActive')}</Text>
      )}
      <div className="qr-display-scan">
        <strong>{tEn('qr.scanLine')}</strong>
        <strong lang="kn">{tKn('qr.scanLine')}</strong>
      </div>
      {link && <div className="qr-display-link">{link}</div>}
      <footer>Presentify — Present. Scan. Access. · {m.reference_no}</footer>
    </div>
  );
}
