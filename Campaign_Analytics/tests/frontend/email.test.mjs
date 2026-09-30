// node --test 'Campaign_Analytics/tests/frontend/*.test.mjs'
// Synthetic data only (no real prospects).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstantlyCsv, campaignFromFile, campaignLabel, eventCode } from '../../js/email-csv.mjs';
import * as E from '../../js/lib/email-agg.mjs';
import { detectText } from '../../js/upload-detect.mjs';
import { buildBuckets, series, sameDays, bucketEnd } from '../../js/trend.mjs';
import { gsiMatcher, sourceChannel, recentActivity } from '../../js/lib/leads-agg.mjs';

const CSV = [
  'Associated account,Contact,Step,Event,Link Clicked,Created At',
  'box1@send.example,a.one@acme-si.example,Step 1,Sent,,2026-09-01T04:00:00.000Z',
  'box1@send.example,a.one@acme-si.example,Step 1,Opened,,2026-09-01T06:00:00.000Z',
  'box1@send.example,a.one@acme-si.example,Step 1,Link Clicked,https://www.lyzr.ai/book-demo/?utm_source=instantly,2026-09-01T09:00:00.000Z',
  'box2@send.example,b.two@acme-si.example,Step 1,Sent,,2026-09-01T04:05:00.000Z',
  'box2@send.example,b.two@acme-si.example,Step 1,Link Clicked,https://www.lyzr.ai/gsi-si/?utm_source=instantly,2026-09-01T04:06:00.000Z',
  'box2@send.example,b.two@acme-si.example,Step 2,Sent,,2026-09-04T04:05:00.000Z',
  'box2@send.example,b.two@acme-si.example,Step 2,Link Clicked,https://www.lyzr.ai/case-studies/hfs-research/,2026-09-05T10:00:00.000Z',
  'box1@send.example,c.three@tcs.com,Step 1,Sent,,2026-09-08T04:00:00.000Z',
  'box1@send.example,c.three@tcs.com,Step 1,Link Clicked,https://www.lyzr.ai/gsi-si/,2026-09-08T12:00:00.000Z',
  'box1@send.example,d.four@tcs.com,Step 1,Sent,,2026-09-08T04:00:00.000Z',
  'box1@send.example,d.four@tcs.com,Step 1,Bounce,,2026-09-08T04:01:00.000Z',
].join('\r\n');
const FILE = 'GSI_Sep_X_Test_Cold_analytics_23_09_2026, 13_22_32.csv';

test('campaign name comes from the file name and keeps Instantly spelling', () => {
  assert.equal(campaignFromFile(FILE), 'GSI_Sep_X_Test_Cold');
  assert.equal(campaignFromFile('FirstSource_- India - July_analytics_24_09_2026, 15_31_10.csv'), 'FirstSource_- India - July');
  assert.equal(campaignLabel('FirstSource_- India - July'), 'FirstSource - India - July');
  assert.equal(eventCode('Link Clicked'), 'clicked');
  assert.equal(eventCode('Auto Reply'), 'auto_reply');
});

test('parser: events, lag from the Sent of the same step, stats', () => {
  const r = parseInstantlyCsv(CSV, FILE);
  assert.equal(r.campaign, 'GSI_Sep_X_Test_Cold');
  assert.equal(r.rows.length, 11);
  assert.deepEqual([r.stats.sent, r.stats.opened, r.stats.clicked, r.stats.contacts], [5, 1, 4, 4]);
  const clicks = r.rows.filter(x => x.event === 'clicked');
  assert.deepEqual(clicks.map(c => c.lag_s), [18000, 60, 107700, 28800]);
  assert.equal(r.rows.find(x => x.raw_event === 'Bounce').event, 'bounced');
});

test('links: demo direct, via GSI/SI page, categories, custom rules', () => {
  assert.deepEqual(E.linkInfo('https://www.lyzr.ai/book-demo/?x=1'), { cat: 'Book a Demo', label: 'Book a Demo', demo: 'direct' });
  assert.equal(E.linkInfo('https://calendly.com/lyzr/30min').demo, 'direct');
  assert.equal(E.linkInfo('https://www.lyzr.ai/gsi-si/').demo, 'via');
  assert.equal(E.linkInfo('https://www.lyzr.ai/gsi-si/', { gsi_page_counts_as_demo: false }).demo, null);
  assert.equal(E.linkInfo('https://www.lyzr.ai/case-studies/hfs-research/').cat, 'Case Studies');
  assert.equal(E.linkInfo('https://www.lyzr.ai/').label, 'Lyzr.ai Homepage');
  assert.equal(E.linkInfo('https://x.example/roadmap', { link_rules: [{ match: '/roadmap/i', category: 'Playbooks', label: 'Roadmap' }] }).label, 'Roadmap');
});

