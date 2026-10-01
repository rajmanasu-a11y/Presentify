// End-to-end: the Phase 1 journeys through the real screens.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { changePasswordUi, newSuperAdminAccount, PASSWORD, setUpMfaUi, signInUi, typeCode, uniqueEmail } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

const orgName = `Karnataka Police Training Division DEMO ${Date.now().toString(36)}`;
const orgAdminEmail = uniqueEmail('e2e-orgadmin');
let superAdmin;
let superSecret;
let orgAdminTemporary;

test('sign-in page is clear, accessible and bilingual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Presentify' })).toBeVisible();
  await expect(page.getByText('Test mode — not for official use')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 1)).toEqual([]);

  await page.getByText('ಕನ್ನಡ').click();
  await expect(page.getByRole('heading', { name: 'ಪ್ರೆಸೆಂಟಿಫೈಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kn');
  await page.getByText('English').click();
  await expect(page.getByRole('heading', { name: 'Sign in to Presentify' })).toBeVisible();
});

test('a wrong password gives a plain-language message', async ({ page }) => {
  await signInUi(page, 'nobody@test.presentify.local', 'Wrong#Password1');
  await expect(page.getByRole('alert')).toHaveText('The e-mail address or password is incorrect.');
});

test('Super Admin first sign-in: new password, authenticator set-up, console', async ({ page }) => {
  superAdmin = await newSuperAdminAccount();
  await signInUi(page, superAdmin.email, superAdmin.temporary);
  await changePasswordUi(page);
  superSecret = await setUpMfaUi(page);
  await expect(page.getByRole('heading', { name: 'Presentify administration' })).toBeVisible();
  await expect(page).toHaveURL(/\/console$/);
});

test('Super Admin creates an organisation and its administrator', async ({ page }) => {
  await signInUi(page, superAdmin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await typeCode(page, superSecret);
  await expect(page.getByRole('heading', { name: 'Presentify administration' })).toBeVisible();

  await page.getByRole('link', { name: 'Organisations' }).click();
  await page.getByRole('button', { name: 'New organisation' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Organisation name/).fill(orgName);
  await dialog.getByLabel(/^Package/).click();
  await page.getByRole('option', { name: 'Government / Internal' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: orgName })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Staff' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Full name/).fill('Anita Sharma (DEMO)');
  await form.getByLabel(/^E-mail address/).fill(orgAdminEmail);
  await form.getByLabel(/^Designation/).fill('Superintendent of Police');
  await form.getByRole('radio', { name: 'Organisation Admin' }).check();
  await form.getByRole('button', { name: 'Create' }).click();

  orgAdminTemporary = (await page.getByTestId('temp-password').textContent()).trim();
  expect(orgAdminTemporary).toMatch(/^[A-Za-z0-9]{14}$/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('cell', { name: /^Anita Sharma \(DEMO\)/ })).toBeVisible();

  // Limits are adjustable by the Super Admin.
  await page.getByRole('tab', { name: 'Package & limits' }).click();
  await page.getByLabel(/^Administrators/).fill('3');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.').first()).toBeVisible();
});

test('Organisation Admin signs in, sets a password and manages the organisation', async ({ page }) => {
  await signInUi(page, orgAdminEmail, orgAdminTemporary);
  await changePasswordUi(page);
  await expect(page.getByRole('heading', { name: 'Welcome, Anita Sharma (DEMO)' })).toBeVisible();
  await expect(page.getByText(orgName).first()).toBeVisible();

  // The Super Admin console is not available to organisation staff.
  await page.goto('/console/organisations');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  // Organisation profile and logo.
  await page.goto('/organisation');
  await page.getByLabel(/^Tagline/).fill('Present. Scan. Access.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.').first()).toBeVisible();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('img', { name: 'Logo' })).toBeVisible();

  // Participant registration settings.
  await page.getByRole('tab', { name: 'Participant settings' }).click();
  await page.getByRole('checkbox', { name: 'Mobile number — Ask' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.').first()).toBeVisible();

  // Add an organiser.
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Full name/).fill('Ravi Kumar (DEMO)');
  await form.getByLabel(/^E-mail address/).fill(uniqueEmail('e2e-organiser'));
  await form.getByRole('radio', { name: 'Organiser' }).check();
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('temp-password')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('cell', { name: /^Ravi Kumar \(DEMO\)/ })).toBeVisible();

  // The audit log shows what happened.
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('USER_CREATED').first()).toBeVisible();

  // Kannada interface.
  await page.getByText('ಕನ್ನಡ').first().click();
  await expect(page.getByRole('heading', { name: 'ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆ' })).toBeVisible();
  await page.getByText('English').first().click();
});

test('dashboard has no serious accessibility problems', async ({ page }) => {
  await signInUi(page, orgAdminEmail, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 1)).toEqual([]);
});
