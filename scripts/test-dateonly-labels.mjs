// One-off regression test (no unit-test runner in this repo — run via:
//   TZ=America/Phoenix node --experimental-transform-types scripts/test-dateonly-labels.mjs
// ):
// Date-only strings from the dashboard APIs ("2026-07-13") are CALENDAR
// LABELS bucketed in the operator's timezone by the backend. JS parses
// bare YYYY-MM-DD as UTC midnight, so rendering via toLocaleString in
// any western timezone shifted every chart label back one day — the
// Overview backup-size graph appeared to end at 7/12 when the API's
// last bucket was 7/13.
import { parseAsUtc, fmtLocal } from '../src/utils/datetime.ts';
import assert from 'node:assert';

assert.equal(process.env.TZ, 'America/Phoenix', 'run with TZ=America/Phoenix');

// Date-only: must render as the SAME calendar day in local display.
assert.equal(
  fmtLocal('2026-07-13', { month: 'short', day: 'numeric' }),
  'Jul 13',
  'date-only string must not shift a day in western timezones',
);

// Naive datetime (no tz suffix): still treated as UTC then localized —
// 18:24 UTC = 11:24 Phoenix, same calendar day.
assert.equal(
  fmtLocal('2026-04-17T18:24:57.797', { month: 'short', day: 'numeric', hour: 'numeric' }),
  'Apr 17, 11 AM',
  'naive datetimes must keep the treat-as-UTC behavior',
);

// Naive datetime that crosses midnight when localized: 2026-07-13T02:00 UTC
// = 2026-07-12 19:00 Phoenix — timestamps SHOULD shift (they are instants).
assert.equal(
  fmtLocal('2026-07-13T02:00:00', { month: 'short', day: 'numeric' }),
  'Jul 12',
  'UTC instants must still convert to local',
);

// parseAsUtc returns local-midnight for date-only input.
const d = parseAsUtc('2026-07-13');
assert.equal(d.getFullYear(), 2026);
assert.equal(d.getMonth(), 6);
assert.equal(d.getDate(), 13, 'local date component must be the 13th');

console.log('OK — all date-label assertions passed');
