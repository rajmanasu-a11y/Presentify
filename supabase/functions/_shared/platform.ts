// Direct, dependency-free access to the Supabase services from Edge Functions.
// Functions talk to Auth and the REST API inside the Docker network; the service
// key is only ever used here, on the server.

import { forbidden, HttpError } from './http.ts';

const AUTH_URL = Deno.env.get('PRESENTIFY_AUTH_URL') ?? 'http://auth:9999';
const REST_URL = Deno.env.get('PRESENTIFY_REST_URL') ?? 'http://rest:3000';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export interface Caller {
  userId: string;
  token: string;
  aal: string;
  context: {
    role: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'ORGANISER' | 'PRESENTER';
    full_name: string;
    is_active: boolean;
    mfa_required: boolean;
    permissions: string[];
    organisation: null | { id: string; name: string; access: string };
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return JSON.parse(atob(b64));
}

/**
 * Identifies the signed-in staff member making the request. The router has
 * already verified the token signature; here we confirm with Auth that the
 * session is still valid and load the person's role from the database.
 */
export async function requireCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const unauth = new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  if (!token) throw unauth;
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    throw unauth;
  }
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') throw unauth;

  const userRes = await fetch(`${AUTH_URL}/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY } });
  if (!userRes.ok) throw unauth;

  const ctxRes = await fetch(`${REST_URL}/rpc/my_context`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const context = ctxRes.ok ? await ctxRes.json() : null;
  if (!context || !context.is_active) throw forbidden('Your account is not active.');
  const aal = String(payload.aal ?? 'aal1');
  if (context.mfa_required && aal !== 'aal2') {
    throw forbidden('Please complete the authenticator-app verification first.');
  }
  return { userId: payload.sub, token, aal, context };
}

// ---- REST API as the service role ------------------------------------------

export interface DbError {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
}

export class DbRequestError extends Error {
  constructor(public status: number, public db: DbError) {
    super(db.message ?? `Database request failed (${status})`);
  }
}

export async function rest<T = unknown>(path: string, init: {
  method?: string;
  body?: unknown;
  actor?: string;
  ip?: string | null;
  prefer?: string;
} = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (init.actor) headers['X-Presentify-Actor'] = init.actor;
  if (init.ip) headers['X-Real-IP'] = init.ip;
  if (init.prefer) headers['Prefer'] = init.prefer;
  const res = await fetch(`${REST_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new DbRequestError(res.status, data ?? {});
  return data as T;
}

/** Converts database rule violations into messages a user can act on. */
export function dbToHttp(err: unknown): unknown {
  if (err instanceof DbRequestError) {
    const { code, message } = err.db;
    if (code === '23514' || code === 'P0001') return new HttpError(422, err.db.hint ?? 'RULE_VIOLATION', message ?? 'This change is not allowed.');
    if (code === '23505') return new HttpError(409, 'DUPLICATE', 'A record with these details already exists.');
    if (code === '42501') return new HttpError(403, 'FORBIDDEN', message ?? 'You do not have permission to do this.');
  }
  return err;
}

// ---- Auth admin API --------------------------------------------------------

export async function authAdmin<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${AUTH_URL}/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message: string = data?.msg ?? data?.message ?? data?.error_description ?? `Auth request failed (${res.status})`;
    if (/already been registered|already exists/i.test(message)) {
      throw new HttpError(409, 'EMAIL_IN_USE', 'An account with this e-mail address already exists.');
    }
    if (res.status === 422 && /password/i.test(message)) {
      throw new HttpError(422, 'WEAK_PASSWORD', 'The password must have at least 10 characters, including upper-case and lower-case letters and a number.');
    }
    throw new HttpError(res.status >= 500 ? 502 : 400, 'AUTH_ERROR', message);
  }
  return data as T;
}

// ---- misc ------------------------------------------------------------------

/** Readable temporary password that satisfies the password policy. */
export function temporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789'];
  const all = sets.join('');
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = sets.map(pick);
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
