// End-to-end (Phase 4): the create-meeting wizard from start to "Meeting Published
// Successfully"; the QR display on a 1920 × 1080 screen with the live count; presenter
// mode (NOW / NEXT, countdown, manual override, QR, count); the live panel; Kannada.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  createMeeting, createOrganisation, createSession, createStaff, createSuperAdmin, db, makePdf, PASSWORD, publicCall,
} from '../api/_helpers.mjs';
import { signInUi } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

// SHOTS=<folder> saves screenshots for the phase report.
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
const file = (name, bytes, mimeType) => ({ name, mimeType, buffer: Buffer.from(bytes) });
const noSerious = async (page) => {
  // Pop-up messages fade in and out; mid-animation they measure as low contrast. They are
  // left out here (their contrast is checked when fully shown in the Phase 1–3 tests).
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[class*="Notifications-root"]').analyze();
  const serious = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
};
const fitsScreen = (page) => page.evaluate(() =>
  document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);

let org, admin, presenterLogin, liveMeeting, wizardMeetingId;
const PERSON = { designation: 'Deputy Director', organisation: 'Planning (DEMO)' };

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  org = await createOrganisation(sa.client, { name: `Rural Development Department DEMO ${Date.now().toString(36)}` });
  admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
  presenterLogin = await createStaff(admin.client, org.id, 'PRESENTER');
  const { data: pr } = await admin.client.from('presenters')
    .insert({ full_name: 'Smt. Leela Prasad (DEMO)', designation: 'Joint Director', user_id: presenterLogin.userId }).select('id').single();

  // A meeting happening now with two sessions, for presenter mode and the live figures.
  const at = (min) => new Date(Date.now() + min * 60000).toISOString();
  liveMeeting = await createMeeting(admin.client, { title: 'District Planning Review (DEMO)', starts_at: at(-30), ends_at: at(90) });
  await createSession(admin.client, liveMeeting.id, { title: 'Water Supply Projects', presenter_id: pr.id, starts_at: at(-30), ends_at: at(20) });
  await createSession(admin.client, liveMeeting.id, { title: 'Road Connectivity', starts_at: at(20), ends_at: at(80) });
  await admin.client.from('meetings').update({ status: 'PUBLISHED', availability_mode: 'ALWAYS' }).eq('id', liveMeeting.id);
  liveMeeting.token = (await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [liveMeeting.id])).rows[0].token;
});

