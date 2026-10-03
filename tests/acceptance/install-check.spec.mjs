// Installation check — the whole journey through the real screens on any Presentify
// installation (laptop or server), without database access:
//   Super Admin first sign-in (new password + authenticator) → organisation and its
//   administrator → administrator's first sign-in → meeting wizard with a presenter,
//   a PDF and a QR code → publish → a phone registers and reads the PDF → attendance,
//   presenter mode and QR display.
//
// It creates DEMO data (an organisation named "Installation check DEMO …").
// See docs/TESTING-GUIDE.md, "Installation check", for how to run it.
import { devices, expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { generateSync } from 'otplib';
import { makePdf } from '../lib/pdf.mjs';

test.describe.configure({ mode: 'serial' });

const SA_EMAIL = process.env.CHECK_SA_EMAIL;
const SA_TEMP = process.env.CHECK_SA_PASSWORD;
const run = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomBytes(2).toString('hex')}`;
const strong = () => `Check#${randomBytes(6).toString('hex')}A1`;
const state = { saPassword: strong(), adminPassword: process.env.CHECK_ADMIN_PASSWORD || strong(), adminEmail: `check.admin.${run}@demo.presentify.local` };
const orgName = `Installation check DEMO ${run}`;
const meetingTitle = `Installation check meeting (DEMO) ${run}`;

test.skip(!SA_EMAIL || !SA_TEMP, 'Set CHECK_SA_EMAIL and CHECK_SA_PASSWORD (a new Super Admin from create-superadmin).');

async function signIn(page, email, password) {
  await page.goto('/');
  await page.getByLabel(/E-mail address/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function newPassword(page, password) {
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel(/^New password/).fill(password);
  await page.getByLabel(/Re-enter the new password/).fill(password);
  await page.getByRole('button', { name: 'Change password' }).click();
}
async function typeCode(page, secret) {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 4) await page.waitForTimeout((remaining + 1) * 1000);
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(generateSync({ secret }));
}

test('1. Super Admin: first sign-in, new password, authenticator app', async ({ page }) => {
  await signIn(page, SA_EMAIL, SA_TEMP);
  await newPassword(page, state.saPassword);
  await expect(page.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible();
  state.saSecret = (await page.getByTestId('mfa-secret').textContent()).trim();
  await typeCode(page, state.saSecret);
  await expect(page.getByRole('heading', { name: 'Presentify administration' })).toBeVisible();
});

test('2. Super Admin: organisation and its administrator', async ({ page }) => {
  await signIn(page, SA_EMAIL, state.saPassword);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await typeCode(page, state.saSecret);
  await page.getByRole('link', { name: 'Organisations' }).click();
  await page.getByRole('button', { name: 'New organisation' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Organisation name/).fill(orgName);
  await dialog.getByLabel(/^Package/).click();
  await page.getByRole('option', { name: 'Government / Internal' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: orgName })).toBeVisible();
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Full name/).fill('Installation Check Admin (DEMO)');
  await form.getByLabel(/^E-mail address/).fill(state.adminEmail);
  await form.getByRole('radio', { name: 'Organisation Admin' }).check();
  await form.getByRole('button', { name: 'Create' }).click();
  state.adminTemp = (await page.getByTestId('temp-password').textContent()).trim();
  expect(state.adminTemp).toMatch(/^[A-Za-z0-9]{14}$/);
});

test('3. Administrator: first sign-in and a meeting through the wizard', async ({ page }) => {
  await signIn(page, state.adminEmail, state.adminTemp);
  await newPassword(page, state.adminPassword);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  await page.getByRole('link', { name: 'Create meeting' }).click();
  await page.getByLabel(/^Meeting title/).fill(meetingTitle);
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  await page.getByLabel(/^Date/).fill(today);
  await page.getByLabel(/^Start time/).fill('00:01');
  await page.getByLabel(/^End time/).fill('23:59');
  await page.getByLabel(/^Venue/).fill('Check Hall');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByRole('button', { name: 'Add session' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add session' });
  await dialog.getByLabel(/^Session title/).fill('Installation check session');
  await dialog.getByRole('button', { name: 'New presenter' }).click();
  const pd = page.getByRole('dialog', { name: 'Add presenter' });
  await pd.getByLabel(/^Full name/).fill('Check Presenter (DEMO)');
  await pd.getByRole('button', { name: 'Save' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByTestId('session-1').getByRole('button', { name: 'Add presentation' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Presentation title/).fill('Check slides');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('upload-Check slides').setInputFiles({ name: 'check.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf(5, 'Check')) });
  await expect(page.getByTestId('presentation-Check slides').getByText(/check\.pdf/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();   // supporting material (optional)
  await page.getByRole('button', { name: 'Next' }).click();   // access
  await page.getByLabel('At any time (until the meeting is archived)').check();
  await expect(page.getByText('Changes saved.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();   // QR
  await page.getByRole('button', { name: 'Create QR code' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();   // review
  await page.getByRole('button', { name: 'Publish meeting' }).click();
  await expect(page.getByTestId('published-title')).toHaveText('Meeting Published Successfully');
  state.link = await page.getByLabel('Meeting link').inputValue();
  state.meetingUrl = page.url();
});

test('4. A phone scans, registers and reads the PDF', async ({ browser }) => {
  // The link inside the QR code must point at this installation (PUBLIC_URL in .env).
  const base = new URL(test.info().project.use.baseURL);
  const link = new URL(state.link);
  expect(link.host, `PUBLIC_URL in .env (${link.origin}) must match the address phones use`).toBe(base.host);

  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await phone.newPage();
  await p.goto(state.link);
  await expect(p.getByRole('heading', { name: meetingTitle })).toBeVisible();
  await p.getByLabel('Name').fill('Check Participant (DEMO)');
  await p.getByLabel('Designation').fill('Tester');
  await p.getByLabel('Organisation').fill('Installation check');
  await p.getByLabel('I agree').check();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('button', { name: 'Open' }).click();
  const page1 = p.getByRole('img', { name: 'Page 1' });
  await expect(page1).toBeVisible();
  await expect.poll(() => page1.evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 120) ink++;
    return ink;
  }), { message: 'the PDF page must actually be drawn' }).toBeGreaterThan(500);
  await p.getByRole('button', { name: 'Full screen' }).click();
  await expect(p.getByText('Page 1 of 5')).toBeVisible();
  await phone.close();
});

test('5. Attendance, presenter mode and QR display', async ({ page }) => {
  await signIn(page, state.adminEmail, state.adminPassword);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const meetingPath = new URL(state.meetingUrl).pathname.replace(/\/setup$/, '');
  await page.goto(`${meetingPath}?tab=participants`);
  await expect(page.getByRole('cell', { name: 'Check Participant (DEMO)' })).toBeVisible();
  await expect(page.getByTestId('live-total')).toHaveText('1');
  const id = meetingPath.split('/').pop();
  await page.goto(`/present/meetings/${id}`);
  await expect(page.getByTestId('pm-now')).toHaveText('Installation check session');
  await page.goto(`/display/meetings/${id}/qr`);
  await expect(page.getByTestId('qr-display-image')).toBeVisible();
  console.log(`\nInstallation check passed. DEMO organisation: "${orgName}". Administrator: ${state.adminEmail}`);
});
