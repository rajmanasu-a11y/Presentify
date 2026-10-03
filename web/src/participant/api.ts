// Calls the "public" server function. Participants never sign in.

export class PublicError extends Error {
  constructor(public code: string, message: string, public network = false) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * When a whole hall scans at once the server may ask phones to slow down (HTTP 429 "busy").
 * The page then waits a moment and tries again by itself (up to 4 times, with growing,
 * randomised pauses so the phones do not all come back together) before showing a message.
 */
export async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(action, body);
    } catch (err) {
      const retry = err instanceof PublicError && (err.code === 'BUSY' || err.network) && attempt < 4;
      if (!retry) throw err;
      await wait((1000 + Math.random() * 2000) * 2 ** attempt);
    }
  }
}

async function once<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const key = window.__PRESENTIFY__?.anonKey ?? '';
  let res: Response;
  try {
    res = await fetch('/functions/v1/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new PublicError('NETWORK', 'network', true);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429 || res.status === 502 || res.status === 503) throw new PublicError('BUSY', data?.msg ?? 'busy');
    throw new PublicError(data?.error?.code ?? 'ERROR', data?.error?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// Per-meeting access token and the optional "remember me" token, kept on this phone only.
const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
export const storage = {
  access: (qr: string) => safe(() => localStorage.getItem(`presentify-access-${qr}`), null),
  setAccess: (qr: string, v: string) => safe(() => localStorage.setItem(`presentify-access-${qr}`, v), undefined),
  clearAccess: (qr: string) => safe(() => localStorage.removeItem(`presentify-access-${qr}`), undefined),
  device: () => safe(() => localStorage.getItem('presentify-device'), null),
  setDevice: (v: string) => safe(() => localStorage.setItem('presentify-device', v), undefined),
};

export interface MeetingInfo {
  state: 'OPEN' | 'NOT_YET' | 'ENDED' | 'UNAVAILABLE';
  opens_at: string | null;
  closes_at: string | null;
  organisation: { name: string; short_name: string | null; tagline: string | null; logo_url?: string | null; brand_color: string; default_language: 'en' | 'kn' };
  meeting: { title: string; reference_no: string; starts_at: string; ends_at: string; venue: string | null; chairperson: string | null };
  sessions: { title: string; starts_at: string; ends_at: string; presenter: string | null; designation: string | null }[];
  registration: {
    mode: 'REQUIRED' | 'OPTIONAL' | 'NONE';
    fields: { key: string; enabled: boolean; required: boolean }[];
    consent_en: string | null;
    consent_kn: string | null;
    retention_days: number | null;
    passcode_required: boolean;
    remember_allowed: boolean;
  };
  remembered: Record<string, string | null> | null;
}

export interface Item {
  kind: 'presentation' | 'attachment';
  id: string;
  title: string;
  file_name: string;
  extension: string;
  size: number | null;
  view: 'pdf' | 'image' | 'video' | null;
  download: boolean;
}

export interface Content {
  state: 'OPEN' | 'REGISTER' | 'NOT_YET' | 'ENDED' | 'UNAVAILABLE' | 'INVALID';
  opens_at?: string;
  participant: string | null;
  watermark: boolean;
  sessions: {
    id: string; title: string; starts_at: string; ends_at: string; presenter: string | null; designation: string | null;
    released: boolean; items: Item[];
  }[];
}
