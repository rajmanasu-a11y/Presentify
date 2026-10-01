import { expect } from '@playwright/test';
import { generateSync } from 'otplib';
import { authAdmin, db, PASSWORD, uniqueEmail } from '../api/_helpers.mjs';

export { PASSWORD, uniqueEmail, db };

/** A Super Admin as created from the server console: temporary password, no MFA yet. */
export async function newSuperAdminAccount() {
  const email = uniqueEmail('e2e-super');
  const temporary = 'Temp#Pass2026x';
  const user = await authAdmin('/users', 'POST', { email, password: temporary, email_confirm: true });
  await db.query(
    `insert into public.profiles (user_id, organisation_id, role, full_name, email, must_change_password)
     values ($1, null, 'SUPER_ADMIN', 'E2E Super Admin', $2, true)`, [user.id, email]);
  return { email, temporary };
}

export async function signInUi(page, email, password) {
  await page.goto('/');
  await page.getByLabel(/E-mail address/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function typeCode(page, secret) {
  // Avoid a code that is about to expire.
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 4) await page.waitForTimeout((remaining + 1) * 1000);
  const code = generateSync({ secret });
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(code);
}

export async function changePasswordUi(page, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel(/^New password/).fill(password);
  await page.getByLabel(/Re-enter the new password/).fill(password);
  await page.getByRole('button', { name: 'Change password' }).click();
}

/** Completes authenticator set-up on the MFA page and returns the secret. */
export async function setUpMfaUi(page) {
  await expect(page.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible();
  const secret = (await page.getByTestId('mfa-secret').textContent()).trim();
  await typeCode(page, secret);
  return secret;
}
