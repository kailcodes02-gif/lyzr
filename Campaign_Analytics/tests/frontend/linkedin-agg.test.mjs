// node --test tests/frontend
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/lib/linkedin-agg.mjs';
import { linkedinMock } from '../../js/mock/linkedin.mjs';

const row = (day, campaign_group, campaign, o = {}) => ({ day, campaign_group, campaign, ad_id: o.ad_id || 'a1', ad_name: o.ad_name || 'Ad', impressions: 0, clicks: 0, spend: 0, leads: 0, lead_forms_opened: 0, sends: 0, opens: 0, ...o });

test('totals and derived rates', () => {
  const t = A.totals([row('2026-09-01', 'G', 'C', { impressions: 1000, clicks: 10, spend: 100, leads: 4, lead_forms_opened: 8, sends: 50, opens: 25 }), row('2026-09-02', 'G', 'C', { impressions: 1000, clicks: 10, spend: 100, leads: 1 })]);
  assert.equal(t.impressions, 2000); assert.equal(t.ctr, 1); assert.equal(t.cpl, 40); assert.equal(t.completion, 62.5); assert.equal(t.open_rate, 50); assert.equal(t.cpm, 100);
  assert.equal(A.totals([]).cpl, null);
});

test('trend buckets by day, week (Monday) and month', () => {
  const rows = [row('2026-09-01', 'G', 'C', { spend: 1 }), row('2026-09-06', 'G', 'C', { spend: 2 }), row('2026-09-07', 'G', 'C', { spend: 4 }), row('2026-10-01', 'G', 'C', { spend: 8 })];
  assert.deepEqual(A.trend(rows, 'day').map(b => b.key), ['2026-09-01', '2026-09-06', '2026-09-07', '2026-10-01']);
  const w = A.trend(rows, 'week'); assert.deepEqual(w.map(b => [b.key, b.spend]), [['2026-08-31', 3], ['2026-09-07', 4], ['2026-09-28', 8]]);
  const m = A.trend(rows, 'month'); assert.deepEqual(m.map(b => [b.key, b.spend, b.days]), [['2026-09', 7, 3], ['2026-10', 8, 1]]);
  assert.equal(A.growth(150, 100), 50); assert.equal(A.growth(5, 0), null);
});

test('previous range has the same length and ends the day before', () => {
  assert.deepEqual(A.previousRange('2026-09-01', '2026-09-30'), { from: '2026-08-02', to: '2026-08-31' });
  assert.equal(A.daysBetween('2026-09-01', '2026-09-30'), 30);
});

