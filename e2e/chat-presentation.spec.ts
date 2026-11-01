import { test, expect, type Page } from '@playwright/test';

test.use({ channel: 'chrome', baseURL: process.env.E2E_URL || 'http://127.0.0.1:5178' });

const tenant = '10000000-0000-0000-0000-000000000001';
const resource = '20000000-0000-0000-0000-000000000001';
const child = '20000000-0000-0000-0000-000000000002';
const snapshot = '30000000-0000-0000-0000-000000000001';
const routePath = `/tenants/${tenant}/m365/protection/recovery?resourceId=${resource}&tab=chats`;

async function fixture(page: Page, { many = false, holdChatA }: { many?: boolean; holdChatA?: Promise<void> } = {}) {
  const requests: Array<{ path: string; method: string; body: any; query: URLSearchParams }> = [];
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({ id: 'qa-user', email: 'qa@example.invalid',
      name: 'Synthetic QA', roles: ['SUPER_ADMIN'] }));
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postDataJSON();
    requests.push({ path, method: request.method(), body, query: url.searchParams });
    const headers = { 'Access-Control-Allow-Origin': new URL(process.env.E2E_URL || 'http://127.0.0.1:5178').origin,
      'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,idempotency-key' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let data: any = {};
    let status = 200;
    if (path.endsWith('/tenants')) data = { items: [{ id: tenant, display_name: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' }] };
    else if (path.includes('/tenants/')) data = { id: tenant, display_name: 'Synthetic tenant', type: 'M365', status: 'ACTIVE' };
    else if (path.endsWith('/auth/me')) data = { id: 'qa-user', email: 'qa@example.invalid', roles: ['SUPER_ADMIN'] };
    else if (path.endsWith('/with-backups')) data = { items: [{ id: resource, tenant_id: tenant,
      kind: 'entra_user', provider: 'm365', name: 'Synthetic person', email: 'person@example.invalid',
      data: {}, storage_bytes: 100, snapshot_count: 1, total_items: 2 }] };
    else if (path.endsWith('/content-snapshots')) data = { resourceId: resource, snapshotCount: 1,
      byContent: { chats: { snapshotId: snapshot, childResourceId: child, itemCount: 2,
        bytesTotal: 100, createdAt: '2026-11-01T10:00:00Z' }, mail: null, contacts: null,
        calendar: null, onedrive: null, archive: null } };
    else if (path.endsWith('/storage-summary')) data = { resourceId: resource, subtreeSize: 100,
      totalBytes: 100, deltas: { week: 0, month: 0, year: 0 }, dailySeries: [] };
    else if (path.endsWith('/snapshots')) data = { content: [{ id: snapshot, resourceId: child,
      createdAt: '2026-11-01T10:00:00Z', size: 100, status: 'COMPLETED', type: 'FULL', itemCount: 2 }],
      totalElements: 1, totalPages: 1, size: 20, number: 1 };
    else if (path.endsWith('/chats/groups')) {
      const groups = many
        ? Array.from({ length: 501 }, (_, index) => ({ chatId: `chat-${index}`,
          displayName: index === 0 || index === 500 ? 'Planning' : `Conversation ${index}`,
          folderPath: index === 0 || index === 500 ? 'chats/Planning' : `chats/Conversation ${index}`, count: 1 }))
        : ['chat-a', 'chat-b'].map(chatId => ({ chatId, displayName: 'Planning', folderPath: 'chats/Planning', count: 2 }));
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const size = Number(url.searchParams.get('size') || 500);
      data = { content: groups.slice((pageNumber - 1) * size, pageNumber * size),
        total: groups.length, page: pageNumber, size, hasMore: pageNumber * size < groups.length };
    } else if (path.endsWith('/chats')) {
      const chatId = url.searchParams.get('chatId');
      if (chatId === 'chat-a' && holdChatA) await holdChatA;
      if (!chatId && url.searchParams.has('folder')) {
        data = { detail: { error: 'AMBIGUOUS_CHAT_PATH' } }; status = 400;
      } else {
        const id = chatId || (many ? 'chat-0' : 'chat-a');
        data = { content: [{ id: `message-${id}`, snapshotId: snapshot, externalId: `message-${id}`,
          itemType: 'TEAMS_CHAT_MESSAGE', name: 'Sender', chatId: id, sender: 'Sender', chatTopic: 'Planning',
          body: `Message from ${id}`, bodyContentType: 'text', folderPath: 'chats/Planning', contentSize: 10,
          metadata: { chatId: id, raw: { body: { content: `Message from ${id}`, contentType: 'text' } } },
          createdAt: '2026-11-01T10:00:00Z', isDeleted: false }], totalElements: 1, totalPages: 1, size: 50, number: 1 };
      }
    } else if (path.endsWith('/exports/chat/estimate')) data = { messages: 2, attachmentBytes: 0,
      estimatedZipBytes: 20, layoutMode: body?.chatId ? 'single_thread' : 'per_message', softCapExceeded: false, hardCapExceeded: false };
    else if (path.endsWith('/exports/chat')) data = { jobId: '40000000-0000-0000-0000-000000000001',
      estimatedMessages: 2, estimatedBytes: 20, softCapWarning: false };
    else if (path.includes('/exports/chat/')) data = { status: 'RUNNING' };
    return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return requests;
}

test('equal titles browse and export by the selected conversation identity', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto(routePath);
  const rows = page.locator('.folder-item.has-check');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator('.folder-name-btn').click();
  await expect(page).toHaveURL(/chatId=chat-b/);
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
  await rows.nth(1).locator('input.folder-check').check();
  await expect(rows.nth(0).locator('input.folder-check')).not.toBeChecked();
  await page.locator('.recovery-toolbar-btn-download').click();
  await expect.poll(() => requests.filter(request => request.path.endsWith('/exports/chat/estimate')).at(-1)?.body?.chatId).toBe('chat-b');
  await page.screenshot({ path: test.info().outputPath('same-title-export.png'), fullPage: true });
  await page.locator('.btn-download').click();
  await expect.poll(() => requests.find(request => request.path.endsWith('/exports/chat'))?.body?.chatId).toBe('chat-b');
  const submitted = requests.find(request => request.path.endsWith('/exports/chat'))!.body;
  expect(submitted.itemIds).toEqual([]);
  expect(submitted.threadPath).toBeUndefined();
});

test('message ticks replace whole-conversation scope and history retains identity', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto(routePath);
  const rows = page.locator('.folder-item.has-check');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator('.folder-name-btn').click();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
  await rows.nth(0).locator('.folder-name-btn').click();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-a');
  await page.goBack();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
  await rows.nth(1).locator('input.folder-check').check();
  await page.locator('.chat-item-row input[type=checkbox]').check();
  await expect(rows.nth(1).locator('input.folder-check')).not.toBeChecked();
  await page.locator('.recovery-toolbar-btn-download').click();
  await expect.poll(() => requests.filter(request => request.path.endsWith('/exports/chat/estimate')).at(-1)?.body?.itemIds)
    .toEqual(['message-chat-b']);
  expect(requests.filter(request => request.path.endsWith('/exports/chat/estimate')).at(-1)?.body?.chatId).toBeUndefined();
});

test('an ambiguous old name link asks for a conversation and then recovers', async ({ page }) => {
  await fixture(page);
  await page.goto(routePath + '&folder=chats%2FPlanning');
  await expect(page.getByText('Several conversations have this name. Select a conversation and try again.')).toBeVisible();
  await page.locator('.folder-item.has-check').nth(1).locator('.folder-name-btn').click();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
  await expect(page.getByText('Several conversations have this name. Select a conversation and try again.')).toHaveCount(0);
});

test('a late response for another same-title chat cannot replace the selected chat', async ({ page }) => {
  let release!: () => void;
  const holdChatA = new Promise<void>(resolve => { release = resolve; });
  const requests = await fixture(page, { holdChatA });
  const late = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).searchParams.get('chatId') === 'chat-a');
  await page.goto(routePath);
  await expect.poll(() => requests.some(request => request.method === 'GET'
    && request.path.endsWith('/chats') && request.query.get('chatId') === 'chat-a')).toBe(true);
  await page.locator('.folder-item.has-check').nth(1).locator('.folder-name-btn').click();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
  release();
  await late;
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-b');
});

test('pagination appends a distinct conversation with a repeated display name', async ({ page }) => {
  const requests = await fixture(page, { many: true });
  await page.goto(routePath);
  await expect(page.locator('.folder-item.has-check')).toHaveCount(500);
  await page.locator('.panel-left').hover();
  await page.mouse.wheel(0, 50000);
  await expect(page.locator('.folder-item.has-check')).toHaveCount(501);
  expect(requests.some(request => request.path.endsWith('/chats/groups') && request.query.get('page') === '2')).toBe(true);
  await page.locator('.folder-item.has-check').last().locator('.folder-name-btn').click();
  await expect(page.locator('.chat-item-text')).toContainText('Message from chat-500');
});
