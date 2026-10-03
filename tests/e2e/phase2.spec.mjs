// End-to-end: an Organisation Admin prepares a meeting through the real screens.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createOrganisation, createStaff, createSuperAdmin, PASSWORD, SAMPLE } from '../api/_helpers.mjs';
import { signInUi } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

let admin;

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  const org = await createOrganisation(sa.client, { name: `Karnataka Police Training Division DEMO ${Date.now().toString(36)}` });
  admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
});

const file = (name, bytes, mimeType) => ({ name, mimeType, buffer: Buffer.from(bytes) });

test('create a meeting with a presenter, session, presentation, PDF copy and supporting document', async ({ page }) => {
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // Presenter directory
  await page.getByRole('link', { name: 'Presenters' }).click();
  await page.getByRole('button', { name: 'Add presenter' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Full name/).fill('Ravi Kumar, IPS (DEMO)');
  await dialog.getByLabel(/^Designation/).fill('Superintendent of Police');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: /^Ravi Kumar, IPS \(DEMO\)/ })).toBeVisible();

  // Meeting (from the dashboard quick action)
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('link', { name: 'Create meeting' }).click();
  // (Phase 4: "Create meeting" opens the step-by-step wizard; this test continues on the meeting page.)
  await page.getByLabel(/^Meeting title/).fill('Senior Officers Training Programme (DEMO)');
  const tomorrow = new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
  await page.getByLabel(/^Date/).fill(tomorrow);
  await page.getByLabel(/^Venue/).fill('Training Hall');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Step 2: Presenters & sessions' })).toBeVisible();
  await page.getByRole('link', { name: 'Finish later' }).click();
  await expect(page.getByRole('heading', { name: 'Senior Officers Training Programme (DEMO)' })).toBeVisible();
  await expect(page.getByText(/MTG-\d{4}-\d{4}/)).toBeVisible();

  // Publishing needs at least one session.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Add at least one session before publishing the meeting.')).toBeVisible();

  // Session
  await page.getByRole('button', { name: 'Add session' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Session title/).fill('Cyber Security Awareness');
  await dialog.getByLabel(/^Presenter/).click();
  await page.getByRole('option', { name: /Ravi Kumar/ }).click();
  await dialog.getByLabel(/^End time/).fill('11:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const session = page.getByTestId('session-1');
  await expect(session.getByRole('heading', { name: 'Cyber Security Awareness' })).toBeVisible();
  await expect(session.getByText('Ravi Kumar, IPS (DEMO), Superintendent of Police')).toBeVisible();

  // Presentation: PowerPoint first, then its PDF copy for phones.
  await session.getByRole('button', { name: 'Add presentation' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Presentation title/).fill('Cyber Security Awareness');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('upload-Cyber Security Awareness').setInputFiles(
    file('Cyber Security.pptx', SAMPLE.pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
  const item = page.getByTestId('presentation-Cyber Security Awareness');
  await expect(item.getByText(/Cyber Security\.pptx/)).toBeVisible();
  await expect(item.getByText(/No viewable copy yet/)).toBeVisible();
  await page.getByTestId('pdf-Cyber Security Awareness').setInputFiles(file('Cyber Security.pdf', SAMPLE.pdf, 'application/pdf'));
  await expect(item.getByText('PDF ready for phones')).toBeVisible();

  // A disguised file is refused with a plain-language message.
  await page.getByTestId('attach-1').setInputFiles(file('Statistics.pdf', SAMPLE.html, 'application/pdf'));
  await expect(page.getByText(/does not match a \.pdf file/)).toBeVisible();

  // Supporting document
  await page.getByTestId('attach-1').setInputFiles(file('Briefing Note.pdf', SAMPLE.pdf, 'application/pdf'));
  await expect(session.getByText('Briefing Note', { exact: true })).toBeVisible();

  // New version, then the version history.
  await item.getByRole('button', { name: /Actions: Cyber Security Awareness/ }).click();
  await page.getByRole('menuitem', { name: 'Upload new version' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/What changed/).fill('Updated statistics');
  await page.getByTestId('new-version-input').setInputFiles(file('Cyber Security v2.pdf', SAMPLE.pdf, 'application/pdf'));
  await expect(item.getByText(/Version 2/)).toBeVisible();
  await item.getByRole('button', { name: /Actions: Cyber Security Awareness/ }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Updated statistics')).toBeVisible();
  await dialog.getByRole('button', { name: 'Make this the current version' }).click();
  await page.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'Make this the current version' }).click();
  await expect(item.getByText(/Version 3/)).toBeVisible();

  // Publish
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Meeting published.')).toBeVisible();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();

  // Accessibility of the meeting page
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 1)).toEqual([]);
});

test('the meeting appears in the lists and on the dashboard', async ({ page }) => {
  await signInUi(page, admin.email, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Upcoming meetings' }).or(page.getByRole('heading', { name: "Today's meetings" })).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Senior Officers Training Programme (DEMO)' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Presentations', exact: true }).click();
  await expect(page.getByRole('cell', { name: /^Cyber Security Awareness/ })).toBeVisible();
  await page.getByRole('link', { name: 'Meetings', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Senior Officers Training Programme (DEMO)' })).toBeVisible(); // Upcoming
  await page.locator('label', { hasText: /^All$/ }).click();
  await expect(page.getByRole('link', { name: 'Senior Officers Training Programme (DEMO)' })).toBeVisible();
});