test('funnel stage keywords: BoFu wins over MoFu over ToFu, program name first', () => {
  assert.equal(A.stageOf({ campaign_group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', campaign: 'Retargeting Aud|GSI&SI|Playbooks' }), 'MoFu', 'program name decides before the ad set name');
  assert.equal(A.stageOf({ campaign_group: 'GSI & SI Lead Gen|Conversion', campaign: 'WP|Accenture|Anju|India|Lead Gen|GSI&SI' }), 'BoFu');
  assert.equal(A.stageOf({ campaign_group: 'GSI & SI Lead Gen|Book a Demo', campaign: 'x' }), 'BoFu');
  assert.equal(A.stageOf({ campaign_group: 'LinkedIn Ads-GSI & SI|brand Awareness Campaign', campaign: 'x' }), 'ToFu');
  assert.equal(A.stageOf({ campaign_group: 'GSI & SI Lead Gen| Website visits', campaign: 'x' }), 'ToFu', 'website visits is ToFu even though the group name also says Lead Gen');
  assert.equal(A.stageOf({ campaign_group: 'LinkedIn Ads-GSI & SI|Workshop|Lead Gen', campaign: 'x' }), 'MoFu');
  assert.equal(A.stageOf({ campaign_group: '', campaign: 'Something else' }), 'Other');
});

test('funnel stage: an explicit stages setting overrides the defaults', () => {
  const stages = { ToFu: ['reach'], MoFu: ['nurture'], BoFu: ['close'] };
  assert.equal(A.stageOf({ campaign_group: 'Close deals', campaign: '' }, stages), 'BoFu');
  assert.equal(A.stageOf({ campaign_group: 'Playbook Lead Gen', campaign: '' }, stages), 'Other');
});

test('verdict rules', () => {
  assert.equal(A.verdict({ leads: 12, cpl: 20, spend: 240, days_span: 30 }, 45).label, 'High');
  assert.equal(A.verdict({ leads: 0, cpl: null, spend: 150, days_span: 30 }, 45).label, 'Low');
  assert.equal(A.verdict({ leads: 1, cpl: 50, spend: 50, days_span: 6 }, 45).label, 'Too early');
  assert.equal(A.verdict({ leads: 12, cpl: 80, spend: 960, days_span: 30 }, 45).label, 'Medium');
  assert.equal(A.verdict({ leads: 0, cpl: null, spend: 50, days_span: 30 }, 45).label, 'Medium');
  assert.equal(A.median([5, 1, 3]), 3); assert.equal(A.median([4, 1, 3, 2]), 2.5); assert.equal(A.median([]), null);
});

test('programs: groups by campaign group then campaign, months active, verdict', () => {
  const rows = [
    row('2026-08-20', 'Playbook Lead Gen', 'Seniorities', { spend: 300, impressions: 3000, leads: 12 }),
    row('2026-09-05', 'Playbook Lead Gen', 'Seniorities', { spend: 300, impressions: 3000, leads: 10 }),
    row('2026-09-05', 'Playbook Lead Gen', 'Heatmap', { spend: 200, impressions: 9000, leads: 30 }),
    row('2026-09-20', 'Playbook Lead Gen', 'Heatmap', { spend: 200, impressions: 9000, leads: 26 }),
    row('2026-09-18', 'Book a Demo', 'Demo retarget', { spend: 100, impressions: 3800, leads: 1 }),
  ];
  const P = A.programs(rows);
  assert.equal(P.programs[0].name, 'Playbook Lead Gen');
  assert.equal(P.programs[0].months_label, "Aug '26, Sep '26");
  assert.equal(P.programs[0].campaigns[0].name, 'Heatmap');
  assert.equal(P.programs[0].campaigns[0].verdict.label, 'High');
  assert.equal(P.programs[1].verdict.label, 'Too early');
  assert.equal(P.programs[0].stage, 'MoFu'); assert.equal(P.programs[1].stage, 'BoFu');
});

test('ads: sorted by leads then CPL, unnamed ads fall back to the id', () => {
  const rows = [row('2026-09-01', 'G', 'C', { ad_id: '1', ad_name: 'A', spend: 100, impressions: 10, leads: 2 }), row('2026-09-01', 'G', 'C', { ad_id: '2', ad_name: 'B', spend: 50, impressions: 10, leads: 2 }), row('2026-09-01', 'G', 'C', { ad_id: '3', ad_name: '', spend: 10, impressions: 10 })];
  const a = A.ads(rows); assert.deepEqual(a.map(x => x.ad_name), ['B', 'A', '3']);
});

test('account matching: exact, alias, parenthesised short name, initials, prefix', () => {
  const accounts = [{ name: 'Boston Consulting Group (BCG)', aliases: [] }, { name: 'Tata Consultancy Services', aliases: ['Tata Consultancy Services'] }, { name: 'KPMG', aliases: ['KPMG US', 'KPMG India'] }, { name: 'McKinsey & Company', aliases: [] }, { name: 'EY', aliases: ['EY'] }, { name: 'Accenture', aliases: ['Accenture in India'] }];
  assert.equal(A.matchAccount('BCG', accounts), 'Boston Consulting Group (BCG)');
  assert.equal(A.matchAccount('TCS', accounts), 'Tata Consultancy Services');
  assert.equal(A.matchAccount('KPMG India', accounts), 'KPMG');
  assert.equal(A.matchAccount('kpmg', accounts), 'KPMG');
  assert.equal(A.matchAccount('McKinsey', accounts), 'McKinsey & Company');
  assert.equal(A.matchAccount('EY', accounts), 'EY');
  assert.equal(A.matchAccount('Accenture in India', accounts), 'Accenture');
  assert.equal(A.matchAccount('Capgemini', accounts), null);
  assert.equal(A.matchAccount('IBM', accounts), null);
});

test('region lookup accepts the seed file shape or the inner map', () => {
  const seed = { note: '', regions: { India: ['India'], 'Middle East': ['UAE', 'United Arab Emirates'] } };
  assert.equal(A.regionOf('United Arab Emirates', seed), 'Middle East');
  assert.equal(A.regionOf('india', seed.regions), 'India');
  assert.equal(A.regionOf('Brazil', seed), 'Other');
});

test('band weights from job titles, Director splits 50/50', () => {
  const bands = { global: { MD: ['Managing Director', 'Partner', 'Senior Vice President'], MD1: ['Vice President', 'Associate Director', 'Principal'], MD2: ['Senior Manager', 'Engagement Manager'] } };
  assert.deepEqual(A.bandWeights('Partner', bands), { MD: 1 });
  assert.deepEqual(A.bandWeights('Senior Vice President', bands), { MD: 1 }, 'MD wins over the MD-1 substring');
  assert.deepEqual(A.bandWeights('Assistant Vice President', bands), { 'MD-1': 1 });
  assert.deepEqual(A.bandWeights('Director', bands), { 'MD-1': 0.5, 'MD-2': 0.5 });
  assert.deepEqual(A.bandWeights('Director of Engineering', bands), { 'MD-1': 0.5, 'MD-2': 0.5 });
  assert.deepEqual(A.bandWeights('Senior Manager', bands), { 'MD-2': 1 });
  assert.deepEqual(A.bandWeights('Software Engineer', bands), { Other: 1 });
  const s = A.bandShares([{ value: 'Partner', impressions: 100 }, { value: 'Director', impressions: 100 }, { value: 'Analyst', impressions: 200 }], bands);
  assert.equal(s.share.MD, 0.25); assert.equal(s.share['MD-1'], 0.125); assert.equal(s.share['MD-2'], 0.125); assert.equal(s.share.Other, 0.5);
});

test('penetration: impressions x country share x band share / frequency, over pool', () => {
  const accounts = [{ name: 'EY', aliases: ['EY'] }];
  const icp_pool = [{ company: 'EY', country: 'India', md: 1000, md1: 2000, md2: 3000 }, { company: 'EY', country: 'United States', md: 500, md1: 500, md2: 500 }];
  const bands = { global: { MD: ['Partner'], MD1: ['Vice President'], MD2: ['Senior Manager'] } };
  const rows = [
    { segment: 'Company', value: 'EY', impressions: 7000 }, { segment: 'Company', value: 'IBM', impressions: 9999 },
    { segment: 'Country', value: 'India', impressions: 800 }, { segment: 'Country', value: 'United States', impressions: 200 },
    { segment: 'Job Title', value: 'Partner', impressions: 50 }, { segment: 'Job Title', value: 'Vice President', impressions: 25 }, { segment: 'Job Title', value: 'Senior Manager', impressions: 25 }, { segment: 'Job Title', value: 'Analyst', impressions: 100 },
  ];
  const P = A.penetration({ windows: [{ rows }], accounts, icp_pool, bands, frequency: 3.5, band: 'MD' });
  const india = P.cells.find(c => c.country === 'India');
  // 7000 x 0.8 x 0.25 / 3.5 = 400 people; pool MD 1000 -> 40%
  assert.equal(Math.round(india.reached.MD), 400); assert.equal(Math.round(india.pct), 40); assert.equal(india.pool_band, 1000);
  const us = P.cells.find(c => c.country === 'United States');
  assert.equal(Math.round(us.reached.MD), 100); assert.equal(Math.round(us.pct), 20);
  const all = A.penetration({ windows: [{ rows }], accounts, icp_pool, bands, frequency: 3.5, band: 'All' }).cells.find(c => c.country === 'India');
  assert.equal(Math.round(all.reached_band), 800); assert.equal(all.pool_band, 6000);
  assert.equal(P.accounts[0], 'EY');
  assert.equal(A.penLevel(4.9), 1); assert.equal(A.penLevel(15), 3); assert.equal(A.penLevel(70), 5); assert.equal(A.penLevel(null), 0);
});

test('creatives for a country use the geography in the ad set name; global ad sets are shared', () => {
  const rows = [row('2026-09-01', 'G', 'WP|Accenture|Anju|India|Lead Gen', { ad_name: 'India only', impressions: 100, clicks: 5, leads: 1 }), row('2026-09-01', 'G', 'Retargeting Aud|GSI&SI|Playbooks', { ad_name: 'Global', impressions: 100, clicks: 1 }), row('2026-09-01', 'G', 'Brand Awareness|US|UK|EU', { ad_name: 'West', impressions: 100, clicks: 9 })];
  const countries = ['India', 'United States', 'United Kingdom'];
  assert.deepEqual(A.creativesForCountry(rows, 'India', countries).map(c => c.ad_name), ['India only', 'Global']);
  assert.deepEqual(A.creativesForCountry(rows, 'United States', countries).map(c => c.ad_name), ['West', 'Global']);
});

test('bullets only include items whose data exists', () => {
  const b0 = A.bullets({ rows: [], from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(b0, { achieved: [], missed: [] });
  const rows = [row('2026-09-01', 'Playbook Lead Gen', 'Heatmap', { spend: 100, impressions: 1000, leads: 10 }), row('2026-09-20', 'Playbook Lead Gen', 'Heatmap', { spend: 200, impressions: 1000, leads: 5 }), row('2026-09-10', 'Website Visits', 'Traffic', { spend: 150, impressions: 500 })];
  const b = A.bullets({ rows, from: '2026-09-01', to: '2026-09-30' });
  assert.ok(b.achieved.some(x => /Best ad set/.test(x.b)));
  assert.ok(b.missed.some(x => /second half/.test(x.b)), 'CPL rose from $10 to $40');
  assert.ok(!b.missed.some(x => /no leads/.test(x.b)), 'ToFu zero-lead spend is not flagged as dead');
  assert.ok(!b.achieved.concat(b.missed).some(x => /Message ads/.test(x.b)), 'no sends, no conversation bullet');
});

test('mock data matches the report month totals and stays small', () => {
  const by = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const sep = linkedinMock.perf.filter(r => r.day.startsWith('2026-09'));
  assert.equal(by(sep, 'leads'), 97); assert.equal(Math.round(by(sep, 'spend')), 4470); assert.ok(Math.abs(by(sep, 'impressions') - 312312) < 200);
  assert.equal(by(linkedinMock.perf, 'leads'), 128);
  const bytes = JSON.stringify(linkedinMock.perf).length + JSON.stringify(linkedinMock.demo).length;
  assert.ok(bytes < 400 * 1024, `generated data is ${Math.round(bytes / 1024)} KB, limit 400 KB`);
  assert.ok(linkedinMock.demo.length >= 8);
  assert.ok(linkedinMock.uploads.every(u => u.period_start && u.period_end && u.kind));
});
