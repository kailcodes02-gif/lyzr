// node --test Campaign_Analytics/tests/frontend/leads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterOf, spamReason, looksGibberish, companyType, enrich, bucketCounts, withGrowth, bandCounts, crossTab, rowTotal, sourceBreakdown, ownerHealth, actionList, sortRows, toCsv, applyFilters, summary, countBy, sortedEntries, isReached, isReplied, isDemoBooked, isDemoCompleted, isProspect, funnelFlags, funnelCounts, funnelSource, funnelBySource, funnelByBucket, neverContacted, statusBreakdown, statusLabel, lifecycleLabel, outreachDates, firstContactAt, lastContactAt, repliedAt, median, daysFrom, FUNNEL_KEYS, isFormLead, gsiCampaignsOf, inGsiCampaign, replyType, isHumanReply, replySplit, gsiSplit, gsiCampaignTable } from '../../js/lib/leads-agg.mjs';
import { attachInstantly } from '../../js/mock/hubspot.mjs';
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
  assert.ok(contacts.length >= 200 && contacts.length <= 250, `got ${contacts.length}`);
  assert.ok(last_sync.finished_at && last_sync.status === 'done');
  const rows = enrich(contacts.filter(isFormLead), notes_by_contact, accounts);
  const real = rows.filter(r => !r.spam);
  const nonForm = contacts.filter(r => !isFormLead(r)).length; assert.ok(nonForm >= 10 && nonForm <= 20, `non-form contacts ${nonForm}`);
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

// ---- sales funnel ----------------------------------------------------------------------------
const stages = o => { const f = funnelFlags(c(o)); return FUNNEL_KEYS.filter(k => k !== 'generated' && f[k]); };

test('funnel: demo booked, completed and prospect from hs_lead_status (case-insensitive) and lifecyclestage', () => {
  assert.deepEqual(stages({ lead_status: 'OPEN' }), []);
  assert.deepEqual(stages({ lead_status: 'Working' }), []);
  assert.deepEqual(stages({ lead_status: 'Demo Booked' }), ['booked']);
  assert.deepEqual(stages({ lead_status: 'demo booked' }), ['booked'], 'case does not matter');
  assert.deepEqual(stages({ lead_status: 'Demo no show' }), ['booked']);
  assert.deepEqual(stages({ lead_status: 'Demo Cancelled by Client' }), ['booked']);
  assert.deepEqual(stages({ lead_status: 'Intro Call Booked' }), ['booked']);
  assert.deepEqual(stages({ lead_status: 'Intro Call No-Show' }), ['booked']);
  for (const s of ['Demo Completed', 'Demo Completed - PLG', 'Demo Completed - Disqualified', 'Demo Completed - Ghosting', 'Intro Call Completed', 'Intro Qualified', 'Intro Disqualified']) assert.deepEqual(stages({ lead_status: s }), ['booked', 'completed'], s);
  assert.deepEqual(stages({ lead_status: 'Associated with a deal' }), ['booked', 'prospect']);
  assert.deepEqual(stages({ lead_status: 'Junk Lead' }), []); assert.deepEqual(stages({ lead_status: 'UNQUALIFIED' }), []); assert.deepEqual(stages({ lead_status: 'Stalled' }), []);
  // lifecycle alone
  assert.deepEqual(stages({ lifecycle: 'lead' }), []);
  assert.deepEqual(stages({ lifecycle: 'marketingqualifiedlead' }), ['booked'], 'MQL = trying to book a demo');
  assert.deepEqual(stages({ lifecycle: 'opportunity' }), ['booked', 'prospect'], 'opportunity is labelled SQL in the portal');
  assert.deepEqual(stages({ lifecycle: '249550600' }), ['booked', 'prospect'], 'the custom Opportunity stage');
  assert.deepEqual(stages({ lifecycle: 'customer' }), ['booked', 'prospect']);
  assert.deepEqual(stages({ lifecycle: '242934529' }), [], 'Discarded'); assert.deepEqual(stages({ lifecycle: '1331052807' }), [], 'Disqualified'); assert.deepEqual(stages({ lifecycle: 'subscriber' }), []);
  // both: a completed demo at a customer
  assert.deepEqual(stages({ lead_status: 'Demo Completed', lifecycle: 'customer' }), ['booked', 'completed', 'prospect']);
  assert.equal(isDemoBooked(c({ lead_status: 'Demo Completed' })), true); assert.equal(isDemoCompleted(c({ lead_status: 'Demo Booked' })), false); assert.equal(isProspect(c({ lead_status: 'Demo Completed' })), false);
});

