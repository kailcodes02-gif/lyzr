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

test('api totals, lead pool and workspace share', () => {
  const camps = [
    { id: 'g1', name: 'GSI_Sep_D_Big4_Cold', status: 1, gsi: true, leads_count: 400, contacted: 150, sent: 300, bounced: 6 },
    { id: 'g2', name: 'Deloitte - US - July', status: 3, gsi: true, leads_count: 100, contacted: 100, sent: 500, bounced: 2 },
    { id: 'w1', name: 'Fintech CFO Outreach', status: 1, gsi: false, leads_count: 900, contacted: 700, sent: 2000, bounced: 40 },
  ];
  const pool = E.leadPool(camps);
  assert.deepEqual([pool.campaigns, pool.active, pool.leads, pool.contacted, pool.uncontacted, pool.bounced], [2, 1, 500, 250, 250, 8]);
  assert.equal(Math.round(pool.bounceRate * 10) / 10, 3.2);
  const share = E.workspaceShare(camps, { sent: 2800, contacted: 950, campaigns: 3 });
  assert.deepEqual([share.gsiSent, share.wsSent, share.gsiCampaigns, share.wsCampaigns], [800, 2800, 2, 3]);
  assert.equal(Math.round(share.sentShare), 29);
  assert.equal(E.workspaceShare(camps).wsSent, 2800); // falls back to summing the rows
  const t = E.apiTotals([{ sent: 100, contacted: 80, new_leads_contacted: 50, unique_opened: 20, unique_clicks: 4, unique_replies: 1, replies_automatic: 2, opportunities: 1 }, { sent: 50, new_leads_contacted: 50, unique_opened: 5 }]);
  assert.deepEqual([t.sent, t.newLeads, t.opened, t.openRate, t.clickRate, t.replyRate], [150, 100, 25, 25, 4, 1]);
  assert.equal(E.apiTotals([]).openRate, null);
});

test('campaign category and account match from the name', () => {
  const accounts = [{ name: 'Tata Consultancy Services', aliases: ['TCS'], domain: 'tcs.com' }, { name: 'Firstsource', domain: 'firstsource.com' }, { name: 'EY', aliases: ['Ernst & Young (EY)'], domain: 'ey.com' }, { name: 'Global Services', domain: 'global.com' }, { name: 'BIP', domain: 'bip.com' }];
  assert.equal(E.campaignAccount('TCS - US - July', accounts), 'Tata Consultancy Services');
  assert.equal(E.campaignAccount('GSI_Sep_D_Firstsource_Cold', accounts), 'Firstsource');
  assert.equal(E.campaignAccount('EY - UK - Aug', accounts), 'EY');
  assert.equal(E.campaignAccount('GSI_Sep_A1_Openers_High_Intent', accounts), null);
  assert.equal(E.campaignAccount('Global Services Cold', accounts), 'Global Services'); // full name as consecutive words still matches
  assert.equal(E.campaignAccount('Global Cold', accounts), null);                      // a generic single word does not
  assert.equal(E.campaignAccount('Bipartisan outreach', accounts), null);               // whole words only
  assert.equal(E.campaignCategory('GSI_Sep_D_Firstsource_Cold', accounts), 'GSI Partner');
  assert.equal(E.campaignCategory('GSI_Sep_D_Big4_Cold', accounts), 'Cold outreach');
  assert.equal(E.campaignCategory('GSI_Sep_A2_Openers_Medium', accounts), 'Retarget');
  assert.equal(E.campaignCategory('GSI_Sep_C_Demo_Clickers_Retarget', accounts), 'Retarget');
  assert.equal(E.campaignCategory('Agent Roadmap ClusterA', accounts), 'Other');
});

test('uncontacted projection per active campaign with the 14 day pace', () => {
  const camps = [
    { id: 'a', name: 'A', status: 1, gsi: true, leads_count: 1000, contacted: 300 },
    { id: 'b', name: 'B', status: 1, gsi: true, leads_count: 200, contacted: 200 },
    { id: 'c', name: 'C', status: 3, gsi: true, leads_count: 500, contacted: 100 },  // completed: left out
    { id: 'd', name: 'D', status: 1, gsi: false, leads_count: 500, contacted: 0 },   // not GSI: left out
    { id: 'e', name: 'E', status: 1, gsi: true, leads_count: 50, contacted: 10 },    // no sends in the window
  ];
  const daily = [];
  for (let i = 0; i < 20; i++) { const day = new Date(Date.parse('2026-09-10T00:00:00Z') + i * 864e5).toISOString().slice(0, 10); daily.push({ campaign_id: 'a', day, sent: 70, new_leads_contacted: 35 }); }
  daily.push({ campaign_id: 'e', day: '2026-09-01', sent: 10, new_leads_contacted: 10 });
  const u = E.uncontacted(camps, daily);
  assert.deepEqual(u.window, { from: '2026-09-16', to: '2026-09-29' });
  assert.deepEqual(u.rows.map(r => r.name), ['A', 'E', 'B']);
  const a = u.rows[0];
  assert.deepEqual([a.uncontacted, a.perDay, a.newPerDay, a.daysToFinish, a.daysToFinishNew], [700, 70, 35, 10, 20]);
  assert.deepEqual([u.rows[1].uncontacted, u.rows[1].daysToFinish], [40, null]);
  assert.deepEqual([u.rows[2].uncontacted, u.rows[2].daysToFinish], [0, 0]);
  assert.deepEqual([u.total.leads, u.total.contacted, u.total.uncontacted, u.total.perDay], [1250, 510, 740, 70]);
  assert.equal(Math.round(u.total.daysToFinishNew * 10) / 10, 21.1);
  assert.equal(E.uncontacted(camps, []).window, null);
  assert.equal(E.uncontacted(camps, daily, '2026-09-12').rows[0].perDay, 70 * 3 / 14);
});

