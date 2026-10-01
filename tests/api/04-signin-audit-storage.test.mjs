import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, createOrganisation, createStaff, createSuperAdmin, db, fn, PASSWORD, signIn } from './_helpers.mjs';

let superAdmin, orgA, orgB, adminA, adminB;

before(async () => {
  superAdmin = await createSuperAdmin();
  orgA = await createOrganisation(superAdmin.client);
  orgB = await createOrganisation(superAdmin.client);
  adminA = await createStaff(superAdmin.client, orgA.id, 'ORG_ADMIN');
  adminB = await createStaff(superAdmin.client, orgB.id, 'ORG_ADMIN');
});
after(closeAll);

describe('sign-in protection', () => {
  test('an account locks after 5 wrong passwords, even for the right password', async () => {
    const victim = await createStaff(adminA.client, orgA.id, 'PRESENTER');
    for (let i = 0; i < 5; i++) {
      const { error } = await signIn(victim.email, 'Wrong#Password1');
      assert.ok(error);
    }
    const { error } = await signIn(victim.email, PASSWORD);
    assert.ok(error, 'locked account must refuse the correct password');
    assert.match(error.message, /too many unsuccessful attempts/i);

    const events = await db.query('select event from login_events where user_id = $1 order by id', [victim.userId]);
    const kinds = events.rows.map((r) => r.event);
    assert.equal(kinds.filter((k) => k === 'SIGN_IN_FAILED').length, 5);
    assert.ok(kinds.includes('ACCOUNT_LOCKED'));

    // An administrator's temporary password does not bypass the lock window; clearing it
    // here simulates the lock period passing.
    await db.query('delete from app.auth_failures where user_id = $1', [victim.userId]);
    assert.equal((await signIn(victim.email)).error, null);
  });

  test('successful sign-ins are recorded', async () => {
    await signIn(adminA.email);
    const { rows } = await db.query("select count(*)::int as n from login_events where user_id = $1 and event = 'SIGN_IN'", [adminA.userId]);
    assert.ok(rows[0].n >= 1);
  });

  test('an administrator can remove a lost authenticator app', async () => {
    const r = await fn(superAdmin.client, 'manage-users', { action: 'reset_mfa', user_id: adminA.userId });
    assert.equal(r.status, 200);
  });
});

describe('audit log', () => {
  test('important actions are recorded with the person who did them', async () => {
    const { rows } = await db.query(
      `select action, actor_user_id, actor_name from audit_logs
        where organisation_id = $1 order by id`, [orgA.id]);
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('ORGANISATION_CREATED'));
    assert.ok(actions.includes('USER_CREATED'));
    const created = rows.find((r) => r.action === 'ORGANISATION_CREATED');
    assert.equal(created.actor_user_id, superAdmin.userId);
    const userCreated = rows.find((r) => r.action === 'USER_CREATED');
    assert.equal(userCreated.actor_user_id, superAdmin.userId, 'actor recorded for changes made by server functions');
  });

  test('changes record old and new values', async () => {
    await adminA.client.from('organisations').update({ tagline: 'Audit me' }).eq('id', orgA.id);
    const { rows } = await db.query(
      "select details, actor_user_id, ip from audit_logs where organisation_id = $1 and action = 'ORGANISATION_UPDATED' order by id desc limit 1", [orgA.id]);
    assert.equal(rows[0].details.tagline.to, 'Audit me');
    assert.equal(rows[0].actor_user_id, adminA.userId);
    assert.ok(rows[0].ip, 'IP address recorded');
  });

  test('audit records cannot be changed or deleted, even by the database owner', async () => {
    const { rows } = await db.query('select id from audit_logs limit 1');
    await assert.rejects(db.query("update audit_logs set summary = 'tampered' where id = $1", [rows[0].id]), /cannot be changed/);
    await assert.rejects(db.query('delete from audit_logs where id = $1', [rows[0].id]), /cannot be changed/);
    await assert.rejects(db.query('truncate audit_logs'), /cannot be changed/);
  });

  test('organisation admins see only their own organisation’s audit records', async () => {
    const { data } = await adminA.client.from('audit_logs').select('organisation_id').limit(500);
    assert.ok(data.length > 0);
    assert.ok(data.every((r) => r.organisation_id === orgA.id));
  });

  test('a browser cannot impersonate another person in the audit log', async () => {
    const res = await adminA.client.from('organisations').update({ tagline: 'spoof attempt' }).eq('id', orgA.id)
      .setHeader('X-Presentify-Actor', adminB.userId);
    assert.equal(res.error, null);
    const { rows } = await db.query(
      "select actor_user_id from audit_logs where organisation_id = $1 and action = 'ORGANISATION_UPDATED' order by id desc limit 1", [orgA.id]);
    assert.equal(rows[0].actor_user_id, adminA.userId);
  });
});

describe('branding storage', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 0, 0, 1, 1, 0, 5, 24, 216, 77, 41, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

  test('an organisation can upload its own logo, but not into another organisation', async () => {
    const own = await adminA.client.storage.from('branding').upload(`${orgA.id}/logo-test.png`, png, { contentType: 'image/png' });
    assert.equal(own.error, null);
    const other = await adminA.client.storage.from('branding').upload(`${orgB.id}/logo-evil.png`, png, { contentType: 'image/png' });
    assert.ok(other.error);
  });

  test("another organisation's logo cannot be read", async () => {
    await adminB.client.storage.from('branding').upload(`${orgB.id}/logo-b.png`, png, { contentType: 'image/png' });
    const { error } = await adminA.client.storage.from('branding').createSignedUrl(`${orgB.id}/logo-b.png`, 60);
    assert.ok(error);
    const own = await adminB.client.storage.from('branding').createSignedUrl(`${orgB.id}/logo-b.png`, 60);
    assert.equal(own.error, null);
  });

  test('only images are accepted for branding', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const { error } = await adminA.client.storage.from('branding').upload(`${orgA.id}/logo.html`, html, { contentType: 'text/html' });
    assert.ok(error);
  });

  test('storage usage is reported', async () => {
    const { data, error } = await adminA.client.rpc('organisation_usage', { p_org: orgA.id });
    assert.equal(error, null);
    assert.ok(data.storage_bytes > 0);
    assert.equal(data.limits.max_admins, 5);
  });
});
