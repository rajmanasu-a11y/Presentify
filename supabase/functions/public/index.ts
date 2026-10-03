// public — everything a participant's phone needs. No sign-in.
//
// POST /functions/v1/public  { "action": "...", "token": "<QR token>", ... }
//
//   info      { token, device? }                       → landing page: branding, meeting, sessions, form
//   register  { token, fields, consent, passcode?, remember?, anonymous? } → { access_token, device_token? }
//   content   { token, access }                         → sessions with viewable / downloadable items
//   file      { token, access, kind, id, mode }         → { url, kind, file_name }  (short-lived link)
//
// All decisions (is the QR valid, is the meeting open, passcode, limits, what is
// released, may this be downloaded) are made in the database (public_* functions).
// This function only adds the short-lived storage links.

import { badRequest, clientIp, HttpError, json, serve, str } from '../_shared/http.ts';
import { DbRequestError, rest } from '../_shared/platform.ts';

const STORAGE_URL = Deno.env.get('PRESENTIFY_STORAGE_URL') ?? 'http://storage:5000';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;

function token(body: Record<string, unknown>, key: string, required = true): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${key} is required.`, 'INVALID');
    return null;
  }
  if (typeof v !== 'string' || !TOKEN.test(v)) {
    if (key === 'token') throw new HttpError(404, 'INVALID', 'This QR code is not valid.');
    if (key === 'access') throw new HttpError(403, 'REGISTER', 'Please register first.');
    return null; // a malformed remember-me token is simply ignored
  }
  return v;
}

/** Database rule → { code, message } the participant page can translate. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rest<T>(`/rpc/${fn}`, { method: 'POST', body: args });
  } catch (err) {
    if (err instanceof DbRequestError) {
      const hint = err.db.hint ?? '';
      const status = err.db.code === '42501' ? 403 : err.db.code === '23514' ? 409 : 422;
      throw new HttpError(status, hint || 'INVALID', err.db.message ?? 'Not allowed.');
    }
    throw err;
  }
}

async function signedUrl(bucket: string, path: string, seconds: number, downloadName?: string): Promise<string> {
  const res = await fetch(`${STORAGE_URL}/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) throw new HttpError(502, 'STORAGE', 'The file store is not available. Please try again.');
  const { signedURL } = await res.json() as { signedURL: string };
  const url = `/storage/v1${signedURL}`;
  return downloadName ? `${url}&download=${encodeURIComponent(downloadName)}` : url;
}

serve(async (req, body) => {
  const action = str(body, 'action', { required: true });
  const qr = token(body, 'token')!;
  const ip = clientIp(req);
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300);

  switch (action) {
    case 'info': {
      const info = await call<Record<string, any>>('public_meeting_info', { p_token: qr, p_device: token(body, 'device', false) });
      if (info.state === 'INVALID') throw new HttpError(404, 'INVALID', 'This QR code is not valid.');
      const logo = info.organisation?.logo_path as string | null;
      if (logo) {
        info.organisation.logo_url = await signedUrl('branding', logo, 3600).catch(() => null);
      }
      delete info.organisation.logo_path;
      return json(info);
    }

    case 'register': {
      // Plain text values only (the database cannot store NUL characters); the database trims and caps them.
      const raw = typeof body.fields === 'object' && body.fields !== null && !Array.isArray(body.fields) ? body.fields : {};
      const fields = Object.fromEntries(Object.entries(raw as Record<string, unknown>).slice(0, 30)
        .filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && typeof v === 'string')
        .map(([k, v]) => [k, (v as string).replaceAll('\u0000', ' ').slice(0, 1000)]));
      const passcode = typeof body.passcode === 'string' ? body.passcode.replaceAll('\u0000', '').slice(0, 60) : null;
      const result = await call<{ access_token: string; device_token: string | null }>('public_register', {
        p_token: qr, p_fields: fields, p_consent: body.consent === true, p_passcode: passcode,
        p_remember: body.remember === true, p_anonymous: body.anonymous === true, p_ip: ip, p_user_agent: ua,
      });
      return json(result, 201);
    }

    case 'content': {
      const content = await call<Record<string, unknown>>('public_meeting_content', {
        p_token: qr, p_access: token(body, 'access', false) ?? '', p_ip: ip, p_user_agent: ua,
      });
      return json(content);
    }

    case 'file': {
      const kind = str(body, 'kind', { required: true });
      const mode = str(body, 'mode', { required: true });
      const id = str(body, 'id', { required: true });
      if (!/^[0-9a-f-]{36}$/i.test(id!)) throw badRequest('Unknown item.', 'NOT_AVAILABLE');
      const file = await call<{ object_path: string; file_name: string; kind: string }>('public_file_access', {
        p_token: qr, p_access: token(body, 'access'), p_kind: kind, p_id: id, p_mode: mode, p_ip: ip, p_user_agent: ua,
      });
      // Documents are fetched at once (the link only has to last until the download starts);
      // videos are streamed in pieces while they play.
      const seconds = file.kind === 'video' ? 3 * 3600 : 60;
      const url = await signedUrl('content', file.object_path, seconds, mode === 'download' ? file.file_name : undefined);
      return json({ url, kind: file.kind, file_name: file.file_name });
    }

    default:
      throw badRequest('Unknown action.');
  }
});
