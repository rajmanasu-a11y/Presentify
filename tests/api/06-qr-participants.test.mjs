// Phase 3: QR codes, availability, participant registration, viewing and
// downloading, and who may see participant data.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, closeAll, createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin,
  db, env, isoAt, newClient, SAMPLE, upload,
} from './_helpers.mjs';

/** Calls the participant ("public") function exactly as a phone would: no sign-in. */
async function pub(action, body = {}, headers = {}) {
  const res = await fetch(`${BASE_URL}/functions/v1/public`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ANON_KEY}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const PERSON = { name: 'Asha Rao (DEMO)', designation: 'Deputy Secretary', organisation: 'Department of Training (DEMO)' };

let superAdmin, orgA, orgB, adminA, adminB, organiserA, presenterA;
let meeting, session1, session2, pdfPres, pptxPres, hiddenPres, attachmentId, qr;

async function activeQr(meetingId) {
  const r = await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [meetingId]);
  return r.rows[0]?.token ?? null;
}

async function publishedMeeting(client, overrides = {}, sessionOverrides = {}) {
  const m = await createMeeting(client, overrides);
  await createSession(client, m.id, sessionOverrides);
  const { error } = await client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', m.id);
  if (error) throw error;
  return { ...m, token: await activeQr(m.id) };
}

async function register(token, extra = {}) {
  return pub('register', { token, fields: PERSON, consent: true, ...extra });
}

before(async () => {
  superAdmin = await createSuperAdmin();
  orgA = await createOrganisation(superAdmin.client);
  orgB = await createOrganisation(superAdmin.client);
  adminA = await createStaff(superAdmin.client, orgA.id, 'ORG_ADMIN');
  adminB = await createStaff(superAdmin.client, orgB.id, 'ORG_ADMIN');
  organiserA = await createStaff(adminA.client, orgA.id, 'ORGANISER');
  presenterA = await createStaff(adminA.client, orgA.id, 'PRESENTER');

  const { data: presenterRecord } = await adminA.client.from('presenters')
    .insert({ full_name: 'Dr. K. Mohan (DEMO)', designation: 'Director', user_id: presenterA.userId }).select('*').single();
  meeting = await createMeeting(organiserA.client, { title: 'Digital Governance Workshop (DEMO)' });
  session1 = await createSession(organiserA.client, meeting.id, { title: 'e-Office', presenter_id: presenterRecord.id });
  session2 = await createSession(organiserA.client, meeting.id, { title: 'Data Protection', starts_at: isoAt(1, 11), ends_at: isoAt(1, 12) });

  pdfPres = await createPresentation(organiserA.client, session1.id, 'e-Office Overview');
  let r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pdfPres.id, name: 'e-Office.pdf', bytes: SAMPLE.pdf });
  assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));

  pptxPres = await createPresentation(organiserA.client, session2.id, 'DPDP Act');
  r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pptxPres.id, name: 'DPDP.pptx', bytes: SAMPLE.pptx });
  assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));

  hiddenPres = await createPresentation(organiserA.client, session1.id, 'Speaker notes (hidden)');
  r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: hiddenPres.id, name: 'notes.pdf', bytes: SAMPLE.pdf });
  assert.equal(r.finish.status, 200);
  await organiserA.client.from('presentations').update({ is_visible: false }).eq('id', hiddenPres.id);

  r = await upload(organiserA.client, { purpose: 'ATTACHMENT', target: session1.id, name: 'Circular.pdf', bytes: SAMPLE.pdf, details: { title: 'Circular' } });
  assert.equal(r.finish.status, 200);
  attachmentId = r.finish.body.attachment_id ?? (await db.query('select id from public.attachments where session_id = $1', [session1.id])).rows[0].id;
});
after(closeAll);

