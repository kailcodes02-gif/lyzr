// Demo-mode email data: synthetic Instantly events shaped like the GSI sequences of Jul to Sep 2026,
// plus a few non-GSI campaigns (totals only) so the workspace share has something to show.
// Every person and domain is made up (".example" domains). Deterministic (seeded) so the demo is stable.
const CAMPAIGNS = [
  ['TCS - US - July', '2026-07-07', 'tcs', 380, 5, .08, .5, 'direct'],
  ['Deloitte - US - July', '2026-07-09', 'deloitte', 420, 5, .01, .45, 'direct'],
  ['FirstSource_- India - July', '2026-07-07', 'firstsource', 130, 5, .06, .6, 'direct'],
  ['Agent Roadmap ClusterA', '2026-07-20', 'mix-strategy', 600, 5, .09, .7, 'direct'],
  ['GSI_Sep_A1_Openers_High_Intent', '2026-09-02', 'mix', 320, 3, .05, .42, 'via'],
  ['GSI_Sep_A2_Openers_Medium', '2026-09-03', 'mix', 520, 3, .03, .28, 'via'],
  ['GSI_Sep_B1_CaseStudy_Clickers_to_Demo', '2026-09-08', 'mix', 90, 3, .12, .35, 'via'],
  ['GSI_Sep_C_Demo_Clickers_Retarget', '2026-09-10', 'mix', 80, 3, .2, .18, 'via'],
  ['GSI_Sep_D_Indian_SIs_Cold', '2026-09-04', 'indian', 700, 4, .012, .6, 'via'],
  ['GSI_Sep_D_Big4_Cold', '2026-09-05', 'big4', 420, 4, .006, .45, 'via'],
  ['GSI_Sep_D_Firstsource_Cold', '2026-09-04', 'firstsource', 181, 3, 0, 0, 'via'],
];
// Campaigns in the same Instantly workspace that are not tagged GSI: totals only, no events, no daily rows.
// [name, start, status, leads, contacted, sent, opened, clicked, replied, bounced]
const OTHER_CAMPAIGNS = [
  ['Fintech CFO Outreach Q3', '2026-07-14', 1, 4200, 3350, 9870, 1240, 61, 38, 41],
  ['Healthcare CIO Agents', '2026-08-03', 1, 3600, 2410, 6120, 980, 44, 22, 29],
  ['Retail Ops Automation', '2026-06-22', 3, 2800, 2800, 8400, 1330, 72, 31, 33],
  ['Insurance Claims AI', '2026-08-18', 1, 5100, 1980, 3960, 610, 27, 12, 24],
  ['Manufacturing Plant Leaders', '2026-07-28', 2, 2200, 1640, 4270, 520, 19, 9, 18],
  ['SaaS Founders Agent Studio', '2026-09-08', 1, 6400, 2210, 3310, 700, 58, 17, 20],
];
const DOMAINS = {
  tcs: ['tcs.example'], deloitte: ['deloitte.example'], firstsource: ['firstsource.example'],
  'mix-strategy': ['kearney.example', 'oliverwyman.example', 'boozallen.example', 'rolandberger.example', 'lek.example'],
  mix: ['tcs.example', 'infosys.example', 'wipro.example', 'accenture.example', 'deloitte.example', 'kpmg.example', 'capgemini.example', 'hcltech.example', 'cognizant.example', 'ey.example'],
  indian: ['infosys.example', 'wipro.example', 'hcltech.example', 'techmahindra.example', 'ltimindtree.example', 'mphasis.example', 'coforge.example'],
  big4: ['deloitte.example', 'kpmg.example', 'ey.example', 'pwc.example'],
};
const FIRST = ['aarav', 'priya', 'rohan', 'meera', 'kabir', 'ananya', 'vikram', 'isha', 'arjun', 'sara', 'dev', 'nisha', 'omar', 'lena', 'tom', 'maria', 'james', 'chen', 'yuki', 'fatima', 'noah', 'emma', 'liam', 'olivia', 'ravi', 'sneha'];
const LAST = ['demo', 'sample', 'test', 'mock', 'example', 'placeholder'];
const SENDERS = ['siva.a@sender-one.example', 'siva.b@sender-one.example', 'siva.c@sender-two.example', 'siva.d@sender-three.example'];
const LINKS = [
  ['https://www.lyzr.ai/case-studies/hfs-research/', 5], ['https://www.lyzr.ai/case-studies/accenture/', 3], ['https://www.lyzr.ai/', 6],
  ['https://www.lyzr.ai/playbooks/10m-ai-practice/', 3], ['https://www.lyzr.ai/assessment/agentic-roadmap/', 4], ['https://www.cbinsights.com/research/ai-100/', 1],
  ['https://www.lyzr.ai/blog/agentic-ai-for-gsis/', 2], ['https://www.lyzr.ai/webinars/agent-ops/', 1], ['https://www.lyzr.ai/agent-studio/', 2],
];

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const pickW = (r, list) => { const tot = list.reduce((a, x) => a + x[1], 0); let t = r() * tot; for (const x of list) { if ((t -= x[1]) < 0) return x[0]; } return list[0][0]; };

