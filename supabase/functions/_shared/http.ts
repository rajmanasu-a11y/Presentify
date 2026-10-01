// Small HTTP helpers shared by Presentify Edge Functions.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'INVALID_INPUT') => new HttpError(400, code, message);
export const forbidden = (message = 'You do not have permission to do this.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested record was not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);

const securityHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: securityHeaders });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`[${ref}]`, err);
  return json({ error: { code: 'INTERNAL', message: `Unable to complete the request. Please try again. (Reference ${ref})` } }, 500);
}

/** Wraps a handler: only POST with a JSON body, uniform error responses. */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  Deno.serve(async (req) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        throw badRequest('The request body must be JSON.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('The request body must be a JSON object.');
      return await handler(req, body);
    } catch (err) {
      return errorResponse(err);
    }
  });
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
}

// ---- input validation ------------------------------------------------------

export function str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number; min?: number; label?: string } = {}): string | null {
  const label = opts.label ?? key;
  const raw = body[key];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (opts.required) throw badRequest(`${label} is required.`);
    return null;
  }
  if (typeof raw !== 'string') throw badRequest(`${label} must be text.`);
  const v = raw.trim();
  if (opts.min && v.length < opts.min) throw badRequest(`${label} must have at least ${opts.min} characters.`);
  if (opts.max && v.length > opts.max) throw badRequest(`${label} must have at most ${opts.max} characters.`);
  return v;
}

export function bool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`${key} must be true or false.`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(body: Record<string, unknown>, key: string, required = true): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${key} is required.`);
    return null;
  }
  if (typeof v !== 'string' || !UUID.test(v)) throw badRequest(`${key} is not a valid identifier.`);
  return v.toLowerCase();
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}
