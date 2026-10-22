// One-off regression test (no unit-test runner in this repo — run via:
//   node --experimental-transform-types scripts/test-multitype-resource-paging.mjs
// ):
// getResources()'s multi-type branch (Protection's "All resources" tab and
// the Groups & Teams / Entra / Power tabs) fetched EACH type with a
// hardcoded page=1&size=500, concatenated, then sliced client-side — while
// reporting item_number as the sum of the REAL per-type totals. On the
// pilot tenant (ENTRA_USER 11,190 / SHAREPOINT_SITE 4,204 / M365_GROUP
// 6,574 / …, 24,642 rows) that meant:
//   * only the newest 500 rows of each type were reachable at all;
//   * Protection rendered ceil(24642/50) = 493 pages, of which everything
//     past the truncated data was a phantom empty page.
// /resources/by-type has a stable ORDER BY (created_at DESC, id DESC) per
// the 2026-07 fix, so a page window CAN be mapped onto real per-type
// offsets — that is what these assertions pin down.
import { register } from 'node:module';
import assert from 'node:assert';

register('./ts-import-hooks.mjs', import.meta.url);
const { getResources } = await import('../src/services/resource.ts');

const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Real pilot-tenant shape. Key order must match M365_ALL_TYPES in
// resource.ts — the concatenation order is the UI's row order.
const COUNTS = {
  ENTRA_USER: 11190,
  SHARED_MAILBOX: 87,
  ROOM_MAILBOX: 42,
  SHAREPOINT_SITE: 4204,
  ENTRA_GROUP: 1231,
  M365_GROUP: 6574,
  TEAMS_CHANNEL: 318,
  ENTRA_DIRECTORY: 1,
  POWER_BI: 12,
  POWER_APPS: 5,
  POWER_AUTOMATE: 975,
  DYNAMIC_GROUP: 3,
};
const TYPES = Object.keys(COUNTS);
const TOTAL = Object.values(COUNTS).reduce((a, b) => a + b, 0);  // 24,642
assert.equal(TOTAL, 24642);

// Global row order the UI shows = types in declaration order, each type
// internally in the backend's stable created_at DESC, id DESC order.
const EXPECTED_IDS = TYPES.flatMap(
  t => Array.from({ length: COUNTS[t] }, (_, i) => `${t}-${i}`),
);

let requests = [];

function installFetch() {
  requests = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://test.local');
    const type = u.searchParams.get('type');
    const page = Number(u.searchParams.get('page'));
    const size = Number(u.searchParams.get('size'));
    requests.push({
      path: u.pathname, type, page, size,
      status: u.searchParams.get('status'),
      query: u.searchParams.get('query'),
      sla: u.searchParams.get('sla'),
    });
    const total = COUNTS[type] ?? 0;
    const from = (page - 1) * size;
    const items = Array.from(
      { length: Math.max(0, Math.min(size, total - from)) },
      (_, i) => ({ id: `${type}-${from + i}`, name: `${type} ${from + i}`, kind: type }),
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items,
        item_number: total,
        page_number: page,
        next_page_token: from + size < total ? String(page + 1) : null,
      }),
    };
  };
}

const all = (page, size = 50) =>
  getResources(TENANT, 'all', page, size, undefined, undefined, undefined, 'm365');

const window = (page, size = 50) =>
  EXPECTED_IDS.slice((page - 1) * size, (page - 1) * size + size);

// ── 1. Page 1 is unchanged (this always worked) ──────────────────────────
installFetch();
let res = await all(1);
assert.equal(res.item_number, TOTAL, 'item_number must stay the true total');
assert.deepEqual(res.items.map(r => r.id), window(1));

// ── 2. A deep page inside the first type must return that window ─────────
// Global offset 9,950 — well past the old 500-row-per-type ceiling.
installFetch();
res = await all(200);
assert.equal(res.items.length, 50, 'page 200 must not be empty');
assert.deepEqual(res.items.map(r => r.id), window(200));
assert.equal(res.items[0].id, 'ENTRA_USER-9950');

