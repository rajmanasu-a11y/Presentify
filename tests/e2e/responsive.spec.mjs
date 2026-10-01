// Mobile phone layout (Pixel 7 viewport).
import { expect, test } from '@playwright/test';

test('sign-in page fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Presentify' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const button = await page.getByRole('button', { name: 'Sign in' }).boundingBox();
  expect(button.height).toBeGreaterThanOrEqual(44); // comfortable touch target
});
