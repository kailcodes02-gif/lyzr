// node --test Campaign_Analytics/tests/frontend/leads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterOf, spamReason, looksGibberish, companyType, enrich, bucketCounts, withGrowth, bandCounts, crossTab, rowTotal, sourceBreakdown, ownerHealth, actionList, sortRows, toCsv, applyFilters, summary, countBy, sortedEntries } from '../../js/lib/leads-agg.mjs';
import { hubspotMock } from '../../js/mock/hubspot.mjs';
import { linkedinMock } from '../../js/mock/linkedin.mjs';
import accounts from '../../seed/accounts.json' with { type: 'json' };

const NOW = Date.parse('2026-09-30T06:00:00Z');
const c = (o) => ({ hs_id: 'x', email: 'a@b.com', first_name: 'A', last_name: 'B', company_raw: 'Acme', account: null, jobtitle: 'CTO', band: 'MD', country: 'India', region: 'India', source: 'PAID_SOCIAL', lead_source: 'LinkedIn Ads (GSI & SI)', lsa_message: 'hi', owner_id: '1', owner_name: 'Anju', created_at: '2026-09-10T05:00:00Z', last_activity_at: null, notes_count: 0, via: [], ...o });

test('clusterOf maps the report sample quotes to their clusters', () => {
  const cases = {
    sales: ['how can we relieve volume from BDRs for inbound leads and move to AI agents', "Looking for AI agent to help with prospecting in certain rev bands that we don't have SDR coverage", 'AI SDR doing account-level thinking replacing the traditional SDR'],
    demo: ['Capability Overview and Demo', 'Discovery Call', 'I want to see how it works', 'Want to know what it is exactly and how does it work'],
    hr: ['Run my entire HR Organisation from Hire to retire on AI', 'AI demo for HR processes - recruitment, onboarding, L&D', 'Exploring use cases for HR operations and automating repetitive tasks'],
    marketing: ['Use of agentic AI in Marketing and content creation', 'automate posts for LinkedIn', 'AI agents for Google Ads, Facebook Ads, SEO, and GA4'],
    cs: ['RFI on Agentic AI Orchestration for Customer Service department', 'Customer Service and Collections', 'provide great experience to the customer through its support'],
    finance: ['AI agents built secure and compliant to automate complex enterprise workflows in Banking', 'Claim Processing and Credit underwriting agents', 'Work flow management in banking', 'AI Agents for financial forecasting'],
    platform: ['Enterprise agentic framework to replace AI Foundry', 'exploring Agentic AI platforms to build agents for clients in the region', 'Team workspace for AI Agents'],
    workflow: ['Looking at Sales, marketing and customer support automation', 'help me with logistics operations, inside sales, ops support and reconciliation', 'supplier discovery agent for manufacturing'],
    exploring: ['New to this, Exploring', 'Experimenting - we are a startup based in Sydney & Hong Kong', 'Interested', 'Create them'],
    vertical: ['build an AI agent for the automotive space', 'M&A', 'Demo on Regulatory Monitoring Agent', 'agent for developer tools', 'Video generation AI'],
  };
  for (const [want, msgs] of Object.entries(cases)) for (const m of msgs) assert.equal(clusterOf(m), want, `"${m}" should be ${want}`);
  assert.equal(clusterOf(''), null); assert.equal(clusterOf(null), null); assert.equal(clusterOf('   '), null);
});

test('spamReason applies the report heuristics and leaves real leads alone', () => {
  assert.equal(spamReason(c({ email: 'qa@lyzr.ai', company_raw: 'Lyzr' })), 'internal test');
  assert.equal(spamReason(c({ email: 'x@lyzrteam.com' })), 'internal test');
  assert.equal(spamReason(c({ email: 'p@example.com', company_raw: 'wOw Precision Health' })), 'internal test');
  assert.equal(spamReason(c({ first_name: 'asdfgh', last_name: 'asd', email: 'a@gmail.com', company_raw: 'asdfgh', lsa_message: 'qwerty' })), 'gibberish');
  assert.equal(spamReason(c({ email: 'me@gmail.com', company_raw: '', lsa_message: 'i want job' })), 'personal email, no company');
  assert.equal(spamReason(c({ lsa_message: 'We provide staff augmentation services for AI teams.' })), 'vendor pitch');
  assert.equal(spamReason(c({ email: 'soubhik@infosys.com', company_raw: 'Infosys', lsa_message: 'Capability Overview and Demo' })), null);
  assert.equal(spamReason(c({ email: 'jane@gmail.com', company_raw: 'Butter Insurance', lsa_message: 'Customer support agent' })), null, 'gmail with a real company is kept');
  assert.equal(looksGibberish('Priya'), false); assert.equal(looksGibberish('xkjhq'), true); assert.equal(looksGibberish('aaaaaa'), true);
});

