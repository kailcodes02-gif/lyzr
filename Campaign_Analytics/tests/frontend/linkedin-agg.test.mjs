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
  assert.equal(A.stageOf({ campaign_group: '', campaign: 'Something else' }), 'ToFu');
});

test('funnel stage: an explicit stages setting overrides the defaults', () => {
  const stages = { ToFu: ['reach'], MoFu: ['nurture'], BoFu: ['close'] };
  assert.equal(A.stageOf({ campaign_group: 'Close deals', campaign: '' }, stages), 'BoFu');
  assert.equal(A.stageOf({ campaign_group: 'Playbook Lead Gen', campaign: '' }, stages), 'ToFu');
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
  assert.ok(bytes < 480 * 1024, `generated data is ${Math.round(bytes / 1024)} KB, limit 480 KB (the September windows are split by ad set)`);
  assert.ok(linkedinMock.demo.length >= 8);
  assert.ok(linkedinMock.uploads.every(u => u.period_start && u.period_end && u.kind));
});

test('mock demographics: September windows carry a campaign for several ad sets, other windows do not', () => {
  const sep = linkedinMock.demo.filter(d => d.upload.period_start.startsWith('2026-09'));
  assert.ok(sep.length >= 2);
  for (const w of sep) {
    const camps = new Set(w.rows.map(r => r.campaign).filter(Boolean));
    assert.ok(camps.size >= 4, 'at least four ad sets in the split');
    const approaches = new Set([...camps].map(A.approachOf));
    for (const a of ['Custom list', 'Native', 'Combined']) assert.ok(approaches.has(a), a + ' present');
    assert.ok(w.rows.some(r => r.campaign && r.segment === 'Company' && r.sends > 0), 'sends sit on the conversation ad set');
    assert.ok(w.rows.filter(r => r.segment === 'Job Function').every(r => !r.campaign), 'segments outside the split stay unsplit');
  }
  const aug = linkedinMock.demo.find(d => d.upload.period_start.startsWith('2026-08'));
  assert.ok(aug.rows.every(r => !r.campaign));
  // Ad names carry sender personas for the message ads.
  const msgAds = new Set(linkedinMock.perf.filter(r => r.sends > 0).map(r => r.ad_name));
  assert.ok([...msgAds].some(n => /^Ani:/.test(n)) && [...msgAds].some(n => /^Jessica:/.test(n)));
});

// ---- White Path sections ----
test('approachOf reads the targeting approach from the ad set name', () => {
  assert.equal(A.approachOf('Custom Aud|GSI&SI|Playbooks|Lead Gen'), 'Custom list');
  assert.equal(A.approachOf('ABM upload - matched list'), 'Custom list');
  assert.equal(A.approachOf("Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26"), 'Native');
  assert.equal(A.approachOf('Playbooks|GSI&SI|Seniorities|Lead Gen'), 'Native');
  assert.equal(A.approachOf('Combined Native + Custom|SI|Playbooks'), 'Combined', 'combined wins over the custom and native words');
  assert.equal(A.approachOf('Custom + Native'), 'Combined');
  assert.equal(A.approachOf('Retargeting Aud|GSI&SI|Playbooks'), 'Retargeting');
  assert.equal(A.approachOf('Assessment|Survey|Target Accounts|Website visits'), 'Retargeting');
  assert.equal(A.approachOf('WP|Accenture|Anju|India|Lead Gen'), 'Other');
  assert.equal(A.approachOf(''), 'Other');
});

