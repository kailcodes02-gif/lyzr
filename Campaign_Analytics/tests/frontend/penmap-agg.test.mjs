// Penetration map model: the formulas of the "GSI LinkedIn Penetration Map" report.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../js/lib/penmap-agg.mjs';

const regions = { India: ['India'], 'United States': ['United States'], 'United Kingdom': ['United Kingdom', 'Ireland'], 'Middle East': ['Saudi Arabia', 'United Arab Emirates', 'Türkiye', 'Israel'], APAC: ['Australia', 'Singapore', 'Japan'], Europe: ['Germany'] };
const pool = [
  { company: 'EY', country: 'India', md: 100, md1: 200, md2: 300 },
  { company: 'EY', country: 'United States', md: 400, md1: 400, md2: 600 },
  { company: 'EY', country: 'United Arab Emirates', md: 30, md1: 30, md2: 40 },
  { company: 'EY', country: 'Saudi Arabia', md: 20, md1: 20, md2: 10 },
  { company: 'KPMG', country: 'India', md: 50, md1: 50, md2: 100 },
  { company: 'KPMG', country: 'United States', md: 100, md1: 100, md2: 100 },
];
const match = v => /^ey\b|ernst/i.test(v) ? 'EY' : /^kpmg/i.test(v) ? 'KPMG' : null;
const win = (start, end, rows) => ({ upload: { period_start: start, period_end: end }, rows });
const demo = (seg, value, impressions, clicks = 0) => ({ segment: seg, value, impressions, clicks });
const perfRow = (day, campaign, o) => ({ day, campaign, campaign_group: 'G', objective: 'Brand awareness', impressions: 0, clicks: 0, spend: 0, leads: 0, lead_forms_opened: 0, ...o });

function model(extra = {}) {
  const windows = [
    win('2026-08-01', '2026-08-31', [demo('Company', 'EY', 900, 9), demo('Company', 'KPMG India', 300, 3), demo('Company', 'Somebody Else', 300),
      demo('Country', 'India', 600), demo('Country', 'United States', 600), demo('Country', 'Türkiye', 50), demo('Country', 'United Arab Emirates', 250),
      demo('Job Seniority', 'CXO', 100), demo('Job Seniority', 'Director', 200), demo('Job Seniority', 'Manager', 300), demo('Job Seniority', 'Senior', 300), demo('Job Seniority', 'Entry', 100)]),
    win('2026-09-01', '2026-09-30', [demo('Company', 'EY', 600), demo('Country', 'India', 300), demo('Country', 'United States', 300), demo('Job Seniority', 'VP', 50), demo('Job Seniority', 'Manager', 50)]),
  ];
  const perf = [
    perfRow('2026-08-03', 'India|Heatmap|Lead Gen', { objective: 'Lead generation', spend: 300, impressions: 3000, clicks: 30, leads: 6, lead_forms_opened: 12 }),
    perfRow('2026-08-04', 'Video|Awareness', { spend: 100, impressions: 10000, clicks: 20 }),
    perfRow('2026-09-02', 'UK|GSI|Native|Playbooks', { objective: 'Lead generation', spend: 200, impressions: 1000, leads: 0, lead_forms_opened: 3 }),
    perfRow('2026-09-03', 'Middle East|GSI|Native|Playbooks', { objective: 'Lead generation', spend: 100, impressions: 2000, leads: 2, lead_forms_opened: 5 }),
    perfRow('2026-09-05', 'Retargeting|Playbooks', { objective: 'Lead generation', spend: 50, impressions: 500, leads: 1, lead_forms_opened: 2 }),
  ];
  return P.buildModel({ perf, windows, icpPool: pool, regions, matchAccount: match, ...extra });
}

test('people = impressions ÷ 3 and penetration = people ÷ Apollo headcount, not capped', () => {
  const M = model();
  const imp = P.imp(M, 'EY', 'US', P.ICPB, M.months);
  assert.ok(imp > 0);
  assert.equal(P.people(M, 'EY', 'US', P.ICPB, M.months), imp / 3);
  const c = P.cellVal(M, 'EY', 'US', { band: 'ICP', metric: 'pen' });
  assert.equal(c.v, (imp / 3) / 1400);
  // Sr IC and Everyone fall back to MD to MD-2 for the percentage, as in the report
  const s = P.cellVal(M, 'EY', 'US', { band: 'Sr IC', metric: 'pen' });
  assert.equal(s.v, c.v);
  assert.equal(P.cellVal(M, 'EY', 'Europe & other', { band: 'ICP', metric: 'pen' }).v, null);
});