test('companyType uses accounts.json categories, unmatched = Not a target account', () => {
  assert.equal(companyType(c({ account: 'EY' }), accounts), 'Big Four');
  assert.equal(companyType(c({ account: 'Accenture' }), accounts), 'Global SI');
  assert.equal(companyType(c({ account: 'Infosys' }), accounts), 'Indian IT / BPM');
  assert.equal(companyType(c({ account: 'McKinsey & Company' }), accounts), 'MBB / Strategy');
  assert.equal(companyType(c({ account: 'Protiviti' }), accounts), 'Advisory');
  assert.equal(companyType(c({ account: null, company_raw: 'RingCentral' }), accounts), 'Not a target account');
});

test('bucketCounts groups by day, week and month with band totals; withGrowth compares periods', () => {
  const rows = [c({ created_at: '2026-09-01T10:00:00Z', band: 'MD' }), c({ created_at: '2026-09-02T10:00:00Z', band: 'MD-1' }), c({ created_at: '2026-09-09T10:00:00Z', band: 'MD-2' }), c({ created_at: '2026-09-09T12:00:00Z', band: 'Other' }), c({ created_at: '2026-08-30T10:00:00Z', band: 'Zzz' })];
  const enriched = enrich(rows, {}, accounts);
  const byMonth = bucketCounts(enriched, 'month');
  assert.deepEqual(byMonth.map(b => [b.key, b.total]), [['2026-08', 1], ['2026-09', 4]]);
  assert.equal(byMonth[1].MD, 1); assert.equal(byMonth[1]['MD-1'], 1); assert.equal(byMonth[1]['MD-2'], 1); assert.equal(byMonth[1].Other, 1); assert.equal(byMonth[0].Unknown, 1, 'unknown band strings count as Unknown');
  const byWeek = bucketCounts(enriched, 'week');
  assert.deepEqual(byWeek.map(b => [b.key, b.total]), [['2026-08-24', 1], ['2026-08-31', 2], ['2026-09-07', 2]], 'weeks start on Monday');
  const byDay = bucketCounts(enriched, 'day');
  assert.equal(byDay.find(b => b.key === '2026-09-09').total, 2);
  assert.equal(byDay.find(b => b.key === '2026-09-10'), undefined, '12:00 UTC on the 9th is 17:30 IST, still the 9th');
  const g = withGrowth(byWeek);
  assert.equal(g[0].growth, null); assert.equal(g[1].growth, 1); assert.equal(g[2].growth, 0);
  assert.deepEqual(bandCounts(enriched), { MD: 1, 'MD-1': 1, 'MD-2': 1, Other: 1, Unknown: 1, total: 5 });
});

test('IST day boundary: 19:00 UTC is next day in IST', () => {
  const rows = enrich([c({ created_at: '2026-09-09T19:00:00Z' })], {}, accounts);
  assert.equal(rows[0].day, '2026-09-10');
});

test('crossTab, sourceBreakdown and countBy', () => {
  const rows = enrich([c({ region: 'India', band: 'MD' }), c({ region: 'India', band: 'MD' }), c({ region: 'United States', band: 'MD-2', account: 'EY', lead_source: 'Organic' }), c({ region: 'India', band: 'Other', lead_source: 'Organic' })], {}, accounts);
  const x = crossTab(rows, r => r.region, r => r.band);
  assert.equal(x.get('India').get('MD'), 2); assert.equal(rowTotal(x.get('India')), 3); assert.equal(x.get('United States').get('MD-2'), 1);
  const src = sourceBreakdown(rows);
  assert.equal(src[0].source, 'LinkedIn Ads (GSI & SI)'); assert.equal(src[0].leads, 2); assert.equal(src[0].MD, 2);
  const org = src.find(s => s.source === 'Organic'); assert.equal(org.leads, 2); assert.equal(org.target, 1); assert.equal(org['MD-2'], 1);
  assert.deepEqual(sortedEntries(countBy(rows, r => r.region)), [['India', 3], ['United States', 1]]);
});