test('adSets: one row per ad set with status from the last 7 days, approach and comparison figures', () => {
  const rows = [
    row('2026-09-02', 'G', 'Native Targeting|Playbooks', { spend: 100, impressions: 10000, clicks: 50, reach: 9000, leads: 4 }),
    row('2026-09-20', 'G', 'Native Targeting|Playbooks', { spend: 100, impressions: 10000, clicks: 50, reach: 9000, leads: 6 }),
    row('2026-09-02', 'G', 'Custom Aud|Playbooks', { spend: 300, impressions: 5000, clicks: 10, leads: 1 }),
    row('2026-09-10', 'G', 'ANI|Conversation', { ad_name: 'Ani: quick question', spend: 50, sends: 100, opens: 40, clicks: 2 }),
  ];
  const prevRows = [row('2026-08-10', 'G', 'Native Targeting|Playbooks', { spend: 50, impressions: 4000, leads: 5 })];
  const sets = A.adSets(rows, { to: '2026-09-24', prevRows });
  assert.deepEqual(sets.map(s => s.name), ['Custom Aud|Playbooks', 'Native Targeting|Playbooks', 'ANI|Conversation'], 'largest spend first');
  const nat = sets[1];
  assert.equal(nat.status, 'Active'); assert.equal(nat.approach, 'Native'); assert.equal(nat.cpm, 10); assert.equal(nat.ctr, 0.5); assert.equal(nat.cpl, 20); assert.equal(nat.reach, 18000);
  assert.deepEqual({ spend: nat.prev.spend, leads: nat.prev.leads, cpl: nat.prev.cpl }, { spend: 50, leads: 5, cpl: 10 });
  assert.equal(sets[0].status, 'Paused'); assert.equal(sets[0].prev, null);
  const msg = sets[2]; assert.equal(msg.open_rate, 40); assert.equal(msg.cpm, null); assert.equal(msg.ctr, null);
  assert.equal(A.adSets(rows).find(s => s.name === 'Native Targeting|Playbooks').status, 'Active', 'without a range the last day with rows is the end');
});

test('scorecard: approaches graded against the medians, message-only approaches get no grade', () => {
  const mk = (name, spend, impressions, clicks, leads = 0, sends = 0) => ({ name, approach: A.approachOf(name), spend, impressions, clicks, leads, sends, opens: sends / 2 });
  const sets = [mk('Native A', 100, 10000, 100), mk('Native B', 100, 10000, 100), mk('Custom list A', 300, 5000, 50, 1), mk('Retargeting A', 50, 10000, 20), mk('Combined A', 200, 4000, 8), mk('ANI|Conversation', 50, 0, 0, 0, 100)];
  const S = A.scorecard(sets);
  const by = Object.fromEntries(S.rows.map(r => [r.approach, r]));
  assert.deepEqual(S.rows.map(r => r.approach), ['Custom list', 'Native', 'Combined', 'Retargeting', 'Other']);
  assert.equal(by.Native.sets, 2); assert.equal(by.Native.impressions, 20000); assert.equal(by.Native.ctr, 1); assert.equal(by.Native.cpm, 10);
  assert.equal(by['Custom list'].cpm, 60); assert.equal(by['Custom list'].cpl, 300);
  assert.equal(S.median_ctr, 0.6, 'CTRs 0.2, 0.2, 1, 1'); assert.equal(S.median_cpm, 30, 'CPMs 5, 10, 50, 60');
  assert.equal(by.Native.grade, 'A'); assert.equal(by['Custom list'].grade, 'B'); assert.equal(by.Retargeting.grade, 'B'); assert.equal(by.Combined.grade, 'C');
  assert.equal(by.Other.grade, null); assert.match(by.Other.verdict, /Message ads only/);
  assert.match(by.Native.verdict, /more budget/); assert.match(by['Custom list'].verdict, /Widen the audience/); assert.match(by.Retargeting.verdict, /Refresh the creative/); assert.match(by.Combined.verdict, /Pause or rebuild/);
  assert.ok(!/—/.test(S.rows.map(r => r.verdict).join(' ')), 'no em dashes in copy');
  assert.equal(A.scorecard([mk('Only one', 10, 1000, 5)]).rows[0].grade, 'A', 'a single approach equals its own medians');
});

