import { FunctionsHttpError } from '@supabase/supabase-js';
import i18n from '../i18n';

/** Error raised by our own API helpers, carrying a code and a readable message. */
export class AppError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const t = (k: string) => i18n.t(k);

/** Turns any error into a sentence a non-technical user can act on. */
export function friendlyMessage(err: unknown): string {
  if (!err) return t('common.unknownError');
  if (err instanceof AppError) {
    if (err.code && i18n.exists(`errors.${err.code}`)) return t(`errors.${err.code}`);
    return err.message || t('common.unknownError');
  }
  const e = err as { message?: string; code?: string; status?: number; name?: string; hint?: string };
  const msg = e.message ?? '';
  if (e.name === 'TypeError' && /fetch|network/i.test(msg)) return t('common.networkError');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t('common.networkError');
  if (e.hint && i18n.exists(`errors.${e.hint}`)) return t(`errors.${e.hint}`);
  if (e.code === '42501' || /permission denied|row-level security/i.test(msg)) return t('common.permissionDenied');
  if (e.code === '23505') {
    if (/organisations_name_uq/.test(msg)) return t('errors.duplicateOrgName');
    return t('errors.DUPLICATE');
  }
  if (e.code === 'PGRST301' || e.status === 401 || /JWT expired/i.test(msg)) return t('common.sessionExpired');
  // Database rule messages (limits, subscription) are written for users already.
  if (e.code === '23514' || e.code === 'P0001') return msg;
  return msg && msg.length < 200 ? msg : t('common.unknownError');
}

/** Calls an Edge Function and returns its JSON, throwing AppError with the server's message. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new AppError(payload?.error?.message ?? t('common.unknownError'), payload?.error?.code);
    }
    throw error;
  }
  return data as T;
}
