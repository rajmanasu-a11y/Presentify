// Phase 2: presenters, meetings, sessions, presentations, versions, supporting
// material and uploads — permissions, isolation, file checks and limits.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAll, CONTENT_TYPE, createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin,
  db, fn, isoAt, SAMPLE, upload,
} from './_helpers.mjs';

const MB = 1024 * 1024;
let superAdmin, orgA, orgB, adminA, adminB, organiserA, organiser2A, presenterUserA;
let presenterRecord, meeting, session1, session2;

before(async () => {
  superAdmin = await createSuperAdmin();
  orgA = await createOrganisation(superAdmin.client, { max_file_bytes: 1 * MB, storage_bytes: 3 * MB, max_meetings: 6, max_presentations: 8 });
  orgB = await createOrganisation(superAdmin.client);
  adminA = await createStaff(superAdmin.client, orgA.id, 'ORG_ADMIN');
  adminB = await createStaff(superAdmin.client, orgB.id, 'ORG_ADMIN');
  organiserA = await createStaff(adminA.client, orgA.id, 'ORGANISER');
  organiser2A = await createStaff(adminA.client, orgA.id, 'ORGANISER');
  presenterUserA = await createStaff(adminA.client, orgA.id, 'PRESENTER');
});
after(closeAll);

describe('presenters and meetings', () => {
  test('presenters belong to one organisation', async () => {
    const { data, error } = await adminA.client.from('presenters')
      .insert({ full_name: 'Ravi Kumar, IPS (DEMO)', designation: 'SP', user_id: presenterUserA.userId }).select('*').single();
    assert.equal(error, null);
    presenterRecord = data;
    const other = await adminB.client.from('presenters').select('id').eq('id', presenterRecord.id);
    assert.equal(other.data.length, 0);
    const bad = await adminB.client.from('presenters').insert({ full_name: 'Linked elsewhere', user_id: presenterUserA.userId });
    assert.ok(bad.error, 'cannot link a login of another organisation');
  });

  test('an organiser creates a meeting with an automatic reference number', async () => {
    meeting = await createMeeting(organiserA.client, { title: 'Senior Officers Training Programme (DEMO)' });
    assert.match(meeting.reference_no, /^MTG-\d{4}-\d{4}$/);
    assert.equal(meeting.status, 'DRAFT');
    assert.equal(meeting.organiser_user_id, organiserA.userId);
  });

  test('end time must be after start time', async () => {
    const { error } = await organiserA.client.from('meetings').insert({ title: 'Backwards', starts_at: isoAt(2, 12), ends_at: isoAt(2, 10) });
    assert.ok(error);
  });

  test('other organisers can view but not change the meeting; admins can change it', async () => {
    const view = await organiser2A.client.from('meetings').select('id').eq('id', meeting.id);
    assert.equal(view.data.length, 1);
    const upd = await organiser2A.client.from('meetings').update({ venue: 'Hijacked' }).eq('id', meeting.id).select();
    assert.equal(upd.data?.length ?? 0, 0);
    const ok = await adminA.client.from('meetings').update({ venue: 'Main Training Hall' }).eq('id', meeting.id).select();
    assert.equal(ok.data.length, 1);
  });

  test('an organiser cannot hand the meeting to someone else', async () => {
    const { error } = await organiserA.client.from('meetings').update({ organiser_user_id: organiser2A.userId }).eq('id', meeting.id);
    assert.ok(error);
  });

  test('another organisation cannot see the meeting', async () => {
    const { data } = await adminB.client.from('meetings').select('id').eq('id', meeting.id);
    assert.equal(data.length, 0);
  });

  test('a meeting cannot be published without sessions', async () => {
    const { error } = await organiserA.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id);
    assert.ok(error);
    assert.equal(error.hint, 'NO_SESSIONS');
  });

  test('sessions with presenters; a presenter sees only meetings they present in', async () => {
    session1 = await createSession(organiserA.client, meeting.id, { title: 'Cyber Security Awareness', presenter_id: presenterRecord.id });
    session2 = await createSession(organiserA.client, meeting.id, { title: 'Data Analytics in Policing', starts_at: isoAt(1, 11), ends_at: isoAt(1, 12) });
    const other = await createMeeting(organiserA.client, { title: 'Unrelated meeting' });
    const seen = await presenterUserA.client.from('meetings').select('id');
    assert.deepEqual(seen.data.map((m) => m.id), [meeting.id]);
    assert.ok(!seen.data.some((m) => m.id === other.id));
    const sessions = await presenterUserA.client.from('meeting_sessions').select('id').eq('meeting_id', meeting.id);
    assert.equal(sessions.data.length, 2);
  });

  test('presenters cannot edit sessions or meetings', async () => {
    const s = await presenterUserA.client.from('meeting_sessions').update({ title: 'Renamed' }).eq('id', session1.id).select();
    assert.equal(s.data?.length ?? 0, 0);
    const m = await presenterUserA.client.from('meetings').update({ title: 'Renamed' }).eq('id', meeting.id).select();
    assert.equal(m.data?.length ?? 0, 0);
  });

  test('publish, archive (read-only) and restore', async () => {
    let r = await organiserA.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id).select('status, published_at').single();
    assert.equal(r.data.status, 'PUBLISHED');
    assert.ok(r.data.published_at);
    r = await organiserA.client.from('meetings').update({ status: 'ARCHIVED' }).eq('id', meeting.id).select('status').single();
    assert.equal(r.data.status, 'ARCHIVED');
    const blocked = await organiserA.client.from('meeting_sessions').insert({ meeting_id: meeting.id, title: 'Late session', starts_at: isoAt(1, 12), ends_at: isoAt(1, 13) });
    assert.ok(blocked.error, 'archived meetings are read-only');
    const edit = await organiserA.client.from('meetings').update({ title: 'Edited while archived' }).eq('id', meeting.id);
    assert.ok(edit.error);
    r = await organiserA.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id).select('status').single();
    assert.equal(r.data.status, 'PUBLISHED');
  });

  test('only empty draft meetings can be deleted', async () => {
    const empty = await createMeeting(organiserA.client, { title: 'To delete' });
    const { error } = await organiserA.client.rpc('delete_draft_meeting', { p_meeting: empty.id });
    assert.equal(error, null);
    const gone = await db.query('select count(*)::int n from meetings where id = $1', [empty.id]);
    assert.equal(gone.rows[0].n, 0);
    const published = await organiserA.client.rpc('delete_draft_meeting', { p_meeting: meeting.id });
    assert.ok(published.error);
  });
});

