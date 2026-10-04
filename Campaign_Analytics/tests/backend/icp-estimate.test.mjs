// node --test tests/backend
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEstimates, userMessage } from '../../../functions/api/ca/icp-estimate.js';

test('cleanEstimates keeps only asked accounts and countries, whole numbers, confidence defaults to Low', () => {
  const accounts = [{ name: 'Engineering Group', category: 'Global SI' }];
  const out = cleanEstimates([
    { company: 'engineering group', country: 'India', md: 12.4, md1: '30', md2: -5, conf: 'Medium', basis: 'Public headcount' },
    { company: 'Engineering Group', country: 'Mars', md: 1, md1: 1, md2: 1, conf: 'High', basis: '' },
    { company: 'Someone else', country: 'India', md: 1, md1: 1, md2: 1, conf: 'High', basis: '' },
    { company: 'Engineering Group', country: 'Japan', md: 0, md1: 0, md2: 0, conf: 'Guess', basis: 'No office' },
  ], accounts, ['India', 'Japan'], 'claude-sonnet-5');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(o => [o.company, o.country, o.md, o.md1, o.md2, o.conf]), [['Engineering Group', 'India', 12, 30, 0, 'Medium'], ['Engineering Group', 'Japan', 0, 0, 0, 'Low']]);
  assert.equal(out[0].model, 'claude-sonnet-5'); assert.ok(out[0].estimated_at);
  const msg = userMessage([{ name: 'Accenture', category: 'Global SI', ladder: { md: 'Managing Director', md1: 'Associate Director', md2: 'Senior Manager' } }], ['India', 'United States']);
  assert.ok(msg.includes('Accenture (Global SI); ladder: md = Managing Director')); assert.ok(msg.includes('2 rows'));
});