test('divisor follows Admin › Targets', () => {
  const M = model({ divisor: 4 });
  assert.equal(P.people(M, 'EY', 'India', ['MD'], M.months), P.imp(M, 'EY', 'India', ['MD'], M.months) / 4);
});

test('the fit matches company totals and region totals exactly', () => {
  const M = model();
  const ey = P.REG.reduce((a, r) => a + P.imp(M, 'EY', r, P.ALLB, ['2026-08']), 0);
  assert.ok(Math.abs(ey - 900) < 1e-6, 'EY row total ' + ey);
  // KPMG India is pinned to India
  for (const r of P.REG) if (r !== 'India') assert.equal(P.imp(M, 'KPMG', r, P.ALLB, ['2026-08']), 0);
  assert.ok(Math.abs(P.imp(M, 'KPMG', 'India', P.ALLB, ['2026-08']) - 300) < 1e-6);
  // Türkiye counts as Europe & other (the report's Middle East)
  assert.equal(M.monthly.find(o => o.m === '2026-08').regimp['Europe & other'], 50);
  assert.equal(M.monthly.find(o => o.m === '2026-08').regimp['Middle East'], 250);
});

test('ipf hits both margins', () => {
  const m = P.ipf([[1, 2, 0.1], [3, 1, 0.1], [1, 1, 1]], [10, 20, 30], [25, 25, 10]);
  const rows = m.map(r => r.reduce((a, b) => a + b, 0)), cols = [0, 1, 2].map(j => m.reduce((a, r) => a + r[j], 0));
  [10, 20, 30].forEach((v, i) => assert.ok(Math.abs(rows[i] - v) < 1e-4));
  [25, 25, 10].forEach((v, i) => assert.ok(Math.abs(cols[i] - v) < 1e-4));
});

test('bands come from Job Seniority: MD = Partner/VP/CXO/Owner, MD-1 = Director, MD-2 = Manager, Sr IC = Senior', () => {
  assert.equal(P.seniorityBand('CXO'), 'MD'); assert.equal(P.seniorityBand('Partner'), 'MD'); assert.equal(P.seniorityBand('VP'), 'MD'); assert.equal(P.seniorityBand('Owner'), 'MD');
  assert.equal(P.seniorityBand('Director'), 'MD-1'); assert.equal(P.seniorityBand('Manager'), 'MD-2'); assert.equal(P.seniorityBand('Senior'), 'Sr IC');
  assert.equal(P.seniorityBand('Entry'), 'Junior'); assert.equal(P.seniorityBand('Training'), 'Junior'); assert.equal(P.seniorityBand('Unpaid'), 'Junior');
  const M = model();
  assert.deepEqual(M.bshare['2026-08'], { MD: 0.1, 'MD-1': 0.2, 'MD-2': 0.3, 'Sr IC': 0.3, Junior: 0.1 });
  const all = P.imp(M, 'EY', 'US', P.ALLB, ['2026-08']), md = P.imp(M, 'EY', 'US', ['MD'], ['2026-08']);
  assert.ok(Math.abs(md / all - 0.1) < 1e-9);
});

test('monthly: lead-gen spend, CPL and KPIs', () => {
  const M = model();
  const aug = M.monthly.find(o => o.m === '2026-08'), sep = M.monthly.find(o => o.m === '2026-09');
  assert.equal(aug.spend, 400); assert.equal(aug.lgspend, 300); assert.equal(aug.leads, 6); assert.equal(sep.lgspend, 350);
  const K = P.kpis(M);
  assert.deepEqual(M.recent, ['2026-08', '2026-09']);
  assert.equal(K.cplRecent, 650 / 9);
  assert.equal(K.completion, 9 / 22);
  // non-India regional sets in the latest month: UK and Middle East (Retargeting names no geography)
  assert.deepEqual(K.nonHome.sets.sort(), ['Middle East|GSI|Native|Playbooks', 'UK|GSI|Native|Playbooks']);
  assert.equal(K.nonHome.spend, 300); assert.equal(K.nonHome.leads, 2); assert.equal(K.nonHome.cpl, 150);
  assert.deepEqual(K.nonHome.leadRegions, ['Middle East']);
});

test('geography from ad set names', () => {
  assert.deepEqual(P.geoOfName('US|GSI&SI|Native|Playbooks- 5 Oct').regions, ['US']);
  assert.deepEqual(P.geoOfName("Middle East|GSI&SI|Native|Playbooks-5 OCt'26").regions, ['Middle East']);
  assert.equal(P.geoOfName('Combined Region|All GSI/SI (Native)').fixed, false);
  assert.equal(P.geoOfName('Native Targeting(Heatmap)|GSI|Playbooks').fixed, false);
  assert.equal(P.pinnedRegion('Accenture in India'), 'India');
  assert.equal(P.pinnedRegion('alrajhi bank'), 'Middle East');
  assert.equal(P.pinnedRegion('Department of Government Enablement'), 'Middle East');
  assert.equal(P.pinnedRegion('Deloitte'), null);
});

