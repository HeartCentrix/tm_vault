// One-off regression test (no unit-test runner in this repo — run via:
//   node --experimental-transform-types scripts/test-calendar-download-scope.mjs
// ):
// Loading the FULL calendar event set (the 2026-07-31 truncation fix) made
// the Calendar tab's Download / Recover auto-seed enumerate every event id
// into one POST body. The SPA's own nginx (frontend pod, nginx.conf) sets no
// `client_max_body_size`, so nginx's 1 MiB default applies to every /api
// POST — and ALL api traffic is proxied through that pod. At ~39 bytes per
// id ('"<uuid>",') the heaviest pilot account (35,026 events) shipped a
// ~1.30 MiB body and got a 413 from the frontend pod before job-service
// ever saw it: Download and Recover broke on exactly the account the
// truncation fix was written for.
//
// calendarSelectionScope() is the client-side budget: enumerate ids while
// they fit comfortably under the proxy limit, otherwise hand the backend a
// scope it resolves itself (folderPaths → shared.folder_resolver, which is
// sibling-snapshot aware), and refuse loudly when neither is expressible
// rather than silently exporting the wrong set.
import { register } from 'node:module';
import assert from 'node:assert';

register('./ts-import-hooks.mjs', import.meta.url);
const { calendarSelectionScope, MAX_ENUMERATED_ITEM_IDS } =
  await import('../src/services/snapshot.ts');

// nginx default client_max_body_size. The scope must keep every request
// body it produces well under this.
const NGINX_DEFAULT_BODY_LIMIT = 1024 * 1024;
const SNAP = '11111111-2222-3333-4444-555555555555';

// A realistic body for the export/restore POST (see DownloadModal ->
// RecoveryService.triggerExport): everything except the id list is small
// and fixed, so id count dominates.
const bodyBytes = (scope) => new TextEncoder().encode(JSON.stringify({
  restoreType: 'EXPORT_ZIP',
  snapshotIds: [SNAP],
  itemIds: scope.itemIds,
  folderPaths: scope.folderPaths.length ? scope.folderPaths : undefined,
  exportFormat: 'ZIP',
  includeAttachments: true,
  preserveTree: true,
})).length;

const mkEvents = (n, folderPath = 'Calendar/Default') =>
  Array.from({ length: n }, (_, i) => ({
    id: `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, '0')}`,
    folderPath,
  }));

// ── 0. The budget itself has to be under the proxy limit ─────────────────
assert.ok(
  typeof MAX_ENUMERATED_ITEM_IDS === 'number' && MAX_ENUMERATED_ITEM_IDS > 0,
  'a hard id budget must exist',
);
assert.ok(
  bodyBytes({ itemIds: mkEvents(MAX_ENUMERATED_ITEM_IDS).map(e => e.id), folderPaths: [] })
    < NGINX_DEFAULT_BODY_LIMIT / 2,
  'the id budget must leave at least 2x headroom under nginx\'s 1 MiB default',
);

// ── 1. Small selections keep the exact-id behavior (unchanged) ───────────
// 5,112- and 7,953-event accounts, and any narrow filter anywhere, must
// still send the precise id list — no scope approximation.
const small = mkEvents(966);
let scope = calendarSelectionScope(small, { typeFiltered: true });
assert.equal(scope.error, undefined, 'a small selection must not be refused');
assert.deepEqual(scope.itemIds, small.map(e => e.id), 'exact ids for small sets');
assert.deepEqual(scope.folderPaths, [], 'no folder scope needed when ids fit');
assert.ok(bodyBytes(scope) < NGINX_DEFAULT_BODY_LIMIT);

