// End-to-end on a phone: scan the QR link → register → open the PDF viewer →
// full screen → page through → download only where allowed; Kannada; messages.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  createMeeting, createOrganisation, createPresentation, createSession, createStaff, createSuperAdmin, db, makePdf, upload,
} from '../api/_helpers.mjs';

test.describe.configure({ mode: 'serial' });

// SHOTS=<folder> saves screenshots for the phase report.
const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });

let token, ended, notYet, organiser, viewOnly, downloadable;

async function publish(client, meetingId) {
  const { error } = await client.from('meetings').update({ status: 'PUBLISHED' }).eq('id', meetingId);
  if (error) throw error;
  return (await db.query(`select token from public.qr_codes where meeting_id = $1 and status = 'ACTIVE'`, [meetingId])).rows[0].token;
}

test.beforeAll(async () => {
  const sa = await createSuperAdmin();
  const org = await createOrganisation(sa.client, { name: `Administrative Training Institute DEMO ${Date.now().toString(36)}` });
  const admin = await createStaff(sa.client, org.id, 'ORG_ADMIN');
  organiser = admin;

  // Happening now, so the session is marked "Now".
  const now = Date.now();
  const at = (h) => new Date(now + h * 3600000).toISOString();
  const m = await createMeeting(admin.client, { title: 'e-Governance Capacity Building (DEMO)', venue: 'Hall 2', starts_at: at(-1), ends_at: at(2) });
  const s1 = await createSession(admin.client, m.id, { title: 'Digital Records', starts_at: at(-1), ends_at: at(1) });
  viewOnly = await createPresentation(admin.client, s1.id, 'Digital Records — Slides');
  let r = await upload(admin.client, { purpose: 'PRESENTATION', target: viewOnly.id, name: 'Digital Records.pdf', bytes: makePdf(4) });
  if (r.finish?.status !== 200) throw new Error(JSON.stringify(r));
  downloadable = await createPresentation(admin.client, s1.id, 'Reading Material');
  r = await upload(admin.client, { purpose: 'PRESENTATION', target: downloadable.id, name: 'Reading Material.pdf', bytes: makePdf(2, 'Reading') });
  if (r.finish?.status !== 200) throw new Error(JSON.stringify(r));
  await admin.client.from('presentations').update({ downloads_allowed: true }).eq('id', downloadable.id);
  token = await publish(admin.client, m.id);
  await admin.client.from('meetings').update({ availability_mode: 'ALWAYS' }).eq('id', m.id);

  const m2 = await createMeeting(admin.client, { title: 'Closed Workshop (DEMO)' });
  await createSession(admin.client, m2.id);
  ended = await publish(admin.client, m2.id);
  await admin.client.from('meetings').update({ status: 'ARCHIVED' }).eq('id', m2.id);

  const m3 = await createMeeting(admin.client, { title: 'Tomorrow\'s Review (DEMO)' });
  await createSession(admin.client, m3.id);
  notYet = await publish(admin.client, m3.id);
});

