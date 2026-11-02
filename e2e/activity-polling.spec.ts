import { test, expect, type Page, type Route } from '@playwright/test';

test.use({ channel: 'chrome', baseURL: process.env.E2E_URL || 'http://127.0.0.1:5189' });
const tenant = '10000000-0000-0000-0000-000000000001';
const activity = (name = 'Mailbox') => ({ items: [{ id: 'job-live', operation: 'BACKUP',
  object: name, status: 'In Progress', start_time: new Date().toISOString(), progressPct: 10 }],
  total: 1, page: 1, size: 50, has_more: false });

async function fixture(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({ id: 'qa', roles: ['SUPER_ADMIN'] }));
    const observed: { done: boolean; aborted: boolean; hasSignal: boolean }[] = [];
    Object.assign(window, { activityRequests: observed });
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (!String(input).includes('/activity?')) return original(input, init);
      const call = { done: false, aborted: false, hasSignal: Boolean(init?.signal) };
      observed.push(call);
      init?.signal?.addEventListener('abort', () => { call.aborted = true; });
      return original(input, init).finally(() => { call.done = true; });
    };
  });
  const state = { calls: 0, hold: false, held: [] as Route[], payload: undefined as unknown };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': new URL(process.env.E2E_URL || 'http://127.0.0.1:5189').origin,
      'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let data: unknown = {};
    if (path.endsWith('/activity')) {
      state.calls++;
      if (state.hold) { state.held.push(route); return; }
      data = state.payload || activity();
    } else if (path.endsWith('/auth/me')) data = { id: 'qa', roles: ['SUPER_ADMIN'] };
    else if (path.endsWith('/tenants')) data = [{ id: tenant, displayName: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' }];
    else if (path.includes('/tenants/')) data = { id: tenant, displayName: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' };
    else if (path.endsWith('/backup/size')) data = { total: '1 KB', totalBytes: 1000, freshness: 'fresh', eligibleCount: 1, freshCount: 1, missingCount: 0, staleCount: 0, dailyData: [] };
    else if (path.endsWith('/status/24hour')) data = { success: 1, warnings: 0, failures: 0, inProgress: 1, stalled: 0 };
    else if (path.endsWith('/status/7day')) data = { dailyStatus: [], summary: { totalBackups: 1, successRate: 100, avgDuration: '1m' } };
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return state;
}

test('slow Activity poll completes without overlapping or losing its response', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/activity');
  await expect(page.getByText('Mailbox', { exact: true })).toBeVisible();
  const before = state.calls;
  state.hold = true;
  await page.clock.fastForward(9000);
  await expect.poll(() => state.calls).toBe(before + 1);
  await page.clock.fastForward(25000);
  expect(await page.evaluate(() => (window as unknown as { activityRequests: { done: boolean; aborted: boolean }[] })
    .activityRequests.filter(request => !request.done && !request.aborted).length)).toBe(1);
  state.hold = false;
  await state.held[0].fulfill({ contentType: 'application/json', body: JSON.stringify(activity('Refreshed mailbox')) });
  await expect(page.getByText('Refreshed mailbox', { exact: true })).toBeVisible();
});

test('failed Activity poll releases ownership for the next refresh', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/activity');
  await expect(page.getByText('Mailbox', { exact: true })).toBeVisible();
  state.hold = true;
  const before = state.calls;
  await page.clock.fastForward(9000);
  await expect.poll(() => state.calls).toBe(before + 1);
  await state.held[0].fulfill({ status: 503, body: 'unavailable' });
  state.hold = false;
  await page.clock.fastForward(9000);
  await expect.poll(() => state.calls).toBe(before + 2);
});

test('Overview visibility refresh and timer share Activity request ownership', async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/tenants/${tenant}/m365/overview`);
  await expect(page.getByText('Mailbox', { exact: true })).toBeVisible();
  const before = state.calls;
  state.hold = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.calls).toBe(before + 1);
  await page.clock.fastForward(31000);
  expect(await page.evaluate(() => (window as unknown as { activityRequests: { done: boolean; aborted: boolean }[] })
    .activityRequests.filter(request => !request.done && !request.aborted).length)).toBe(1);
  state.hold = false;
  await state.held[0].fulfill({ contentType: 'application/json', body: JSON.stringify(activity('Refreshed mailbox')) });
  await expect(page.getByText('Refreshed mailbox', { exact: true })).toBeVisible();
});

test('changing Activity filters aborts the obsolete poll and applies the new response', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/activity');
  await expect(page.getByText('Mailbox', { exact: true })).toBeVisible();
  state.hold = true;
  await page.clock.fastForward(9000);
  await expect.poll(() => state.held.length).toBe(1);
  state.hold = false;
  await page.locator('select').filter({ has: page.locator('option[value="BACKUP"]') }).selectOption('BACKUP');
  await expect.poll(async () => page.evaluate(() => (window as unknown as {
    activityRequests: { aborted: boolean; hasSignal: boolean }[]
  }).activityRequests.some(request => request.hasSignal && request.aborted))).toBe(true);
  await expect(page.getByText('Mailbox', { exact: true })).toBeVisible();
  await state.held[0].fulfill({ contentType: 'application/json', body: JSON.stringify(activity('Obsolete mailbox')) }).catch(() => {});
  await expect(page.getByText('Obsolete mailbox', { exact: true })).toHaveCount(0);
});


test('provider waiting remains active until its durable receipt settles', async ({ page }) => {
  const state = await fixture(page);
  const pending = { ...activity(), items: [{ ...activity().items[0], status: 'Done', progressPct: 100,
    provider_work: { state: 'WAITING', pending_leaves: 1 } }] };
  state.payload = pending;
  await page.goto('/activity');
  await expect(page.getByText('Waiting for Microsoft; backup will resume automatically')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Mailbox' });
  await expect(row).not.toContainText('100%');
  state.payload = { ...pending, items: [{ ...pending.items[0], provider_work: { state: 'COMPLETE', pending_leaves: 0 } }] };
  await page.clock.fastForward(9000);
  await expect(page.getByText('Waiting for Microsoft; backup will resume automatically')).toHaveCount(0);
  await expect(row).toContainText('Done');
  await expect(row).not.toContainText('In Progress');
});
