// Sign-out after inactivity. The limit (SESSION_INACTIVITY_TIMEOUT, 30 minutes) is
// shortened to 10 seconds for these tests by rewriting the runtime configuration.
// (The server-side limit is checked separately: a session that has not been renewed
// within the limit cannot be renewed — see docs/TEST-REPORT for the timed check.)
import { expect, test } from '@playwright/test';
import { createMeeting, createOrganisation, createSession, createStaff, createSuperAdmin, PASSWORD } from '../api/_helpers.mjs';
import { signInUi } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });
let admin, meeting;

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  const org = await createOrganisation(sa.client);
  admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
  meeting = await createMeeting(admin.client, { title: 'Session check (DEMO)' });
  await createSession(admin.client, meeting.id);
  await admin.client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meeting.id);
});

async function shortLimit(page, limit = '10s') {
  await page.route('**/config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/sessionInactivity:"[^"]*"/, `sessionInactivity:"${limit}"`);
    await route.fulfill({ response: res, body });
  });
}

test('an idle screen warns, then signs out and explains why', async ({ page }) => {
  await shortLimit(page);
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole('heading', { name: 'Sign in to Presentify' })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText('You were signed out because there was no activity for a while.')).toBeVisible();
  // The session is really gone: going back to a page asks to sign in again.
  await page.goto('/meetings');
  await expect(page.getByRole('heading', { name: 'Sign in to Presentify' })).toBeVisible();
});

test('using the screen keeps the person signed in; "Stay signed in" works', async ({ page }) => {
  await shortLimit(page);
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  for (let i = 0; i < 8; i++) {                    // 16 seconds of activity
    await page.mouse.move(100 + i * 10, 200);
    await page.waitForTimeout(2000);
  }
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const warning = page.getByRole('dialog', { name: 'Are you still there?' });
  await expect(warning).toBeVisible({ timeout: 12_000 });
  await warning.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});

test('QR display and presenter screens stay on during a meeting', async ({ page }) => {
  await shortLimit(page);
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto(`/present/meetings/${meeting.id}`);
  await expect(page.getByTestId('presenter-mode')).toBeVisible();
  await page.waitForTimeout(15_000);
  await expect(page.getByTestId('presenter-mode')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toHaveCount(0);
});
