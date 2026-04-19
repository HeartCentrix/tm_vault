import { test, expect } from '@playwright/test';

test('single-thread chat export HTML', async ({ page }) => {
  await page.goto(process.env.E2E_URL || 'http://localhost:5173');
  await page.fill('[name=email]', process.env.E2E_USER!);
  await page.fill('[name=password]', process.env.E2E_PASS!);
  await page.click('button[type=submit]');
  await page.click('a:has-text("Recovery")');
  await page.click('text=Akshat Verma | Amit Mishra');
  await page.locator('.folder-item.has-check:has-text("Akshat Verma | Amit Mishra") input.folder-check').check();
  await page.click('button:has-text("Download")');
  await page.click('label:has-text("Export as HTML") input');
  await page.click('button.btn-download');

  const dl = await page.waitForEvent('download', { timeout: 120_000 });
  const p = await dl.path();
  expect(p).toBeTruthy();
});