test('senderOf: "Name:" prefix, known first word, else Unknown sender; first matching name wins', () => {
  assert.equal(A.senderOf('Ani: quick question about your practice'), 'Ani');
  assert.equal(A.senderOf('JESSICA: a note from Lyzr'), 'Jessica');
  assert.equal(A.senderOf('Jessica Chen: a note'), 'Jessica Chen');
  assert.equal(A.senderOf('Agentic AI Roadmap: the 90-day plan'), 'Unknown sender', 'three-word prefixes are titles, not senders');
  assert.equal(A.senderOf("ANI|Priority Acc|GSI/SI- 3 July'26"), 'Ani');
  assert.equal(A.senderOf('Siva video', ''), 'Siva');
  assert.equal(A.senderOf('Book a demo', "Jessica|Priority Acc|GSI/SI- 9 July'26"), 'Jessica', 'falls through to the ad set name');
  assert.equal(A.senderOf('Book a demo', 'GSI&SI|Book a demo'), 'Unknown sender');
  assert.equal(A.senderOf(null, undefined), 'Unknown sender');
});

test('messagingBySender: rows with sends grouped by sender then ad set', () => {
  const rows = [
    row('2026-09-01', 'Conv', "GSI&SI|ANI|Conversation Ads|Lead Gen- 26 Aug'26", { ad_name: 'Ani: quick question', spend: 100, sends: 200, opens: 100, clicks: 10, leads: 2 }),
    row('2026-09-02', 'Conv', "GSI&SI|ANI|Conversation Ads|Lead Gen- 4 Sept'26", { ad_name: 'Ani: quick question', spend: 50, sends: 100, opens: 60, clicks: 3 }),
    row('2026-09-02', 'Conv', "Jessica|Priority Acc|GSI/SI- 9 July'26", { ad_name: 'A note from Lyzr', spend: 40, sends: 80, opens: 20, clicks: 1 }),
    row('2026-09-02', 'Awareness', 'Brand|Video', { ad_name: 'Siva video', spend: 500, impressions: 10000 }),
  ];
  const S = A.messagingBySender(rows);
  assert.deepEqual(S.map(s => [s.sender, s.sends, s.sets.length]), [['Ani', 300, 2], ['Jessica', 80, 1]], 'no sends means not a messaging ad');
  const ani = S[0];
  assert.equal(ani.opens, 160); assert.equal(Math.round(ani.open_rate * 100) / 100, 53.33); assert.equal(ani.clicks, 13); assert.equal(ani.leads, 2); assert.equal(ani.cpl, 75); assert.equal(Math.round(ani.click_to_open * 10) / 10, 8.1);
  assert.equal(ani.sets[0].name, "GSI&SI|ANI|Conversation Ads|Lead Gen- 26 Aug'26"); assert.equal(ani.sets[0].open_rate, 50); assert.equal(ani.sets[1].leads, 0);
  assert.equal(S[1].sets[0].ad_name, 'A note from Lyzr');
  assert.deepEqual(A.messagingBySender([]), []);
});