test('gap and warm-now statuses use the recent window', () => {
  const M = model({ recentMonths: 1 });
  const g = P.gaps(M, { regions: ['US'], limit: 0 }).find(x => x.c === 'EY');
  const rec = P.people(M, 'EY', 'US', P.ICPB, ['2026-09']);
  assert.equal(g.rec, rec); assert.equal(g.gap, 1400 - rec); assert.equal(g.status, rec / 1400 < 0.05 ? 'Cold' : rec / 1400 < 0.25 ? 'Thin' : 'Warm');
});

test('anti heat map ranks unreached headcount, including accounts never reached', () => {
  const M = model();
  const AH = P.antiHeat(M, { regions: ['India', 'US', 'Middle East'] });
  assert.ok(AH.rows.length >= 2);
  const k = AH.rows.find(r => r.c === 'KPMG');
  assert.ok(k.cells.US.gap === 300 && k.cells.US.reached === 0 && k.cells.US.status === 'Cold');
  for (let i = 1; i < AH.rows.length; i++) assert.ok(AH.rows[i - 1].pri >= AH.rows[i].pri);
  const filtered = P.antiHeat(M, { regions: ['US'], search: 'kp' });
  assert.deepEqual(filtered.rows.map(r => r.c), ['KPMG']);
});

test('plan maths equals the report ($600 over 5 days)', () => {
  // The report's PLAN[600]: daily 40, 20, 25, 20, 15 = $120/day.
  const rows = [
    { key: 'L1', share: 40 / 120, cplLo: 35, cplHi: 60 }, { key: 'L2', share: 20 / 120, cplLo: 35, cplHi: 90 },
    { key: 'T1', share: 25 / 120, cpmLo: 16, cpmHi: 30 }, { key: 'T2', share: 20 / 120, cpmLo: 11, cpmHi: 14 }, { key: 'T3', share: 15 / 120, cpmLo: 12, cpmHi: 30 },
  ];
  const N = P.planNumbers(rows, { budget: 600, days: 5, divisor: 3 });
  assert.deepEqual(N.rows.map(r => r.daily), [40, 20, 25, 20, 15]);
  assert.equal(N.tot, 600);
  // report: lLo += s/cplHi, lHi += s/cplLo
  const lLo = 200 / 60 + 100 / 90, lHi = 200 / 35 + 100 / 35;
  assert.ok(Math.abs(N.leadsLo - lLo) < 1e-9 && Math.abs(N.leadsHi - lHi) < 1e-9);
  const iLo = 1000 * 125 / 30 + 1000 * 100 / 14 + 1000 * 75 / 30, iHi = 1000 * 125 / 16 + 1000 * 100 / 11 + 1000 * 75 / 12;
  assert.ok(Math.abs(N.peopleLo - iLo / 3) < 1e-9 && Math.abs(N.peopleHi - iHi / 3) < 1e-9);
  assert.ok(Math.abs(N.lgCplLo - 300 / lHi) < 1e-9 && Math.abs(N.allCplHi - 600 / lLo) < 1e-9);
  const mid = (lLo + lHi) / 2;
  assert.equal(N.demosLo, Math.max(1, Math.round(mid * 0.12))); assert.equal(N.demosHi, Math.round(mid * 0.25));
});

test('worked split and the rule plan come from the account\'s own ad sets', () => {
  const M = model();
  const W = P.workedSplit(M);
  assert.ok(W.bad.some(x => x.name === 'UK|GSI|Native|Playbooks'), 'UK set spent $200 with no leads');
  const plan = P.rulePlan(M);
  assert.ok(plan.length >= 1);
  for (const r of plan) assert.ok((r.cplLo && r.cplHi) || (r.cpmLo && r.cpmHi));
});

test('aiInput is compact JSON with the page numbers', () => {
  const M = model();
  const inp = P.aiInput(M, { k: P.kpis(M), worked: P.workedSplit(M), gapsList: P.gaps(M), antiRows: P.antiHeat(M).rows, budget: 600, days: 5 });
  assert.equal(inp.monthly.length, 2);
  assert.ok(inp.ad_sets.every(a => 'cpl' in a && 'cpm' in a));
  assert.ok(JSON.stringify(inp).length < 60000);
});
