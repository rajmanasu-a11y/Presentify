// Runtime configuration served by the gateway as /config.js, so the same build
// works on a laptop and on the State Data Centre server.
interface RuntimeConfig {
  anonKey: string;
  publicUrl: string;
  testMode: boolean;
  emailEnabled: boolean;
}

declare global {
  interface Window {
    __PRESENTIFY__?: Partial<RuntimeConfig>;
  }
}

const raw = window.__PRESENTIFY__ ?? {};

export const config: RuntimeConfig = {
  anonKey: raw.anonKey ?? '',
  publicUrl: raw.publicUrl || window.location.origin,
  testMode: raw.testMode !== false,
  emailEnabled: raw.emailEnabled === true,
};