test('creativeAudience: top creatives by impressions with titles and countries of their ad set', () => {
  const perf = [
    row('2026-09-01', 'G', 'Native|Playbooks', { ad_id: '1', ad_name: 'Roadmap', impressions: 9000, clicks: 90, spend: 90, leads: 3 }),
    row('2026-09-01', 'G', 'Custom Aud|Playbooks', { ad_id: '2', ad_name: 'Enterprise', impressions: 4000, clicks: 20, spend: 80 }),
    row('2026-09-01', 'G', 'Conv', { ad_id: '3', ad_name: 'Ani: hi', sends: 100, opens: 50, spend: 10 }),
  ];
  const demo = [
    { segment: 'Job Title', value: 'Partner', campaign: 'Native|Playbooks', impressions: 300 }, { segment: 'Job Title', value: 'Director', campaign: 'Native|Playbooks', impressions: 700 },
    { segment: 'Country', value: 'India', campaign: 'Native|Playbooks', impressions: 800 }, { segment: 'Country', value: 'United States', campaign: 'Native|Playbooks', impressions: 200 },
    { segment: 'Job Title', value: 'Manager', campaign: '', impressions: 5000 },
  ];
  const R = A.creativeAudience(perf, demo, { top: 2 });
  assert.equal(R.has_split, true);
  assert.deepEqual(R.creatives.map(c => c.ad_name), ['Roadmap', 'Enterprise']);
  const r = R.creatives[0];
  assert.equal(r.has_rows, true); assert.equal(r.ctr, 1); assert.equal(r.leads, 3);
  assert.deepEqual(r.titles.map(t => [t.value, t.impressions, t.share]), [['Director', 700, 70], ['Partner', 300, 30]]);
  assert.deepEqual(r.countries.map(t => t.value), ['India', 'United States']);
  assert.equal(R.creatives[1].has_rows, false, 'no demographics rows for that ad set');
  const none = A.creativeAudience(perf, demo.filter(d => !d.campaign));
  assert.equal(none.has_split, false); assert.ok(none.creatives.every(c => !c.has_rows && c.titles.length === 0));
  assert.equal(A.creativeAudience(perf, demo, { top: 5 }).creatives.length, 3, 'message ads are included by sends when impressions are zero');
});

test('assetCompanySplit: account x approach from company rows that carry a campaign', () => {
  const accounts = [{ name: 'Accenture', aliases: ['Accenture in India'] }, { name: 'KPMG', aliases: ['KPMG US'] }];
  const demo = [
    { segment: 'Company', value: 'Accenture', campaign: 'Native|Playbooks', impressions: 1000, clicks: 10 },
    { segment: 'Company', value: 'Accenture in India', campaign: 'Native Heatmap|Awareness', impressions: 1000, clicks: 30 },
    { segment: 'Company', value: 'Accenture', campaign: 'Custom Aud|Playbooks', impressions: 200, clicks: 1 },
    { segment: 'Company', value: 'KPMG US', campaign: 'Custom Aud|Playbooks', impressions: 500, clicks: 5 },
    { segment: 'Company', value: 'IBM', campaign: 'Native|Playbooks', impressions: 300, clicks: 3 },
    { segment: 'Company', value: 'Microsoft', campaign: 'Native|Playbooks', impressions: 100, clicks: 0 },
    { segment: 'Company', value: 'Deloitte', campaign: '', impressions: 9999, clicks: 99 },
    { segment: 'Job Title', value: 'Partner', campaign: 'Native|Playbooks', impressions: 50 },
  ];
  const R = A.assetCompanySplit(demo, accounts);
  assert.equal(R.has_split, true);
  assert.deepEqual(R.companies, ['Accenture', 'KPMG', 'Other'], 'by impressions, Other last; rows without a campaign are ignored');
  assert.deepEqual(R.approaches, ['Custom list', 'Native']);
  const a = R.at('Accenture', 'Native'); assert.equal(a.impressions, 2000); assert.equal(a.clicks, 40); assert.equal(a.ctr, 2); assert.deepEqual(a.sets.sort(), ['Native Heatmap|Awareness', 'Native|Playbooks']);
  assert.equal(R.at('Accenture', 'Custom list').impressions, 200);
  assert.equal(R.at('Other', 'Native').impressions, 400); assert.equal(R.at('Other', 'Custom list'), null);
  assert.equal(R.at('KPMG', 'Native'), null);
  const none = A.assetCompanySplit(demo.filter(d => !d.campaign), accounts);
  assert.equal(none.has_split, false); assert.deepEqual(none.companies, []); assert.deepEqual(none.cells, []);
  const withMsg = A.assetCompanySplit([...demo, { segment: 'Company', value: 'KPMG', campaign: 'ANI|Conversation', impressions: 0, sends: 40 }], accounts);
  assert.deepEqual(withMsg.approaches, ['Custom list', 'Native'], 'a message-only approach makes no column');
});