test('funnel: reached out and replied from num_contacted_notes, notes_last_contacted, logged touches and sales email replies', () => {
  assert.equal(isReached(c({})), false);
  assert.equal(isReached(c({ props: { num_contacted_notes: '2' } })), true, 'HubSpot number of times contacted');
  assert.equal(isReached(c({ props: { notes_last_contacted: '1757500000000' } })), true, 'HubSpot last contacted as epoch ms');
  assert.equal(isReached(c({ last_activity_at: '2026-09-12T05:00:00Z', last_activity_type: 'CALL' })), true);
  assert.equal(isReached(c({ last_activity_at: '2026-09-12T05:00:00Z', last_activity_type: 'NOTE' })), false, 'a note alone is not outreach');
  assert.equal(isReached(c({ last_activity_at: '2026-09-12T05:00:00Z', last_activity_type: 'TASK' })), false);
  assert.equal(isReached(c({ notes: [{ kind: 'note', created_at: '2026-09-12T05:00:00Z' }] })), false);
  assert.equal(isReached(c({ notes: [{ kind: 'email', created_at: '2026-09-12T05:00:00Z' }] })), true);
  assert.equal(isReached(c({ props: { hs_sales_email_last_replied: '2026-09-14T05:00:00Z' } })), true, 'a reply implies we wrote');
  assert.equal(isReplied(c({ props: { num_contacted_notes: 3 } })), false);
  assert.equal(repliedAt(c({ props: { hs_sales_email_last_replied: '2026-09-14T05:00:00Z' } })), '2026-09-14T05:00:00.000Z');
  assert.equal(repliedAt(c({ last_activity_at: '2026-09-14T05:00:00Z', last_activity_type: 'INCOMING_EMAIL' })), '2026-09-14T05:00:00.000Z');
  const r = c({ created_at: '2026-09-10T05:00:00Z', props: { notes_last_contacted: '2026-09-16T05:00:00Z' }, notes: [{ kind: 'call', created_at: '2026-09-12T05:00:00Z' }, { kind: 'note', created_at: '2026-09-11T05:00:00Z' }] });
  assert.deepEqual(outreachDates(r), ['2026-09-12T05:00:00.000Z', '2026-09-16T05:00:00.000Z']);
  assert.equal(firstContactAt(r), '2026-09-12T05:00:00.000Z'); assert.equal(lastContactAt(r), '2026-09-16T05:00:00.000Z');
  assert.equal(daysFrom(r.created_at, lastContactAt(r)), 6); assert.equal(daysFrom(null, 'x'), null);
  assert.equal(median([]), null); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('funnel: cumulative keeps the chain, raw counts every lead at the stage', () => {
  const rows = [
    c({ hs_id: '1' }),                                                                                              // generated only
    c({ hs_id: '2', props: { num_contacted_notes: 1 } }),                                                            // reached
    c({ hs_id: '3', replies_human: 1, props: { num_contacted_notes: 1, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' } }),       // replied
    c({ hs_id: '4', replies_human: 1, props: { num_contacted_notes: 2, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' }, lead_status: 'Demo Booked' }),
    c({ hs_id: '5', replies_human: 2, props: { num_contacted_notes: 2, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' }, lead_status: 'Demo Completed' }),
    c({ hs_id: '6', replies_human: 1, replies_auto: 1, props: { num_contacted_notes: 2, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' }, lead_status: 'Demo Completed', lifecycle: 'opportunity' }),
    c({ hs_id: '7', lead_status: 'Demo Completed' }),                                                               // completed with nothing logged before it
    c({ hs_id: '8', lifecycle: 'customer', props: { num_contacted_notes: 1 } }),                                     // prospect, booked by lifecycle, never replied
  ];
  const F = funnelCounts(rows);
  assert.equal(F.generated, 8);
  assert.deepEqual(F.cumulative, { generated: 8, reached: 6, replied: 4, booked: 3, completed: 2, prospect: 1 });
  assert.deepEqual(F.raw, { generated: 8, reached: 6, replied: 4, booked: 5, completed: 3, prospect: 2 }, 'lead 7 is completed but never reached, lead 8 is a prospect that never replied');
  assert.deepEqual(F.steps.map(s => s.key), FUNNEL_KEYS);
  const booked = F.steps.find(s => s.key === 'booked');
  assert.equal(booked.n, 3); assert.equal(booked.raw, 5); assert.equal(booked.ofGenerated, 3 / 8); assert.equal(booked.ofPrev, 3 / 4);
  assert.equal(F.steps[0].ofPrev, null); assert.equal(F.steps[0].ofGenerated, 1);
  const empty = funnelCounts([]); assert.equal(empty.generated, 0); assert.equal(empty.steps[0].ofGenerated, null);
  assert.deepEqual(neverContacted(rows).map(r => r.hs_id), ['1', '7']);
  assert.deepEqual(F.replies, { human: 4, auto: 0, unknown: 0, any: 4 });
  // the same chain with an auto-reply-only lead and an unknown-type reply: neither passes Replied (human)
  const G = funnelCounts([...rows, c({ hs_id: '9', replies_auto: 2, props: { num_contacted_notes: 1, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' } }), c({ hs_id: '10', props: { num_contacted_notes: 1, hs_sales_email_last_replied: '2026-09-12T05:00:00Z' } })]);
  assert.equal(G.cumulative.reached, 8); assert.equal(G.cumulative.replied, 4); assert.equal(G.raw.replied, 4);
  assert.deepEqual(G.replies, { human: 4, auto: 1, unknown: 1, any: 6 });
});

test('funnel: source labels from lead_source first, then the analytics source', () => {
  assert.equal(funnelSource(c({ lead_source: 'Book a Demo' })), 'Book a demo form');
  assert.equal(funnelSource(c({ lead_source: 'LinkedIn' })), 'LinkedIn');
  assert.equal(funnelSource(c({ lead_source: 'LinkedIn Ads (GSI & SI)' })), 'LinkedIn');
  assert.equal(funnelSource(c({ lead_source: 'Contact Us' })), 'Contact us');
  assert.equal(funnelSource(c({ lead_source: '100+ AI Use Cases' })), 'Playbook / asset form');
  assert.equal(funnelSource(c({ lead_source: 'Agentic AI Roadmap Playbook' })), 'Playbook / asset form');
  assert.equal(funnelSource(c({ lead_source: 'OutBound' })), 'Outbound');
  assert.equal(funnelSource(c({ lead_source: 'apollo_import' })), 'Import (Apollo)');
  assert.equal(funnelSource(c({ lead_source: 'AI Summit Dubai 2026' })), 'Events');
  assert.equal(funnelSource(c({ lead_source: '', source: 'ORGANIC_SEARCH' })), 'Organic search');
  assert.equal(funnelSource(c({ lead_source: null, source: 'PAID_SOCIAL', props: { first_conversion_event_name: 'GSI Lead Form' } })), 'GSI form');
  const by = funnelBySource([c({ lead_source: 'LinkedIn', props: { num_contacted_notes: 1 } }), c({ lead_source: 'LinkedIn', lead_status: 'Demo Completed' }), c({ lead_source: 'Book a Demo' })]);
  assert.deepEqual(by.map(s => [s.source, s.generated, s.reached, s.booked, s.completed]), [['LinkedIn', 2, 1, 1, 1], ['Book a demo form', 1, 0, 0, 0]]);
});

test('funnel: by week and by month buckets with reached share and median days to contact', () => {
  const rows = enrich([
    c({ hs_id: '1', created_at: '2026-09-01T05:00:00Z', props: { notes_last_contacted: '2026-09-03T05:00:00Z', num_contacted_notes: 1 } }),   // week of 31 Aug, 2 days
    c({ hs_id: '2', created_at: '2026-09-02T05:00:00Z', props: { notes_last_contacted: '2026-09-08T05:00:00Z', num_contacted_notes: 1 }, lead_status: 'Demo Booked' }), // 6 days
    c({ hs_id: '3', created_at: '2026-09-03T05:00:00Z' }),                                                                                   // never reached
    c({ hs_id: '4', created_at: '2026-09-09T05:00:00Z', replies_human: 1, props: { hs_sales_email_last_replied: '2026-09-10T05:00:00Z' } }),  // week of 7 Sep, replied (no contact date)
    c({ hs_id: '5', created_at: '2026-08-20T05:00:00Z', lead_status: 'Demo Completed', lifecycle: 'opportunity' }),                          // August, completed without outreach
  ], {}, accounts);
  const w = funnelByBucket(rows, 'week');
  assert.deepEqual(w.map(b => [b.key, b.generated, b.reached, b.notReached]), [['2026-08-17', 1, 0, 1], ['2026-08-31', 3, 2, 1], ['2026-09-07', 1, 1, 0]]);
  const sep1 = w[1]; assert.equal(sep1.reachedShare, 2 / 3); assert.equal(sep1.medianDaysToContact, 4); assert.equal(sep1.booked, 1); assert.equal(sep1.replied, 0);
  assert.equal(w[2].medianDaysToContact, null, 'a reply without a contact date gives no days'); assert.equal(w[2].replied, 1);
  assert.equal(w[0].completed, 1); assert.equal(w[0].prospect, 1); assert.equal(w[0].reached, 0);
  const m = funnelByBucket(rows, 'month');
  assert.deepEqual(m.map(b => [b.key, b.generated, b.reached]), [['2026-08', 1, 0], ['2026-09', 4, 3]]);
});

test('funnel: status breakdown shows the portal label and what each status counts as', () => {
  const rows = [c({ lead_status: 'OPEN' }), c({ lead_status: 'OPEN', props: { num_contacted_notes: 1 } }), c({ lead_status: 'Demo Completed - Ghosting' }), c({ lead_status: 'Associated with a deal' }), c({ lead_status: 'Demo Booked' }), c({ lead_status: '' })];
  const s = statusBreakdown(rows);
  assert.deepEqual(s.map(x => [x.label, x.n, x.countsAs, x.reached]), [['New', 2, '', 1], ['Associated with a deal', 1, 'Sales prospect', 0], ['Demo Booked', 1, 'Demo booked', 0], ['Demo Completed - Stalled', 1, 'Demo completed', 0], ['No status', 1, '', 0]]);
  assert.equal(s[0].status, 'OPEN');
  assert.equal(statusLabel('OPEN'), 'New'); assert.equal(statusLabel('Working'), 'Working'); assert.equal(statusLabel(''), '');
  assert.equal(lifecycleLabel('opportunity'), 'SQL'); assert.equal(lifecycleLabel('249550600'), 'Opportunity'); assert.equal(lifecycleLabel('marketingqualifiedlead'), 'MQL'); assert.equal(lifecycleLabel('242934529'), 'Discarded');
});

test('hubspotMock: a believable sales funnel with the live portal statuses', () => {
  const rows = enrich(hubspotMock.contacts.filter(isFormLead), hubspotMock.notes_by_contact, accounts).filter(r => !r.spam);
  const F = funnelCounts(rows);
  assert.ok(F.replies.human >= 6 && F.replies.auto >= 3 && F.replies.unknown >= 1, `reply split ${JSON.stringify(F.replies)}`);
  const reachedShare = F.raw.reached / F.generated; assert.ok(reachedShare > 0.3 && reachedShare < 0.7, `reached ${reachedShare}`);
  assert.ok(F.raw.replied >= 6 && F.raw.replied < F.raw.reached, `replied ${F.raw.replied}`);
  assert.ok(F.raw.booked >= 10 && F.raw.booked <= 40, `booked ${F.raw.booked}`);
  assert.ok(F.raw.completed >= 4 && F.raw.completed < F.raw.booked, `completed ${F.raw.completed}`);
  assert.ok(F.raw.prospect >= 2 && F.raw.prospect <= F.raw.booked, `prospect ${F.raw.prospect}`);
  assert.ok(F.cumulative.booked >= 5 && F.cumulative.completed >= 2 && F.cumulative.prospect >= 1, `chain ${JSON.stringify(F.cumulative)}`);
  for (let i = 1; i < FUNNEL_KEYS.length; i++) assert.ok(F.cumulative[FUNNEL_KEYS[i]] <= F.cumulative[FUNNEL_KEYS[i - 1]], 'cumulative never grows');
  const statuses = new Set(hubspotMock.contacts.map(r => r.lead_status));
  for (const s of ['OPEN', 'Working', 'Demo Booked', 'Demo Completed', 'Associated with a deal']) assert.ok(statuses.has(s), s);
  assert.ok(!statuses.has('NEW') && !statuses.has('CONNECTED') && !statuses.has('OPEN_DEAL'), 'old made-up statuses are gone');
  assert.ok(hubspotMock.contacts.some(r => r.lifecycle === 'opportunity') && hubspotMock.contacts.some(r => r.lifecycle === 'marketingqualifiedlead'));
  assert.ok(rows.every(r => !r.props.num_contacted_notes || r.props.notes_last_contacted), 'a contact count always has a last-contacted date');
  assert.ok(funnelByBucket(rows, 'month').length >= 5);
});

test('linkedinMock has the shape the overview reads (uploads, daily perf rows, demo windows)', () => {
  assert.ok(Array.isArray(linkedinMock.uploads) && Array.isArray(linkedinMock.perf) && Array.isArray(linkedinMock.demo));
  assert.ok(linkedinMock.perf.every(r => r.day && 'impressions' in r && 'spend' in r));
  assert.ok(linkedinMock.perf.some(r => Number(r.leads) > 0), 'some rows carry leads');
  assert.ok(linkedinMock.uploads.every(u => u.uploaded_at && u.kind && u.channel === 'linkedin'));
  assert.ok(linkedinMock.demo.every(d => d.upload && d.upload.period_start && Array.isArray(d.rows)));
});

// ---- scope, GSI campaigns, reply type ------------------------------------------------------------
test('isFormLead: only contacts with a first conversion date are leads', () => {
  assert.equal(isFormLead(c({ props: { first_conversion_date: '2026-09-10T05:00:00Z' } })), true);
  assert.equal(isFormLead(c({ props: { first_conversion_date: 1757480400000 } })), true, 'epoch ms counts');
  assert.equal(isFormLead(c({ props: { first_conversion_date: '' } })), false);
  assert.equal(isFormLead(c({ props: { first_conversion_date: null } })), false);
  assert.equal(isFormLead(c({ props: {} })), false);
  assert.equal(isFormLead(c({})), false, 'no props at all');
  assert.equal(isFormLead(null), false);
});

const inst = (id, gsi, o = {}) => ({ campaign_id: id, campaign_name: `Camp ${id}`, gsi, status: 1, interest_status: null, reply_count: 0, last_reply_at: null, ...o });
test('gsiCampaignsOf keeps GSI-tagged campaigns only, once each', () => {
  assert.deepEqual(gsiCampaignsOf(c({})), []);
  assert.deepEqual(gsiCampaignsOf(c({ instantly: [] })), []);
  const l = gsiCampaignsOf(c({ instantly: [inst('a', true), inst('b', false), inst('a', true), inst('c', true), inst('d', null), null] }));
  assert.deepEqual(l.map(x => x.campaign_id), ['a', 'c'], 'gsi must be exactly true; duplicates and blanks dropped');
  assert.equal(inGsiCampaign(c({ instantly: [inst('b', false)] })), false);
  assert.equal(inGsiCampaign(c({ instantly: [inst('b', false), inst('a', true)] })), true);
});

test('gsiSplit and gsiCampaignTable: where the leads came from', () => {
  const rows = [
    c({ hs_id: '1', instantly: [inst('a', true)], lead_status: 'Demo Booked', replies_human: 1 }),
    c({ hs_id: '2', instantly: [inst('a', true), inst('c', true)], replies_auto: 1 }),
    c({ hs_id: '3', instantly: [inst('w', false)], lead_status: 'Demo Completed' }),   // only a non-GSI campaign -> form lead
    c({ hs_id: '4' }),
    c({ hs_id: '5', instantly: [] }),
  ];
  const sp = gsiSplit(rows);
  assert.deepEqual(sp.map(x => [x.key, x.n, x.booked]), [['campaign', 2, 1], ['form', 3, 1]]);
  assert.equal(sp[0].share, 2 / 5); assert.equal(sp[1].share, 3 / 5); assert.equal(sp[0].bookedShare, 1 / 2);
  assert.equal(sp[0].n + sp[1].n, rows.length, 'the two parts add up to Generated');
  const t = gsiCampaignTable(rows);
  assert.deepEqual(t.map(x => [x.campaign_id, x.generated, x.repliedHuman, x.autoOnly, x.booked]), [['a', 2, 1, 1, 1], ['c', 1, 0, 1, 0]]);
  assert.deepEqual(gsiSplit([]).map(x => [x.n, x.share]), [[0, null], [0, null]]);
});

test('replyType: human, auto only, unknown, none', () => {
  const R = '2026-09-12T05:00:00Z';
  assert.equal(replyType(c({})), null);
  assert.equal(replyType(c({ replies_human: 1 })), 'human');
  assert.equal(replyType(c({ replies_human: 1, replies_auto: 3 })), 'human', 'a human reply wins over auto replies');
  assert.equal(replyType(c({ replies_auto: 2 })), 'auto');
  assert.equal(replyType(c({ replies_auto: 2, props: { hs_sales_email_last_replied: R } })), 'auto', 'stored reply emails beat the HubSpot date');
  assert.equal(replyType(c({ props: { hs_sales_email_last_replied: R } })), 'unknown', 'HubSpot reply, no reply email stored');
  assert.equal(replyType(c({ props: { hs_sales_email_last_replied: R }, instantly: [inst('a', true, { reply_count: 1, interest_status: 1 })] })), 'human', 'Instantly rated the reply');
  assert.equal(replyType(c({ props: { hs_sales_email_last_replied: R }, instantly: [inst('a', true, { reply_count: 1, interest_status: 0 })] })), 'unknown', 'out of office is not a human signal');
  assert.equal(replyType(c({ props: { hs_sales_email_last_replied: R }, instantly: [inst('a', true, { reply_count: 0, interest_status: 1 })] })), 'unknown', 'no Instantly reply');
  assert.equal(replyType(c({ instantly: [inst('a', true, { reply_count: 1, interest_status: 1 })] })), null, 'Instantly alone does not make a reply under the fallback rule');
  assert.equal(isHumanReply(c({ replies_human: '2' })), true, 'numeric strings from the API');
  assert.equal(isReplied(c({ replies_auto: 1, props: { hs_sales_email_last_replied: R } })), true, 'isReplied stays the old any-reply rule');
  assert.equal(isReached(c({ replies_auto: 1 })), true, 'an auto reply means we wrote to them');
  assert.deepEqual(replySplit([c({ replies_human: 1 }), c({ replies_auto: 1 }), c({ props: { hs_sales_email_last_replied: R } }), c({})]), { human: 1, auto: 1, unknown: 1, any: 3 });
});

test('attachInstantly: uses the lookup when it matches, else a deterministic fallback over the campaigns', () => {
  const camps = [{ id: 'g1', name: 'GSI one', gsi: true }, { id: 'g2', name: 'GSI two', gsi: true }, { id: 'w1', name: 'Other', gsi: false }];
  const contacts = hubspotMock.contacts.filter(isFormLead);
  const a = attachInstantly(contacts, camps), b = attachInstantly(contacts, camps);
  assert.deepEqual(a.map(x => x.instantly), b.map(x => x.instantly), 'deterministic');
  const inGsi = a.filter(inGsiCampaign).length; assert.ok(inGsi >= 20 && inGsi < a.length * 0.6, `in GSI campaigns ${inGsi} of ${a.length}`);
  assert.ok(a.every(x => x.instantly.every(i => 'campaign_id' in i && 'gsi' in i && 'reply_count' in i && 'interest_status' in i)));
  assert.ok(attachInstantly(hubspotMock.contacts.filter(x => !isFormLead(x)), camps).every(x => !x.instantly.length), 'non-form contacts get no fallback campaigns');
  const one = contacts[0];
  const viaLookup = attachInstantly(contacts, camps, e => e === one.email ? [inst('z', true)] : []);
  assert.deepEqual(viaLookup.find(x => x.hs_id === one.hs_id).instantly.map(i => i.campaign_id), ['z']);
  assert.ok(viaLookup.every(x => x.instantly.length === (x.email === one.email ? 1 : 0)), 'with a matching lookup the fallback is off');
  assert.ok(!('instantly' in hubspotMock.contacts[0]), 'the shared mock is not mutated');
});