test('ownerHealth and actionList flag idle senior target-account leads', () => {
  const rows = enrich([
    c({ hs_id: '1', account: 'EY', band: 'MD', created_at: '2026-09-01T05:00:00Z', last_activity_at: null }),                       // untouched 29 days -> action
    c({ hs_id: '2', account: 'EY', band: 'MD-1', created_at: '2026-09-01T05:00:00Z', last_activity_at: '2026-09-28T05:00:00Z' }),   // touched 2 days ago -> fine
    c({ hs_id: '3', account: 'EY', band: 'MD-1', created_at: '2026-08-01T05:00:00Z', last_activity_at: '2026-09-10T05:00:00Z' }),   // touched 20 days ago -> action
    c({ hs_id: '4', account: 'EY', band: 'MD-2', created_at: '2026-08-01T05:00:00Z' }),                                              // MD-2 -> not in list
    c({ hs_id: '5', account: null, band: 'MD', created_at: '2026-08-01T05:00:00Z' }),                                                // not target -> not in list
    c({ hs_id: '6', account: 'PwC', band: 'MD', created_at: '2026-09-27T05:00:00Z', owner_id: null, owner_name: null }),             // 3 days old -> not yet
  ], {}, accounts);
  const acts = actionList(rows, NOW, 7);
  assert.deepEqual(acts.map(a => a.hs_id), ['1', '3']);
  assert.equal(acts[0].idleDays, 29); assert.equal(acts[0].touched, false); assert.equal(acts[1].touched, true);
  const oh = ownerHealth(rows, NOW);
  const anju = oh.find(o => o.owner === 'Anju'); assert.equal(anju.leads, 5); assert.equal(anju.active, 2); assert.equal(anju.md, 4);
  assert.equal(anju.lastActivity, '2026-09-28T05:00:00Z');
  assert.equal(Math.round(anju.avgIdleDays), Math.round((29 + 60 + 60) / 3));
  const un = oh.find(o => o.owner === 'Unassigned'); assert.equal(un.leads, 1);
});

test('sortRows: numeric, string and blanks last', () => {
  const rows = [{ n: 2, s: 'b' }, { n: null, s: 'a' }, { n: 10, s: '' }, { n: 1, s: 'C' }];
  assert.deepEqual(sortRows(rows, 'n', 1).map(r => r.n), [1, 2, 10, null]);
  assert.deepEqual(sortRows(rows, 'n', -1).map(r => r.n), [10, 2, 1, null]);
  assert.deepEqual(sortRows(rows, 's', 1).map(r => r.s), ['a', 'b', 'C', '']);
});

test('toCsv quotes commas, quotes and newlines', () => {
  const csv = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'line1\nline2', d: 5 }], [{ k: 'a', h: 'A' }, { k: 'b', h: 'B' }, { k: 'c', h: 'C' }, { k: 'd', h: 'D', f: r => r.d * 2 }]);
  assert.equal(csv, 'A,B,C,D\r\n"x,y","he said ""hi""","line1\nline2",10');
});

test('applyFilters and summary', () => {
  const rows = enrich([c({ hs_id: '1', email: 't@lyzr.ai' }), c({ hs_id: '2', region: 'India', band: 'MD', lsa_message: 'Demo please', owner_name: null, owner_id: null }), c({ hs_id: '3', region: 'APAC', band: 'Other', lsa_message: '', notes_count: 2, account: 'EY' })], {}, accounts);
  assert.equal(applyFilters(rows, { excludeSpam: true }).length, 2);
  assert.equal(applyFilters(rows, { excludeSpam: false }).length, 3);
  assert.deepEqual(applyFilters(rows, { excludeSpam: true, hasMessage: 'yes' }).map(r => r.hs_id), ['2']);
  assert.deepEqual(applyFilters(rows, { excludeSpam: true, hasActivity: 'yes' }).map(r => r.hs_id), ['3']);
  assert.deepEqual(applyFilters(rows, { excludeSpam: true, cluster: 'demo' }).map(r => r.hs_id), ['2']);
  assert.deepEqual(applyFilters(rows, { account: 'Not a target account', excludeSpam: true }).map(r => r.hs_id), ['2']);
  assert.deepEqual(applyFilters(rows, { owner: 'Unassigned' }).map(r => r.hs_id), ['2']);
  assert.deepEqual(applyFilters(rows, { q: 'demo' }).map(r => r.hs_id), ['2']);
  const s = summary(applyFilters(rows, { excludeSpam: true }));
  assert.equal(s.leads, 2); assert.equal(s.withMessage, 1); assert.equal(s.withActivity, 1); assert.equal(s.target, 1); assert.equal(s.md, 1); assert.equal(s.unowned, 1);
});