test('reachVsContacts: est. reach = impressions / frequency, contacts matched to accounts, hint when no lists', () => {
  const accounts = [{ name: 'Accenture', aliases: ['Accenture in India'] }, { name: 'KPMG', aliases: ['KPMG US'] }, { name: 'Fujitsu', aliases: [] }];
  const demo = [
    { segment: 'Company', value: 'Accenture', campaign: 'Native', impressions: 3000, clicks: 30 }, { segment: 'Company', value: 'Accenture in India', impressions: 3000, clicks: 30 },
    { segment: 'Company', value: 'KPMG US', impressions: 900, clicks: 9 }, { segment: 'Company', value: 'IBM', impressions: 600, clicks: 6 }, { segment: 'Company', value: 'Freelance', impressions: 300, clicks: 1 },
    { segment: 'Country', value: 'India', impressions: 9999 },
  ];
  const R = A.reachVsContacts(demo, accounts, { contact_lists: { Accenture: 1000, 'KPMG US': 600, Fujitsu: 400 }, frequency: 3 });
  assert.equal(R.has_contacts, true);
  assert.deepEqual(R.rows.map(r => r.company), ['Accenture', 'KPMG', 'Fujitsu', 'Other pages'], 'named accounts first, accounts with a list but no impressions still listed, unmatched pages grouped last');
  const acc = R.rows[0]; assert.equal(acc.impressions, 6000); assert.equal(acc.est_reach, 2000); assert.equal(acc.contacts, 1000); assert.equal(acc.ratio, 2); assert.equal(acc.clicks, 60);
  const k = R.rows[1]; assert.equal(k.contacts, 600, 'contact list keys are matched like page names'); assert.equal(k.est_reach, 300); assert.equal(k.ratio, 0.5);
  const fj = R.rows[2]; assert.equal(fj.impressions, 0); assert.equal(fj.ratio, 0, 'a list with no impressions reached nobody');
  const other = R.rows[3]; assert.equal(other.impressions, 900); assert.equal(other.contacts, null); assert.equal(other.matched, false);
  assert.equal(R.total.impressions, 7800); assert.equal(R.total.contacts, 2000); assert.equal(R.total.est_reach, 2600); assert.equal(R.total.ratio, 1.3);
  const noLists = A.reachVsContacts(demo, accounts, { frequency: 3 });
  assert.equal(noLists.has_contacts, false); assert.ok(noLists.rows.every(r => r.contacts === null && r.ratio === null)); assert.equal(noLists.total.contacts, null);
  assert.deepEqual(noLists.rows.map(r => r.company), ['Accenture', 'KPMG', 'Other pages']);
  assert.equal(A.reachVsContacts(demo, accounts, { contact_lists: {}, frequency: 0 }).frequency, 3, 'empty object counts as no lists, frequency falls back to 3');
});