test('companies from email domains', () => {
  assert.equal(E.companyOf('x@tcs.com'), 'TCS');
  assert.equal(E.companyOf('x@in.ey.com'), 'EY');
  assert.equal(E.companyOf('x@acme-si.example', { domains: { 'acme-si.example': 'Acme SI' } }), 'Acme SI');
  assert.equal(E.companyOf('x@gmail.com'), 'Personal email');
  assert.equal(E.companyOf('x@newfirm.co.uk'), 'Newfirm');
  assert.equal(E.companyOf('x@infy.com', {}, [{ name: 'Infosys', aliases: ['Infy'] }]), 'Infosys');
});

test('fast clicks are excluded from human clicks, demo and segments', () => {
  const r = parseInstantlyCsv(CSV, FILE);
  const ev = E.enrich(r.rows.map(x => ({ ...x, lag: x.lag_s })), { fast_click_seconds: 180 });
  const f = E.funnel(ev);
  assert.deepEqual([f.sent, f.reached, f.opened, f.clickers, f.demo, f.demoDirect, f.demoVia, f.fastClicks, f.bounced], [5, 4, 1, 3, 2, 1, 1, 1, 1]);
  const P = new Map(E.people(ev).map(p => [p.email, p]));
  assert.equal(P.get('a.one@acme-si.example').segment, 'demo');
  assert.equal(P.get('b.two@acme-si.example').segment, 'engaged'); // its GSI/SI click was 60 s after the send
  assert.equal(P.get('b.two@acme-si.example').fastClicks, 1);
  assert.equal(P.get('c.three@tcs.com').demoVia, 1);
  assert.equal(P.get('d.four@tcs.com').bounced, true);
  const acc = E.accounts(ev).find(a => a.company === 'TCS');
  assert.deepEqual([acc.reached, acc.demo], [2, 1]);
  const cat = E.catStats(ev);
  assert.deepEqual([cat['Case Studies'].people, cat['Case Studies'].otherPeople], [1, 1]);
  const [camp] = E.campaigns(ev);
  assert.equal(camp.stepClicks.get(2), 1);
  assert.match(E.peopleTsv(E.people(ev)).split('\n')[0], /^Email\tCompany\tSegment/);
});

test('bulk detection routes files to the right tab', () => {
  const d = detectText(CSV, FILE);
  assert.equal(d.channel, 'email');
  assert.equal(d.kind, 'events');
  assert.throws(() => detectText('name,age\nx,1\n', 'people.csv'), /Not recognised/);
});

test('trend: buckets, comparison with earlier periods, projection, same days', () => {
  const items = [];
  for (const [day, n] of [['2026-07-03', 2], ['2026-07-20', 4], ['2026-08-05', 6], ['2026-08-25', 6], ['2026-09-02', 3], ['2026-09-09', 3]]) for (let i = 0; i < n; i++) items.push({ day });
  const B = buildBuckets(items, i => i.day, 'month', '2026-09-15');
  assert.deepEqual(B.map(b => b.start), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(B[2].partial, true);
  assert.equal(B[2].elapsed, 15);
  const m = { key: 'n', fn: l => l.length, additive: true };
  const S = series(B, m);
  assert.deepEqual(S.map(x => x.value), [6, 12, 6]);
  assert.equal(S[2].avg, 9);
  assert.equal(S[2].projected, 12);
  const sd = sameDays(B, m, i => i.day);
  assert.equal(sd.now, 6);
  assert.equal(sd.last, 6); // Aug 1 to 15
  assert.equal(sd.avg, (2 + 6) / 2); // Jul 1 to 15, Aug 1 to 15
  assert.equal(bucketEnd('2026-02-01', 'month'), '2026-02-28');
});

test('leads: GSI list matching, source channel, recent activity', () => {
  const g = gsiMatcher(['EY', 'Tata Consultancy Services', 'TCS']);
  assert.equal(g({ company_raw: 'EY GDS' }), 'EY');
  assert.equal(g({ company_raw: 'Keystone' }), null);
  assert.equal(g({ company_raw: '', email: 'x@tcs.com' }), 'TCS');
  assert.equal(sourceChannel({ source: 'ORGANIC_SEARCH' }), 'Organic search');
  assert.equal(sourceChannel({ source: 'OFFLINE', lead_source: 'GSI partner form' }), 'GSI form');
  const r = recentActivity({ last_activity_at: '2026-09-01T00:00:00Z', last_activity_type: 'CALL', props: { hs_sales_email_last_replied: '2026-09-10T00:00:00Z' } });
  assert.equal(r.label, 'Replied to a sales email');
  assert.equal(recentActivity({}), null);
});
