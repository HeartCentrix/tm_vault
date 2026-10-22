// One-off regression test (no unit-test runner in this repo — run via:
//   node --experimental-transform-types scripts/test-calendar-event-paging.mjs
// ):
// The Recovery Calendar tab loaded events with ONE
// listCalendarEvents(snapshotId, 1, 1000) call and ignored totalPages.
// /calendar dedups + paginates ordered by created_at DESC, so on the real
// accounts here (5,112 / 7,953 / 35,026 events) only the 1,000
// most-recently-CAPTURED rows ever reached the month grid — every older
// event was silently missing from the grid, from the type/calendar filter
// sidebar, and from the filtered-id set Download scopes off.
//
// Exercises the real SnapshotService against a fake global fetch that
// mimics the backend's page/size contract.
import { register } from 'node:module';
import assert from 'node:assert';

register('./ts-import-hooks.mjs', import.meta.url);
const { SnapshotService } = await import('../src/services/snapshot.ts');

const SNAP = '11111111-2222-3333-4444-555555555555';
// One of the real pilot calendars.
const TOTAL = 5112;
// created_at DESC — index 0 is the most recently captured row, index
// TOTAL-1 the oldest. The oldest rows are exactly what the truncated
// single-page load dropped.
const ALL = Array.from({ length: TOTAL }, (_, i) => ({
  id: `evt-${i}`,
  subject: `Event ${i}`,
  start: '2026-07-15T17:00:00Z',
  eventType: 'Meeting',
  folderPath: i % 500 === 0 ? 'Calendar/United States holidays' : 'Calendar',
}));

let requests = [];
let failPage = 0;      // when set, that page number responds 500
let shortPage = 0;     // when set, that page number responds with []

function installFetch() {
  requests = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url, 'http://test.local');
    const page = Number(u.searchParams.get('page'));
    const size = Number(u.searchParams.get('size'));
    requests.push({ page, size });
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (page === failPage) {
      return { ok: false, status: 500, statusText: 'Internal Server Error' };
    }
    const content = page === shortPage
      ? []
      : ALL.slice((page - 1) * size, page * size);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content,
        totalElements: TOTAL,
        totalPages: Math.max(1, Math.ceil(TOTAL / size)),
        size,
        number: page,
      }),
    };
  };
}

// ── 1. Characterization of the page fetcher the buggy caller used ────────
// listCalendarEvents is a single-PAGE fetcher and is correct as such —
// which is precisely why a caller that wants the whole calendar has to
// walk totalPages instead of calling it once.
installFetch();
const onePage = await SnapshotService.listCalendarEvents(SNAP, 1, 1000);
assert.equal(onePage.content.length, 1000);
assert.equal(onePage.totalElements, TOTAL);
assert.equal(onePage.totalPages, 6);
assert.equal(
  onePage.content.some(e => e.id === `evt-${TOTAL - 1}`), false,
  'sanity: the oldest event is NOT in the first created_at DESC page',
);

// ── 2. The whole event set must be loaded ────────────────────────────────
installFetch();
const all = await SnapshotService.listAllCalendarEvents(SNAP);
assert.equal(all.events.length, TOTAL, 'every calendar event must be loaded');
assert.equal(all.total, TOTAL);
assert.equal(all.truncated, false);
assert.equal(new Set(all.events.map(e => e.id)).size, TOTAL, 'no duplicate events');
assert.equal(
  all.events[0].id, 'evt-0',
  'page order must be preserved (created_at DESC)',
);
assert.equal(
  all.events[TOTAL - 1].id, `evt-${TOTAL - 1}`,
  'the OLDEST event — the one the single-page load dropped — must be present',
);
// Every page walked exactly once, none skipped or refetched.
assert.deepEqual(
  [...requests.map(r => r.page)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6],
  'must request each page of totalPages exactly once',
);

// ── 3. Progress is reported so the UI can show a rollup ──────────────────
installFetch();
const seen = [];
const withProgress = await SnapshotService.listAllCalendarEvents(SNAP, {
  onProgress: (loaded, total) => seen.push([loaded, total]),
});
assert.equal(withProgress.events.length, TOTAL);
assert.ok(seen.length >= 2, 'onProgress must fire per page');
assert.deepEqual(seen[0], [1000, TOTAL], 'first progress tick = page 1 landed');
assert.deepEqual(seen[seen.length - 1], [TOTAL, TOTAL], 'last tick = fully loaded');

// ── 4. Bounded: a cap must be honest, never a silent partial ─────────────
installFetch();
const capped = await SnapshotService.listAllCalendarEvents(SNAP, { maxPages: 2 });
assert.equal(capped.events.length, 2000, 'maxPages must bound the walk');
assert.equal(capped.total, TOTAL);
assert.equal(
  capped.truncated, true,
  'a capped load must report truncated=true, not pretend to be complete',
);
assert.equal(requests.length, 2, 'no pages fetched past the cap');

// ── 5. Aborting stops the walk and rejects (cross-account staleness) ─────
// Clicking account A (heavy calendar) then account B must not leave A's
// multi-page walk hammering the backend, and must not resolve with A's
// events for B to render.
installFetch();
const ctl = new AbortController();
await assert.rejects(
  SnapshotService.listAllCalendarEvents(SNAP, {
    signal: ctl.signal,
    onProgress: () => ctl.abort(),
  }),
  (err) => err.name === 'AbortError',
  'an aborted load must reject, not resolve with partial events',
);
assert.equal(requests.length, 1, 'no further pages requested after abort');

// ── 6. A failing page fails loudly rather than silently truncating ───────
installFetch();
failPage = 3;
await assert.rejects(
  SnapshotService.listAllCalendarEvents(SNAP),
  /calendar events/i,
  'a mid-walk error must surface, not resolve with a partial calendar',
);
failPage = 0;

// ── 7. A short page mid-walk keeps going and is reported as truncated ────
// totalPages over-reporting means the snapshot changed under the walk;
// pages AFTER the short one can still hold real events, so they must
// still be fetched (page 6's 112 events here), and the shortfall must be
// surfaced rather than papered over.
installFetch();
shortPage = 3;
const short = await SnapshotService.listAllCalendarEvents(SNAP);
assert.deepEqual(
  [...requests.map(r => r.page)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6],
  'a short page must not abandon the remaining pages',
);
assert.equal(short.events.length, TOTAL - 1000, 'only the short page is missing');
assert.equal(short.events.at(-1).id, `evt-${TOTAL - 1}`, 'last page still loaded');
assert.equal(
  short.truncated, true,
  'a shortfall vs totalElements must be reported as truncated',
);
shortPage = 0;

console.log('OK — all calendar event paging assertions passed');