// ── 3. A page straddling a type boundary must splice both types ──────────
// Offset 11,150: 40 rows left in ENTRA_USER (11,190) then SHARED_MAILBOX.
installFetch();
res = await all(224);
assert.deepEqual(res.items.map(r => r.id), window(224));
assert.equal(res.items.filter(r => r.kind === 'ENTRA_USER').length, 40);
assert.equal(res.items[40].id, 'SHARED_MAILBOX-0');

// ── 4. The last page must be reachable and the token must end there ──────
const lastPage = Math.ceil(TOTAL / 50);  // 493
installFetch();
res = await all(lastPage);
assert.equal(res.items.length, TOTAL - (lastPage - 1) * 50, 'last page must be full-width');
assert.deepEqual(res.items.map(r => r.id), window(lastPage));
assert.equal(res.items.at(-1).id, 'DYNAMIC_GROUP-2', 'the very last row must be reachable');
assert.equal(res.next_page_token, null, 'no next page past the end');

// ── 5. No phantom pages: every page up to the last carries rows ──────────
installFetch();
for (const p of [1, 100, 250, 400, 470, 492, 493]) {
  const r = await all(p);
  assert.ok(r.items.length > 0, `page ${p} must not be a phantom empty page`);
  assert.deepEqual(r.items.map(x => x.id), window(p), `page ${p} window`);
}
// Past the end is genuinely empty, and says so.
res = await all(lastPage + 1);
assert.deepEqual(res.items, []);
assert.equal(res.next_page_token, null);

// ── 6. Bounded work: never pull whole types down to slice locally ────────
installFetch();
await all(200);
assert.ok(
  requests.length <= TYPES.length + 4,
  `expected a bounded request count, got ${requests.length}`,
);
assert.equal(
  requests.filter(r => r.size > 50).length, 0,
  'no request may ask for more rows than the caller\'s page size',
);
const rowsPulled = requests.reduce((s, r) => s + r.size, 0);
assert.ok(rowsPulled <= 200, `expected to pull few rows, pulled up to ${rowsPulled}`);

// ── 7. Filters must reach the server on every request ────────────────────
// Otherwise the per-type totals the window maths is built on describe a
// different row set than the pages being fetched.
installFetch();
await getResources(TENANT, 'all', 3, 50, 'smith', 'none', 'active', 'm365');
assert.ok(requests.length > 0);
for (const r of requests) {
  assert.equal(r.query, 'smith', 'query must be sent server-side');
  assert.equal(r.status, 'ACTIVE', 'status filter must be sent server-side');
  assert.equal(r.sla, 'none', 'sla filter must be sent server-side');
}

// ── 8. Multi-type tabs other than "all" behave the same ──────────────────
installFetch();
res = await getResources(TENANT, 'groups', 2, 50, undefined, undefined, undefined, 'm365');
const groupIds = ['ENTRA_GROUP', 'M365_GROUP', 'TEAMS_CHANNEL'].flatMap(
  t => Array.from({ length: COUNTS[t] }, (_, i) => `${t}-${i}`),
);
assert.equal(res.item_number, COUNTS.ENTRA_GROUP + COUNTS.M365_GROUP + COUNTS.TEAMS_CHANNEL);
assert.deepEqual(res.items.map(r => r.id), groupIds.slice(50, 100));

// ── 9. Single-type path untouched — straight server pagination ───────────
installFetch();
res = await getResources(TENANT, 'users', 7, 50, undefined, undefined, undefined, 'm365');
assert.equal(requests.length, 1, 'single-type tabs stay one request');
assert.equal(requests[0].page, 7);
assert.equal(requests[0].size, 50);
assert.equal(res.items[0].id, 'ENTRA_USER-300');

console.log('OK — all multi-type resource paging assertions passed');
