// End-to-end: an organiser opens the meeting's QR code, sets who may open it
// (passcode), replaces the code, shows it full screen, and sees who registered.
import { devices, expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin, db, makePdf, PASSWORD, upload,
} from '../api/_helpers.mjs';
import { signInUi } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

// SHOTS=<folder> saves screenshots for the phase report.
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });

let admin, organiser, presenter, meeting;

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  const org = await createOrganisation(sa.client, { name: `Fisheries Department DEMO ${Date.now().toString(36)}` });
  admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
  organiser = await createStaff(admin.client, org.id, 'ORGANISER');
  presenter = await createStaff(admin.client, org.id, 'PRESENTER');
  const { data: presenterRecord, error } = await admin.client.from('presenters')
    .insert({ full_name: 'Dr. Lata Shetty (DEMO)', designation: 'Joint Director', user_id: presenter.userId }).select('id').single();
  if (error) throw error;
  meeting = await createMeeting(organiser.client, { title: 'Coastal Development Review (DEMO)', venue: 'Conference Room 1' });
  const s = await createSession(organiser.client, meeting.id, { title: 'Harbour Projects', presenter_id: presenterRecord.id });
  const p = await createPresentation(organiser.client, s.id, 'Harbour Projects — Status');
  const r = await upload(organiser.client, { purpose: 'PRESENTATION', target: p.id, name: 'Harbour.pdf', bytes: makePdf(2) });
  if (r.finish?.status !== 200) throw new Error(JSON.stringify(r));
});

const linkToken = async (page) => (await page.getByTestId('qr-link').inputValue()).split('/m/')[1];

test('QR code tab, access settings, passcode, replacing the code', async ({ page }) => {
  await signInUi(page, organiser.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto(`/meetings/${meeting.id}?tab=qr`);
  await expect(page.getByText('You can create the QR code now and print it in advance.', { exact: false })).toBeVisible();

  // Publish → the QR code appears.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  const first = await linkToken(page);
  expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await expect(page.getByText('Not open yet')).toBeVisible();

  // Open at any time, with a passcode.
  await page.getByLabel('At any time (until the meeting is archived)').check();
  await expect(page.getByText('Link is open now')).toBeVisible();
  await page.getByLabel('Set a passcode (4–40 characters)').fill('HARBOUR26');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('A passcode is set.', { exact: false })).toBeVisible();

  await shot(page, 's-qr-tab');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);

  // Replace the code: a warning first, then a new code; the old one stops working.
  await page.getByRole('button', { name: 'Replace with a new QR code' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('stop working immediately');
  await dialog.getByRole('button', { name: 'Replace with a new QR code' }).click();
  await expect(page.getByText('A new QR code has been created.')).toBeVisible();
  await expect.poll(() => linkToken(page)).not.toBe(first);
  const current = await linkToken(page);

  // Full-screen display page shows the current code and the bilingual instruction.
  const [display] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'Show full screen' }).click()]);
  await expect(display.getByTestId('qr-display-image')).toBeVisible();
  await expect(display.getByText('Scan to access presentation and supporting material')).toBeVisible();
  await expect(display.getByText(`/m/${current}`)).toBeVisible();
  const img = await display.getByTestId('qr-display-image').boundingBox();
  expect(img.width).toBeGreaterThan(300);
  await shot(display, 's-qr-display');
  await display.close();

  // A participant registers with the passcode on a phone.
  const phone = await page.context().browser().newContext({ ...devices['Pixel 7'] });
  const p = await phone.newPage();
  await p.goto(`/m/${first}`);
  await expect(p.getByRole('heading', { name: 'This QR code is not valid' })).toBeVisible();
  await p.goto(`/m/${current}`);
  await p.getByLabel('Name').fill('Suresh Naik (DEMO)');
  await p.getByLabel('Designation').fill('Assistant Director');
  await p.getByLabel('Organisation').fill('Fisheries (DEMO)');
  await p.getByLabel('Meeting passcode').fill('wrong');
  await p.getByLabel('I agree').check();
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.getByText('The meeting passcode is not correct.')).toBeVisible();
  await p.getByLabel('Meeting passcode').fill('HARBOUR26');
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.getByRole('heading', { name: 'Harbour Projects' })).toBeVisible();
  await p.getByRole('button', { name: 'Open' }).click();
  await expect(p.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await phone.close();

  // The organiser sees the participant and what they opened.
  await page.getByRole('tab', { name: 'Participants' }).click();
  await expect(page.getByRole('cell', { name: 'Suresh Naik (DEMO)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1 viewed · 0 downloaded' })).toBeVisible();
  await shot(page, 's-participants');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Participants registered today').locator('..')).toContainText('1');
  const a11y2 = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y2.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
});

test('presenters can display the QR code but not change it or see participants', async ({ page }) => {
  await signInUi(page, presenter.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto(`/meetings/${meeting.id}?tab=qr`);
  await expect(page.getByTestId('qr-image')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show full screen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace with a new QR code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch off' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Participants' })).toHaveCount(0);
  await expect(page.getByLabel('At any time (until the meeting is archived)')).toBeDisabled();
});

test('QR code tab in Kannada', async ({ page }) => {
  await signInUi(page, organiser.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto(`/meetings/${meeting.id}?tab=qr`);
  await page.getByText('ಕನ್ನಡ').first().click();
  await expect(page.getByRole('tab', { name: 'QR ಕೋಡ್ ಮತ್ತು ಪ್ರವೇಶ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ಪೂರ್ಣ ಪರದೆಯಲ್ಲಿ ತೋರಿಸಿ' })).toBeVisible();
  await expect(page.getByText('ಸಭೆಯನ್ನು ಯಾರು, ಯಾವಾಗ ತೆರೆಯಬಹುದು')).toBeVisible();
  await page.getByText('English').first().click();
});
