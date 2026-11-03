// One-off regression test (no unit-test runner in this repo — run via:
//   node --experimental-transform-types scripts/test-calendar-walk-abort-cache.mjs
// ):
// Two load-amplification defects in the full-calendar walk added 2026-07-31.
//
// 1. A mid-walk page failure rejected immediately but did NOT stop the other
//    workers: the loop's only exits were `page > pages` and the caller's
//    abort signal, so a failing 36-page calendar still paid all 36 heavy
//    /calendar requests (COUNT(DISTINCT …) + DISTINCT ON dedup over the
//    22M-row snapshot_items table, single-replica 500m-CPU snapshot-service)
//    AFTER the UI had already shown "Could not load events" — and the user's
//    natural retry (tab flip) paid it again.
//
// 2. Nothing cached the walk, and CalendarMonthView unmounts on tab switch,
//    so Calendar → Mail → Calendar re-walked every page. The items path has
//    had a per-session SWR cache since 2026-07-30 (itemsCacheRef /
//    foldersCacheRef in Recovery.tsx); the calendar walk needs the same,
//    keyed strictly by snapshotId so a new Gold batch misses naturally.
import { register } from 'node:module';
import assert from 'node:assert';

register('./ts-import-hooks.mjs', import.meta.url);
const { SnapshotService, clearCalendarEventCache, CALENDAR_EVENT_CACHE_MAX } =
  await import('../src/services/snapshot.ts');

// The heaviest pilot account: 35,026 events = 36 pages at size 1000.
const TOTAL = 35026;
const PAGES = 36;
const ALL = Array.from({ length: TOTAL }, (_, i) => ({
  id: `evt-${i}`,
  subject: `Event ${i}`,
  start: '2026-07-15T17:00:00Z',
  eventType: 'Meeting',
  folderPath: 'Calendar/Default',
}));

let requests = [];
let failPage = 0;
let settled = false;

function installFetch() {
  requests = [];
  settled = false;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url, 'http://test.local');
    const page = Number(u.searchParams.get('page'));
    const size = Number(u.searchParams.get('size'));
    requests.push({ page, size, afterSettle: settled });
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    // One macrotask of latency so the concurrent workers really overlap.
    await new Promise(r => setTimeout(r, 1));
    if (page === failPage) {
      return { ok: false, status: 500, statusText: 'Internal Server Error' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: ALL.slice((page - 1) * size, page * size),
        totalElements: TOTAL,
        totalPages: Math.max(1, Math.ceil(TOTAL / size)),
        size,
        number: page,
      }),
    };
  };
}

// ── 1. A failing page must stop the remaining workers ────────────────────
installFetch();
failPage = 3;
let caught = null;
try {
  await SnapshotService.listAllCalendarEvents('snap-fail');
} catch (err) {
  caught = err;
}
settled = true;
// Let anything still in flight land so we can count it.
await new Promise(r => setTimeout(r, 60));
assert.ok(caught, 'a failing page must reject');
assert.equal(
  caught.name === 'AbortError', false,
  'the rejection must carry the REAL error, not the internal abort — the '
  + 'component swallows AbortError as teardown and would show no notice',
);
assert.match(caught.message, /calendar events/i);
assert.ok(
  requests.length < PAGES,
  `a failed walk must not pay all ${PAGES} pages, issued ${requests.length}`,
);
assert.equal(
  requests.filter(r => r.afterSettle).length, 0,
  'no page may be requested after the walk has already rejected',
);
failPage = 0;

// ── 2. A successful walk is unaffected ───────────────────────────────────
installFetch();
const full = await SnapshotService.listAllCalendarEvents('snap-ok');
assert.equal(full.events.length, TOTAL);
assert.equal(full.truncated, false);
assert.deepEqual(
  [...requests.map(r => r.page)].sort((a, b) => a - b),
  Array.from({ length: PAGES }, (_, i) => i + 1),
  'every page walked exactly once',
);

// ── 3. Re-opening the tab must not re-pay the walk ───────────────────────
clearCalendarEventCache();
installFetch();
const a1 = await SnapshotService.listAllCalendarEventsCached('snap-A');
assert.equal(a1.events.length, TOTAL);
const firstCost = requests.length;
assert.equal(firstCost, PAGES, 'first open pays the full walk');

