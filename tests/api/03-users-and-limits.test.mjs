import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAll, createOrganisation, createStaff, createSuperAdmin, db, fn, PASSWORD, signIn, signInOk, uniqueEmail,
} from './_helpers.mjs';

let superAdmin, org, admin;

before(async () => {
  superAdmin = await createSuperAdmin();
  org = await createOrganisation(superAdmin.client, { max_admins: 2, max_users: 4 });
  admin = await createStaff(superAdmin.client, org.id, 'ORG_ADMIN');
});
after(closeAll);

describe('staff accounts', () => {
  test('a new account must change its temporary password first', async () => {
    const email = uniqueEmail('presenter');
    const r = await fn(admin.client, 'manage-users', { action: 'create', email, full_name: 'New Presenter', role: 'PRESENTER' });
    assert.equal(r.status, 201);
    assert.match(r.body.temporary_password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{14}$/);
    const c = await signInOk(email, r.body.temporary_password);
    const { data: ctx } = await c.rpc('my_context');
    assert.equal(ctx.must_change_password, true);
    assert.equal(ctx.role, 'PRESENTER');
    const { error } = await c.auth.updateUser({ password: PASSWORD });
    assert.equal(error, null);
    const { data: after } = await c.rpc('my_context');
    assert.equal(after.must_change_password, false, 'flag clears when the person sets their own password');
  });

  test('weak passwords are refused', async () => {
    for (const weak of ['short1A', 'alllowercase123', 'NoDigitsHereAtAll']) {
      const { error } = await admin.client.auth.updateUser({ password: weak });
      assert.ok(error, `"${weak}" must be refused`);
    }
  });

  test('duplicate e-mail addresses are refused with a clear message', async () => {
    const r = await fn(admin.client, 'manage-users', { action: 'create', email: admin.email, full_name: 'Dup', role: 'ORGANISER' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'EMAIL_IN_USE');
  });

  test('input is validated', async () => {
    const r1 = await fn(admin.client, 'manage-users', { action: 'create', email: 'not-an-email', full_name: 'X Y', role: 'ORGANISER' });
    assert.equal(r1.status, 400);
    const r2 = await fn(admin.client, 'manage-users', { action: 'create', email: uniqueEmail('x'), full_name: 'X Y', role: 'SUPER_ADMIN' });
    assert.equal(r2.status, 400);
    const r3 = await fn(admin.client, 'manage-users', { action: 'explode' });
    assert.equal(r3.status, 400);
  });

  test('the administrator limit is enforced by the server', async () => {
    // max_admins = 2: one exists, a second is allowed, a third is refused.
    await createStaff(admin.client, org.id, 'ORG_ADMIN');
    const r = await fn(admin.client, 'manage-users', { action: 'create', email: uniqueEmail('admin3'), full_name: 'Third Admin', role: 'ORG_ADMIN' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'LIMIT_ADMINS');
    // and no orphan login was left behind
    const orphan = await db.query("select count(*)::int as n from auth.users u left join profiles p on p.user_id = u.id where p.user_id is null");
    assert.equal(orphan.rows[0].n, 0);
  });

  test('the user-account limit is enforced by the server', async () => {
    // max_users = 4: admin, presenter (earlier test), second admin → one more allowed, then refused.
    await createStaff(admin.client, org.id, 'ORGANISER');
    const r = await fn(admin.client, 'manage-users', { action: 'create', email: uniqueEmail('extra'), full_name: 'Extra User', role: 'PRESENTER' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'LIMIT_USERS');
  });

  test('the Super Admin can raise a limit at any time', async () => {
    const { error } = await superAdmin.client.from('organisations').update({ max_users: 10 }).eq('id', org.id);
    assert.equal(error, null);
    const r = await fn(admin.client, 'manage-users', { action: 'create', email: uniqueEmail('after-raise'), full_name: 'After Raise', role: 'PRESENTER' });
    assert.equal(r.status, 201);
  });

  test('administrators cannot deactivate themselves or change their own role', async () => {
    const r1 = await fn(admin.client, 'manage-users', { action: 'set_active', user_id: admin.userId, active: false });
    assert.equal(r1.status, 403);
    const r2 = await fn(admin.client, 'manage-users', { action: 'update', user_id: admin.userId, role: 'PRESENTER' });
    assert.equal(r2.status, 403);
  });

  test('deactivation blocks sign-in and cuts off access immediately', async () => {
    const victim = await createStaff(admin.client, org.id, 'PRESENTER');
    const before = await victim.client.from('organisations').select('id');
    assert.equal(before.data.length, 1);

    const r = await fn(admin.client, 'manage-users', { action: 'set_active', user_id: victim.userId, active: false });
    assert.equal(r.status, 200);

    // A still-valid token no longer sees anything, because the database checks the profile.
    const afterRows = await victim.client.from('organisations').select('id');
    assert.equal(afterRows.data.length, 0);
    const { error } = await signIn(victim.email);
    assert.ok(error);

    const back = await fn(admin.client, 'manage-users', { action: 'set_active', user_id: victim.userId, active: true });
    assert.equal(back.status, 200);
    const again = await signIn(victim.email);
    assert.equal(again.error, null);
  });

  test('a temporary password can be issued and the old one stops working', async () => {
    const person = await createStaff(admin.client, org.id, 'PRESENTER');
    const r = await fn(admin.client, 'manage-users', { action: 'reset_password', user_id: person.userId });
    assert.equal(r.status, 200);
    assert.ok((await signIn(person.email)).error, 'old password must fail');
    const c = await signInOk(person.email, r.body.temporary_password);
    const { data: ctx } = await c.rpc('my_context');
    assert.equal(ctx.must_change_password, true);
  });

  test('an administrator can update staff details and roles', async () => {
    const person = await createStaff(admin.client, org.id, 'PRESENTER');
    const r = await fn(admin.client, 'manage-users', {
      action: 'update', user_id: person.userId, full_name: 'Renamed Person', role: 'ORGANISER', can_create_meetings: false,
    });
    assert.equal(r.status, 200);
    const { data: ctx } = await person.client.rpc('my_context');
    assert.equal(ctx.full_name, 'Renamed Person');
    assert.equal(ctx.role, 'ORGANISER');
    assert.ok(!ctx.permissions.includes('MEETING_MANAGE'), 'organiser without meeting rights');
  });

  test('staff can update their own details without losing others', async () => {
    await admin.client.rpc('update_my_profile', { p_full_name: 'Admin Name', p_designation: 'SP', p_phone: '+91 80 2222 3333' });
    await admin.client.rpc('update_my_profile', { p_language: 'kn' });
    const { data: ctx } = await admin.client.rpc('my_context');
    assert.equal(ctx.preferred_language, 'kn');
    assert.equal(ctx.phone, '+91 80 2222 3333');
    assert.equal(ctx.designation, 'SP');
  });
});

describe('organisation status and subscription', () => {
  test('a deactivated organisation cannot sign in', async () => {
    const o = await createOrganisation(superAdmin.client);
    const a = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    await superAdmin.client.from('organisations').update({ status: 'INACTIVE' }).eq('id', o.id);
    const { error } = await signIn(a.email);
    assert.ok(error);
    assert.match(error.message, /organisation is currently disabled/i);
    const rows = await a.client.from('organisations').select('id');
    assert.equal(rows.data.length, 0, 'existing sessions lose access too');
    await superAdmin.client.from('organisations').update({ status: 'ACTIVE' }).eq('id', o.id);
    assert.equal((await signIn(a.email)).error, null, 'reactivation restores access');
  });

  test('within the grace period everything still works', async () => {
    const o = await createOrganisation(superAdmin.client, { expires_at: new Date(Date.now() - 2 * 86400000).toISOString(), grace_days: 15 });
    const a = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    const { data: ctx } = await a.client.rpc('my_context');
    assert.equal(ctx.organisation.access, 'GRACE');
    const { error } = await a.client.from('organisations').update({ tagline: 'still editable' }).eq('id', o.id);
    assert.equal(error, null);
  });

  test('after the grace period the organisation is view-only', async () => {
    const o = await createOrganisation(superAdmin.client);
    const a = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    await superAdmin.client.from('organisations').update({ expires_at: new Date(Date.now() - 30 * 86400000).toISOString(), grace_days: 15 }).eq('id', o.id);
    const { data: ctx } = await a.client.rpc('my_context');
    assert.equal(ctx.organisation.access, 'READ_ONLY');
    const view = await a.client.from('organisations').select('id').eq('id', o.id);
    assert.equal(view.data.length, 1, 'can still view');
    const upd = await a.client.from('organisations').update({ tagline: 'blocked' }).eq('id', o.id).select();
    assert.equal(upd.data?.length ?? 0, 0, 'cannot change');
    const r = await fn(a.client, 'manage-users', { action: 'create', email: uniqueEmail('ro'), full_name: 'Read Only', role: 'PRESENTER' });
    assert.equal(r.status, 403);
  });

  test('participant retention cannot exceed the package maximum', async () => {
    const { data: basic } = await superAdmin.client.from('packages').select('id, max_retention_days').eq('code', 'BASIC').single();
    assert.equal(basic.max_retention_days, 365);
    const o = await createOrganisation(superAdmin.client, { package_id: basic.id });
    const a = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    const { error } = await a.client.from('organisation_settings').update({ participant_retention_days: null }).eq('organisation_id', o.id);
    assert.ok(error, 'indefinite retention must be refused on BASIC');
  });
});
