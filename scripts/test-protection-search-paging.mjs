// One-off regression test (no unit-test runner in this repo — run via:
//   node --experimental-transform-types scripts/test-protection-search-paging.mjs
// ):
// getResources()'s multi-type branch was fixed (2026-07-31) to map the
// requested page window onto real per-type offsets. That is correct global
// windowing — but Protection's SEARCH mode asked for page=1&size=10000, and
// a 10,000-wide window starting at 0 is entirely consumed by the FIRST type
// whenever that type has >=10,000 matches. On the pilot tenant a query that
// matches most of the 11,190 ENTRA_USERs ('com', 'taylormorrison', '@', a
// single common letter) therefore returned 10,000 users and ZERO of the
// matching SharePoint sites / groups / flows — the same "vast majority of
// resources unreachable" defect, relocated into search.
//
// The fix: search pages server-side like every other list (query= is
// honored by /resources/by-type via build_by_type_search_filters), so every
// match in every type is reachable by paging. Two things have to hold:
//   * Protection must stop asking for the 10,000-wide window.
//   * the client-side matcher it still applies must be a SUPERSET of the
//     server-side filter, or rows the server matched (web_url-only matches,
//     e.g. "IT OPS NOTES" living at /sites/ITOPS) get dropped back out and
//     the page renders with holes.
import { register } from 'node:module';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

register('./ts-import-hooks.mjs', import.meta.url);
const { getResources, resourceMatchesQuery } =
  await import('../src/services/resource.ts');

const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROTECTION_SRC = readFileSync(
  new URL('../src/pages/Protection.tsx', import.meta.url), 'utf8',
);

// ── 1. Protection must not request the collapsing 10,000-wide window ─────
// A source assertion because the repo has no DOM/React runner; the window
// arithmetic itself is proven correct by test-multitype-resource-paging.mjs,
// so what is left to pin is the request shape the page issues.
// Inspect calls rather than comments documenting the old 10,000-row bug.
const source = ts.createSourceFile('Protection.tsx', PROTECTION_SRC, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wideWindowCalls = [];
const containsWideWindow = node =>
  (ts.isNumericLiteral(node) && Number(node.text.replaceAll('_', '')) === 10000)
  || ts.forEachChild(node, containsWideWindow);
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'getResources'
      && node.arguments.some(containsWideWindow)) wideWindowCalls.push(node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);
assert.deepEqual(
  wideWindowCalls, [],
  'Protection must not ask getResources for a 10,000-wide window — that '
  + 'window collapses onto the first type and hides every later type',
);

