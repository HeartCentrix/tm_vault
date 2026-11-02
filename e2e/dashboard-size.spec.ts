import { test, expect, type Page } from '@playwright/test';

test.use({ channel: 'chrome', baseURL: process.env.E2E_URL || 'http://127.0.0.1:5189' });
const tenant = '10000000-0000-0000-0000-000000000001';
const overview = `/tenants/${tenant}/m365/overview`;
const fresh = { total: '2.40 GB', totalBytes: 2400, eligibleCount: 2, freshCount: 2,
  staleCount: 0, missingCount: 0, partial: false, stale: false, freshness: 'fresh',
  dailyData: [], asOf: '2026-11-02T03:00:00Z', projectedBytes1y: 5000000,
  projectedBytes3y: 9000000, dailyGrowthBytes: 100 };

async function fixture(page: Page, state: { size: Record<string, unknown>; error?: boolean; live?: boolean }) {
  let sizeCalls = 0;
  await page.addInitScript(() => localStorage.setItem('user', JSON.stringify({
    id: 'synthetic-qa', email: 'qa@example.invalid', roles: ['SUPER_ADMIN'],
  })));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const headers = { 'Access-Control-Allow-Origin': new URL(process.env.E2E_URL || 'http://127.0.0.1:5189').origin,
      'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let data: unknown = {};
    let status = 200;
    if (path.endsWith('/backup/size')) {
      sizeCalls++;
      data = state.error ? { detail: 'Temporarily unavailable' } : state.size;
      status = state.error ? 503 : 200;
    } else if (path.endsWith('/tenants')) data = [{ id: tenant, displayName: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' }];
    else if (path.includes('/tenants/')) data = { id: tenant, displayName: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' };
    else if (path.endsWith('/auth/me')) data = { id: 'synthetic-qa', email: 'qa@example.invalid', roles: ['SUPER_ADMIN'] };
    else if (path.endsWith('/status/24hour')) data = { success: 3, warnings: 0, failures: 0, inProgress: 1, stalled: 0 };
    else if (path.endsWith('/status/7day')) data = { dailyStatus: [], summary: { totalBackups: 3, successRate: 100, avgDuration: '1m' } };
    else if (path.includes('/activity')) data = { items: state.live ? [{
      id: 'job-live', operation: 'BACKUP', object: 'Mailbox', status: 'In Progress',
      start_time: new Date().toISOString(), progressPct: 10,
    }] : [], total: state.live ? 1 : 0 };
    else if (path.endsWith('/storage/status')) data = { active_backend: { id: 'backend-a', kind: 'azure_blob', name: 'Azure', endpoint: 'https://storage.invalid', is_enabled: true }, transition_state: 'stable', last_toggle_at: null, cooldown_until: null, inflight_jobs_count: 0 };
    else if (path.endsWith('/storage/backends') || path.endsWith('/storage/events')) data = [];
    return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return () => sizeCalls;
}

test('overview keeps known size and refreshes pending summaries without hiding other cards', async ({ page }) => {
  await page.clock.install();
  const state = { size: { ...fresh, stale: true, freshness: 'stale', freshCount: 1, staleCount: 1 } };
  const calls = await fixture(page, state);
  await page.goto(overview);
  const size = page.locator('.status-card').filter({ has: page.getByText('Backup size', { exact: true }) });
  await expect(size.getByText('2.40 GB', { exact: true })).toBeVisible();
  await expect(size.getByText('Updating backup size')).toBeVisible();
  await expect(page.getByText('24-hour status', { exact: true })).toBeVisible();
  const initialCalls = calls();
  state.size = { ...fresh };
  await page.clock.fastForward(16_000);
  await expect(size.getByText('Up to date', { exact: true })).toBeVisible();
  expect(calls()).toBe(initialCalls + 1);
  await page.screenshot({ path: test.info().outputPath('overview-fresh.png'), fullPage: true });
});

test('first missing baseline says calculating instead of zero', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { size: { ...fresh, total: 'Calculating', totalBytes: null, partial: true,
    freshness: 'missing', freshCount: 0, missingCount: 2 } });
  await page.goto(overview);
  const size = page.locator('.status-card').filter({ has: page.getByText('Backup size', { exact: true }) });
  await expect(size.getByText('Calculating…', { exact: true })).toBeVisible();
  await expect(size.getByText('0 GB', { exact: true })).toHaveCount(0);
  expect(await size.locator('.backup-size-total').evaluate(node => {
    const card = node.closest('.status-card')!.getBoundingClientRect();
    return node.getBoundingClientRect().right <= card.right;
  })).toBe(true);
  expect(await size.locator('.backup-size-freshness').evaluate(node =>
    node.getBoundingClientRect().right <= node.closest('.status-card')!.getBoundingClientRect().right)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('overview-calculating-mobile.png'), fullPage: true });
});

test('storage keeps last-known value and blocks estimates until summaries catch up', async ({ page }) => {
  await page.clock.install();
  const state = { size: { ...fresh, partial: true, freshness: 'missing', freshCount: 1, missingCount: 1 } };
  await fixture(page, state);
  await page.goto('/settings/storage');
  await expect(page.getByText('Partial last-known total')).toBeVisible();
  const estimates = page.locator('.storage-usage-card').filter({ has: page.getByText(/year estimate/) });
  await expect(estimates).toHaveCount(2);
  await expect(estimates.first().locator('.storage-usage-value')).toHaveText('—');
  state.size = { ...fresh };
  await page.clock.fastForward(16_000);
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  await expect(estimates.first().locator('.storage-usage-value')).not.toHaveText('—');
});

test('overview refresh error preserves last-known total with warning', async ({ page }) => {
  await page.clock.install();
  const state = { size: { ...fresh, stale: true, freshness: 'stale' }, error: false };
  const calls = await fixture(page, state);
  await page.goto(overview);
  const size = page.locator('.status-card').filter({ has: page.getByText('Backup size', { exact: true }) });
  await expect(size.getByText('2.40 GB', { exact: true })).toBeVisible();
  state.error = true;
  await page.clock.fastForward(16_000);
  await expect(size.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(size.getByText('2.40 GB', { exact: true })).toBeVisible();
  await expect(size.getByText('Updating backup size')).toBeVisible();
  const beforeRetry = calls();
  await size.getByRole('button', { name: 'Retry' }).click();
  await page.clock.runFor(100);
  await expect.poll(calls).toBeGreaterThan(beforeRetry);
  await expect(size.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(size.getByText('2.40 GB', { exact: true })).toBeVisible();
});

test('slow size reads do not overlap and are aborted when leaving overview', async ({ page }) => {
  await page.clock.install();
  await fixture(page, { size: fresh, live: true });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  let failed = 0;
  page.on('requestfailed', request => { if (request.url().includes('/backup/size')) failed++; });
  await page.route('**/dashboard/backup/size**', async route => {
    calls++;
    await hold;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fresh) }).catch(() => {});
  });
  try {
    await page.goto(overview);
    await expect.poll(() => calls).toBeGreaterThan(0);
    const initialCalls = calls;
    await page.clock.fastForward(31_000);
    await page.clock.runFor(100);
    expect(calls).toBe(initialCalls);
    const beforeLeaving = failed;
    await page.getByText('Configuration', { exact: true }).click();
    await expect(page).toHaveURL(/configuration/);
    await expect.poll(() => failed).toBeGreaterThan(beforeLeaving);
  } finally {
    release();
  }
});

test('a stalled protection card does not block pending size refresh', async ({ page }) => {
  await page.clock.install();
  const state = { size: { ...fresh, stale: true, freshness: 'stale' } };
  await fixture(page, state);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/dashboard/protection**', async route => {
    await hold;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {});
  });
  try {
    await page.goto(overview);
    await expect(page.getByText('Updating backup size')).toBeVisible();
    state.size = { ...fresh };
    await page.clock.fastForward(16_000);
    await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  } finally {
    release();
  }
});