test('hubspotMock: ~220 contacts, named GSI leads with exact messages, cluster and country mix near the report', () => {
  const { contacts, notes_by_contact, last_sync } = hubspotMock;
  assert.ok(contacts.length >= 200 && contacts.length <= 240, `got ${contacts.length}`);
  assert.ok(last_sync.finished_at && last_sync.status === 'done');
  const rows = enrich(contacts, notes_by_contact, accounts);
  const real = rows.filter(r => !r.spam);
  assert.ok(real.length >= 140 && real.length <= 175, `real ${real.length}`);
  assert.ok(rows.length - real.length >= 45, 'tests and spam are present and detected');
  const named = [['Infosys', 'Capability Overview and Demo'], ['Accenture', 'Explore a potential use case and opportunity'], ['Accenture', 'Security'], ['Deloitte', 'Use of agentic AI in Marketing and content creation'], ['EY', 'Exploring Agentic AI platforms to build Chat, V2V agents for clients in the region'], ['Trace3', 'Request for a solution overview and technical demo with Innovation team'], ['ITC Infotech', 'Great experience to the customer through its support'], ['Firstsource', 'Want to know what it is exactly and how does it work'], ['Datamatics', 'Interested'], ['Team Computers', 'Create them'], ['Shorthills AI', 'Discovery Call']];
  for (const [co, msg] of named) assert.ok(rows.some(r => r.company_raw === co && r.lsa_message === msg && !r.spam), `${co}: "${msg}"`);
  const ey = rows.find(r => r.company_raw === 'EY' && r.country === 'Singapore'); assert.equal(ey.account, 'EY'); assert.equal(ey.band, 'MD'); assert.equal(ey.region, 'APAC');
  const inf = rows.find(r => r.company_raw === 'Infosys'); assert.equal(inf.account, 'Infosys'); assert.equal(inf.band, 'MD-2');
  const clusters = Object.fromEntries(countBy(real.filter(r => r.cluster), r => r.cluster));
  assert.ok(clusters.sales >= 22 && clusters.sales <= 30, `sales ${clusters.sales}`);
  assert.ok(clusters.demo >= 16 && clusters.demo <= 26, `demo ${clusters.demo}`);
  assert.ok(clusters.vertical >= 5 && clusters.vertical <= 10, `vertical ${clusters.vertical}`);
  const india = real.filter(r => r.country === 'India').length / real.length; assert.ok(india > 0.35 && india < 0.5, `india ${india}`);
  const us = real.filter(r => r.country === 'United States').length / real.length; assert.ok(us > 0.18 && us < 0.32, `us ${us}`);
  assert.ok(real.every(r => r.created_at >= '2026-04-01' && r.created_at < '2026-10-01'));
  const withNotes = real.filter(r => r.notes_count > 0).length / real.length; assert.ok(withNotes > 0.2 && withNotes < 0.5, `notes share ${withNotes}`);
  const owners = new Set(real.map(r => r.owner_name).filter(Boolean)); for (const o of ['Anju', 'Praveen S', 'Bharath', 'Kaushik Venkatesan', 'Pooja']) assert.ok(owners.has(o), o);
  assert.ok(rows.every(r => ['MD', 'MD-1', 'MD-2', 'Other', 'Unknown'].includes(r.band)));
  assert.ok(rows.every(r => Array.isArray(r.via)));
  // deterministic
  assert.equal(contacts[0].hs_id, hubspotMock.contacts[0].hs_id);
});

test('linkedinMock has the shape the overview reads (uploads, daily perf rows, demo windows)', () => {
  assert.ok(Array.isArray(linkedinMock.uploads) && Array.isArray(linkedinMock.perf) && Array.isArray(linkedinMock.demo));
  assert.ok(linkedinMock.perf.every(r => r.day && 'impressions' in r && 'spend' in r));
  assert.ok(linkedinMock.perf.some(r => Number(r.leads) > 0), 'some rows carry leads');
  assert.ok(linkedinMock.uploads.every(u => u.uploaded_at && u.kind && u.channel === 'linkedin'));
  assert.ok(linkedinMock.demo.every(d => d.upload && d.upload.period_start && Array.isArray(d.rows)));
});
