// node --test Campaign_Analytics/tests/frontend/pipeline-agg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../js/lib/pipeline-agg.mjs';
import { dealsMock, dealsGet, dealsSyncPost } from '../../js/mock/deals.mjs';

const d = (o) => ({ hs_id: 'x', name: 'Deal', partner: 'Accenture', bucket: 'conversation', substage: 'Discovery Call', stage_label: 'Discovery Call', amount: 0, close_date: '2026-10-15', created_at: '2026-09-01T05:00:00Z', motion_label: 'New Business', forecast: null, ...o });
const SET = [
  d({ hs_id: '1', partner: 'Accenture', bucket: 'won', substage: 'Closed Won', amount: 250000, close_date: '2026-09-20' }),
  d({ hs_id: '2', partner: 'Accenture', bucket: 'demo', substage: 'Proposal', amount: 100000, close_date: '2026-12-01', motion_label: 'Expansion' }),
  d({ hs_id: '3', partner: 'Accenture', bucket: 'conversation', substage: 'Qualification', amount: 0, close_date: '2027-02-10' }),
  d({ hs_id: '4', partner: 'Deloitte', bucket: 'lost', substage: 'Closed Lost', amount: 50000, close_date: '2026-08-01' }),
  d({ hs_id: '5', partner: 'Deloitte', bucket: 'conversation', substage: 'Discovery Call', amount: 30000, close_date: null, created_at: '2026-07-04T00:00:00Z', motion_label: 'Partnership' }),
  d({ hs_id: '6', partner: 'EY', bucket: 'won', substage: 'Closed Won', amount: 0, close_date: '2026-11-11', motion_label: 'POC' }),
  d({ hs_id: '7', partner: null, bucket: 'demo', substage: 'Negotiation', amount: 20000, close_date: '2026-12-20' }),
];

test('quarterOf and dealQuarter', () => {
  assert.equal(P.quarterOf('2026-09-20'), 'Q3 2026');
  assert.equal(P.quarterOf('2027-01-05T10:00:00Z'), 'Q1 2027');
  assert.equal(P.quarterOf(''), null); assert.equal(P.quarterOf('nope'), null);
  assert.equal(P.dealQuarter(SET[4]), 'Q3 2026', 'no close date falls back to the create date');
  assert.equal(P.dealQuarter(d({ close_date: null, created_at: null })), 'No date');
  assert.equal(P.quarterKey('Q4 2026') < P.quarterKey('Q1 2027'), true);
});

test('filterDeals, searchDeals, sortDeals, partners', () => {
  assert.equal(P.filterDeals(SET, { mode: 'accenture' }).length, 3);
  assert.equal(P.filterDeals(SET, { mode: 'other' }).length, 4, 'other includes the unknown partner');
  assert.equal(P.filterDeals(SET, { mode: 'all', partner: 'Deloitte' }).length, 2);
  assert.equal(P.filterDeals(SET, { mode: 'other', partner: 'Accenture' }).length, 0);
  assert.deepEqual(P.searchDeals(SET, 'negot').map(x => x.hs_id), ['7']);
  assert.deepEqual(P.searchDeals(SET, 'partnership').map(x => x.hs_id), ['5']);
  assert.equal(P.searchDeals(SET, '  ').length, SET.length);
  assert.deepEqual(P.sortDeals(SET, 'amount', -1).slice(0, 2).map(x => x.hs_id), ['1', '2']);
  assert.deepEqual(P.sortDeals(SET, 'partner', 1).map(x => x.partner)[0], 'Accenture');
  assert.equal(P.sortDeals(SET, 'partner', 1).at(-1).partner, null, 'Unknown sorts last');
  assert.deepEqual(P.sortDeals(SET, 'stage', 1).map(x => x.bucket).slice(0, 2), ['conversation', 'conversation']);
  assert.deepEqual(P.partners(SET), ['Accenture', 'Deloitte', 'EY', 'Unknown']);
});

