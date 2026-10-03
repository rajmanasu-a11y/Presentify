// Phase 4: QR codes for draft meetings (wizard), live figures for display and
// presenter screens — who may see them, and that they never contain names.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAll, createMeeting, createOrganisation, createSession, createStaff, createSuperAdmin, db, newClient, publicCall,
} from './_helpers.mjs';

const PERSON = { name: 'Kavitha Hegde (DEMO)', designation: 'Section Officer', organisation: 'DPAR (DEMO)' };
let superAdmin, orgA, adminA, adminB, organiserA, presenterA, presenterOther, meeting, token;

before(async () => {
  superAdmin = await createSuperAdmin();
  orgA = await createOrganisation(superAdmin.client);
  const orgB = await createOrganisation(superAdmin.client);
  adminA = await createStaff(superAdmin.client, orgA.id, 'ORG_ADMIN');
  adminB = await createStaff(superAdmin.client, orgB.id, 'ORG_ADMIN');
  organiserA = await createStaff(adminA.client, orgA.id, 'ORGANISER');
  presenterA = await createStaff(adminA.client, orgA.id, 'PRESENTER');
  presenterOther = await createStaff(adminA.client, orgA.id, 'PRESENTER');
  const { data: p } = await adminA.client.from('presenters')
    .insert({ full_name: 'Prof. Ananth Rao (DEMO)', user_id: presenterA.userId }).select('id').single();
  meeting = await createMeeting(organiserA.client, { title: 'Wizard meeting (DEMO)' });
  await createSession(organiserA.client, meeting.id, { presenter_id: p.id });
});
after(closeAll);

describe('QR codes for draft meetings', () => {
  test('the organiser can create the QR code before publishing; it says "not open yet"', async () => {
    const { data, error } = await organiserA.client.rpc('regenerate_qr', { p_meeting: meeting.id });
    assert.equal(error, null);
    token = data;
    const info = await publicCall('info', { token });
    assert.equal(info.status, 200);
    assert.equal(info.body.state, 'NOT_YET');
    assert.equal(info.body.opens_at, null);
    const reg = await publicCall('register', { token, consent: true, fields: PERSON });
    assert.equal(reg.body.error.code, 'NOT_YET');
    const audit = await db.query(`select action from public.audit_logs where entity_id = $1 and action like 'QR_%'`, [meeting.id]);
    assert.deepEqual(audit.rows.map((r) => r.action), ['QR_GENERATED']);
  });

  test('publishing keeps the same code, which then opens', async () => {
    const { error } = await organiserA.client.from('meetings').update({ status: 'PUBLISHED', availability_mode: 'ALWAYS' }).eq('id', meeting.id);
    assert.equal(error, null);
    const q = await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [meeting.id]);
    assert.deepEqual(q.rows.map((r) => r.token), [token]);
    assert.equal((await publicCall('info', { token })).body.state, 'OPEN');
  });

  test('presenters and other organisations cannot create it; archived meetings are refused', async () => {
    const draft = await createMeeting(organiserA.client);
    for (const c of [presenterA.client, adminB.client, newClient()]) {
      const r = await c.rpc('regenerate_qr', { p_meeting: draft.id });
      assert.ok(r.error);
    }
    const archived = await createMeeting(organiserA.client);
    await createSession(organiserA.client, archived.id);
    await organiserA.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', archived.id);
    await organiserA.client.from('meetings').update({ status: 'ARCHIVED' }).eq('id', archived.id);
    const r = await organiserA.client.rpc('regenerate_qr', { p_meeting: archived.id });
    assert.equal(r.error?.hint, 'ARCHIVED');
  });

  test('a meeting moved back to draft shows "not open yet" instead of its material', async () => {
    const m = await createMeeting(organiserA.client);
    await createSession(organiserA.client, m.id);
    await organiserA.client.from('meetings').update({ status: 'PUBLISHED', availability_mode: 'ALWAYS' }).eq('id', m.id);
    const t = (await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [m.id])).rows[0].token;
    const reg = await publicCall('register', { token: t, consent: true, fields: PERSON });
    assert.equal(reg.status, 201);
    await organiserA.client.from('meetings').update({ status: 'DRAFT' }).eq('id', m.id);
    const c = await publicCall('content', { token: t, access: reg.body.access_token });
    assert.equal(c.body.state, 'NOT_YET');
    assert.equal(c.body.sessions, undefined);
  });
});

describe('live figures', () => {
  test('count registrations, people active now, views and downloads — numbers only', async () => {
    const before = await organiserA.client.rpc('meeting_live_stats', { p_meeting: meeting.id });
    assert.equal(before.error, null);
    assert.equal(before.data.total, 0);
    for (const name of ['One (DEMO)', 'Two (DEMO)', 'Three (DEMO)']) {
      const r = await publicCall('register', { token, consent: true, fields: { ...PERSON, name } });
      assert.equal(r.status, 201);
    }
    await db.query(`update public.attendance set last_access_at = now() - interval '1 hour'
                    where meeting_id = $1 and details->>'name' = 'Three (DEMO)'`, [meeting.id]);
    const { data } = await organiserA.client.rpc('meeting_live_stats', { p_meeting: meeting.id });
    assert.equal(data.total, 3);
    assert.equal(data.registered, 3);
    assert.equal(data.anonymous, 0);
    assert.equal(data.active_now, 2);
    assert.equal(data.joined_last_10_min, 3);
    assert.ok('views' in data && 'downloads' in data && data.as_of);
    assert.ok(!JSON.stringify(data).includes('DEMO'), 'no names');
  });

  test('administrators, organisers and the meeting\'s presenter may see them', async () => {
    for (const c of [adminA.client, organiserA.client, presenterA.client]) {
      const r = await c.rpc('meeting_live_stats', { p_meeting: meeting.id });
      assert.equal(r.error, null);
      assert.equal(r.data.total, 3);
    }
  });

  test('presenters lose them when the organisation switches the setting off', async () => {
    const { error } = await adminA.client.from('organisation_settings').update({ presenters_see_count: false }).eq('organisation_id', orgA.id);
    assert.equal(error, null);
    const r = await presenterA.client.rpc('meeting_live_stats', { p_meeting: meeting.id });
    assert.equal(r.error?.code, '42501');
    assert.equal((await organiserA.client.rpc('meeting_live_stats', { p_meeting: meeting.id })).error, null);
    await adminA.client.from('organisation_settings').update({ presenters_see_count: true }).eq('organisation_id', orgA.id);
  });

  test('other presenters, other organisations, the Super Admin and the public may not', async () => {
    for (const c of [presenterOther.client, adminB.client, superAdmin.client, newClient()]) {
      const r = await c.rpc('meeting_live_stats', { p_meeting: meeting.id });
      assert.ok(r.error, 'refused');
    }
  });

  test('an organiser cannot change the presenter setting; only administrators can', async () => {
    const r = await organiserA.client.from('organisation_settings').update({ presenters_see_count: false })
      .eq('organisation_id', orgA.id).select();
    assert.ok(r.error || r.data.length === 0);
    const s = await db.query('select presenters_see_count from public.organisation_settings where organisation_id = $1', [orgA.id]);
    assert.equal(s.rows[0].presenters_see_count, true);
  });
});
