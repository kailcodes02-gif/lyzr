// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf } from '../../../functions/api/ca/coverage.js';
import { activeWindows } from '../../../functions/api/ca/_lib/windows.js';

test('coverageOf merges upload periods and reports the gaps', () => {
  const c = coverageOf([{ from: '2026-09-01', to: '2026-09-10' }, { from: '2026-09-05', to: '2026-09-12' }, { from: '2026-09-15', to: '2026-09-15' }, { from: '2026-09-16', to: '2026-09-20' }]);
  assert.equal(c.from, '2026-09-01'); assert.equal(c.to, '2026-09-20');
  assert.equal(c.days_covered, 18); assert.equal(c.days_missing, 2);
  assert.deepEqual(c.gaps, [{ from: '2026-09-13', to: '2026-09-14' }]);
  assert.deepEqual(coverageOf([]), { from: null, to: null, days_covered: 0, days_missing: 0, gaps: [] });
  assert.deepEqual(coverageOf([{ from: null, to: '2026-09-01' }]).gaps, []);
});

test('activeWindows: a demographics file uploaded twice counts once, newest wins, 0-row uploads skipped', () => {
  const u = (id, start, end, at, notes = 'Company', rows = 10) => ({ id, kind: 'demographics', platform: 'linkedin', period_start: start, period_end: end, uploaded_at: at, notes, row_count: rows });
  const list = [
    u('a', '2026-09-01', '2026-09-30', '2026-10-01T10:00:00Z'),
    u('b', '2026-09-01', '2026-09-30', '2026-10-02T10:00:00Z'),            // same file again -> wins
    u('c', '2026-09-01', '2026-09-14', '2026-09-20T10:00:00Z'),            // inside b -> dropped
    u('d', '2026-09-01', '2026-09-30', '2026-10-03T10:00:00Z', 'Job Title'), // other breakdown -> kept
    u('e', '2026-09-01', '2026-09-30', '2026-10-03T10:00:00Z', 'Company (Anju)'), // tagged -> kept
    u('f', '2026-08-01', '2026-08-31', '2026-09-01T10:00:00Z'),            // other month -> kept
    u('g', '2026-07-01', '2026-07-31', '2026-08-01T10:00:00Z', 'Company', 0), // nothing read -> skipped
  ];
  assert.deepEqual(activeWindows(list).map(x => x.id).sort(), ['b', 'd', 'e', 'f']);
});