test('kpis: ongoing, demos, wins, losses, customers and ACV', () => {
  const k = P.kpis(SET);
  assert.deepEqual([k.total, k.ongoing, k.demos, k.wins, k.losses, k.customers], [7, 4, 2, 2, 1, 2]);
  assert.equal(k.closed_acv, 250000);
  assert.equal(k.open_acv, 150000, 'lost money is not open pipeline');
  assert.equal(k.open_with_amount, 3); assert.equal(k.won_with_amount, 1);
  assert.deepEqual(P.kpis([]), { total: 0, ongoing: 0, demos: 0, wins: 0, losses: 0, customers: 0, closed_acv: 0, open_acv: 0, open_with_amount: 0, won_with_amount: 0 });
});

test('breakdowns: quarter order, partner top N, motion order, stage mix, sub-stage, ACV', () => {
  const q = P.byQuarter(SET);
  assert.deepEqual(q.map(x => x.key), ['Q3 2026', 'Q4 2026', 'Q1 2027']);
  assert.deepEqual([q[0].won, q[0].lost, q[0].conversation, q[0].total], [1, 1, 1, 3]);
  assert.equal(q[1].open_acv, 120000);
  const p = P.byPartner(SET, 2);
  assert.deepEqual(p.map(x => x.key), ['Accenture', 'Deloitte']);
  assert.deepEqual([p[0].total, p[0].won, p[0].closed_acv, p[0].open_acv], [3, 1, 250000, 100000]);
  const m = P.byMotion(SET);
  assert.deepEqual(m.map(x => x.key), ['New Business', 'Expansion', 'Partnership', 'POC']);
  assert.equal(m[0].amount, 320000); assert.equal(m[0].total, 4);
  assert.equal(P.byMotion([d({ motion_label: null })])[0].key, 'Direct');
  const mix = P.stageMix(SET);
  assert.deepEqual(mix.map(x => x.count), [2, 2, 2, 1]);
  assert.equal(Math.round(mix[0].share), 29);
  assert.deepEqual(P.stageMix([]).map(x => x.count), [0, 0, 0, 0]);
  const ss = P.bySubstage(SET);
  assert.deepEqual(ss.map(x => x.substage), ['Discovery Call', 'Qualification', 'Negotiation', 'Proposal', 'Closed Won', 'Closed Lost'], 'bucket order, then count, then name');
  assert.equal(ss.find(x => x.substage === 'Closed Won').count, 2);
  const acv = P.acvByPartner(SET, 12);
  assert.deepEqual(acv.map(x => [x.partner, x.closed, x.open]), [['Accenture', 250000, 100000], ['Deloitte', 0, 30000], ['Unknown', 0, 20000]], 'lost and zero-amount deals are left out');
  assert.equal(P.acvByPartner(SET, 1).length, 1);
});