test('geoSeniority: region x seniority per audience, estimated from the two one-dimensional lists', () => {
  const regions = { India: ['India'], 'North America': ['United States', 'Canada'] };
  const aud = (campaign, k) => [
    { segment: 'Country', value: 'India', campaign, impressions: 800 * k, clicks: 8 * k }, { segment: 'Country', value: 'United States', campaign, impressions: 200 * k, clicks: 4 * k },
    { segment: 'Job Seniority', value: 'Director', campaign, impressions: 600 * k, clicks: 6 * k }, { segment: 'Job Seniority', value: 'CXO', campaign, impressions: 100 * k, clicks: 3 * k }, { segment: 'Job Seniority', value: 'Senior', campaign, impressions: 300 * k, clicks: 3 * k },
  ];
  const G = A.geoSeniority([...aud('Native|Playbooks', 1), ...aud('Custom Aud|Playbooks', 2)], { regions });
  assert.equal(G.split, true); assert.equal(G.estimated, true);
  assert.deepEqual(G.audiences.map(a => [a.name, a.approach, a.total]), [['Custom Aud|Playbooks', 'Custom list', 2000], ['Native|Playbooks', 'Native', 1000]], 'largest audience first');
  const nat = G.audiences[1];
  assert.deepEqual(nat.regions, ['India', 'North America']);
  assert.deepEqual(nat.seniorities, ['Senior', 'Director', 'CXO'], 'seniority in career order');
  assert.equal(nat.cells.India.Director, 480, '800 x 600 / 1000'); assert.equal(nat.cells['North America'].CXO, 20);
  assert.equal(nat.regionTotal.India, 800); assert.equal(nat.senTotal.Director, 600);
  const clicks = A.geoSeniority(aud('Native|Playbooks', 1), { regions, metric: 'clicks' }).audiences[0];
  assert.equal(clicks.total, 12); assert.equal(clicks.cells.India.CXO, 2, '8 x 3 / 12');
  const all = A.geoSeniority(aud('', 1), { regions });
  assert.equal(all.split, false); assert.equal(all.audiences.length, 1); assert.equal(all.audiences[0].name, A.ALL_AUDIENCES); assert.equal(all.audiences[0].approach, null); assert.equal(all.audiences[0].cells.India.Director, 480);
  const noSen = A.geoSeniority([{ segment: 'Country', value: 'India', impressions: 100 }], { regions }).audiences[0];
  assert.equal(noSen.total, 0, 'needs both lists');
  assert.equal(A.geoSeniority([], { regions }).audiences[0].total, 0);
  const withMsg = A.geoSeniority([...aud('Native|Playbooks', 1), { segment: 'Company', value: 'KPMG', campaign: 'ANI|Conversation', sends: 40 }], { regions });
  assert.deepEqual(withMsg.audiences.map(a => a.name), ['Native|Playbooks'], 'message-only ad sets are not audiences');
});

test('penetrationCube: company x region x band, cumulative over windows', () => {
  const accounts = [{ name: 'EY', aliases: ['EY'] }];
  const icp_pool = [{ company: 'EY', country: 'India', md: 1000, md1: 2000, md2: 3000 }, { company: 'EY', country: 'United States', md: 500, md1: 500, md2: 500 }, { company: 'EY', country: 'Saudi Arabia', md: 100, md1: 100, md2: 100 }];
  const bands = { global: { MD: ['Partner'], MD1: ['Vice President'], MD2: ['Senior Manager'] } };
  const regions = { India: ['India'], 'United States': ['United States'], 'Middle East': ['Saudi Arabia', 'United Arab Emirates'] };
  const rows = [
    { segment: 'Company', value: 'EY', impressions: 7000 },
    { segment: 'Country', value: 'India', impressions: 800 }, { segment: 'Country', value: 'United States', impressions: 200 },
    { segment: 'Job Title', value: 'Partner', impressions: 50 }, { segment: 'Job Title', value: 'Vice President', impressions: 25 }, { segment: 'Job Title', value: 'Senior Manager', impressions: 25 },
  ];
  // two identical windows: cumulative = double
  const C = A.penetrationCube({ windows: [{ rows }, { rows }], accounts, icp_pool, bands, frequency: 3.5, regions });
  assert.equal(C.accounts.length, 1);
  const ey = C.accounts[0];
  assert.equal(Math.round(ey.regions.India.MD.reached), 1600);         // 2 x (7000 x .8 x .5 / 3.5)
  assert.equal(ey.regions.India.MD.pool, 1000);
  assert.equal(Math.round(ey.regions.India.MD.pct), 160);              // more people reached than the pool: frequency-based estimate, shown as is
  assert.equal(Math.round(ey.regions['United States'].All.reached), 800); // 2 x (7000 x .2 / 3.5)
  assert.equal(ey.regions['United States'].All.pool, 1500);
  assert.equal(Math.round(ey.total.All.reached), 4000);
  assert.equal(ey.total.All.pool, 7800);                                 // whole-company pool, Middle East included although nobody was reached there
  assert.equal(ey.regions['Middle East'].All.pct, 0); assert.equal(ey.regions['Middle East'].All.pool, 300);
  assert.deepEqual(C.regions, ['India', 'United States', 'Middle East']);
  // reach in a country with no pool row still counts as people reached (no pct)
  const C2 = A.penetrationCube({ windows: [{ rows: [...rows.filter(r => r.segment !== 'Country'), { segment: 'Country', value: 'India', impressions: 500 }, { segment: 'Country', value: 'Germany', impressions: 500 }] }], accounts, icp_pool, bands, frequency: 3.5, regions: { ...regions, Europe: ['Germany'] } });
  assert.equal(Math.round(C2.accounts[0].total.All.reached), 2000);
  assert.equal(Math.round(C2.accounts[0].regions.Europe.All.reached), 1000); assert.equal(C2.accounts[0].regions.Europe.All.pct, null);
  assert.deepEqual(C.bands, ['MD', 'MD-1', 'MD-2']);
});