// ── 2. …and it must not re-paginate a server-paged list client-side ──────
// Slicing sortedResources by page again would blank pages 2+ (the server
// already returned only that page's 50 rows).
assert.equal(
  /sortedResources\.slice\(/.test(PROTECTION_SRC), false,
  'search results are server-paged now; a second client-side slice would '
  + 'empty every page after the first',
);

// ── 3. The client matcher must be a superset of the server filter ────────
// build_by_type_search_filters (resource-service/main.py) ORs
// display_name / email / metadata->>'web_url'. Anything it matches must
// survive the client pass.
const site = {
  id: 's1', name: 'IT OPS NOTES', email: null, kind: 'sharepoint_site',
  data: { web_url: 'https://taylormorrison.sharepoint.com/sites/ITOPS' },
};
assert.equal(
  resourceMatchesQuery(site, 'ITOPS'), true,
  'a web_url-only match (what the server matched on) must not be dropped',
);
assert.equal(resourceMatchesQuery(site, 'it ops'), true, 'name match');
assert.equal(
  resourceMatchesQuery(
    { id: 'u1', name: 'Jason Rue', email: 'jrue@taylormorrison.com', kind: 'entra_user', data: {} },
    'TAYLORMORRISON.COM',
  ), true,
  'email match, case-insensitive',
);
assert.equal(
  resourceMatchesQuery({ id: 'k1', name: 'x', kind: 'shared_mailbox', data: {} }, 'shared'),
  true, 'kind match (client-only axis) preserved',
);
assert.equal(
  resourceMatchesQuery({ id: 'n1', name: 'Nope', kind: 'entra_user', data: {} }, 'zzz'),
  false, 'non-matches still filtered',
);
// Missing/odd shapes must not throw — rows come straight off the wire.
assert.equal(resourceMatchesQuery({ id: 'e1' }, 'x'), false);
assert.equal(resourceMatchesQuery({ id: 'e2', name: 'abc' }, '   '), true,
  'a blank query matches everything (no filtering)');

// ── 4. Contract the fix leans on: server-paged search spans EVERY type ───
// Drive the real getResources over every page of a search whose matches are
// spread across types, with the shape Protection now uses (page, 50).
const MATCHES = {
  ENTRA_USER: 10500,        // > 10,000 on its own — the collapsing case
  SHARED_MAILBOX: 12,
  ROOM_MAILBOX: 3,
  SHAREPOINT_SITE: 3000,
  ENTRA_GROUP: 40,
  M365_GROUP: 4000,
  TEAMS_CHANNEL: 7,
  ENTRA_DIRECTORY: 0,
  POWER_BI: 1,
  POWER_APPS: 0,
  POWER_AUTOMATE: 950,
  DYNAMIC_GROUP: 0,
};
const TYPES = Object.keys(MATCHES);
const TOTAL = Object.values(MATCHES).reduce((a, b) => a + b, 0);  // 18,513
const EXPECTED_IDS = TYPES.flatMap(
  t => Array.from({ length: MATCHES[t] }, (_, i) => `${t}-${i}`),
);

let requests = [];
globalThis.fetch = async (url) => {
  const u = new URL(url, 'http://test.local');
  const type = u.searchParams.get('type');
  const page = Number(u.searchParams.get('page'));
  const size = Number(u.searchParams.get('size'));
  requests.push({ type, page, size, query: u.searchParams.get('query') });
  // Server-side query filter is honored (ITO-9652) — only matching rows
  // are countable / returnable.
  const total = u.searchParams.get('query') ? (MATCHES[type] ?? 0) : 99999;
  const from = (page - 1) * size;
  return {
    ok: true, status: 200,
    json: async () => ({
      items: Array.from(
        { length: Math.max(0, Math.min(size, total - from)) },
        (_, i) => ({ id: `${type}-${from + i}`, name: `${type} ${from + i}`, kind: type }),
      ),
      item_number: total,
      page_number: page,
      next_page_token: from + size < total ? String(page + 1) : null,
    }),
  };
};

const pageCount = Math.ceil(TOTAL / 50);
const walked = [];
for (let p = 1; p <= pageCount; p++) {
  requests = [];
  const res = await getResources(TENANT, 'all', p, 50, 'com', undefined, undefined, 'm365');
  assert.equal(res.item_number, TOTAL, `page ${p} must report the true match total`);
  assert.ok(res.items.length > 0, `page ${p} must not be a phantom empty page`);
  for (const r of requests) {
    assert.equal(r.query, 'com', 'the query must reach the server on every request');
  }
  walked.push(...res.items.map(r => r.id));
}
assert.deepEqual(walked, EXPECTED_IDS, 'paging search must cover every match, in order');
const typesSeen = new Set(walked.map(id => id.slice(0, id.lastIndexOf('-'))));
for (const t of TYPES) {
  if (MATCHES[t] === 0) continue;
  assert.ok(typesSeen.has(t), `matches in ${t} must be reachable`);
}

// And the old shape really did drop them — kept as the regression witness.
requests = [];
const collapsed = await getResources(TENANT, 'all', 1, 10000, 'com', undefined, undefined, 'm365');
assert.equal(collapsed.items.length, 10000);
assert.equal(
  new Set(collapsed.items.map(r => r.kind)).size, 1,
  'sanity: a 10,000-wide window really does collapse onto one type',
);

console.log('OK — all Protection search paging assertions passed');
