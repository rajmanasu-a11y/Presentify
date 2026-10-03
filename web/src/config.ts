// Runtime configuration served by the gateway as /config.js, so the same build
// works on a laptop and on the State Data Centre server.
/** "30m" / "1h" / "90s" / "2h30m" → milliseconds (default 30 minutes). */
export function parseDuration(value: string | undefined, fallbackMs = 30 * 60 * 1000): number {
  if (!value) return fallbackMs;
  let ms = 0;
  const re = /(\d+(?:\.\d+)?)(h|m|s)/g;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = re.exec(value))) {
    found = true;
    ms += Number(match[1]) * (match[2] === 'h' ? 3600e3 : match[2] === 'm' ? 60e3 : 1e3);
  }
  return found && ms > 0 ? ms : fallbackMs;
}

interface RuntimeConfig {
  anonKey: string;
  publicUrl: string;
  testMode: boolean;
  emailEnabled: boolean;
  /** Milliseconds without mouse/keyboard use before the screens sign out. */
  inactivityMs: number;
}

declare global {
  interface Window {
    __PRESENTIFY__?: Partial<Omit<RuntimeConfig, 'inactivityMs'>> & { sessionInactivity?: string };
  }
}

const raw = window.__PRESENTIFY__ ?? {};

export const config: RuntimeConfig = {
  anonKey: raw.anonKey ?? '',
  publicUrl: raw.publicUrl || window.location.origin,
  testMode: raw.testMode !== false,
  emailEnabled: raw.emailEnabled === true,
  inactivityMs: parseDuration(raw.sessionInactivity),
};