test('funnel steps, campaign tiers and the what-worked bullets', () => {
  const st = E.funnelSteps({ reached: 200, opened: 50, clickers: 10, demo: 4 });
  assert.deepEqual([st.openedOfReached, st.clickersOfOpened, st.demoOfClickers, st.demoOfReached], [25, 20, 40, 2]);
  assert.equal(E.funnelSteps({ reached: 0, opened: 0, clickers: 0, demo: 0 }).clickersOfOpened, null);
  const camps = [
    { name: 'Hot', reached: 120, opened: 40, clickers: 9, demo: 3, demoRate: 2.5 },
    { name: 'Warm', reached: 300, opened: 80, clickers: 12, demo: 0, demoRate: 0 },
    { name: 'Opens', reached: 90, opened: 20, clickers: 0, demo: 0, demoRate: 0 },
    { name: 'Dead', reached: 150, opened: 0, clickers: 0, demo: 0, demoRate: 0 },
    { name: 'Quiet', reached: 20, opened: 0, clickers: 0, demo: 0, demoRate: 0 },
  ];
  const tiers = E.campaignTiers(camps);
  assert.deepEqual(tiers.map(t => [t.label, t.items.map(i => i.name)]), [['Demo intent', ['Hot']], ['Engaged', ['Warm']], ['Opens only', ['Opens']], ['No activity', ['Dead', 'Quiet']]]);
  assert.deepEqual([tiers[0].items[0].demo, tiers[0].items[0].other], [3, 6]);
  const T = { sent: 900, reached: 680, opened: 140, clickers: 21, demo: 3, demoDirect: 2, demoVia: 1, clicks: 30, fastClicks: 20, openRate: 20.6, clickRate: 3.09, demoRate: 0.44 };
  const TP = { ...T, demo: 5, clickers: 15 };
  const senders = [{ sender: 'a@s.example', reached: 300, opened: 0, clickers: 5 }, { sender: 'b@s.example', reached: 300, opened: 100, clickers: 16 }, { sender: 'c@s.example', reached: 80, opened: 0, clickers: 0 }];
  const b = E.emailBullets({ T, TP, cmp: { label: 'the period before' }, camps, senders, apiCur: { newLeads: 600, replies: 4, opened: 200, openRate: 33 }, apiPrev: { replies: 2 }, pool: { contacted: 5000, bounced: 200, bounceRate: 4 }, unc: { rows: [{ name: 'Big', uncontacted: 900, daysToFinishNew: 90 }], total: { uncontacted: 900, newPerDay: 10, daysToFinishNew: 90 } } });
  const heads = list => list.map(x => x.b);
  assert.deepEqual(heads(b.achieved), ['Click rate 3.1%.', 'Hot converts to demo intent at 2.5%.', 'Replies up 100% vs the period before.', 'Open rate 33%.']);
  assert.deepEqual(heads(b.missed), ['Book a Demo clickers down 40% vs the period before.', '1 campaign with no human click after 100+ people.', '1 mailbox with clicks but no opens.', '1 mailbox with no opens and no clicks.', '40% of clicks were scanner-fast.', 'Bounce rate 4% all time.', '1 active campaign will take over 60 days to finish.']);
  assert.match(b.missed[1].s, /^Dead:/);
  const quiet = E.emailBullets({ T: { ...T, reached: 10, clickers: 0, demo: 0, clicks: 0, fastClicks: 0, clickRate: 0 }, TP: null, cmp: null });
  assert.deepEqual([quiet.achieved.length, quiet.missed.length], [0, 0]);
  const noCmp = E.emailBullets({ T, TP: null, cmp: null });
  assert.equal(noCmp.achieved[1].b, '3 people clicked Book a Demo.');
});