describe('QR codes', () => {
  test('a draft meeting has no QR code; publishing creates exactly one', async () => {
    assert.equal(await activeQr(meeting.id), null);
    const { error } = await organiserA.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id);
    assert.equal(error, null);
    qr = await activeQr(meeting.id);
    assert.match(qr, /^[A-Za-z0-9_-]{24}$/);
    // Re-publishing (archive → restore) keeps the same code.
    const n = await db.query('select count(*)::int as n from public.qr_codes where meeting_id = $1', [meeting.id]);
    assert.equal(n.rows[0].n, 1);
  });

  test('staff who can see the meeting can read its QR code; other organisations cannot', async () => {
    for (const c of [organiserA.client, adminA.client, presenterA.client]) {
      const { data } = await c.from('qr_codes').select('token').eq('meeting_id', meeting.id).eq('status', 'ACTIVE');
      assert.equal(data.length, 1);
    }
    const other = await adminB.client.from('qr_codes').select('token').eq('meeting_id', meeting.id);
    assert.equal(other.data.length, 0);
    const anon = await newClient().from('qr_codes').select('token');
    assert.ok(anon.error || anon.data.length === 0);
  });

  test('presenters and other organisations cannot regenerate or revoke it', async () => {
    for (const c of [presenterA.client, adminB.client]) {
      const a = await c.rpc('regenerate_qr', { p_meeting: meeting.id });
      assert.equal(a.error?.code, '42501');
      const b = await c.rpc('revoke_qr', { p_meeting: meeting.id });
      assert.equal(b.error?.code, '42501');
    }
    const anon = await newClient().rpc('regenerate_qr', { p_meeting: meeting.id });
    assert.ok(anon.error);
    assert.equal(await activeQr(meeting.id), qr);
  });

  // (QR codes for drafts — allowed since Phase 4 — are tested in 07-display-live.)
  test('a QR code cannot be made with an expiry in the past', async () => {
    const b = await organiserA.client.rpc('regenerate_qr', { p_meeting: meeting.id, p_expires_at: new Date(Date.now() - 60000).toISOString() });
    assert.equal(b.error?.hint, 'EXPIRY_PAST');
  });

  test('unknown, malformed and missing tokens are refused', async () => {
    assert.equal((await pub('info', { token: 'AAAAAAAAAAAAAAAAAAAAAAAA' })).status, 404);
    assert.equal((await pub('info', { token: "x' or 1=1 --" })).status, 404);
    assert.equal((await pub('info', { token: '../../etc/passwd' })).status, 404);
    assert.equal((await pub('info', {})).status, 400);
    assert.equal((await pub('nonsense', { token: qr })).status, 400);
  });

  test('the landing page shows the meeting without internal identifiers', async () => {
    const r = await pub('info', { token: qr });
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'NOT_YET');              // tomorrow; opens 30 minutes before
    assert.equal(r.body.meeting.title, meeting.title);
    assert.equal(r.body.organisation.name, orgA.name);
    assert.equal(r.body.sessions.length, 2);
    assert.equal(r.body.sessions[0].presenter, 'Dr. K. Mohan (DEMO)');
    assert.deepEqual(r.body.registration.fields.map((f) => f.key), ['name', 'designation', 'organisation']);
    const text = JSON.stringify(r.body);
    for (const id of [meeting.id, orgA.id, session1.id, pdfPres.id]) assert.ok(!text.includes(id), `leaks ${id}`);
    assert.ok(!('logo_path' in r.body.organisation));
  });

  test('the participant page is served for any /m/ link', async () => {
    const res = await fetch(`${BASE_URL}/m/${qr}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<div id="root">/);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });
});

describe('availability', () => {
  const setMeeting = (fields) => organiserA.client.from('meetings').update(fields).eq('id', meeting.id).select('id').single();

  test('before it opens, registration is refused with the opening time', async () => {
    const r = await register(qr);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NOT_YET');
    const c = await pub('content', { token: qr });
    assert.equal(c.body.state, 'NOT_YET');
    assert.ok(c.body.opens_at);
  });

  test('opening earlier makes it available', async () => {
    assert.equal((await setMeeting({ open_before_minutes: 1440 })).error, null);
    // Tomorrow 10:00 minus a day is earlier than now only after 10:00 today — use "always" for a stable test.
    assert.equal((await setMeeting({ availability_mode: 'ALWAYS' })).error, null);
    assert.equal((await pub('info', { token: qr })).body.state, 'OPEN');
  });

  test('a custom window in the past means the meeting has ended', async () => {
    const m = await publishedMeeting(organiserA.client);
    await organiserA.client.from('meetings').update({
      availability_mode: 'CUSTOM', custom_from: new Date(Date.now() - 2 * 86400000).toISOString(),
      custom_until: new Date(Date.now() - 86400000).toISOString(),
    }).eq('id', m.id);
    assert.equal((await pub('info', { token: m.token })).body.state, 'ENDED');
    const r = await register(m.token);
    assert.equal(r.body.error.code, 'ENDED');
  });

  test('access closes the set number of days after the meeting; empty = until archived', async () => {
    const m = await publishedMeeting(organiserA.client);
    await db.query(`update public.meetings set starts_at = now() - interval '10 days', ends_at = now() - interval '10 days' + interval '2 hours',
                    access_after_days = 7 where id = $1`, [m.id]);
    assert.equal((await pub('info', { token: m.token })).body.state, 'ENDED');
    await organiserA.client.from('meetings').update({ access_after_days: null }).eq('id', m.id);
    assert.equal((await pub('info', { token: m.token })).body.state, 'OPEN');
    await organiserA.client.from('meetings').update({ status: 'ARCHIVED' }).eq('id', m.id);
    assert.equal((await pub('info', { token: m.token })).body.state, 'ENDED');
  });

  test('settings are validated', async () => {
    assert.ok((await setMeeting({ registration_mode: 'SOMETIMES' })).error);
    assert.ok((await setMeeting({ open_before_minutes: 5000 })).error);
    assert.ok((await setMeeting({ access_after_days: -1 })).error);
    const { error } = await organiserA.client.from('meetings').update({ has_passcode: true }).eq('id', meeting.id);
    assert.ok(error, 'has_passcode is set only through set_meeting_passcode');
  });
});

describe('registration', () => {
  let access;

  test('required fields and consent are checked by the server', async () => {
    let r = await pub('register', { token: qr, fields: { name: 'Only Name' }, consent: true });
    assert.equal(r.body.error.code, 'FIELD_REQUIRED:designation');
    r = await pub('register', { token: qr, fields: { ...PERSON, name: '   ' }, consent: true });
    assert.equal(r.body.error.code, 'FIELD_REQUIRED:name');
    r = await pub('register', { token: qr, fields: PERSON, consent: false });
    assert.equal(r.body.error.code, 'CONSENT');
    r = await pub('register', { token: qr, consent: true, anonymous: true });
    assert.equal(r.body.error.code, 'FIELD_REQUIRED:name', 'no anonymous entry when registration is required');
    r = await pub('register', { token: qr, fields: { ...PERSON, name: ['array'] }, consent: true });
    assert.equal(r.body.error.code, 'FIELD_REQUIRED:name', 'only text is accepted');
  });

  test('a participant registers and receives an access token', async () => {
    const r = await register(qr);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.access_token, /^[A-Za-z0-9_-]{48}$/);
    assert.equal(r.body.device_token, null);
    access = r.body.access_token;
    // Only a hash of the token is stored.
    const stored = await db.query('select token_hash from app.attendance_tokens');
    assert.ok(stored.rows.every((x) => x.token_hash !== access && /^[0-9a-f]{64}$/.test(x.token_hash)));
  });

  test('registering again with the same details does not count twice', async () => {
    const r = await register(qr);
    assert.equal(r.status, 201);
    assert.notEqual(r.body.access_token, access);
    const n = await db.query('select count(*)::int as n from public.attendance where meeting_id = $1', [meeting.id]);
    assert.equal(n.rows[0].n, 1);
  });

  test('text is trimmed, control characters removed and length capped', async () => {
    const m = await publishedMeeting(organiserA.client);
    await organiserA.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);
    const r = await pub('register', {
      token: m.token, consent: true,
      fields: { name: `  Long\u0000Name ${'x'.repeat(400)}`, designation: 'D', organisation: 'O', unknown_field: 'ignored' },
    });
    assert.equal(r.status, 201);
    const a = await db.query('select details from public.attendance where meeting_id = $1', [m.id]);
    assert.equal(a.rows[0].details.name.length, 150);
    assert.ok(!a.rows[0].details.name.includes('\u0000'));
    assert.ok(!('unknown_field' in a.rows[0].details));
  });

  test('mobile and e-mail are validated; the directory links the same person across meetings', async () => {
    const { data: settings } = await adminA.client.from('organisation_settings').select('registration_fields').single();
    const fields = settings.registration_fields.map((f) => (f.key === 'mobile' || f.key === 'email') ? { ...f, enabled: true } : f);
    assert.equal((await adminA.client.from('organisation_settings').update({ registration_fields: fields }).eq('organisation_id', orgA.id)).error, null);

    const m1 = await publishedMeeting(organiserA.client);
    const m2 = await publishedMeeting(organiserA.client);
    for (const m of [m1, m2]) await organiserA.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);

    let r = await pub('register', { token: m1.token, consent: true, fields: { ...PERSON, mobile: '12345' } });
    assert.equal(r.body.error.code, 'FIELD_INVALID:mobile');
    r = await pub('register', { token: m1.token, consent: true, fields: { ...PERSON, email: 'not-an-email' } });
    assert.equal(r.body.error.code, 'FIELD_INVALID:email');

    r = await pub('register', { token: m1.token, consent: true, fields: { ...PERSON, mobile: '+91 98450 12345' }, remember: true });
    assert.equal(r.status, 201);
    assert.match(r.body.device_token, /^[A-Za-z0-9_-]{48}$/);
    const device = r.body.device_token;
    r = await pub('register', { token: m2.token, consent: true, fields: { ...PERSON, designation: 'Joint Secretary', mobile: '9845012345' } });
    assert.equal(r.status, 201);
    const p = await db.query(
      'select distinct participant_id from public.attendance where meeting_id = any($1)', [[m1.id, m2.id]]);
    assert.equal(p.rows.length, 1, 'same mobile number = same person');
    const person = await db.query('select designation from public.participants where id = $1', [p.rows[0].participant_id]);
    assert.equal(person.rows[0].designation, 'Joint Secretary', 'details are kept up to date');

    // "Remember me" fills the form next time, in this organisation only.
    const info = await pub('info', { token: m2.token, device });
    assert.equal(info.body.remembered.mobile, '9845012345');
    const otherOrg = await publishedMeeting(adminB.client);
    const info2 = await pub('info', { token: otherOrg.token, device });
    assert.equal(info2.body.remembered, null);

    await adminA.client.from('organisation_settings').update({ registration_fields: settings.registration_fields }).eq('organisation_id', orgA.id);
  });

  test('a meeting passcode is required when set', async () => {
    let e = await organiserA.client.rpc('set_meeting_passcode', { p_meeting: meeting.id, p_passcode: 'abc' });
    assert.equal(e.error?.hint, 'PASSCODE_LENGTH');
    e = await presenterA.client.rpc('set_meeting_passcode', { p_meeting: meeting.id, p_passcode: 'KSDC-2026' });
    assert.equal(e.error?.code, '42501');
    e = await organiserA.client.rpc('set_meeting_passcode', { p_meeting: meeting.id, p_passcode: 'KSDC-2026' });
    assert.equal(e.error, null);
    assert.equal((await pub('info', { token: qr })).body.registration.passcode_required, true);
    assert.equal((await register(qr)).body.error.code, 'PASSCODE');
    assert.equal((await register(qr, { passcode: 'ksdc-2026' })).body.error.code, 'PASSCODE');
    assert.equal((await register(qr, { passcode: 'KSDC-2026' })).status, 201);
    const secret = await db.query('select passcode_hash from app.meeting_secrets where meeting_id = $1', [meeting.id]);
    assert.match(secret.rows[0].passcode_hash, /^\$2[aby]\$10\$/);
    const { data } = await organiserA.client.from('meetings').select('*').eq('id', meeting.id).single();
    assert.ok(!JSON.stringify(data).includes('$2'), 'the hash never reaches staff screens');
    e = await organiserA.client.rpc('set_meeting_passcode', { p_meeting: meeting.id, p_passcode: '' });
    assert.equal(e.error, null);
    assert.equal((await register(qr)).status, 201);
  });

  test('optional and no registration', async () => {
    const m = await publishedMeeting(organiserA.client);
    await organiserA.client.from('meetings').update({ availability_mode: 'ALWAYS', registration_mode: 'OPTIONAL' }).eq('id', m.id);
    let r = await pub('register', { token: m.token, anonymous: true });
    assert.equal(r.status, 201);
    await organiserA.client.from('meetings').update({ registration_mode: 'NONE' }).eq('id', m.id);
    r = await pub('register', { token: m.token, fields: PERSON });   // details are ignored
    assert.equal(r.status, 201);
    const c = await pub('content', { token: m.token, access: r.body.access_token });
    assert.equal(c.body.state, 'OPEN');
    const a = await db.query('select anonymous, participant_id from public.attendance where meeting_id = $1', [m.id]);
    assert.equal(a.rows.length, 2);
    assert.ok(a.rows.every((x) => x.anonymous && x.participant_id === null));
  });

  test('the participant limit is enforced; people already registered keep access', async () => {
    const o = await createOrganisation(superAdmin.client, { max_participants_per_meeting: 2 });
    const admin = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    const m = await publishedMeeting(admin.client);
    await admin.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);
    const p = (name) => pub('register', { token: m.token, consent: true, fields: { ...PERSON, name } });
    assert.equal((await p('One')).status, 201);
    assert.equal((await p('Two')).status, 201);
    const third = await p('Three');
    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, 'LIMIT_PARTICIPANTS');
    assert.equal((await p('One')).status, 201, 'returning participant');
    // Many phones at once cannot overshoot the limit.
    await db.query('update public.organisations set max_participants_per_meeting = 12 where id = $1', [o.id]);
    const rush = await Promise.all(Array.from({ length: 20 }, (_, i) => p(`Rush ${i}`)));
    assert.equal(rush.filter((x) => x.status === 201).length, 10);
    const n = await db.query('select count(*)::int as n from public.attendance where meeting_id = $1', [m.id]);
    assert.equal(n.rows[0].n, 12);
  });

  test('registrations are audited', async () => {
    const r = await db.query(`select count(*)::int as n from public.audit_logs where action = 'PARTICIPANT_REGISTERED' and organisation_id = $1`, [orgA.id]);
    assert.ok(r.rows[0].n >= 1);
  });

  describe('content and files', () => {
    let content;
    const item = (id) => content.sessions.flatMap((s) => s.items).find((i) => i.id === id);

    before(async () => {
      access = (await register(qr)).body.access_token;
    });

    test('content needs a valid access token for this meeting', async () => {
      assert.equal((await pub('content', { token: qr })).body.state, 'REGISTER');
      assert.equal((await pub('content', { token: qr, access: 'A'.repeat(48) })).body.state, 'REGISTER');
      const other = await publishedMeeting(organiserA.client);
      await organiserA.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', other.id);
      assert.equal((await pub('content', { token: other.token, access })).body.state, 'REGISTER', 'token of another meeting');
    });

    test('lists visible material with view and download rights', async () => {
      const r = await pub('content', { token: qr, access });
      assert.equal(r.status, 200);
      content = r.body;
      assert.equal(content.participant, PERSON.name);
      assert.equal(content.watermark, true);
      assert.equal(content.sessions.length, 2);
      assert.equal(item(pdfPres.id).view, 'pdf');
      assert.equal(item(pdfPres.id).download, false);       // organisation default: no downloads
      assert.equal(item(pptxPres.id).view, null);           // PowerPoint without a PDF copy
      assert.equal(item(attachmentId).kind, 'attachment');
      assert.equal(item(hiddenPres.id), undefined, 'hidden presentations are not listed');
    });

    test('viewing gives a short-lived link to the file', async () => {
      const r = await pub('file', { token: qr, access, kind: 'presentation', id: pdfPres.id, mode: 'view' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.kind, 'pdf');
      assert.match(r.body.url, /^\/storage\/v1\/object\/sign\/content\//);
      assert.ok(!r.body.url.includes('download='));
      const file = await fetch(`${BASE_URL}${r.body.url}`);
      assert.equal(file.status, 200);
      assert.equal(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)), '%PDF-');
      const tampered = await fetch(`${BASE_URL}${r.body.url.replace(/token=[^&]+/, 'token=abc')}`);
      assert.notEqual(tampered.status, 200);
    });

    test('downloading follows the download setting', async () => {
      let r = await pub('file', { token: qr, access, kind: 'presentation', id: pdfPres.id, mode: 'download' });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'DOWNLOAD_NOT_ALLOWED');
      await organiserA.client.from('presentations').update({ downloads_allowed: true }).eq('id', pdfPres.id);
      r = await pub('file', { token: qr, access, kind: 'presentation', id: pdfPres.id, mode: 'download' });
      assert.equal(r.status, 200);
      assert.match(r.body.url, /download=e-Office\.pdf/);
      const file = await fetch(`${BASE_URL}${r.body.url}`);
      assert.equal(file.status, 200);
      assert.match(file.headers.get('content-disposition') ?? '', /attachment/);
    });

    test('files without a preview, hidden items and other meetings\' items are refused', async () => {
      let r = await pub('file', { token: qr, access, kind: 'presentation', id: pptxPres.id, mode: 'view' });
      assert.equal(r.body.error.code, 'NOT_VIEWABLE');
      r = await pub('file', { token: qr, access, kind: 'presentation', id: hiddenPres.id, mode: 'view' });
      assert.equal(r.body.error.code, 'NOT_AVAILABLE');
      r = await pub('file', { token: qr, access, kind: 'attachment', id: pdfPres.id, mode: 'view' });
      assert.equal(r.body.error.code, 'NOT_AVAILABLE', 'wrong kind');
      const other = await publishedMeeting(organiserA.client);
      const s = (await db.query('select id from public.meeting_sessions where meeting_id = $1', [other.id])).rows[0];
      const foreign = await createPresentation(organiserA.client, s.id, 'Other meeting');
      await upload(organiserA.client, { purpose: 'PRESENTATION', target: foreign.id, name: 'other.pdf', bytes: SAMPLE.pdf });
      r = await pub('file', { token: qr, access, kind: 'presentation', id: foreign.id, mode: 'view' });
      assert.equal(r.body.error.code, 'NOT_AVAILABLE', 'item of another meeting');
      r = await pub('file', { token: qr, kind: 'presentation', id: pdfPres.id, mode: 'view' });
      assert.equal(r.status, 400);
      r = await pub('file', { token: qr, access: 'B'.repeat(48), kind: 'presentation', id: pdfPres.id, mode: 'view' });
      assert.equal(r.body.error.code, 'REGISTER');
      r = await pub('file', { token: qr, access, kind: 'presentation', id: 'not-a-uuid', mode: 'view' });
      assert.equal(r.status, 400);
      r = await pub('file', { token: qr, access, kind: 'presentation', id: pdfPres.id, mode: 'steal' });
      assert.equal(r.status, 422);
    });

    test('with "release at session start", later sessions stay closed', async () => {
      await organiserA.client.from('meetings').update({ session_release: 'ON_START' }).eq('id', meeting.id);
      const r = await pub('content', { token: qr, access });
      assert.ok(r.body.sessions.every((s) => s.released === false && s.items.length === 0));
      const f = await pub('file', { token: qr, access, kind: 'presentation', id: pdfPres.id, mode: 'view' });
      assert.equal(f.body.error.code, 'NOT_AVAILABLE');
      await organiserA.client.from('meetings').update({ session_release: 'ALL' }).eq('id', meeting.id);
    });

    test('opening, viewing and downloading are recorded', async () => {
      const r = await db.query(`select action, count(*)::int as n from public.access_events where meeting_id = $1 group by action`, [meeting.id]);
      const by = Object.fromEntries(r.rows.map((x) => [x.action, x.n]));
      assert.ok(by.OPEN_MEETING >= 1);
      assert.ok(by.VIEW >= 1);
      assert.ok(by.DOWNLOAD >= 1);
      const ev = await db.query(`select ip, user_agent from public.access_events where meeting_id = $1 and action = 'VIEW' limit 1`, [meeting.id]);
      assert.ok(ev.rows[0].ip);
    });

    test('a new QR code stops the old one; registered participants keep access', async () => {
      const { data: token, error } = await organiserA.client.rpc('regenerate_qr', { p_meeting: meeting.id });
      assert.equal(error, null);
      assert.notEqual(token, qr);
      assert.equal((await pub('info', { token: qr })).status, 404);
      assert.equal((await pub('content', { token: qr, access })).body.state, 'INVALID');
      assert.equal((await pub('content', { token, access })).body.state, 'OPEN');
      qr = token;
      const audit = await db.query(`select 1 from public.audit_logs where action = 'QR_REGENERATED' and entity_id = $1`, [meeting.id]);
      assert.equal(audit.rows.length, 1);
    });

    test('an expired or revoked QR code stops working', async () => {
      const e = await organiserA.client.rpc('set_qr_expiry', { p_meeting: meeting.id, p_expires_at: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(e.error, null);
      assert.equal((await pub('info', { token: qr })).status, 200);
      await db.query(`update public.qr_codes set expires_at = now() - interval '1 minute' where token = $1`, [qr]);
      assert.equal((await pub('info', { token: qr })).status, 404);
      const { data: fresh } = await organiserA.client.rpc('regenerate_qr', { p_meeting: meeting.id });
      assert.equal((await pub('info', { token: fresh })).status, 200);
      assert.equal((await organiserA.client.rpc('revoke_qr', { p_meeting: meeting.id })).error, null);
      assert.equal((await pub('info', { token: fresh })).status, 404);
      const { data: again } = await organiserA.client.rpc('regenerate_qr', { p_meeting: meeting.id });
      qr = again;
    });
  });
});

describe('organisation status', () => {
  test('a view-only organisation\'s meetings are unavailable; a deactivated one\'s are invalid', async () => {
    const o = await createOrganisation(superAdmin.client);
    const admin = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    const m = await publishedMeeting(admin.client);
    await admin.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);
    assert.equal((await pub('info', { token: m.token })).body.state, 'OPEN');
    await superAdmin.client.from('organisations').update({ expires_at: new Date(Date.now() - 30 * 86400000).toISOString(), grace_days: 15 }).eq('id', o.id);
    assert.equal((await pub('info', { token: m.token })).body.state, 'UNAVAILABLE');
    assert.equal((await register(m.token)).body.error.code, 'UNAVAILABLE');
    await superAdmin.client.from('organisations').update({ status: 'INACTIVE' }).eq('id', o.id);
    assert.equal((await pub('info', { token: m.token })).status, 404);
  });
});

describe('who can see participant data', () => {
  test('organisers and administrators of the organisation can', async () => {
    for (const c of [organiserA.client, adminA.client]) {
      const a = await c.from('attendance').select('id, details').eq('meeting_id', meeting.id);
      assert.ok(a.data.length >= 1);
      const p = await c.from('participants').select('id');
      assert.ok(p.data.length >= 1);
      const e = await c.from('access_events').select('id').eq('meeting_id', meeting.id);
      assert.ok(e.data.length >= 1);
    }
  });

  test('presenters, other organisations, the Super Admin and the public cannot', async () => {
    for (const c of [presenterA.client, adminB.client, superAdmin.client, newClient()]) {
      for (const table of ['attendance', 'participants', 'access_events']) {
        const r = await c.from(table).select('*');
        assert.ok(r.error || r.data.length === 0, `${table} visible`);
      }
    }
  });

  test('nobody can change participant data directly', async () => {
    const r1 = await adminA.client.from('attendance').update({ details: {} }).eq('meeting_id', meeting.id).select();
    assert.ok(r1.error || r1.data.length === 0);
    const r2 = await adminA.client.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
    assert.ok(r2.error || r2.data.length === 0);
    const r3 = await adminA.client.from('attendance').insert({ meeting_id: meeting.id, anonymous: true });
    assert.ok(r3.error);
  });

  test('the participant functions cannot be called from a browser session', async () => {
    for (const c of [newClient(), organiserA.client]) {
      const r = await c.rpc('public_register', {
        p_token: qr, p_fields: PERSON, p_consent: true, p_passcode: null, p_remember: false, p_anonymous: false, p_ip: null, p_user_agent: null,
      });
      assert.ok(r.error);
      const s = await c.rpc('public_meeting_info', { p_token: qr });
      assert.ok(s.error);
    }
  });
});

describe('retention', () => {
  test('participant details are removed after the retention period; counts stay', async () => {
    const o = await createOrganisation(superAdmin.client);
    const admin = await createStaff(superAdmin.client, o.id, 'ORG_ADMIN');
    await admin.client.from('organisation_settings').update({ participant_retention_days: 30 }).eq('organisation_id', o.id);
    const oldMeeting = await publishedMeeting(admin.client);
    const recent = await publishedMeeting(admin.client);
    for (const m of [oldMeeting, recent]) await admin.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);
    const r = await pub('register', { token: oldMeeting.token, consent: true, fields: { ...PERSON, name: 'Old Attendee (DEMO)' }, remember: true });
    assert.equal(r.status, 201);
    assert.equal((await pub('register', { token: recent.token, consent: true, fields: { ...PERSON, name: 'Recent Attendee (DEMO)' } })).status, 201);
    // The first meeting ended 40 days ago; the person last registered then too.
    await db.query(`update public.meetings set starts_at = now() - interval '40 days', ends_at = now() - interval '40 days' + interval '1 hour' where id = $1`, [oldMeeting.id]);
    await db.query(`update public.participants set created_at = now() - interval '40 days' where full_name = 'Old Attendee (DEMO)'`);

    const result = (await db.query('select app.apply_retention() as r')).rows[0].r;
    assert.ok(result.attendance >= 1 && result.participants >= 1 && result.devices >= 1, JSON.stringify(result));

    const old = await db.query('select details, ip, anonymised_at, participant_id from public.attendance where meeting_id = $1', [oldMeeting.id]);
    assert.deepEqual(old.rows[0].details, {});
    assert.equal(old.rows[0].ip, null);
    assert.ok(old.rows[0].anonymised_at);
    const person = await db.query('select full_name, mobile, anonymised_at from public.participants where id = $1', [old.rows[0].participant_id]);
    assert.equal(person.rows[0].full_name, null);
    assert.ok(person.rows[0].anonymised_at);
    assert.equal((await pub('info', { token: oldMeeting.token, device: r.body.device_token })).body.remembered, null);

    const kept = await db.query('select details from public.attendance where meeting_id = $1', [recent.id]);
    assert.equal(kept.rows[0].details.name, 'Recent Attendee (DEMO)');
    const n = await admin.client.from('attendance').select('id', { count: 'exact', head: true }).eq('meeting_id', oldMeeting.id);
    assert.equal(n.count, 1, 'attendance still counts');
  });

  test('IP addresses and browser details are blanked after the set period, including in the audit log', async () => {
    await db.query(`update public.access_events set occurred_at = now() - interval '100 days' where meeting_id = $1`, [meeting.id]);
    const audit = await db.query(`insert into public.audit_logs (occurred_at, action, entity_type, summary, ip, user_agent)
                                  values (now() - interval '100 days', 'TEST_OLD_EVENT', 'test', 'old event', '10.1.2.3', 'Old browser')
                                  returning id`);
    await db.query('select app.apply_retention()');
    const ev = await db.query('select count(*)::int as n from public.access_events where meeting_id = $1 and ip is not null', [meeting.id]);
    assert.equal(ev.rows[0].n, 0);
    const a = await db.query('select ip, user_agent, action, summary from public.audit_logs where id = $1', [audit.rows[0].id]);
    assert.deepEqual(a.rows[0], { ip: null, user_agent: null, action: 'TEST_OLD_EVENT', summary: 'old event' });
    // The exception for the job does not open the audit log to other changes.
    await assert.rejects(db.query(`update public.audit_logs set summary = 'tampered' where id = $1`, [audit.rows[0].id]));
    await assert.rejects(db.query(`select set_config('app.audit_redaction', 'on', false); update public.audit_logs set summary = 'x' where id = ${audit.rows[0].id}`));
  });

  test('the retention job runs every night and cannot be called from a browser', async () => {
    const job = await db.query(`select schedule, command from cron.job where jobname = 'presentify-retention'`);
    assert.equal(job.rows[0].schedule, '30 20 * * *');        // 02:00 India time
    const r = await adminA.client.rpc('apply_retention');
    assert.ok(r.error);
  });
});
