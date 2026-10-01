// Organisation isolation: one organisation must never see or change another's data,
// enforced by the database itself (not only the screens).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, createOrganisation, createStaff, createSuperAdmin, db, fn, signInOk } from './_helpers.mjs';

let superAdmin, orgA, orgB, adminA, adminB, organiserA;

before(async () => {
  superAdmin = await createSuperAdmin();
  orgA = await createOrganisation(superAdmin.client);
  orgB = await createOrganisation(superAdmin.client);
  adminA = await createStaff(superAdmin.client, orgA.id, 'ORG_ADMIN');
  adminB = await createStaff(superAdmin.client, orgB.id, 'ORG_ADMIN');
  organiserA = await createStaff(adminA.client, orgA.id, 'ORGANISER');
});
after(closeAll);

describe('organisation isolation', () => {
  test('an organisation admin sees only their own organisation', async () => {
    const { data } = await adminA.client.from('organisations').select('id');
    assert.deepEqual(data.map((o) => o.id), [orgA.id]);
  });

  test('settings, profiles and limits of another organisation are invisible', async () => {
    const s = await adminA.client.from('organisation_settings').select('organisation_id').eq('organisation_id', orgB.id);
    assert.equal(s.data.length, 0);
    const p = await adminA.client.from('profiles').select('user_id').eq('organisation_id', orgB.id);
    assert.equal(p.data.length, 0);
    const l = await adminA.client.from('organisation_limits').select('*').eq('organisation_id', orgB.id);
    assert.equal(l.data.length, 0);
  });

  test("another organisation's profile cannot be changed", async () => {
    const { data } = await adminA.client.from('organisations').update({ tagline: 'hacked' }).eq('id', orgB.id).select();
    assert.equal(data?.length ?? 0, 0);
    const row = await db.query('select tagline from organisations where id = $1', [orgB.id]);
    assert.notEqual(row.rows[0].tagline, 'hacked');
  });

  test("another organisation's usage cannot be read", async () => {
    const { error } = await adminA.client.rpc('organisation_usage', { p_org: orgB.id });
    assert.ok(error);
    assert.equal(error.code, '42501');
  });

  test("another organisation's staff cannot be managed", async () => {
    const r1 = await fn(adminA.client, 'manage-users', { action: 'set_active', user_id: adminB.userId, active: false });
    assert.equal(r1.status, 403);
    const r2 = await fn(adminA.client, 'manage-users', {
      action: 'create', organisation_id: orgB.id, email: 'x@example.com', full_name: 'Intruder', role: 'ORG_ADMIN',
    });
    assert.equal(r2.status, 403);
    const r3 = await fn(adminA.client, 'manage-users', { action: 'reset_password', user_id: adminB.userId });
    assert.equal(r3.status, 403);
  });

  test('organisation admins cannot create organisations', async () => {
    const { data: pkg } = await adminA.client.from('packages').select('id').limit(1).single();
    const { error } = await adminA.client.from('organisations').insert({ name: 'Rogue org', package_id: pkg.id });
    assert.ok(error);
  });

  test('organisation admins cannot change their own package, limits, status or expiry', async () => {
    for (const patch of [{ max_users: 999 }, { status: 'INACTIVE' }, { expires_at: '2099-01-01T00:00:00Z' }, { grace_days: 300 }]) {
      const { error } = await adminA.client.from('organisations').update(patch).eq('id', orgA.id);
      assert.ok(error, `update ${JSON.stringify(patch)} must be refused`);
    }
  });

  test('organisation admins can edit their own profile and settings', async () => {
    const { error } = await adminA.client.from('organisations').update({ tagline: 'Paperless meetings' }).eq('id', orgA.id);
    assert.equal(error, null);
    const s = await adminA.client.from('organisation_settings').update({ downloads_default: true }).eq('organisation_id', orgA.id).select();
    assert.equal(s.error, null);
    assert.equal(s.data.length, 1);
  });

  test('organisers cannot edit the organisation or manage users', async () => {
    const { data } = await organiserA.client.from('organisations').update({ tagline: 'organiser edit' }).eq('id', orgA.id).select();
    assert.equal(data?.length ?? 0, 0);
    const r = await fn(organiserA.client, 'manage-users', {
      action: 'create', email: 'y@example.com', full_name: 'Someone', role: 'PRESENTER',
    });
    assert.equal(r.status, 403);
  });

  test('staff cannot write profiles, audit records or system settings directly', async () => {
    const p = await adminA.client.from('profiles').update({ role: 'SUPER_ADMIN' }).eq('user_id', organiserA.userId).select();
    assert.ok(p.error || p.data.length === 0);
    const a = await adminA.client.from('audit_logs').insert({ action: 'FAKE', summary: 'forged' });
    assert.ok(a.error);
    const s = await adminA.client.from('system_settings').update({ value: 1 }).eq('key', 'security.lockout_threshold').select();
    assert.ok(s.error || s.data.length === 0);
  });

  test('the Super Admin sees all organisations', async () => {
    const { data } = await superAdmin.client.from('organisations').select('id').in('id', [orgA.id, orgB.id]);
    assert.equal(data.length, 2);
  });

  test('Super Admin rights require a verified authenticator code (aal2)', async () => {
    const aal1 = await signInOk(superAdmin.email);
    const { data } = await aal1.from('organisations').select('id');
    assert.equal(data.length, 0, 'without MFA verification the Super Admin sees nothing');
    const r = await fn(aal1, 'manage-users', { action: 'create', organisation_id: orgA.id, email: 'z@example.com', full_name: 'Z Z', role: 'ORGANISER' });
    assert.equal(r.status, 403);
  });
});