test('register, view a PDF full screen, download only where allowed', async ({ page }) => {
  await page.goto(`/m/${token}`);
  await expect(page.getByRole('heading', { name: 'e-Governance Capacity Building (DEMO)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Please enter your details' })).toBeVisible();

  // The server's rules are shown in plain language.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Please fill in this field.').first()).toBeVisible();
  await expect(page.getByText('Please tick "I agree" to continue.')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);

  await shot(page, 'p-register-errors');
  await page.getByLabel('Name').fill('Meena Kulkarni (DEMO)');
  await page.getByLabel('Designation').fill('Under Secretary');
  await page.getByLabel('Organisation').fill('DPAR (DEMO)');
  await page.getByLabel('I agree').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Digital Records' })).toBeVisible();
  const slides = page.locator('li', { hasText: 'Digital Records — Slides' });
  await expect(slides.getByText('Downloading is not permitted for this document.')).toBeVisible();
  await expect(slides.getByRole('button', { name: 'Download' })).toHaveCount(0);
  const reading = page.locator('li', { hasText: 'Reading Material' });
  await expect(reading.getByRole('button', { name: 'Download' })).toBeVisible();

  await shot(page, 'p-content');
  const contentA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(contentA11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);

  // Viewer: the PDF renders on canvases sized to the phone.
  await slides.getByRole('button', { name: 'Open' }).click();
  const viewer = page.getByRole('dialog', { name: 'Digital Records — Slides' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText('Page 1 of 4')).toBeVisible();
  const first = viewer.getByRole('img', { name: 'Page 1' });
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.width).toBeGreaterThan(vw * 0.9);
  expect(box.width).toBeLessThanOrEqual(vw + 1);
  await expect.poll(() => first.evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    // Opaque, dark pixels: the slide's text and bar (a blank or unrendered canvas has none).
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 120) ink++;
    return ink;
  })).toBeGreaterThan(500);
  await shot(page, 'p-viewer');
  // No sideways scrolling inside the viewer.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(viewer.locator('.pv-watermark').first()).toContainText('Meena Kulkarni (DEMO)');

  // Full screen: one page at a time, fitted inside the screen.
  await viewer.getByRole('button', { name: 'Full screen' }).click();
  await expect(viewer.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Next page' }).click();
  await expect(viewer.getByText('Page 2 of 4')).toBeVisible();
  const p2 = viewer.getByRole('img', { name: 'Page 2' });
  const b2 = await p2.boundingBox();
  const size = page.viewportSize();
  expect(b2.width).toBeLessThanOrEqual(size.width + 1);
  expect(b2.height).toBeLessThanOrEqual(size.height + 1);
  await shot(page, 'p-fullscreen');
  // Swipe left goes forward.
  await viewer.locator('.pv-paged').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 300, clientY: 400 }], changedTouches: [{ identifier: 1, clientX: 300, clientY: 400 }] });
  await viewer.locator('.pv-paged').dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 60, clientY: 410 }] });
  await expect(viewer.getByText('Page 3 of 4')).toBeVisible();
  // Any screen: turned sideways, a small old phone, a tablet — the page always fits and fills one side.
  for (const [width, height] of [[915, 412], [320, 568], [1024, 1366], [412, 915]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const b = await viewer.getByRole('img', { name: 'Page 3' }).boundingBox();
      const fits = b.width <= width + 1 && b.height <= height + 1;
      const fills = b.width >= width * 0.9 || b.height >= (height - 80) * 0.9;
      return fits && fills;
    }).toBe(true);
  }
  await shot(page, 'p-fullscreen-tall');
  await page.setViewportSize(size);
  await viewer.getByRole('button', { name: 'Exit full screen' }).click();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);

  // Download where allowed.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    reading.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Reading Material.pdf');

  // Coming back later on the same phone goes straight to the material.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Digital Records' })).toBeVisible();

  const events = await db.query(`select action from public.access_events e join public.attendance a on a.id = e.attendance_id
                                  where a.details->>'name' = 'Meena Kulkarni (DEMO)'`);
  const actions = events.rows.map((x) => x.action);
  expect(actions).toContain('OPEN_MEETING');
  expect(actions).toContain('VIEW');
  expect(actions).toContain('DOWNLOAD');
});

test('Kannada page', async ({ page }) => {
  await page.goto(`/m/${token}`);
  await page.getByRole('button', { name: 'ಕನ್ನಡ' }).click();
  await expect(page.getByRole('heading', { name: 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ' })).toBeVisible();
  await page.getByLabel('ಹೆಸರು').fill('ರಮೇಶ್ ಗೌಡ (DEMO)');
  await page.getByLabel('ಹುದ್ದೆ').fill('ಉಪ ಕಾರ್ಯದರ್ಶಿ');
  await page.getByLabel('ಸಂಸ್ಥೆ').fill('ಡಿಪಿಎಆರ್');
  await page.getByLabel('ನಾನು ಒಪ್ಪುತ್ತೇನೆ').check();
  await page.getByRole('button', { name: 'ಮುಂದುವರಿಯಿರಿ' }).click();
  await expect(page.getByRole('heading', { name: 'Digital Records' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kn');
  await expect(page.getByRole('button', { name: 'ತೆರೆಯಿರಿ' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('invalid, ended and not-yet-open links explain themselves', async ({ page }) => {
  await page.goto('/m/AAAAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'This QR code is not valid' })).toBeVisible();
  await page.goto(`/m/${ended}`);
  await expect(page.getByRole('heading', { name: 'This meeting has ended' })).toBeVisible();
  await page.goto(`/m/${notYet}`);
  await expect(page.getByRole('heading', { name: 'This meeting has not opened yet' })).toBeVisible();
  await expect(page.getByText(/It opens at .+ on .+\./)).toBeVisible();
});