test('changesIn joins history to deals inside the IST range; compareChanges gives both periods', () => {
  const hist = [
    { id: 1, hs_id: '3', at: '2026-09-02T10:00:00Z', kind: 'new', from_value: null, to_value: 'Qualification', amount: 0 },
    { id: 2, hs_id: '2', at: '2026-09-10T10:00:00Z', kind: 'stage', from_value: 'Qualification', to_value: 'Proposal', amount: 100000 },
    { id: 3, hs_id: '2', at: '2026-09-10T10:00:00Z', kind: 'amount', from_value: '60000', to_value: '100000', amount: 100000 },
    { id: 4, hs_id: '1', at: '2026-09-20T10:00:00Z', kind: 'stage', from_value: 'Negotiation', to_value: 'Closed Won', amount: 250000 },
    { id: 5, hs_id: '1', at: '2026-09-20T10:00:00Z', kind: 'closed', from_value: 'demo', to_value: 'won', amount: 250000 },
    { id: 6, hs_id: '4', at: '2026-08-15T10:00:00Z', kind: 'closed', from_value: 'conversation', to_value: 'lost', amount: 50000 },
    { id: 7, hs_id: 'gone', at: '2026-09-30T20:00:00Z', kind: 'new', from_value: null, to_value: 'Intro', amount: null },
  ];
  const ch = P.changesIn(hist, SET, '2026-09-01', '2026-09-30');
  assert.deepEqual(ch.counts, { new: 1, stage: 2, amount: 1, won: 1, lost: 0, amount_delta: 40000 });
  assert.equal(ch.new[0].partner, 'Accenture');
  assert.equal(ch.new[0].substage, 'Qualification', 'joined to the deal row');
  assert.equal(ch.stage[0].hs_id, '1', 'newest first');
  assert.equal(ch.stage[1].partner, 'Accenture');
  assert.equal(ch.closed[0].to_value, 'won');
  const late = P.changesIn(hist, SET, '2026-10-01', '2026-10-31');
  assert.equal(late.counts.new, 1, '20:00 UTC on 30 Sep is 1 Oct in IST');
  assert.equal(late.new[0].name, 'Deal gone', 'a history row without a deal still shows');
  assert.equal(late.new[0].partner, 'Unknown');
  const cmp = P.compareChanges(hist, SET, '2026-09-01', '2026-09-30', { from: '2026-08-01', to: '2026-08-31', label: 'the 31 days before' });
  assert.equal(cmp.cur.won, 1); assert.equal(cmp.prev.lost, 1); assert.equal(cmp.prev.new, 0);
  assert.equal(P.compareChanges(hist, SET, '2026-09-01', '2026-09-30', null).prev, null);
  const input = P.insightInput(SET, hist, { from: '2026-09-01', to: '2026-09-30', prev: null, mode: 'all', partner: '' });
  assert.equal(input.kpis.total, 7);
  assert.equal(input.changes.moved.length, 2);
  assert.deepEqual(input.changes.closed[0], { deal: 'Deal', partner: 'Accenture', result: 'won', amount: 250000 });
  assert.equal(input.quarters[0].quarter, 'Q3 2026');
  assert.equal(input.compare.prev, null);
});

test('demo deals: shape of the GET and sync mocks', () => {
  assert.ok(dealsMock.deals.length >= 55 && dealsMock.deals.length <= 65);
  assert.ok(new Set(dealsMock.deals.map(x => x.partner)).size >= 14);
  assert.ok(dealsMock.history.length >= 35 && dealsMock.history.length <= 50);
  for (const x of dealsMock.deals) {
    assert.ok(P.BUCKETS.includes(x.bucket), x.bucket);
    assert.ok(x.close_date >= '2026-07-01' && x.close_date <= '2027-06-30', x.close_date);
    assert.ok(x.created_at >= '2026-06-01' && x.created_at < '2026-10-01', x.created_at);
    assert.equal(x.substage, x.stage_label);
  }
  for (const h of dealsMock.history) assert.ok(h.at >= '2026-08-01' && h.at < '2026-10-01', h.at);
  const ids = new Set(dealsMock.deals.map(x => x.hs_id));
  for (const h of dealsMock.history) assert.ok(ids.has(h.hs_id));
  for (const h of dealsMock.history.filter(h => h.kind === 'stage')) { const deal = dealsMock.deals.find(x => x.hs_id === h.hs_id); assert.equal(deal.substage, h.to_value); assert.equal(deal.prev_stage, h.from_value); }
  const g = dealsGet({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(Object.keys(g).sort(), ['deals', 'from', 'history', 'kpis', 'last_sync', 'to']);
  assert.equal(g.deals.length, dealsMock.deals.length, 'deals are never range-filtered');
  assert.ok(g.history.length > 0 && g.history.length < dealsMock.history.length);
  assert.ok(g.history.every(h => P.dayIST(h.at) >= '2026-09-01' && P.dayIST(h.at) <= '2026-09-30'));
  assert.equal(g.kpis.total, dealsMock.deals.length);
  assert.equal(dealsGet({}).history.length, dealsMock.history.length);
  const a = dealsSyncPost({});
  assert.equal(a.done, false); assert.deepEqual(a.cursor, { step: 1 }); assert.equal(a.progress.phase, 'companies');
  const b = dealsSyncPost({ cursor: a.cursor });
  assert.equal(b.done, true); assert.equal(b.deals, dealsMock.deals.length); assert.equal(b.progress.phase, 'done');
  assert.equal(dealsMock.last_sync.started_by, 'demo@lyzr.com');
  assert.throws(() => dealsSyncPost({ cursor: { step: 9 } }), /Unknown cursor/);
});