async function signIn(page, who = admin) {
  await signInUi(page, who.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('create a meeting with the wizard, from details to "Meeting Published Successfully"', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Create meeting' }).click();
  await expect(page.getByRole('heading', { name: 'Step 1: Meeting details' })).toBeVisible();

  // 1 — details
  await page.getByLabel(/^Meeting title/).fill('Panchayat Raj Training (DEMO)');
  const tomorrow = new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
  await page.getByLabel(/^Date/).fill(tomorrow);
  await page.getByLabel(/^Venue/).fill('SIRD Hall 1');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // 2 — presenters & sessions (a new presenter added from inside the session form)
  await expect(page.getByRole('heading', { name: 'Step 2: Presenters & sessions' })).toBeVisible();
  wizardMeetingId = page.url().match(/meetings\/([0-9a-f-]{36})\/setup/)[1];
  await noSerious(page);
  await page.getByRole('button', { name: 'Add session' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add session' });
  await dialog.getByLabel(/^Session title/).fill('Gram Sabha Procedures');
  await dialog.getByLabel(/^End time/).fill('11:00');
  await dialog.getByRole('button', { name: 'New presenter' }).click();
  const presenterDialog = page.getByRole('dialog', { name: 'Add presenter' });
  await presenterDialog.getByLabel(/^Full name/).fill('Sri. Manjunath Gowda (DEMO)');
  await presenterDialog.getByLabel(/^Designation/).fill('Faculty, SIRD');
  await presenterDialog.getByRole('button', { name: 'Save' }).click();
  await expect(presenterDialog).toHaveCount(0);
  await expect(dialog.getByLabel(/^Presenter/)).toHaveValue(/Manjunath Gowda/);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('session-1').getByText('Sri. Manjunath Gowda (DEMO), Faculty, SIRD')).toBeVisible();
  await page.getByRole('button', { name: 'Add session' }).click();
  dialog = page.getByRole('dialog', { name: 'Add session' });
  await dialog.getByLabel(/^Session title/).fill('Open Discussion');
  await dialog.getByLabel(/^Start time/).fill('11:00');
  await dialog.getByLabel(/^End time/).fill('12:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('session-2')).toBeVisible();
  // This step shows sessions only.
  await expect(page.getByRole('button', { name: 'Add presentation' })).toHaveCount(0);
  await shot(page, 'w-step2');
  await page.getByRole('button', { name: 'Next' }).click();

  // 3 — presentations
  await expect(page.getByRole('heading', { name: 'Step 3: Presentations' })).toBeVisible();
  await page.getByTestId('session-1').getByRole('button', { name: 'Add presentation' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Presentation title/).fill('Gram Sabha Procedures');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('upload-Gram Sabha Procedures').setInputFiles(file('Gram Sabha.pdf', makePdf(3), 'application/pdf'));
  await expect(page.getByTestId('presentation-Gram Sabha Procedures').getByText(/Gram Sabha\.pdf/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // 4 — supporting material
  await expect(page.getByRole('heading', { name: 'Step 4: Supporting material' })).toBeVisible();
  await page.getByTestId('attach-1').setInputFiles(file('Circular 2026-14.pdf', makePdf(1, 'Circular'), 'application/pdf'));
  await expect(page.getByTestId('session-1').getByText('Circular 2026-14', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // 5 — access & downloads
  await expect(page.getByRole('heading', { name: 'Step 5: Access & downloads' })).toBeVisible();
  await page.getByLabel('Details are optional — participants may skip').check();
  await expect(page.getByText('Changes saved.').first()).toBeVisible();
  await noSerious(page);
  await page.getByRole('button', { name: 'Next' }).click();

  // 6 — QR code, created before publishing
  await expect(page.getByRole('heading', { name: 'Step 6: QR code' })).toBeVisible();
  await page.getByRole('button', { name: 'Create QR code' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  await expect(page.getByText('Works after publishing')).toBeVisible();
  const link = await page.getByTestId('qr-link').inputValue();
  const early = await publicCall('info', { token: link.split('/m/')[1] });
  expect(early.body.state).toBe('NOT_YET');
  await page.getByRole('button', { name: 'Next' }).click();

  // 7 — review & publish
  await expect(page.getByRole('heading', { name: 'Step 7: Review & publish' })).toBeVisible();
  const checks = page.getByTestId('review-checks');
  await expect(checks).toContainText('"Open Discussion" has no presenter.');
  await expect(checks).toContainText('"Open Discussion" has no presentation yet');
  await expect(page.getByText('Created — ready to print or display')).toBeVisible();
  await shot(page, 'w-review');
  await page.getByRole('button', { name: 'Publish meeting' }).click();

  await expect(page.getByTestId('published-title')).toHaveText('Meeting Published Successfully');
  await expect(page.getByTestId('published-qr')).toBeVisible();
  await expect(page.getByLabel('Meeting link')).toHaveValue(link);           // the code made in step 6 is kept
  for (const name of ['Display QR', 'Download QR', 'Print QR', 'Copy link']) {
    await expect(page.getByRole('link', { name }).or(page.getByRole('button', { name }))).toBeVisible();
  }
  await shot(page, 'w-published');
  await noSerious(page);
  expect((await publicCall('info', { token: link.split('/m/')[1] })).body.state).not.toBe('INVALID');
  const status = await db.query('select status from public.meetings where id = $1', [wizardMeetingId]);
  expect(status.rows[0].status).toBe('PUBLISHED');
});

test('a draft can be continued later from the meeting page', async ({ page }) => {
  const draft = await createMeeting(admin.client, { title: 'Unfinished Workshop (DEMO)' });
  await signIn(page);
  await page.goto(`/meetings/${draft.id}`);
  await page.getByRole('link', { name: 'Continue setup' }).click();
  await expect(page.getByRole('heading', { name: 'Step 2: Presenters & sessions' })).toBeVisible();
  await page.getByRole('button', { name: /Review & publish/ }).first().click();
  await expect(page.getByTestId('review-checks')).toContainText('a meeting cannot be published without sessions');
  await expect(page.getByRole('button', { name: 'Publish meeting' })).toBeDisabled();
});

test('the wizard works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await signIn(page);
  await page.goto(`/meetings/${wizardMeetingId}/setup?step=3`);
  await expect(page.getByRole('heading', { name: 'Step 3: Presentations' })).toBeVisible();
  await shot(page, 'w-phone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('QR display on a 1920 × 1080 screen, with the live count', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await page.goto(`/display/meetings/${liveMeeting.id}/qr`);
  const qr = page.getByTestId('qr-display-image');
  await expect(qr).toBeVisible();
  await expect(page.getByText('Scan to access presentation and supporting material')).toBeVisible();
  await expect(page.getByText('ಪ್ರಸ್ತುತಿ ಮತ್ತು ಪೂರಕ ಸಾಮಗ್ರಿ ಪಡೆಯಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ')).toBeVisible();
  await expect(page.getByText('Open your mobile camera and scan the QR code', { exact: false })).toBeVisible();
  const box = await qr.boundingBox();
  expect(box.height).toBeGreaterThan(550);                       // readable from the back of a hall
  expect(box.y + box.height).toBeLessThanOrEqual(1080);
  expect(await fitsScreen(page)).toBe(true);                      // nothing hidden below the screen
  await expect(page.getByTestId('qr-display-count')).toHaveCount(0);   // count is off unless chosen
  await shot(page, 'd-display-1080');

  await page.getByRole('button', { name: 'Participant count' }).click();
  await expect(page.getByTestId('qr-display-count')).toContainText('0');
  const r = await publicCall('register', { token: liveMeeting.token, consent: true, fields: { ...PERSON, name: 'Ramesh Naik (DEMO)' } });
  expect(r.status).toBe(201);
  await expect(page.getByTestId('qr-display-count')).toContainText('1', { timeout: 12_000 });
  expect(await fitsScreen(page)).toBe(true);
  await shot(page, 'd-display-count');
  await noSerious(page);

  // Smaller screens (an old 1366 × 768 projector, a 1280 × 720 TV) still fit.
  for (const [width, height] of [[1366, 768], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    expect(await fitsScreen(page)).toBe(true);
  }
});

test('presenter mode: NOW / NEXT, countdown, manual override, QR and count', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await page.goto(`/meetings/${liveMeeting.id}`);
  const [pm] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'Start presentation' }).click()]);
  await pm.setViewportSize({ width: 1920, height: 1080 });
  await expect(pm.getByTestId('pm-now')).toHaveText('Water Supply Projects');
  await expect(pm.getByText('Smt. Leela Prasad (DEMO), Joint Director')).toBeVisible();
  await expect(pm.getByTestId('pm-next')).toContainText('Road Connectivity');
  await expect(pm.getByTestId('pm-timer')).toHaveText(/^\d+:\d\d left$/);
  await expect(pm.getByTestId('pm-qr')).toBeVisible();
  await expect(pm.getByText('Meeting:', { exact: false })).toContainText('elapsed');
  expect(await fitsScreen(pm)).toBe(true);
  await shot(pm, 'p-presenter-mode');

  // Running early: move to the next session by hand, then back to the timetable.
  await pm.keyboard.press('ArrowRight');
  await expect(pm.getByTestId('pm-now')).toHaveText('Road Connectivity');
  await expect(pm.getByText('chosen by hand', { exact: false })).toBeVisible();
  await pm.keyboard.press('t');
  await expect(pm.getByTestId('pm-now')).toHaveText('Water Supply Projects');

  // QR off, count on.
  await pm.keyboard.press('q');
  await expect(pm.getByTestId('pm-qr')).toHaveCount(0);
  await pm.keyboard.press('c');
  await expect(pm.getByTestId('pm-count')).toContainText('Total participants');
  await expect(pm.getByTestId('pm-count')).toContainText('1');
  await noSerious(pm);
  // The controls hide when the mouse and keyboard are idle, and come back on any key.
  await pm.mouse.move(400, 400);
  await expect(pm.getByRole('button', { name: 'Follow timetable' }).or(pm.getByRole('button', { name: 'QR code' }))).toBeHidden({ timeout: 6000 });
  await pm.keyboard.press('Shift');
  await expect(pm.getByRole('button', { name: 'QR code' })).toBeVisible();
});

test('the presenter of the meeting can use presenter mode; the count follows the organisation setting', async ({ page }) => {
  await signIn(page, presenterLogin);
  await page.goto(`/present/meetings/${liveMeeting.id}?count=1`);
  await expect(page.getByTestId('pm-now')).toHaveText('Water Supply Projects');
  await expect(page.getByTestId('pm-count')).toBeVisible();
  await admin.client.from('organisation_settings').update({ presenters_see_count: false }).eq('organisation_id', org.id);
  await page.reload();
  await expect(page.getByTestId('pm-now')).toHaveText('Water Supply Projects');
  await expect(page.getByRole('button', { name: 'Count' })).toHaveCount(0);
  await expect(page.getByTestId('pm-count')).toHaveCount(0);
  await admin.client.from('organisation_settings').update({ presenters_see_count: true }).eq('organisation_id', org.id);
});

test('the meeting page shows live figures that update by themselves', async ({ page }) => {
  await signIn(page);
  await page.goto(`/meetings/${liveMeeting.id}`);
  const panel = page.getByTestId('live-panel');
  await expect(panel).toContainText('Water Supply Projects');
  await expect(panel).toContainText('Smt. Leela Prasad (DEMO)');
  const before = Number(await page.getByTestId('live-total').textContent());
  await publicCall('register', { token: liveMeeting.token, consent: true, fields: { ...PERSON, name: 'Fathima Begum (DEMO)' } });
  await expect(page.getByTestId('live-total')).toHaveText(String(before + 1), { timeout: 12_000 });
  await expect(page.getByTestId('live-active')).toHaveText(String(before + 1));
});

test('presenter mode in Kannada', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await page.getByText('ಕನ್ನಡ').first().click();
  await page.goto(`/present/meetings/${liveMeeting.id}`);
  await expect(page.getByText('ಈಗ', { exact: true })).toBeVisible();
  await expect(page.getByText('ಮುಂದೆ', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pm-timer')).toContainText('ಉಳಿದಿದೆ');
  expect(await fitsScreen(page)).toBe(true);
  await page.goto('/');
  await page.getByText('English').first().click();
});