export function buildEmailMock(today = '2026-09-30') {
  const r = rng(20260930);
  const events = [];
  const api = [];
  const daily = new Map();
  const end = Date.parse(today + 'T23:59:59Z');
  CAMPAIGNS.forEach(([name, start, pool, n, steps, clickP, openP, demoMode], ci) => {
    const doms = DOMAINS[pool];
    const id = 'demo-' + (ci + 1);
    const people = [];
    for (let i = 0; i < n; i++) people.push(`${FIRST[Math.floor(r() * FIRST.length)]}.${LAST[Math.floor(r() * LAST.length)]}${i}@${doms[Math.floor(r() * doms.length)]}`);
    const hot = new Set(people.filter(() => r() < clickP * 2.2));
    let sent = 0, opened = 0, clicked = 0, replies = 0;
    people.forEach((c, pi) => {
      const sender = SENDERS[pi % SENDERS.length];
      const trackOpens = !sender.includes('sender-one');
      let t0 = Date.parse(start + 'T04:00:00Z') + Math.floor(pi / 30) * 864e5 + Math.floor(r() * 5 * 3600e3);
      for (let st = 1; st <= steps; st++) {
        const ts = new Date(t0 + (st - 1) * 3.5 * 864e5).toISOString();
        if (Date.parse(ts) > end) break;
        events.push({ campaign: name, contact: c, step: st, event: 'sent', ts, sender, link: '', lag: null }); sent++;
        const d = ts.slice(0, 10); const dr = daily.get(id + d) || { campaign_id: id, day: d, sent: 0, contacted: 0, new_leads_contacted: 0, unique_opened: 0, unique_replies: 0, replies_automatic: 0, unique_clicks: 0, opportunities: 0 }; dr.sent++; dr.contacted++; if (st === 1) dr.new_leads_contacted++; daily.set(id + d, dr);
        if (trackOpens && st <= 2 && r() < openP) { events.push({ campaign: name, contact: c, step: st, event: 'opened', ts: addMs(ts, (0.2 + r() * 30) * 3600e3), sender, link: '', lag: null }); opened++; dr.unique_opened++; }
        if (hot.has(c) && r() < 0.45) {
          const fast = r() < 0.22;
          const lag = fast ? Math.round(20 + r() * 130) : Math.round(600 + r() * 2.5 * 864e2);
          const link = r() < (demoMode === 'direct' ? 0.28 : 0.4) ? (demoMode === 'direct' ? 'https://www.lyzr.ai/book-demo/' : 'https://www.lyzr.ai/gsi-si/') : pickW(r, LINKS);
          const utm = `?utm_source=instantly&utm_medium=${encodeURIComponent(pool)}&utm_campaign=${encodeURIComponent(name)}`;
          const cts = addMs(ts, lag * 1000);
          if (Date.parse(cts) <= end) {
            events.push({ campaign: name, contact: c, step: st, event: 'clicked', ts: cts, sender, link: link + utm, lag }); clicked++; dr.unique_clicks++;
            if (!fast && r() < 0.35) events.push({ campaign: name, contact: c, step: st, event: 'clicked', ts: addMs(cts, 60e3), sender, link: link + utm, lag: lag + 60 });
          }
        }
        if (st === 1 && r() < 0.01) { events.push({ campaign: name, contact: c, step: st, event: 'bounced', ts: addMs(ts, 120e3), sender, link: '', lag: null }); }
        if (hot.has(c) && st === steps && r() < 0.12) { replies++; dr.unique_replies++; if (r() < 0.3) dr.opportunities++; }
      }
    });
    api.push({ id, name, status: start >= '2026-09-01' ? 1 : 3, gsi: true, leads_count: n, contacted: n, sent, new_leads_contacted: n, opened_unique: opened, clicked_unique: clicked, replied_unique: replies, replies_automatic: Math.round(n * .02), bounced: Math.round(n * .01), unsubscribed: 0, completed: start >= '2026-09-01' ? Math.round(n * .4) : n, opportunities: Math.round(replies * .3), created_at: start + 'T00:00:00Z', synced_at: today + 'T01:30:00Z' });
  });
  OTHER_CAMPAIGNS.forEach(([name, start, status, leads, contacted, sent, opened, clicked, replied, bounced], i) => {
    api.push({ id: 'ws-' + (i + 1), name, status, gsi: false, leads_count: leads, contacted, sent, new_leads_contacted: contacted, opened_unique: opened, clicked_unique: clicked, replied_unique: replied, replies_automatic: Math.round(contacted * .015), bounced, unsubscribed: Math.round(contacted * .004), completed: status === 3 ? contacted : Math.round(contacted * .5), opportunities: Math.round(replied * .2), created_at: start + 'T00:00:00Z', synced_at: today + 'T01:30:00Z' });
  });
  const workspace = { sent: api.reduce((a, c) => a + c.sent, 0), contacted: api.reduce((a, c) => a + c.contacted, 0), campaigns: api.length, gsi_campaigns: api.filter(c => c.gsi).length };
  events.sort((a, b) => a.ts < b.ts ? -1 : 1);
  const uploads = CAMPAIGNS.filter(c => c[6] || c[0].includes('Firstsource')).map((c, i) => ({ id: 'em' + i, channel: 'email', kind: 'events', file_name: `${c[0]}_analytics_29_09_2026, 10_00_00.csv`, uploaded_by: 'demo@lyzr.com', uploaded_at: '2026-09-29T05:00:00.000Z', period_start: c[1], period_end: today, row_count: events.filter(e => e.campaign === c[0]).length, notes: c[0] }));
  return { events, api: { campaigns: api, daily: [...daily.values()].sort((a, b) => a.day < b.day ? -1 : 1), workspace, last_sync: { status: 'done', started_at: today + 'T01:29:00Z', finished_at: today + 'T01:30:00Z', campaigns: workspace.gsi_campaigns }, configured: true }, uploads };
}

/** Same compact page shape as GET /api/ca/email. */
export function emailPage(mock, offset = 0, size = 15000) {
  const slice = mock.events.slice(offset, offset + size);
  const campaigns = [], senders = [], ci = new Map(), si = new Map();
  const idx = (m, l, v) => { if (!m.has(v)) { m.set(v, l.length); l.push(v); } return m.get(v); };
  const out = { events: slice.map(e => [idx(ci, campaigns, e.campaign), e.contact, e.step, e.event, e.ts, idx(si, senders, e.sender), e.link, e.lag]), campaigns, senders, next: offset + size < mock.events.length ? offset + size : null };
  if (!offset) { out.uploads = mock.uploads; out.api = mock.api; }
  return out;
}
