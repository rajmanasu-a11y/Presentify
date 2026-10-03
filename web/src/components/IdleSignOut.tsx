// Signs the person out after the configured time without mouse, keyboard or touch use
// (SESSION_INACTIVITY_TIMEOUT, 30 minutes by default), with a one-minute warning.
//
// Why this is needed: the server already refuses to renew a session that has been idle
// that long, but an open browser tab renews its session by itself every few minutes, so
// without this an unattended computer would stay signed in for up to 12 hours.
//
// Activity in any tab of the same browser counts (shared through localStorage). While a
// QR display or presenter-mode screen is open, the browser counts as in use: those
// screens are meant to run unattended during a meeting.
import { Button, Group, Modal, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { config } from '../config';
import { supabase } from '../lib/supabase';

const KEY = 'presentify-last-activity';
const KEEP_AWAKE = /^\/(display|present)\//;
/** Set before signing out, so the sign-in page can explain what happened. */
export const IDLE_FLAG = 'presentify-idle-signout';

const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const write = (v: number) => { try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ } };

export function IdleSignOut() {
  const { t } = useTranslation();
  const limit = config.inactivityMs;
  const warnAt = Math.max(limit - 60_000, limit * 0.8);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const last = useRef(Date.now());

  const touch = () => {
    const now = Date.now();
    last.current = now;
    if (now - read() > 5000) write(now);   // shared with other tabs, at most every 5 s
  };

  useEffect(() => {
    touch();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (KEEP_AWAKE.test(window.location.pathname)) { touch(); setSecondsLeft(null); return; }
      const idle = Date.now() - Math.max(last.current, read());
      if (idle >= limit) {
        window.clearInterval(timer);
        try { sessionStorage.setItem(IDLE_FLAG, '1'); } catch { /* ignore */ }
        void supabase.auth.signOut({ scope: 'local' });
      } else if (idle >= warnAt) {
        setSecondsLeft(Math.ceil((limit - idle) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, 1000);
    return () => { window.clearInterval(timer); events.forEach((e) => window.removeEventListener(e, touch)); };
  }, [limit, warnAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal opened={secondsLeft !== null} onClose={touch} title={t('idle.title')} centered withCloseButton={false}>
      <Text mb="lg" aria-live="assertive">{t('idle.body', { seconds: secondsLeft ?? 0 })}</Text>
      <Group justify="flex-end"><Button onClick={touch}>{t('idle.stay')}</Button></Group>
    </Modal>
  );
}
