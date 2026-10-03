// Presenter mode ("Start presentation"): a clean screen for the hall or the presenter's
// laptop with NOW / NEXT, a countdown for the current session, the meeting timer, and
// optionally the QR code and the live participant count. It runs in its own browser
// tab and never touches PowerPoint, which the presenter runs separately.
//
// Keys: ← / → previous / next session (when running early or late), T back to the
// timetable, Q QR code on/off, C count on/off, F full screen.
import { Button, Center, Group, Loader } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { formatTime } from '../../lib/format';
import { clock, schedule, sortSessions, useIdle, useLiveStats, useNow } from '../../lib/live';
import { useMeeting, useMeetingContent, usePresenters } from '../../lib/meetingsApi';
import type { MeetingSession, Presenter } from '../../lib/types';
import { NotFoundPage } from '../AccountPages';
import { participantLink, useActiveQr, useQrImage } from './QrPanel';

const who = (p: Presenter | undefined) => (p ? `${p.full_name}${p.designation ? `, ${p.designation}` : ''}` : '');

export function PresenterModePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { me } = useAuth();
  const meeting = useMeeting(id);
  const content = useMeetingContent(id);
  const presenters = usePresenters(true);
  const qr = useActiveQr(id, 60_000);
  const link = qr.data ? participantLink(qr.data.token) : null;
  const image = useQrImage(link, 800);
  const now = useNow(1000);
  const params = new URLSearchParams(window.location.search);
  const [showQr, setShowQr] = useState(params.get('qr') !== '0');
  const [showCount, setShowCount] = useState(params.get('count') === '1');
  // Checked even while hidden, so the Count button only appears for people allowed to see it.
  const live = useLiveStats(id, true, showCount ? 5000 : 30000);
  const [manual, setManual] = useState<number | null>(null);
  const idle = useIdle();

  const sessions: MeetingSession[] = sortSessions(content.data?.sessions ?? []);
  const s = schedule(sessions, now, manual);

  const step = useCallback((delta: number) => {
    setManual((m) => {
      const base = m ?? (s.phase === 'before' ? -1 : s.index);
      return Math.min(Math.max(base + delta, 0), sessions.length - 1);
    });
  }, [s.phase, s.index, sessions.length]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1);
      else if (k === 't') setManual(null);
      else if (k === 'q') setShowQr((v) => !v);
      else if (k === 'c') setShowCount((v) => !v);
      else if (k === 'f') toggleFull();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step]);

  if (meeting.isLoading || content.isLoading) return <Center h="100vh"><Loader aria-label={t('common.loading')} /></Center>;
  if (!meeting.data) return <NotFoundPage />;
  const m = meeting.data;
  const presenterOf = (x: MeetingSession | null) => presenters.data?.find((p) => p.id === x?.presenter_id);

  // Countdown for the current session (may be negative when it runs over).
  const remaining = s.current ? (Date.parse(s.current.ends_at) - now) / 1000 : 0;
  const length = s.current ? (Date.parse(s.current.ends_at) - Date.parse(s.current.starts_at)) / 1000 : 1;
  const elapsedPct = s.current ? Math.min(100, Math.max(0, 100 - (remaining / length) * 100)) : 0;
  const timerState = !s.current ? '' : remaining < 0 ? 'over' : remaining <= 300 ? 'soon' : '';
  const meetingStart = Date.parse(m.starts_at);
  const meetingEnd = Date.parse(m.ends_at);

  return (
    <div className="pm" data-testid="presenter-mode">
      <header className="pm-top">
        <div className="pm-org">{me?.organisation?.name}</div>
        <div className="pm-title">{m.title}</div>
        <div className="pm-clock" aria-label={t('present.timeNow')}>{formatTime(new Date(now))}</div>
      </header>

      <main className={`pm-main${showQr && image ? ' pm-with-side' : ''}`}>
        <section className="pm-now" aria-live="polite">
          {s.current ? (
            <>
              <div className="pm-label">{t('present.now')}{manual !== null && <span className="pm-manual"> · {t('present.manual')}</span>}</div>
              <h1 className="pm-session" data-testid="pm-now">{s.current.title}</h1>
              <div className="pm-presenter">{who(presenterOf(s.current))}</div>
              <div className="pm-slot">{formatTime(s.current.starts_at)} – {formatTime(s.current.ends_at)}</div>
              <div className={`pm-timer ${timerState}`} data-testid="pm-timer">
                {remaining >= 0 ? t('present.left', { time: clock(remaining) }) : t('present.over', { time: clock(remaining) })}
              </div>
              <div className="pm-progress" aria-hidden="true"><div style={{ width: `${elapsedPct}%` }} /></div>
            </>
          ) : s.phase === 'before' && s.next ? (
            <>
              <div className="pm-label">{t('present.welcome')}</div>
              <h1 className="pm-session">{m.title}</h1>
              <div className={`pm-timer`} data-testid="pm-timer">{t('present.startsIn', { time: clock((Date.parse(s.next.starts_at) - now) / 1000) })}</div>
            </>
          ) : s.phase === 'between' && s.next ? (
            <>
              <div className="pm-label">{t('present.break')}</div>
              <h1 className="pm-session">{t('present.backAt', { time: formatTime(s.next.starts_at) })}</h1>
              <div className="pm-timer" data-testid="pm-timer">{t('present.startsIn', { time: clock((Date.parse(s.next.starts_at) - now) / 1000) })}</div>
            </>
          ) : (
            <>
              <div className="pm-label">{t('present.endedLabel')}</div>
              <h1 className="pm-session" data-testid="pm-now">{sessions.length ? t('present.ended') : t('present.noSessions')}</h1>
            </>
          )}

          {s.next && (
            <div className="pm-next" data-testid="pm-next">
              <div className="pm-label">{t('present.next')}</div>
              <div className="pm-next-title">{s.next.title}</div>
              <div className="pm-next-meta">{who(presenterOf(s.next))}{presenterOf(s.next) ? ' · ' : ''}{formatTime(s.next.starts_at)} – {formatTime(s.next.ends_at)}</div>
            </div>
          )}
        </section>

        {showQr && image && (
          <aside className="pm-side">
            <img src={image} alt={t('qr.imageAlt', { title: m.title })} className="pm-qr" data-testid="pm-qr" />
            <div className="pm-scan">{t('display.scanTitle')}</div>
            {showCount && live.data && (
              <div className="pm-count" data-testid="pm-count">
                <div><strong>{live.data.active_now}</strong><span>{t('live.activeNow')}</span></div>
                <div><strong>{live.data.total}</strong><span>{t('live.total')}</span></div>
              </div>
            )}
          </aside>
        )}
        {!(showQr && image) && showCount && live.data && (
          <aside className="pm-side">
            <div className="pm-count" data-testid="pm-count">
              <div><strong>{live.data.active_now}</strong><span>{t('live.activeNow')}</span></div>
              <div><strong>{live.data.total}</strong><span>{t('live.total')}</span></div>
            </div>
          </aside>
        )}
      </main>

      <footer className="pm-bottom">
        <span>
          {now < meetingStart
            ? t('present.meetingStartsIn', { time: clock((meetingStart - now) / 1000) })
            : now <= meetingEnd
              ? t('present.meetingTimer', { elapsed: clock((now - meetingStart) / 1000), left: clock((meetingEnd - now) / 1000) })
              : t('present.meetingOver')}
        </span>
        <span>{t('present.sessionOf', { n: Math.max(s.index + 1, 0), total: sessions.length })}</span>
      </footer>

      <div className={`pm-toolbar${idle ? ' idle' : ''}`}>
        <Group gap="xs">
          <Button size="xs" variant="white" onClick={() => step(-1)} disabled={sessions.length === 0}>{t('present.previous')}</Button>
          <Button size="xs" variant="white" onClick={() => step(1)} disabled={sessions.length === 0}>{t('present.nextSession')}</Button>
          {manual !== null && <Button size="xs" variant="white" onClick={() => setManual(null)}>{t('present.followTimetable')}</Button>}
          <Button size="xs" variant="white" onClick={() => setShowQr((v) => !v)} aria-pressed={showQr}>{t('present.qr')}</Button>
          {live.data !== null && (
            <Button size="xs" variant="white" onClick={() => setShowCount((v) => !v)} aria-pressed={showCount}>{t('present.count')}</Button>
          )}
          <Button size="xs" variant="white" onClick={toggleFull}>{t('qr.fullScreen')}</Button>
          <Button size="xs" variant="white" component={Link} to={`/meetings/${m.id}`}>{t('qr.backToMeeting')}</Button>
        </Group>
      </div>
    </div>
  );
}