// ── 2. The 35,026-event account, unfiltered: server-resolvable scope ─────
// This is the reviewer's 413. The scope must be expressed as folder paths
// so the body stays tiny, and it must cover EVERY calendar the events came
// from (folder_resolver ORs prefix + exact match per path).
const heavy = [
  ...mkEvents(34000, 'Calendar/Default'),
  ...mkEvents(1026, 'Calendar/United States holidays'),
];
assert.equal(heavy.length, 35026);
scope = calendarSelectionScope(heavy, { typeFiltered: false });
assert.equal(scope.error, undefined, 'the whole calendar must remain downloadable');
assert.deepEqual(scope.itemIds, [], 'must NOT enumerate 35,026 ids');
assert.deepEqual(
  [...scope.folderPaths].sort(),
  ['Calendar/Default', 'Calendar/United States holidays'],
  'every calendar present in the selection must be in the folder scope',
);
const heavyBytes = bodyBytes(scope);
assert.ok(
  heavyBytes < 4096,
  `heaviest-account body must be tiny, got ${heavyBytes} B`,
);
// And prove the thing that actually broke: enumerating instead would 413.
assert.ok(
  bodyBytes({ itemIds: heavy.map(e => e.id), folderPaths: [] }) > NGINX_DEFAULT_BODY_LIMIT,
  'sanity: enumerating 35,026 ids really does exceed the 1 MiB proxy limit',
);

// ── 3. A per-calendar filter narrows the folder scope, exactly ───────────
// Only the calendars the selection actually contains may be sent —
// otherwise the export pulls events the grid is not showing.
scope = calendarSelectionScope(
  mkEvents(30000, 'Calendar/United States holidays'), { typeFiltered: false },
);
assert.deepEqual(scope.folderPaths, ['Calendar/United States holidays']);
assert.deepEqual(scope.itemIds, []);

// ── 4. An event-type filter over budget must REFUSE, not approximate ────
// 'Recurring' / 'Meeting' / … are labels /calendar derives from raw Graph
// fields (snapshot-service list_snapshot_calendar); there is no server-side
// equivalent, so a type-filtered set can only be sent as ids. Over budget
// the honest answer is a loud, actionable refusal — sending folderPaths
// would export events the filter excluded (over-restore on Recover), and
// truncating the ids would silently export the wrong set.
scope = calendarSelectionScope(heavy, { typeFiltered: true });
assert.ok(scope.error, 'an over-budget type-filtered selection must be refused');
assert.match(scope.error, /35,026|35026/, 'the refusal must name the real count');
assert.deepEqual(scope.itemIds, [], 'a refusal must not carry a partial id list');
assert.deepEqual(scope.folderPaths, [], 'a refusal must not widen the scope');

// ── 5. NULL folder_path is ambiguous — refuse rather than drop events ────
// /calendar renders `folderPath: i.folder_path or "Calendar"` (snapshot-
// service), and the ENTRA_USER backup path writes CALENDAR_EVENT rows with
// NO folder_path at all (backup-worker db_items.append(SnapshotItem(...))
// — no folder_path kwarg). folder_resolver matches `folder_path IN
// ('Calendar')` / LIKE 'Calendar/%', neither of which matches NULL, so a
// folder scope over a bare 'Calendar' path would silently omit those
// events from the export. Refuse instead.
scope = calendarSelectionScope(
  [...mkEvents(20000, 'Calendar/Default'), ...mkEvents(15026, 'Calendar')],
  { typeFiltered: false },
);
assert.ok(
  scope.error,
  'an ambiguous bare "Calendar" path must not be turned into a folder scope',
);
assert.match(scope.error, /calendar/i);
assert.deepEqual(scope.folderPaths, []);

// Same for an empty folderPath.
scope = calendarSelectionScope(
  [...mkEvents(20000, 'Calendar/Default'), ...mkEvents(15026, '')],
  { typeFiltered: false },
);
assert.ok(scope.error, 'an empty folderPath must not be turned into a folder scope');

// ── 6. Empty selection is empty — never "everything" ────────────────────
scope = calendarSelectionScope([], { typeFiltered: false });
assert.deepEqual(scope.itemIds, []);
assert.deepEqual(scope.folderPaths, []);
assert.equal(scope.error, undefined);
assert.equal(scope.count, 0);

// ── 7. count is always the real selection size, scope shape aside ───────
// The toolbar / modal label reads this; it must not silently become 0 just
// because the ids were replaced by a folder scope.
assert.equal(calendarSelectionScope(heavy, { typeFiltered: false }).count, 35026);
assert.equal(calendarSelectionScope(small, { typeFiltered: true }).count, 966);

console.log('OK — all calendar download-scope assertions passed');