describe('presentations, versions and uploads', () => {
  let pres;

  test('upload a PDF: version 1, viewable on phones', async () => {
    pres = await createPresentation(organiserA.client, session1.id, 'Cyber Security Awareness');
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'Cyber Security.pdf', bytes: SAMPLE.pdf, details: { change_notes: 'First draft' } });
    assert.equal(r.start.status, 200, JSON.stringify(r.start.body));
    assert.equal(r.put.status, 200);
    assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));
    assert.equal(r.finish.body.version_no, 1);
    const v = await db.query('select original_file_id, view_pdf_file_id, change_notes from presentation_versions where id = $1', [r.finish.body.version_id]);
    assert.equal(v.rows[0].view_pdf_file_id, v.rows[0].original_file_id, 'a PDF is its own viewing copy');
    assert.equal(v.rows[0].change_notes, 'First draft');
  });

  test('upload a PowerPoint as version 2, then its PDF copy', async () => {
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'Cyber Security v2.pptx', bytes: SAMPLE.pptx });
    assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));
    assert.equal(r.finish.body.version_no, 2);
    const cur = await organiserA.client.from('presentations').select('current_version_id').eq('id', pres.id).single();
    assert.equal(cur.data.current_version_id, r.finish.body.version_id);
    const noPdf = await db.query('select view_pdf_file_id from presentation_versions where id = $1', [r.finish.body.version_id]);
    assert.equal(noPdf.rows[0].view_pdf_file_id, null, 'PowerPoint needs a separate PDF copy');

    const wrong = await upload(organiserA.client, { purpose: 'VIEW_PDF', target: r.finish.body.version_id, name: 'copy.pptx', bytes: SAMPLE.pptx });
    assert.equal(wrong.start.status, 422);
    assert.equal(wrong.start.body.error.code, 'FILE_TYPE_PDF');

    const copy = await upload(organiserA.client, { purpose: 'VIEW_PDF', target: r.finish.body.version_id, name: 'Cyber Security v2.pdf', bytes: SAMPLE.pdf });
    assert.equal(copy.finish.status, 200, JSON.stringify(copy.finish.body));
    const withPdf = await db.query('select view_pdf_file_id from presentation_versions where id = $1', [r.finish.body.version_id]);
    assert.ok(withPdf.rows[0].view_pdf_file_id);
  });

  test('an earlier version can be restored (recorded as a new version)', async () => {
    const v1 = await db.query('select id, original_file_id from presentation_versions where presentation_id = $1 and version_no = 1', [pres.id]);
    const { data, error } = await adminA.client.rpc('restore_presentation_version', { p_version: v1.rows[0].id });
    assert.equal(error, null);
    assert.equal(data.version_no, 3);
    const v3 = await db.query('select original_file_id, restored_from from presentation_versions where id = $1', [data.version_id]);
    assert.equal(v3.rows[0].original_file_id, v1.rows[0].original_file_id);
    assert.equal(v3.rows[0].restored_from, 1);
    const versions = await db.query('select count(*)::int n from presentation_versions where presentation_id = $1', [pres.id]);
    assert.equal(versions.rows[0].n, 3, 'nothing is overwritten');
  });

  test('presenters cannot restore versions', async () => {
    const v1 = await db.query('select id from presentation_versions where presentation_id = $1 and version_no = 1', [pres.id]);
    const { error } = await presenterUserA.client.rpc('restore_presentation_version', { p_version: v1.rows[0].id });
    assert.ok(error);
  });

  test('supporting material is attached to a session', async () => {
    const r = await upload(organiserA.client, { purpose: 'ATTACHMENT', target: session1.id, name: 'Briefing Note.pdf', bytes: SAMPLE.pdf, details: { title: 'Briefing Note' } });
    assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));
    const { data } = await presenterUserA.client.from('attachments').select('title').eq('session_id', session1.id);
    assert.deepEqual(data.map((a) => a.title), ['Briefing Note']);
  });

  test('a presenter can upload to their own session only', async () => {
    const own = await upload(presenterUserA.client, { purpose: 'ATTACHMENT', target: session1.id, name: 'Annexure-I.pdf', bytes: SAMPLE.pdf });
    assert.equal(own.finish.status, 200, JSON.stringify(own.finish.body));
    const other = await upload(presenterUserA.client, { purpose: 'ATTACHMENT', target: session2.id, name: 'Sneaky.pdf', bytes: SAMPLE.pdf });
    assert.equal(other.start.status, 403);
  });

  test('another organiser of the same organisation cannot upload to this meeting', async () => {
    const r = await upload(organiser2A.client, { purpose: 'ATTACHMENT', target: session2.id, name: 'x.pdf', bytes: SAMPLE.pdf });
    assert.equal(r.start.status, 403);
  });

  test('another organisation cannot upload into this meeting', async () => {
    const r = await upload(adminB.client, { purpose: 'PRESENTATION', target: pres.id, name: 'x.pdf', bytes: SAMPLE.pdf });
    assert.equal(r.start.status, 403);
  });
});

