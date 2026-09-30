// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf } from '../../../functions/api/ca/coverage.js';

test('coverageOf merges upload periods and reports the gaps', () => {
  const c = coverageOf([{ from: '2026-09-01', to: '2026-09-10' }, { from: '2026-09-05', to: '2026-09-12' }, { from: '2026-09-15', to: '2026-09-15' }, { from: '2026-09-16', to: '2026-09-20' }]);
  assert.equal(c.from, '2026-09-01'); assert.equal(c.to, '2026-09-20');
  assert.equal(c.days_covered, 18); assert.equal(c.days_missing, 2);
  assert.deepEqual(c.gaps, [{ from: '2026-09-13', to: '2026-09-14' }]);
  assert.deepEqual(coverageOf([]), { from: null, to: null, days_covered: 0, days_missing: 0, gaps: [] });
  assert.deepEqual(coverageOf([{ from: null, to: '2026-09-01' }]).gaps, []);
});
