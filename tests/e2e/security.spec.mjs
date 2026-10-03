// Hostile input: text that tries to run a script, typed into every field that is shown
// again on a screen (meeting, session, presenter, presentation, file name, participant
// details, organisation tagline). Every screen must show it as plain text and nothing
// may run. (React escapes text; the Content-Security-Policy is a second barrier.)
import { devices, expect, test } from '@playwright/test';
import {
  createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin, db, makePdf, PASSWORD,
  publicCall, upload,
} from '../api/_helpers.mjs';
import { signInUi } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

const HOSTILE = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=2</script>',
  '"><svg onload=window.__xss=3>',
  "javascript:window.__xss=4",
  '{{constructor.constructor("window.__xss=5")()}}',
];
const TITLE = `Hostile ${HOSTILE[0]} ${HOSTILE[2]}`;

let admin, meeting, token, presentation;

async function guard(page) {
  const problems = [];
  page.on('dialog', (d) => { problems.push(`dialog: ${d.message()}`); void d.dismiss(); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return async () => {
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(problems).toEqual([]);
  };
}

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  const org = await createOrganisation(sa.client, { name: `Security check DEMO ${Date.now().toString(36)}`, tagline: HOSTILE[1] });
  admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
  const { data: pr } = await admin.client.from('presenters').insert({ full_name: `Dr. ${HOSTILE[1]}`, designation: HOSTILE[2] }).select('id').single();
  const at = (min) => new Date(Date.now() + min * 60000).toISOString();
  meeting = await createMeeting(admin.client, { title: TITLE, venue: HOSTILE[3], chairperson: HOSTILE[4], starts_at: at(-30), ends_at: at(60) });
  const s = await createSession(admin.client, meeting.id, { title: `Session ${HOSTILE[0]}`, presenter_id: pr.id, starts_at: at(-30), ends_at: at(60) });
  presentation = await createPresentation(admin.client, s.id, `Deck ${HOSTILE[2]}`);
  const r = await upload(admin.client, { purpose: 'PRESENTATION', target: presentation.id, name: `x${HOSTILE[0].replace(/[<>"/]/g, '')}.pdf`, bytes: makePdf(1) });
  if (r.finish?.status !== 200) throw new Error(JSON.stringify(r.finish ?? r.start));
  await admin.client.from('meetings').update({ status: 'PUBLISHED', availability_mode: 'ALWAYS' }).eq('id', meeting.id);
  token = (await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [meeting.id])).rows[0].token;
  const reg = await publicCall('register', {
    token, consent: true, fields: { name: HOSTILE[1], designation: HOSTILE[0], organisation: HOSTILE[2] },
  });
  expect(reg.status).toBe(201);
});

test('staff screens show hostile text as plain text', async ({ page }) => {
  const check = await guard(page);
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto(`/meetings/${meeting.id}`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText(`Session ${HOSTILE[0]}`).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Participants' }).click();
  await expect(page.getByRole('cell', { name: HOSTILE[1] })).toBeVisible();
  await page.getByRole('tab', { name: 'QR code & access' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  await page.goto('/meetings');
  await page.getByRole('button', { name: 'All', exact: true }).or(page.getByText('All', { exact: true })).first().click();
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto('/presentations');
  await expect(page.getByText(`Deck ${HOSTILE[2]}`).first()).toBeVisible();
  await page.goto(`/present/meetings/${meeting.id}`);
  await expect(page.getByTestId('pm-now')).toHaveText(`Session ${HOSTILE[0]}`);
  await page.goto(`/display/meetings/${meeting.id}/qr`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await check();
});

test('the participant page shows hostile text as plain text', async ({ browser }) => {
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await phone.newPage();
  const check = await guard(page);
  await page.goto(`/m/${token}`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText(HOSTILE[1]).first()).toBeVisible();     // organisation tagline
  await page.getByLabel('Name').fill(HOSTILE[1]);
  await page.getByLabel('Designation').fill(HOSTILE[0]);
  await page.getByLabel('Organisation').fill(HOSTILE[4]);
  await page.getByLabel('I agree').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(`Session ${HOSTILE[0]}`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await expect(page.locator('.pv-watermark').first()).toContainText(HOSTILE[1]);
  await check();
  await phone.close();
});

test('a script injected into the page is blocked by the Content-Security-Policy', async ({ page }) => {
  const violations = [];
  page.on('console', (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text()); });
  await page.goto(`/m/${token}`);
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__xss = 99';
    document.body.appendChild(s);
  });
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(violations.length).toBeGreaterThan(0);
});