describe('file checks', () => {
  let pres;
  before(async () => { pres = await createPresentation(organiserA.client, session2.id, 'Data Analytics'); });

  test('disallowed file types are refused before uploading', async () => {
    for (const name of ['virus.exe', 'page.html', 'image.svg', 'script.js', 'no-extension']) {
      const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name, bytes: SAMPLE.pdf });
      assert.equal(r.start.status, 422, name);
      assert.equal(r.start.body.error.code, 'FILE_TYPE', name);
      assert.match(r.start.body.error.message, /not allowed|no recognisable type/);
    }
  });

  test('a web page renamed to .pdf is rejected and deleted', async () => {
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'innocent.pdf', bytes: SAMPLE.html });
    assert.equal(r.put.status, 200);
    assert.equal(r.finish.status, 422);
    assert.equal(r.finish.body.status, 'REJECTED');
    assert.match(r.finish.body.reason, /does not match/);
    const f = await db.query('select status, object_path from stored_files where id = $1', [r.start.body.file_id]);
    assert.equal(f.rows[0].status, 'REJECTED');
    const obj = await db.query("select count(*)::int n from storage.objects where bucket_id = 'content' and name = $1", [f.rows[0].object_path]);
    assert.equal(obj.rows[0].n, 0, 'rejected bytes are deleted');
  });

  test('a file sent with the wrong content type is rejected', async () => {
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'report.pdf', bytes: SAMPLE.pdf, contentType: 'text/html' });
    assert.equal(r.finish.status, 422);
  });

  test('files larger than the organisation limit are refused', async () => {
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'huge.pdf', bytes: SAMPLE.pdf, declaredSize: 2 * MB });
    assert.equal(r.start.status, 422);
    assert.equal(r.start.body.error.code, 'LIMIT_FILE_SIZE');
  });

  test('understating the size does not get around the limit', async () => {
    const big = new Uint8Array(Math.round(1.5 * MB));
    big.set(SAMPLE.pdf);
    const r = await upload(organiserA.client, { purpose: 'PRESENTATION', target: pres.id, name: 'liar.pdf', bytes: big, declaredSize: 1000 });
    assert.equal(r.finish.status, 422);
    assert.match(r.finish.body.reason, /larger than the maximum/);
  });

  test('the storage quota is enforced', async () => {
    // Quota 3 MB, files up to 1 MB: a few large uploads fill it.
    const chunk = new Uint8Array(Math.round(0.9 * MB));
    chunk.set(SAMPLE.pdf);
    let refused = null;
    for (let i = 0; i < 5 && !refused; i++) {
      const r = await upload(organiserA.client, { purpose: 'ATTACHMENT', target: session2.id, name: `fill-${i}.pdf`, bytes: chunk });
      if (r.start.status !== 200) refused = r.start;
    }
    assert.ok(refused, 'an upload must eventually be refused');
    assert.equal(refused.body.error.code, 'LIMIT_STORAGE');
    const usage = await adminA.client.rpc('organisation_usage', { p_org: orgA.id });
    assert.ok(usage.data.storage_bytes <= 3 * MB);
  });

  test('removing material frees space and deletes the file', async () => {
    const before = (await adminA.client.rpc('organisation_usage', { p_org: orgA.id })).data.storage_bytes;
    const att = await db.query("select a.id, f.object_path from attachments a join stored_files f on f.id = a.file_id where a.session_id = $1 and a.title like 'fill-%' and a.deleted_at is null limit 1", [session2.id]);
    const r = await fn(organiserA.client, 'uploads', { action: 'remove', kind: 'attachment', id: att.rows[0].id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const afterBytes = (await adminA.client.rpc('organisation_usage', { p_org: orgA.id })).data.storage_bytes;
    assert.ok(afterBytes < before);
    const obj = await db.query("select count(*)::int n from storage.objects where bucket_id = 'content' and name = $1", [att.rows[0].object_path]);
    assert.equal(obj.rows[0].n, 0);
  });

  test('the database step that accepts uploads cannot be called from a browser', async () => {
    const f = await db.query("select id from stored_files where status = 'REJECTED' limit 1");
    const { error } = await organiserA.client.rpc('finalize_upload', { p_file_id: f.rows[0].id, p_size: 10, p_valid: true, p_reason: null });
    assert.ok(error);
  });

  test('files cannot be uploaded directly into storage, bypassing the checks', async () => {
    const { error } = await organiserA.client.storage.from('content').upload(`${orgA.id}/direct.pdf`, SAMPLE.pdf, { contentType: 'application/pdf' });
    assert.ok(error);
  });
});

