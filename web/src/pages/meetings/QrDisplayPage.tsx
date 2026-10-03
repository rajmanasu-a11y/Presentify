// QR display mode for a projector, TV or hall screen (designed for 1920 × 1080, works
// on any size) and its print layout. Shows the organisation logo, the meeting title,
// "Scan to access presentation and supporting material" (English and ಕನ್ನಡ) and a large
// QR code — nothing else, unless the live participant count is switched on.
// It checks every minute for a replaced code, so the screen never shows a dead one.
import { Button, Center, Group, Loader, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { formatDate, formatTime } from '../../lib/format';
import { useIdle, useLiveStats } from '../../lib/live';
import { useMeeting } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import { NotFoundPage } from '../AccountPages';
import { participantLink, useActiveQr, useQrImage } from './QrPanel';

export function useOrganisationLogo(path: string | null | undefined) {
  return useQuery({
    queryKey: ['branding-image', path],
    enabled: Boolean(path),
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('branding').createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function QrDisplayPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { me } = useAuth();
  const meeting = useMeeting(id);
  const qr = useActiveQr(id, 60_000);
  const link = qr.data ? participantLink(qr.data.token) : null;
  const image = useQrImage(link, 1400);
  const logo = useOrganisationLogo(me?.organisation?.logo_path);
  const params = new URLSearchParams(window.location.search);
  const print = params.has('print');
  const [showCount, setShowCount] = useState(params.get('count') === '1');
  const live = useLiveStats(id, !print, showCount ? 5000 : 60000);
  const idle = useIdle();

  useEffect(() => {
    if (print && image) {
      const timer = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [print, image]);

  if (meeting.isLoading || qr.isLoading) return <Center h="100vh"><Loader aria-label={t('common.loading')} /></Center>;
  if (!meeting.data) return <NotFoundPage />;
  const m = meeting.data;
  // The audience may read either language, so the instruction is shown in both.
  const tEn = i18n.getFixedT('en');
  const tKn = i18n.getFixedT('kn');

  return (
    <div className={`qr-display${print ? ' qr-print' : ''}`} data-testid="qr-display">
      <div className={`qr-display-toolbar${idle ? ' idle' : ''}`}>
        <Group gap="sm">
          <Button variant="white" component={Link} to={`/meetings/${m.id}?tab=qr`}>{t('qr.backToMeeting')}</Button>
          {live.data && (
            <Button variant="white" onClick={() => setShowCount((v) => !v)} aria-pressed={showCount}>{t('display.count')}</Button>
          )}
          <Button variant="white" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>{t('qr.fullScreen')}</Button>
          <Button variant="white" onClick={() => window.print()}>{t('qr.print')}</Button>
        </Group>
      </div>
      <header>
        {logo.data && <img src={logo.data} alt="" className="qr-display-logo" />}
        <div className="qr-display-org">{me?.organisation?.name}</div>
        <h1>{m.title}</h1>
        <p>{formatDate(m.starts_at)} · {formatTime(m.starts_at)} – {formatTime(m.ends_at)}{m.venue ? ` · ${m.venue}` : ''}</p>
      </header>
      <div className="qr-display-body">
        {image ? (
          <img className="qr-display-code" src={image} alt={t('qr.imageAlt', { title: m.title })} data-testid="qr-display-image" />
        ) : (
          <Text className="qr-display-off" role="alert">{t('qr.noActive')}</Text>
        )}
        {showCount && live.data && !print && (
          <div className="qr-display-count" data-testid="qr-display-count" aria-live="polite">
            <strong>{live.data.total}</strong>
            <span>{tEn('display.joined')}</span>
            <span lang="kn">{tKn('display.joined')}</span>
          </div>
        )}
      </div>
      <div className="qr-display-scan">
        <strong>{tEn('display.scanTitle')}</strong>
        <strong lang="kn">{tKn('display.scanTitle')}</strong>
        <span>{tEn('display.scanHint')} · <span lang="kn">{tKn('display.scanHint')}</span></span>
      </div>
      {link && <div className="qr-display-link">{link}</div>}
      <footer>Presentify — Present. Scan. Access. · {m.reference_no}</footer>
    </div>
  );
}
