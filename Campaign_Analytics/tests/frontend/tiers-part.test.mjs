// The tier roll-up used by the LinkedIn "Penetration by tier" part: cube cells summed per tier with the
// pooled-reach rule (percentages only count people reached in cells that have a pool).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rollup } from '../../js/views/parts/tiers.mjs';

const cell = (reached, pool, imp, pooled = reached) => ({ reached, reached_pooled: pool ? pooled : 0, imp, pool: pool || 0, has_pool: pool > 0, est_pool: false });
const bands = (f) => ({ MD: f(1), 'MD-1': f(2), 'MD-2': f(3), All: f(6) });

test('rollup sums reach, impressions and pools per tier and keeps percentages under 100', () => {
  const cube = { accounts: [
    { account: 'EY', total: bands(n => cell(10 * n, 100 * n, 50 * n)), regions: { India: bands(n => cell(10 * n, 100 * n, 50 * n)) } },
    { account: 'Deloitte', total: bands(n => cell(5 * n, 100 * n, 20 * n)), regions: { India: bands(n => cell(5 * n, 100 * n, 20 * n)) } },
    { account: 'NoPool', total: bands(n => cell(40 * n, 0, 140 * n)), regions: { Europe: bands(n => cell(40 * n, 0, 140 * n)) } },
  ] };
  const R = rollup(cube, a => a === 'NoPool' ? 'Other' : 'Big Four');
  const b4 = R.get('Big Four');
  assert.equal(b4.accounts, 2); assert.equal(b4.reachedAccounts, 2);
  assert.equal(b4.total.MD.reached, 15); assert.equal(b4.total.MD.pool, 200); assert.equal(b4.total.MD.pct, 7.5);
  assert.equal(b4.total.All.imp, 420); assert.equal(Math.round(b4.total.All.exposure * 1000) / 1000, 0.35);
  assert.equal(Math.round(b4.total.All.freq * 100) / 100, 4.67);
  assert.equal(b4.regions.India.All.pct, 7.5);
  const other = R.get('Other');
  assert.equal(other.total.All.pct, null); assert.equal(other.total.All.reached, 240); assert.equal(other.total.All.exposure, null);
  // a tier mixing pooled and unpooled cells: reach outside pools never inflates the percentage
  const mixed = rollup(cube, () => 'GSI').get('GSI');
  assert.equal(mixed.total.MD.reached, 55); assert.equal(mixed.total.MD.pct, 7.5);
  assert.deepEqual([...rollup({ accounts: [] }, () => 'GSI').keys()], []);
});