test('lead types: conversation, MQL (book a demo), playbook, other (NQL)', () => {
  assert.equal(A.leadTypeOf({ campaign: 'GSI&SI|ANI|Conversation Ads', format: 'Conversation ad' }), 'conversation');
  assert.equal(A.leadTypeOf({ campaign: 'Jessica|GSI|Demo offer', format: 'Single image', sends: 40 }), 'conversation');   // sends = messaging ad set
  assert.equal(A.leadTypeOf({ campaign: 'WP|Accenture|Anju|India|Book a Demo|GSI&SI' }), 'mql');
  assert.equal(A.leadTypeOf({ campaign: 'Custom Aud|GSI&SI|Playbooks|Lead Gen- 1/09/26' }), 'playbook');
  assert.equal(A.leadTypeOf({ campaign: 'Marketers both|GSI&SI|Lead Gen', campaign_group: 'Brand' }), 'other');
  assert.equal(A.leadTypeOf({ campaign: 'X', ad_name: 'Agentic AI Roadmap: the 90-day plan' }), 'playbook');            // asset name counts
  assert.equal(A.leadTypeOf({ campaign: 'Something' }, { mql: ['something'] }), 'mql');                                  // Admin rules
  const rows = [
    { day: '2026-09-01', campaign: 'A|Book a demo', leads: 3, spend: 90 }, { day: '2026-09-02', campaign: 'A|Book a demo', leads: 1, spend: 10 },
    { day: '2026-09-01', campaign: 'B|Playbooks', leads: 10, spend: 200 }, { day: '2026-09-08', campaign: 'C|Conversation Ads', sends: 100, leads: 2, spend: 50 },
    { day: '2026-09-08', campaign: 'D|Marketers both', leads: 4, spend: 40 },
  ];
  const S = A.leadSplit(rows);
  assert.equal(S.total, 20);
  assert.deepEqual(S.types.map(t => [t.type, t.leads, Math.round(t.spend)]), [['mql', 4, 100], ['conversation', 2, 50], ['playbook', 10, 200], ['other', 4, 40]]);
  assert.equal(S.byType.mql.cpl, 25); assert.equal(S.byType.playbook.share, 50); assert.equal(S.byType.mql.stage, 'BoFu'); assert.equal(S.byType.other.stage, 'ToFu');
  assert.equal(S.byType.mql.campaigns[0].name, 'A|Book a demo');
  const T = A.leadTrend(rows, 'week');
  assert.deepEqual(T.buckets, ['2026-08-31', '2026-09-07']); assert.deepEqual(T.series.mql, [4, 0]); assert.deepEqual(T.series.other, [0, 4]);
});

