// Creates a Presentify Super Administrator.
//
//   docker compose run --rm tools create-superadmin
//   docker compose run --rm tools create-superadmin --email a@b.in --name "Full Name"
//
// Super Admins are created only from the server console, never from the web
// interface. A temporary password is generated; the person must change it and
// set up an authenticator app (MFA) when they first sign in.

import { createInterface } from 'node:readline/promises';
import { randomInt } from 'node:crypto';
import pg from 'pg';

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)$/.exec(args[i]);
    if (m) out[m[1]] = args[++i];
  }
  return out;
}

// Readable temporary password that satisfies the password policy.
export function temporaryPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 14) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function createSuperAdmin(args) {
  const opts = parseArgs(args);
  if (!opts.email || !opts.name) {
    if (!process.stdin.isTTY) throw new Error('Provide --email and --name (or run with -it for interactive input).');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    opts.email ||= (await rl.question('E-mail address of the Super Admin: ')).trim();
    opts.name ||= (await rl.question('Full name: ')).trim();
    rl.close();
  }
  const email = String(opts.email || '').trim().toLowerCase();
  const name = String(opts.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid e-mail address is required.');
  if (name.length < 2) throw new Error('A full name is required.');

  const password = opts.password || temporaryPassword();
  const gotrue = process.env.GOTRUE_URL || 'http://auth:9999';
  const key = process.env.SERVICE_ROLE_KEY;

  const res = await fetch(`${gotrue}/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Could not create the login: ${body.msg || body.message || body.error_description || res.status}`);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into public.profiles (user_id, organisation_id, role, full_name, email, must_change_password)
       values ($1, null, 'SUPER_ADMIN', $2, $3, $4)`,
      [body.id, name, email, !opts.password],
    );
    await client.query(
      `insert into public.audit_logs (organisation_id, actor_role, actor_name, action, entity_type, entity_id, summary)
       values (null, 'SYSTEM', 'Server console', 'USER_CREATED', 'user', $1, $2)`,
      [body.id, `Super Admin ${name} <${email}> created from the server console`],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    // Do not leave a login without a profile behind.
    await fetch(`${gotrue}/admin/users/${body.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}`, apikey: key } });
    throw err;
  } finally {
    await client.end();
  }

  console.log('\nSuper Admin created.');
  console.log(`  E-mail:   ${email}`);
  if (!opts.password) console.log(`  Temporary password: ${password}`);
  console.log('\nAt first sign-in the password must be changed and an authenticator app (MFA) set up.');
}