describe('file access and limits', () => {
  test('staff can open their organisation’s files; other organisations cannot', async () => {
    const f = await db.query(`select f.object_path from stored_files f where f.organisation_id = $1 and f.status = 'READY' limit 1`, [orgA.id]);
    const path = f.rows[0].object_path;
    const own = await organiserA.client.storage.from('content').createSignedUrl(path, 60);
    assert.equal(own.error, null);
    const res = await fetch(own.data.signedUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const other = await adminB.client.storage.from('content').createSignedUrl(path, 60);
    assert.ok(other.error);
  });

  test('a presenter cannot open files of meetings they are not part of', async () => {
    const otherMeeting = await createMeeting(organiserA.client, { title: 'Private meeting' });
    const s = await createSession(organiserA.client, otherMeeting.id);
    const r = await upload(organiserA.client, { purpose: 'ATTACHMENT', target: s.id, name: 'confidential.pdf', bytes: SAMPLE.pdf });
    assert.equal(r.finish.status, 200, JSON.stringify(r.finish.body));
    const f = await db.query('select object_path from stored_files where id = $1', [r.start.body.file_id]);
    const { error } = await presenterUserA.client.storage.from('content').createSignedUrl(f.rows[0].object_path, 60);
    assert.ok(error);
  });

  test('meeting and presentation limits are enforced by the server', async () => {
    await superAdmin.client.from('organisations').update({ max_meetings: 1, max_presentations: 1 }).eq('id', orgA.id);
    const m = await organiserA.client.from('meetings').insert({ title: 'One too many', starts_at: isoAt(3, 10), ends_at: isoAt(3, 11) });
    assert.ok(m.error);
    assert.equal(m.error.hint, 'LIMIT_MEETINGS');
    const p = await organiserA.client.from('presentations').insert({ session_id: session2.id, title: 'One too many' });
    assert.ok(p.error);
    assert.equal(p.error.hint, 'LIMIT_PRESENTATIONS');
    await superAdmin.client.from('organisations').update({ max_meetings: null, max_presentations: null }).eq('id', orgA.id);
  });

  test('usage shows meetings and presentations', async () => {
    const { data } = await adminA.client.rpc('organisation_usage', { p_org: orgA.id });
    assert.ok(data.meetings >= 2);
    assert.ok(data.presentations >= 2);
  });

  test('uploads and changes are in the audit log with the person who made them', async () => {
    const { rows } = await db.query(
      `select action, actor_user_id from audit_logs where organisation_id = $1
        and action in ('MEETING_CREATED', 'SESSION_CREATED', 'PRESENTATION_VERSION_CREATED', 'ATTACHMENT_CREATED', 'ATTACHMENT_DELETED')`, [orgA.id]);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['MEETING_CREATED', 'SESSION_CREATED', 'PRESENTATION_VERSION_CREATED', 'ATTACHMENT_CREATED', 'ATTACHMENT_DELETED']) {
      assert.ok(actions.has(a), `${a} recorded`);
    }
    const versions = rows.filter((r) => r.action === 'PRESENTATION_VERSION_CREATED');
    assert.ok(versions.every((r) => r.actor_user_id), 'every upload names a person');
    assert.ok(versions.some((r) => r.actor_user_id === organiserA.userId), 'organiser uploads attributed to the organiser');
    assert.ok(versions.some((r) => r.actor_user_id === adminA.userId), 'the restore is attributed to the administrator');
  });

  test('a different-content type is checked for Office files too', async () => {
    const pres = await db.query('select id from presentations where organisation_id = $1 and deleted_at is null limit 1', [orgA.id]);
    const r = await upload(organiserA.client, {
      purpose: 'PRESENTATION', target: pres.rows[0].id, name: 'slides.pptx', bytes: SAMPLE.pdf, contentType: CONTENT_TYPE.pptx,
    });
    assert.equal(r.finish.status, 422, 'a PDF renamed to .pptx is rejected');
  });
});