test('senderOf reads the sender from pipe-separated ad set names', () => {
  assert.equal(A.senderOf('WP|Jessica|GSI&SI|Website visits - Jun 10, 2026'), 'Jessica');
  assert.equal(A.senderOf("ANI|Priority Acc|GSI/SI- 3 July'26"), 'Ani');
  assert.equal(A.senderOf('WP|Accenture|Anju|India|Lead Gen|GSI&SI - Apr 27, 2026'), 'Anju');
  assert.equal(A.senderOf('Nvidia & AWS Post Amplification'), 'Unknown sender');
  assert.deepEqual(A.segmentsPresent([{ segment: 'Company' }, { segment: 'Company' }, { segment: '' }]), ['Company']);
});

test('personFromText finds the team member in a file or ad set name', () => {
  assert.equal(A.personFromText('Sept_Anju_Company Demographics.csv'), 'Anju');
  assert.equal(A.personFromText('ANI post amplification - Job Title.csv'), 'Ani');
  assert.equal(A.personFromText('September_Demographics Report.csv'), '');
});

test('byPerson: brand and engagement numbers per team member from ad set names', () => {
  const rows = [
    { day: '2026-08-04', campaign: 'ANJU & SIVA|GSI&SI|Single Image Ads|Awareness', impressions: 1000, clicks: 20, engagements: 50, spend: 30 },
    { day: '2026-08-05', campaign: "ANI|GSI&SI|Video Ads|Awareness", impressions: 500, clicks: 5, engagements: 40, video_views: 300, spend: 20 },
    { day: '2026-08-05', campaign: 'Playbooks|GSI&SI|Lead Gen', impressions: 2000, clicks: 30, engagements: 10, leads: 3, spend: 100 },
  ];
  assert.deepEqual(A.peopleIn('ANJU & SIVA|GSI&SI'), ['Anju', 'Siva']);
  const P = A.byPerson(rows);
  assert.deepEqual(P.people.map(p => p.person), ['Anju', 'Siva', 'Ani']);
  assert.equal(P.people[0].engagements, 50); assert.equal(P.people[0].eng_rate, 5);
  assert.equal(P.people[2].video_views, 300); assert.equal(P.people[2].ad_sets[0].name, 'ANI|GSI&SI|Video Ads|Awareness');
  assert.equal(P.unattributed.leads, 3);
});

test('activeWindows (front end mirror): overlapping windows of one breakdown collapse to the newest', () => {
  const w = (id, start, end, at, notes = 'Company') => ({ upload: { id, period_start: start, period_end: end, uploaded_at: at, notes }, rows: [{ segment: 'Company', value: 'EY', impressions: 1 }] });
  const out = A.activeWindows([w('a', '2026-09-01', '2026-09-30', '2026-10-01'), w('b', '2026-09-01', '2026-09-30', '2026-10-02'), w('c', '2026-09-15', '2026-09-24', '2026-09-25'), w('d', '2026-09-01', '2026-09-30', '2026-10-02', 'Job Title')]);
  assert.deepEqual(out.map(x => x.upload.id).sort(), ['b', 'd']);
});

test('aggregateRows: a person export beside the all-campaign export is not counted twice', () => {
  const win = (id, start, end, rows) => ({ upload: { id, period_start: start, period_end: end, uploaded_at: '2026-10-01', notes: '' }, rows });
  const all = win('all', '2026-09-01', '2026-09-30', [{ segment: 'Company', value: 'EY', impressions: 100 }, { segment: 'Job Title', value: 'Partner', impressions: 40 }]);
  const anju = win('anju', '2026-09-01', '2026-09-30', [{ segment: 'Company', value: 'EY', impressions: 30, campaign: 'Anju' }, { segment: 'Country', value: 'India', impressions: 25, campaign: 'Anju' }]);
  const rows = A.aggregateRows([all, anju]);
  assert.equal(rows.filter(r => r.segment === 'Company').reduce((a, r) => a + r.impressions, 0), 100);   // Anju's Company rows excluded
  assert.equal(rows.filter(r => r.segment === 'Country').reduce((a, r) => a + r.impressions, 0), 25);    // no untagged Country export: tagged one counts
  assert.equal(A.aggregateRows([anju]).length, 2);                                                        // only a tagged export: it is the data
});
