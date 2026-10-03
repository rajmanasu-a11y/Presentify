// Live figures and "now / next" session logic shared by the meeting page,
// the full-screen QR display and presenter mode.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { MeetingSession } from './types';

export interface LiveStats {
  total: number;
  registered: number;
  anonymous: number;
  active_now: number;
  joined_last_10_min: number;
  views: number;
  downloads: number;
  as_of: string;
}

/**
 * Counts only (never names), refreshed every few seconds. Resolves to null when the
 * person may not see them (e.g. a presenter in an organisation that switched this off).
 */
export function useLiveStats(meetingId: string | undefined, enabled = true, intervalMs = 5000) {
  return useQuery({
    queryKey: ['live', meetingId],
    enabled: Boolean(meetingId) && enabled,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: true,
    retry: false,
    queryFn: async (): Promise<LiveStats | null> => {
      const { data, error } = await supabase.rpc('meeting_live_stats', { p_meeting: meetingId });
      if (error) {
        if (error.code === '42501') return null;
        throw error;
      }
      return data as LiveStats;
    },
  });
}

/** The current time, updated every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface Schedule {
  /** Session running now (or chosen by hand), if any. */
  current: MeetingSession | null;
  /** The session after it (or the first one, before the meeting starts). */
  next: MeetingSession | null;
  /** Index of `current` in the time-ordered list, -1 if none. */
  index: number;
  phase: 'before' | 'running' | 'between' | 'after';
}

export const sortSessions = (sessions: MeetingSession[]) =>
  [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.sort_order - b.sort_order);

/**
 * Works out NOW and NEXT from the session times. `manualIndex` lets the presenter
 * override the timetable when the meeting runs early or late.
 */
export function schedule(sessions: MeetingSession[], now: number, manualIndex: number | null = null): Schedule {
  const list = sortSessions(sessions);
  if (list.length === 0) return { current: null, next: null, index: -1, phase: 'after' };
  if (manualIndex !== null && manualIndex >= 0 && manualIndex < list.length) {
    return { current: list[manualIndex], next: list[manualIndex + 1] ?? null, index: manualIndex, phase: 'running' };
  }
  const at = (s: MeetingSession) => [Date.parse(s.starts_at), Date.parse(s.ends_at)] as const;
  // Latest-starting session that is running now (handles overlaps).
  let index = -1;
  list.forEach((s, i) => { const [a, b] = at(s); if (now >= a && now < b) index = i; });
  if (index >= 0) return { current: list[index], next: list[index + 1] ?? null, index, phase: 'running' };
  const upcoming = list.findIndex((s) => at(s)[0] > now);
  if (upcoming === 0) return { current: null, next: list[0], index: -1, phase: 'before' };
  if (upcoming > 0) return { current: null, next: list[upcoming], index: upcoming - 1, phase: 'between' };
  return { current: null, next: null, index: list.length - 1, phase: 'after' };
}

/** 75 → "1:15", 3725 → "1:02:05". Negative values are shown without a sign. */
export function clock(totalSeconds: number): string {
  const s = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * True after `ms` without mouse, touch or keyboard activity — used to hide the controls of
 * the display and presenter screens so the audience sees a clean screen. Any movement or
 * key press shows them again (at full contrast).
 */
export function useIdle(ms = 3000): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'focusin'] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, wake)); };
  }, [ms]);
  return idle;
}