installFetch();
const a2 = await SnapshotService.listAllCalendarEventsCached('snap-A');
assert.equal(
  requests.length, 0,
  'Calendar -> Mail -> Calendar must be served from the session cache',
);
assert.equal(a2.events.length, TOTAL, 'cached result must be the full set');
assert.equal(a2.total, TOTAL);
assert.equal(a2.truncated, false);

// A different snapshot id (new Gold batch, or another account) must miss.
installFetch();
await SnapshotService.listAllCalendarEventsCached('snap-B');
assert.equal(requests.length, PAGES, 'a different snapshotId must refetch');

// ── 4. The cache is bounded — 35k events per entry is real memory ────────
assert.ok(
  typeof CALENDAR_EVENT_CACHE_MAX === 'number' && CALENDAR_EVENT_CACHE_MAX >= 1,
  'the cache must declare a hard entry cap',
);
clearCalendarEventCache();
for (let i = 0; i < CALENDAR_EVENT_CACHE_MAX + 1; i++) {
  installFetch();
  await SnapshotService.listAllCalendarEventsCached(`snap-lru-${i}`);
}
// The oldest entry must have been evicted, the newest must still be warm.
installFetch();
await SnapshotService.listAllCalendarEventsCached('snap-lru-0');
assert.equal(requests.length, PAGES, 'the oldest cache entry must be evicted');
installFetch();
await SnapshotService.listAllCalendarEventsCached(
  `snap-lru-${CALENDAR_EVENT_CACHE_MAX}`,
);
assert.equal(requests.length, 0, 'the newest cache entry must still be warm');

// ── 5. A failed walk must NOT be cached ──────────────────────────────────
clearCalendarEventCache();
installFetch();
failPage = 2;
await assert.rejects(SnapshotService.listAllCalendarEventsCached('snap-err'));
failPage = 0;
installFetch();
const retried = await SnapshotService.listAllCalendarEventsCached('snap-err');
assert.equal(retried.events.length, TOTAL, 'a retry after failure must refetch');
assert.ok(requests.length > 0, 'a failure must not be cached as a result');

// ── 6. An aborted walk must NOT be cached either ─────────────────────────
clearCalendarEventCache();
installFetch();
const ctl = new AbortController();
await assert.rejects(
  SnapshotService.listAllCalendarEventsCached('snap-abort', {
    signal: ctl.signal,
    onProgress: () => ctl.abort(),
  }),
  (err) => err.name === 'AbortError',
);
installFetch();
const afterAbort = await SnapshotService.listAllCalendarEventsCached('snap-abort');
assert.equal(afterAbort.events.length, TOTAL, 'an aborted walk must not be cached');

// ── 7. OFFSET paging over a table a backup is mutating ───────────────────
// Each page is an independent LIMIT/OFFSET over the sibling snapshots
// ordered by si.created_at DESC. A CALENDAR_EVENT insert during the ~36
// request walk shifts that ordering, so one row can land on two pages while
// another is skipped. Duplicates must not reach the month grid's React keys
// or the Download id set, and — critically — must not pad events.length up
// to `total` and make `truncated` read false while events are genuinely
// missing.
{
  const DUP_PAGE = 5;   // repeats page 4's rows
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://test.local');
    const page = Number(u.searchParams.get('page'));
    const size = Number(u.searchParams.get('size'));
    const from = ((page === DUP_PAGE ? page - 1 : page) - 1) * size;
    return {
      ok: true, status: 200,
      json: async () => ({
        content: ALL.slice(from, from + size),
        totalElements: TOTAL,
        totalPages: PAGES,
        size,
        number: page,
      }),
    };
  };
  clearCalendarEventCache();
  const shifted = await SnapshotService.listAllCalendarEvents('snap-shift');
  const ids = shifted.events.map(e => e.id);
  assert.equal(
    new Set(ids).size, ids.length,
    'a row served on two pages must not be delivered twice',
  );
  assert.ok(
    shifted.events.length < TOTAL,
    'the skipped row must leave a real shortfall',
  );
  assert.equal(
    shifted.truncated, true,
    'duplicates must not pad the count into claiming a complete calendar',
  );
}

console.log('OK — all calendar walk abort/cache assertions passed');
