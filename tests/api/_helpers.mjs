// Shared helpers for the Presentify API / security tests.
// The tests run against the disposable "presentify-test" stack (scripts/test.sh).

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { generateSync } from 'otplib';
import pg from 'pg';

export const env = Object.fromEntries(
  readFileSync(process.env.PRESENTIFY_ENV_FILE ?? new URL('../../.env.test', import.meta.url), 'utf8')
    .split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

export const BASE_URL = process.env.PRESENTIFY_URL ?? `http://localhost:${env.HTTP_PORT ?? 8090}`;
const AUTH_ADMIN_URL = `http://127.0.0.1:${process.env.TEST_AUTH_PORT ?? 54399}`;

export const db = new pg.Pool({
  host: '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 54322),
  user: 'postgres',
  password: env.POSTGRES_PASSWORD,
  database: 'postgres',
  max: 4,
});

export const PASSWORD = 'Presentify#Test2026';
const run = randomBytes(3).toString('hex');
let seq = 0;
export const uniqueEmail = (label) => `${label}.${run}.${++seq}@test.presentify.local`;
export const uniqueName = (label) => `${label} ${run}-${++seq}`;

export function newClient() {
  return createClient(BASE_URL, env.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function signIn(email, password = PASSWORD) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { client, session: data.session, error };
}

export async function signInOk(email, password = PASSWORD) {
  const r = await signIn(email, password);
  if (r.error) throw new Error(`sign-in failed for ${email}: ${r.error.message}`);
  return r.client;
}

/** Enrols an authenticator app for the signed-in client and upgrades the session to aal2. */
export async function enrollMfa(client) {
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `t-${randomBytes(3).toString('hex')}` });
  if (error) throw error;
  const code = generateSync({ secret: data.totp.secret });
  const v = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code });
  if (v.error) throw v.error;
  return { factorId: data.id, secret: data.totp.secret };
}

export async function verifyMfa(client, secret) {
  const { data } = await client.auth.mfa.listFactors();
  const factor = data.totp[0];
  const code = generateSync({ secret });
  const v = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (v.error) throw v.error;
}

export async function authAdmin(path, method = 'GET', body) {
  const res = await fetch(`${AUTH_ADMIN_URL}/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, apikey: env.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`auth admin ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Creates a Super Admin directly (as the server console would) and returns an MFA-verified client. */
export async function createSuperAdmin() {
  const email = uniqueEmail('super');
  const user = await authAdmin('/users', 'POST', { email, password: PASSWORD, email_confirm: true });
  await db.query(
    `insert into public.profiles (user_id, organisation_id, role, full_name, email, must_change_password)
     values ($1, null, 'SUPER_ADMIN', 'Test Super Admin', $2, false)`, [user.id, email]);
  const client = await signInOk(email);
  const mfa = await enrollMfa(client);
  return { client, email, userId: user.id, secret: mfa.secret };
}

/** Calls an Edge Function and returns { status, body }. */
export async function fn(client, name, body) {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token ?? env.ANON_KEY;
  const res = await fetch(`${BASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function createOrganisation(superClient, overrides = {}) {
  const { data: pkg } = await superClient.from('packages').select('id').eq('code', 'PROFESSIONAL').single();
  const { data, error } = await superClient.from('organisations')
    .insert({ name: uniqueName('Org'), package_id: pkg.id, ...overrides }).select('*').single();
  if (error) throw error;
  return data;
}

/** Creates a staff account through manage-users, then signs in and sets a permanent password. */
export async function createStaff(adminClient, orgId, role, extra = {}) {
  const email = uniqueEmail(role.toLowerCase());
  const r = await fn(adminClient, 'manage-users', {
    action: 'create', organisation_id: orgId, email, full_name: `Test ${role}`, role, ...extra,
  });
  if (r.status !== 201) throw new Error(`create ${role}: ${r.status} ${JSON.stringify(r.body)}`);
  const client = await signInOk(email, r.body.temporary_password);
  const { error } = await client.auth.updateUser({ password: PASSWORD });
  if (error) throw error;
  return { client, email, userId: r.body.user_id };
}

export async function closeAll() {
  await db.end();
}

// ---- Phase 2 helpers --------------------------------------------------------
export const SAMPLE = {
  pdf: new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'),
  pptx: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('[Content_Types].xml fake pptx body')]),
  html: new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>'),
};

export const CONTENT_TYPE = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function isoAt(daysFromNow, hour, minute = 0) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  const day = new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).toISOString();
}

export async function createMeeting(client, overrides = {}) {
  const { data, error } = await client.from('meetings').insert({
    title: uniqueName('Meeting'), starts_at: isoAt(1, 10), ends_at: isoAt(1, 13), venue: 'Training Hall', ...overrides,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function createSession(client, meetingId, overrides = {}) {
  const { data, error } = await client.from('meeting_sessions').insert({
    meeting_id: meetingId, title: uniqueName('Session'), starts_at: isoAt(1, 10), ends_at: isoAt(1, 11), ...overrides,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function createPresentation(client, sessionId, title = uniqueName('Presentation')) {
  const { data, error } = await client.from('presentations').insert({ session_id: sessionId, title }).select('*').single();
  if (error) throw error;
  return data;
}

/**
 * Full upload through the uploads function: start → PUT bytes → finish.
 * Returns { start, put, finish } responses so tests can inspect each step.
 */
export async function upload(client, { purpose, target, name, bytes, contentType, declaredSize, details }) {
  const start = await fn(client, 'uploads', {
    action: 'start', purpose, target_id: target, file_name: name, size: declaredSize ?? bytes.length, details,
  });
  if (start.status !== 200) return { start };
  const put = await fetch(`${BASE_URL}${start.body.upload_url}`, {
    method: 'PUT', headers: { 'Content-Type': contentType ?? start.body.content_type }, body: bytes,
  });
  const finish = await fn(client, 'uploads', { action: 'finish', file_id: start.body.file_id });
  return { start, put, finish };
}

// ---- Phase 3 helpers --------------------------------------------------------
export { makePdf } from '../lib/pdf.mjs';

/** Calls the participant ("public") function as a phone would: no sign-in. */
export async function publicCall(action, body = {}) {
  const res = await fetch(`${BASE_URL}/functions/v1/public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ANON_KEY}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
