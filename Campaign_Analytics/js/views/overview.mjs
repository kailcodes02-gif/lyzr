// Overview: both channels at a glance, target vs today, what needs attention, quick links and
// a Claude read-out. Every data block loads on its own so one failing API does not hide the rest.
import { enrich, summary, hasMessage } from '../lib/leads-agg.mjs';
import { PLATFORM_LABEL } from '../ads-csv.mjs';
import { leadSplit } from '../lib/linkedin-agg.mjs';
import { mountBoard } from '../actions.mjs';
import { sectionCompare, memoGet, deltaText } from '../compare.mjs';

export const route = 'overview';
export const title = 'Overview';
export function destroy() {}

const DIRECTOR_PLUS = ['director', 'vp', 'cxo', 'partner', 'owner'];
const MQL_PLUS = new Set(['marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer']);
const sumBy = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

function liTotals(li) {
  const perf = (li && li.perf) || [];
  const t = { spend: sumBy(perf, 'spend'), impressions: sumBy(perf, 'impressions'), clicks: sumBy(perf, 'clicks'), reach: sumBy(perf, 'reach'), leads: sumBy(perf, 'leads'), video: sumBy(perf, 'video_views'), days: new Set(perf.map(r => r.day)).size, firstDay: perf.reduce((m, r) => !m || r.day < m ? r.day : m, null) };
  t.cpl = t.leads ? t.spend / t.leads : null; t.ctr = t.impressions ? t.clicks / t.impressions * 100 : null;
  return t;
}
function demoShare(li, segment, pickFn) {
  const rows = ((li && li.demo) || []).flatMap(d => d.rows || []).filter(r => r.segment === segment);
  const tot = sumBy(rows, 'impressions'); if (!tot) return null;
  const by = new Map(); for (const r of rows) by.set(r.value, (by.get(r.value) || 0) + (Number(r.impressions) || 0));
  return pickFn(by, tot);
}
const directorShare = li => demoShare(li, 'Job Seniority', (by, tot) => [...by.entries()].filter(([v]) => DIRECTOR_PLUS.includes(String(v).toLowerCase())).reduce((a, [, n]) => a + n, 0) / tot * 100);
const topCountry = li => demoShare(li, 'Country', (by, tot) => { const [v, n] = [...by.entries()].sort((a, b) => b[1] - a[1])[0]; return { country: v, share: n / tot * 100 }; });

export async function render(el, ctx) {
  const { esc, fmt, usd, pct, istDateTime, timeAgo, rangeLabel, daysBetween, addDays, monthLabel } = ctx.fmt;
  const { table, section, spinner, pill, empty } = ctx.ui;
  const { from, to } = ctx.state;
  const days = daysBetween(from, to);
  const cmp = ctx.state.prev || null;
  const prevFrom = cmp ? cmp.from : null, prevTo = cmp ? cmp.to : null;
  const targets = { leads_per_month: 200, demo_mqls_per_month: 30, ...((ctx.settings && ctx.settings.targets) || {}) };
  const accounts = (ctx.settings && ctx.settings.accounts) || [];
  const now = Date.now();
  const scale = n => n / Math.max(1, days) * 30;

  el.innerHTML = `<div class="seghead">GSI and SI programme</div><h1>Overview</h1><div class="intro"><b>What this page is:</b> every channel side by side for the dates at the top (${esc(rangeLabel(from, to))}). <b>Channels at a glance</b> puts ads, email and HubSpot leads in one table. <b>Target vs today</b> takes the pace of the selected dates, scales it to a 30-day month and compares it with the monthly targets (Admin › Targets). <b>Needs attention</b> lists what the numbers flag this period. The <b>AI read-out</b> is Claude reading all of it and suggesting what to do; suggestions you track are checked again next time.</div>` + spinner('Loading channels');
  // The comparison pull for the top-bar range is memoised, so the glance section's first draw (which
  // uses the same range unless the user picks another one there) does not fetch it twice.
  const [liR, liPrevR, hsR, emR, adsR] = await Promise.allSettled([ctx.api.get('linkedin', { from, to }), (cmp ? memoGet(ctx, 'linkedin', { from: prevFrom, to: prevTo }) : Promise.resolve(null)), ctx.api.get('hubspot', { from, to }), ctx.api.get('email', { offset: 0 }), ctx.api.get('linkedin', { from, to, platform: 'all' })]);
  // Other ad platforms (Google, Meta, Bing, Taboola, X, ChatGPT): one glance row per platform with rows in range.
  const otherAds = adsR.status === 'fulfilled' && adsR.value ? [...new Set((adsR.value.perf || []).map(r => r.platform).filter(p => p && p !== 'linkedin'))].sort().map(p => { const rows = adsR.value.perf.filter(r => r.platform === p && r.day >= from && r.day <= to); const t = liTotals({ perf: rows }); return { platform: p, name: PLATFORM_LABEL[p] || p, ...t }; }) : [];
  // Email: the daily Instantly API rows (all GSI-tagged campaigns) summed over the range.
  const em = emR.status === 'fulfilled' ? emR.value : null;
  const emDaily = em && em.api ? (em.api.daily || []).filter(r => r.day >= from && r.day <= to) : [];
  const emSum = k => emDaily.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const EM = em ? { sent: emSum('sent'), contacted: emSum('contacted'), newLeads: emSum('new_leads_contacted'), opens: emSum('unique_opened'), clicks: emSum('unique_clicks'), replies: emSum('unique_replies'), opps: emSum('opportunities'), campaigns: new Set(emDaily.filter(r => Number(r.sent) > 0).map(r => r.campaign_id)).size, since: (em.api && em.api.daily && em.api.daily[0] && em.api.daily[0].day) || null, synced: em.api && em.api.last_sync, uploads: (em.uploads || []).length } : null;
  const li = liR.status === 'fulfilled' ? liR.value : null, liErr = liR.status === 'rejected' ? (liR.reason.message || String(liR.reason)) : null;
  const liPrev = liPrevR.status === 'fulfilled' ? liPrevR.value : null;
  const hs = hsR.status === 'fulfilled' ? hsR.value : null, hsErr = hsR.status === 'rejected' ? (hsR.reason.message || String(hsR.reason)) : null;

  const T = li ? liTotals(li) : null, TP = liPrev ? liTotals(liPrev) : null;
  const rows = hs ? enrich(hs.contacts || [], hs.notes_by_contact || {}, accounts).filter(r => !r.spam) : [];
  const H = hs ? { ...summary(rows), mqls: rows.filter(r => MQL_PLUS.has(String(r.lifecycle || '').toLowerCase())).length, adLeads: rows.filter(r => /linkedin/i.test(r.lead_source || r.source_detail || '')).length, adMqls: rows.filter(r => /linkedin/i.test(r.lead_source || r.source_detail || '') && MQL_PLUS.has(String(r.lifecycle || '').toLowerCase())).length, mdUnowned: rows.filter(r => r.band === 'MD' && !r.owner_id && !r.owner_name), firstDay: rows.reduce((m, r) => !m || r.day < m ? r.day : m, null) } : null;
  const errBox = (what, msg) => `<div class="empty" style="text-align:left">${esc(what)} could not be loaded: ${esc(msg)}. The rest of the page still works.</div>`;

  // ---- both channels at a glance -------------------------------------------------------------
  const conf = (level) => pill(level, level === 'High' ? 'p-high' : level === 'Medium' ? 'p-med' : 'p-low');
  // The table for one comparison: p is the range chosen for this section ({from,to,label} or null),
  // TG the LinkedIn totals for that range (null when there is nothing to compare with).
  const small = s => `<br><span class="muted" style="font-size:11.5px">${s}</span>`;
  const glanceHtml = (p, TG) => `${liErr ? errBox('LinkedIn ads', liErr) : ''}${hsErr ? errBox('HubSpot', hsErr) : ''}` + table({ cols: [
    { h: 'Channel', k: 'ch', left: true, f: r => r.ch }, { h: 'Active since', k: 'since', f: r => r.since }, { h: 'Spend', k: 'spend', f: r => r.spend }, { h: 'Reach', k: 'reach', f: r => r.reach }, { h: 'Engagement', k: 'eng', f: r => r.eng }, { h: 'Hand-raisers', k: 'hand', f: r => r.hand }, { h: 'Conversions measured', k: 'conv', f: r => r.conv }, { h: 'Confidence', k: 'conf', f: r => r.conf },
  ], rows: [
    T ? (() => { const dl = (cur, prevV, invert = false) => deltaText(p, cur, prevV, invert); const G = TG || {}; return { ch: '<b>LinkedIn ads</b>', since: T.firstDay ? esc(monthLabel(T.firstDay.slice(0, 7))) : '<span class="muted">no data in range</span>', spend: `${usd(T.spend)}${small(dl(T.spend, G.spend))}`, reach: `${fmt(T.impressions)} impressions${small(dl(T.impressions, G.impressions))}${small(`${fmt(T.reach)} reach (sum of daily)`)}`, eng: `${fmt(T.clicks)} clicks${T.video ? `, ${fmt(T.video)} video views` : ''}${small(`${pct(T.ctr, 2)} CTR, clicks ${dl(T.clicks, G.clicks)}`)}`, hand: `${fmt(T.leads)} form leads${small(dl(T.leads, G.leads))}${small(`${usd(T.cpl)} per lead, ${dl(T.cpl, G.cpl, true)}`)}${small((() => { const L = leadSplit((li && li.perf) || [], ctx.settings && ctx.settings.lead_rules); return `${fmt(L.byType.mql.leads)} MQL · ${fmt(L.byType.conversation.leads)} conversation · ${fmt(L.byType.playbook.leads)} playbook · ${fmt(L.byType.other.leads)} other`; })())}`, conv: H ? `${fmt(H.adMqls)} of ${fmt(H.adLeads)} ad leads reached MQL` : 'Needs the HubSpot pull', conf: conf(T.leads ? 'High' : 'Low') }; })() : { ch: '<b>LinkedIn ads</b>', since: '–', spend: '–', reach: '–', eng: '–', hand: '–', conv: '<span class="muted">not loaded</span>', conf: conf('Low') },
    ...otherAds.map(o => ({ ch: `<b>${esc(o.name)} ads</b>`, since: o.firstDay ? esc(monthLabel(o.firstDay.slice(0, 7))) : '–', spend: usd(o.spend), reach: `${fmt(o.impressions)} impressions`, eng: `${fmt(o.clicks)} clicks<br><span class="muted" style="font-size:11.5px">${pct(o.ctr, 2)} CTR</span>`, hand: `${fmt(o.leads)} leads<br><span class="muted" style="font-size:11.5px">${usd(o.cpl)} per lead</span>`, conv: '<span class="muted">platform-reported</span>', conf: conf(o.leads ? 'Medium' : 'Low') })),
    EM && (EM.sent || EM.uploads) ? { ch: '<b>Instantly email</b>', since: EM.since ? esc(monthLabel(EM.since.slice(0, 7))) : 'Jul 2026', spend: '<span class="muted">Tools and domains only</span>', reach: `${fmt(EM.sent)} emails sent<br><span class="muted" style="font-size:11.5px">${fmt(EM.newLeads)} new people · ${fmt(EM.campaigns)} active GSI campaigns</span>`, eng: `${fmt(EM.opens)} opens, ${fmt(EM.clicks)} unique clicks<br><span class="muted" style="font-size:11.5px">API clicks include scanners; see Email for human clicks</span>`, hand: `${fmt(EM.replies)} replies`, conv: `${fmt(EM.opps)} opportunities<br><span class="muted" style="font-size:11.5px"><a href="#/email/instantly">Book a Demo clickers in Email</a></span>`, conf: pill(EM.synced ? 'Medium' : 'Low', EM.synced ? 'p-med' : 'p-low') }
      : { ch: '<b>Instantly email</b>', since: 'Jul 2026', spend: '<span class="muted">Tools and domains only</span>', reach: '<span class="muted">No data yet</span>', eng: '<span class="muted">Upload exports or run the Instantly sync</span>', hand: '–', conv: '–', conf: pill('No data', 'p-na') },
    H ? { ch: '<b>HubSpot leads</b>', since: H.firstDay ? esc(monthLabel(H.firstDay.slice(0, 7))) : '–', spend: '<span class="muted">–</span>', reach: `${fmt(H.leads)} contacts pulled`, eng: `${fmt(H.withMessage)} wrote a message, ${fmt(H.withActivity)} touched`, hand: `${fmt(H.md + H.md1)} MD / MD-1, ${fmt(H.target)} at target accounts`, conv: `${fmt(H.mqls)} at MQL or later`, conf: conf(hs.last_sync && hs.last_sync.finished_at && (now - new Date(hs.last_sync.finished_at)) < 3 * 864e5 ? 'High' : 'Medium') } : { ch: '<b>HubSpot leads</b>', since: '–', spend: '–', reach: '–', eng: '–', hand: '–', conv: '<span class="muted">not loaded</span>', conf: conf('Low') },
  ] });

  // ---- target vs today -----------------------------------------------------------------------
  const leadsPace = T && T.leads ? scale(T.leads) : H ? scale(H.leads) : null;
  const leadsPaceSrc = T && T.leads ? 'LinkedIn form leads' : H ? 'HubSpot leads' : null;
  const demoPace = H ? scale(H.mqls) : null;
  const spendPace = T ? scale(T.spend) : null;
  const gauge = (label, pace, target, unit, note) => {
    const max = Math.max(target || 0, pace || 0, 1) * 1.15; const p = v => (v / max * 100).toFixed(1) + '%';
    return `<div class="card"><h3>${esc(label)}</h3>
      <div style="position:relative;height:16px;border-radius:8px;background:var(--soft);margin:22px 0 26px">
        ${pace != null ? `<i style="position:absolute;left:0;top:0;height:100%;width:${p(pace)};background:${pace >= (target || 0) ? 'var(--good)' : 'var(--orange)'};border-radius:8px"></i><span style="position:absolute;left:${p(pace)};top:-20px;transform:translateX(-50%);font-size:12px;white-space:nowrap"><b>Pace ${fmt(pace, 0)}</b></span>` : ''}
        ${target ? `<i style="position:absolute;left:${p(target)};top:-4px;height:24px;width:2px;background:var(--ink)"></i><span style="position:absolute;left:${p(target)};top:22px;transform:translateX(-50%);font-size:12px;white-space:nowrap;color:var(--ink)"><b>Target ${fmt(target)}</b></span>` : ''}
      </div>
      <div class="split" style="display:flex;gap:22px;flex-wrap:wrap"><div><b style="font-size:20px">${pace == null ? '–' : fmt(pace, 0)}</b><div class="muted" style="font-size:12.5px">${esc(unit)} a month at this pace</div></div><div><b style="font-size:20px;color:${pace != null && target && pace < target ? 'var(--bad)' : 'var(--good)'}">${pace == null || !target ? '–' : (pace >= target ? '+' : '') + fmt(pace - target, 0)}</b><div class="muted" style="font-size:12.5px">gap to target</div></div></div>
      <p class="muted" style="font-size:12.5px;margin-top:10px">${note}</p></div>`;
  };
  const gapRows = [
    { m: 'Leads a month', target: targets.leads_per_month, pace: leadsPace, gap: leadsPace != null ? targets.leads_per_month - leadsPace : null, need: T && T.cpl ? usd(T.cpl * targets.leads_per_month) + ' a month at ' + usd(T.cpl) + ' CPL' : '<span class="muted">needs LinkedIn spend and leads</span>', today: spendPace != null ? usd(spendPace) + ' a month spend pace' : '–' },
    { m: 'Book-a-demo MQLs a month', target: targets.demo_mqls_per_month, pace: demoPace, gap: demoPace != null ? targets.demo_mqls_per_month - demoPace : null, need: leadsPace ? `${pct(targets.demo_mqls_per_month / Math.max(1, leadsPace) * 100, 1)} lead-to-demo rate at the current lead pace` : '–', today: H ? `${fmt(H.mqls)} MQL+ contacts in range` : '–' },
  ];
  const targetsHtml = `<div class="grid g2">
    ${gauge(`${fmt(targets.leads_per_month)} leads a month`, leadsPace, targets.leads_per_month, 'leads', leadsPaceSrc ? `Pace = ${esc(leadsPaceSrc)} in range (${fmt(T && T.leads ? T.leads : H.leads)} over ${days} days) scaled to 30 days.` : 'No lead data loaded.')}
    ${gauge(`${fmt(targets.demo_mqls_per_month)} book-a-demo MQLs a month`, demoPace, targets.demo_mqls_per_month, 'MQLs', H ? `Pace = HubSpot contacts at MQL or later, created in range (${fmt(H.mqls)}), scaled to 30 days.` : 'Needs the HubSpot pull.')}
  </div><div style="margin-top:14px">${table({ cols: [
    { h: 'Metric', k: 'm', left: true, f: r => esc(r.m) }, { h: 'Target', k: 'target', f: r => fmt(r.target) }, { h: 'Pace (30 days)', k: 'pace', f: r => r.pace == null ? '–' : fmt(r.pace, 0) }, { h: 'Gap', k: 'gap', f: r => r.gap == null ? '–' : `<span class="${r.gap > 0 ? 'down' : 'up'}">${r.gap > 0 ? fmt(r.gap, 0) + ' short' : 'on target'}</span>` }, { h: 'What closes it', k: 'need', f: r => r.need }, { h: 'Today', k: 'today', f: r => r.today },
  ], rows: gapRows })}</div>`;

  // ---- needs attention -----------------------------------------------------------------------
  const alerts = [];
  if (T && TP && TP.leads && T.leads && T.cpl > TP.cpl * 1.3) alerts.push({ sev: 'risk', title: `Cost per lead is up ${fmt((T.cpl / TP.cpl - 1) * 100, 0)}% vs ${cmp ? cmp.label : 'the prior period'}`, evidence: `${usd(T.cpl)} now vs ${usd(TP.cpl)} for ${rangeLabel(prevFrom, prevTo)}.`, why: 'The lead-gen ad sets are cooling or spend moved to weaker audiences.', action: 'Check the ad-set table in Ads and move budget back to the sets under $40 CPL.', owner: 'Kailash', link: '#/ads/linkedin' });
  const ds = li ? directorShare(li) : null, dsPrev = liPrev ? directorShare(liPrev) : null;
  if (ds != null && dsPrev != null && dsPrev - ds >= 10) alerts.push({ sev: 'watch', title: `Director-and-above share of impressions fell ${fmt(dsPrev - ds, 0)} points`, evidence: `${pct(ds, 0)} now vs ${pct(dsPrev, 0)} in the prior windows (demographics exports overlapping each range).`, why: 'Volume is being bought below the buying bands.', action: 'Tighten seniority targeting on the lead-gen ad sets.', owner: 'Kailash', link: '#/ads/linkedin' });
  const tc = li ? topCountry(li) : null;
  if (tc && tc.share > 70) alerts.push({ sev: 'watch', title: `${tc.country} is ${pct(tc.share, 0)} of impressions`, evidence: `Country share from the demographics exports overlapping the range.`, why: 'One geography is crowding out the US, UK and Middle East audiences.', action: 'Cap the India budget or split the ad sets by region.', owner: 'Kailash', link: '#/ads/linkedin' });
  if (H && H.mdUnowned.length) alerts.push({ sev: 'risk', title: `${fmt(H.mdUnowned.length)} MD-band lead${H.mdUnowned.length > 1 ? 's have' : ' has'} no owner`, evidence: H.mdUnowned.slice(0, 4).map(r => `${r.name} (${r.account || r.company_raw || 'unknown company'})`).join(', ') + (H.mdUnowned.length > 4 ? ` and ${H.mdUnowned.length - 4} more.` : '.'), why: 'The most senior leads are the ones nobody is working.', action: 'Assign them today; the Leads view has the full list.', owner: 'Anju', link: '#/hubspot/leads' });
  const lastUpload = li && (li.uploads || []).reduce((m, u) => !m || u.uploaded_at > m ? u.uploaded_at : m, null);
  if (li && (!lastUpload || now - new Date(lastUpload) > 16 * 864e5)) alerts.push({ sev: 'watch', title: lastUpload ? `No LinkedIn upload for ${fmt((now - new Date(lastUpload)) / 864e5, 0)} days` : 'No LinkedIn export has been uploaded', evidence: lastUpload ? `Last upload ${istDateTime(lastUpload)}.` : 'The ads view has no data.', why: 'The ads numbers only run to the last upload; anything since is missing.', action: 'Export Performance and Demographics from Campaign Manager and drop them on the LinkedIn page.', owner: 'Kailash', link: '#/ads/linkedin' });
  const syncAt = hs && hs.last_sync && hs.last_sync.finished_at;
  if (hs && (!syncAt || now - new Date(syncAt) > 3 * 864e5)) alerts.push({ sev: 'watch', title: syncAt ? `HubSpot not synced for ${fmt((now - new Date(syncAt)) / 864e5, 0)} days` : 'HubSpot has never been synced', evidence: syncAt ? `Last sync ${istDateTime(syncAt)}.` : 'No sync record.', why: 'Lead counts, owners and activity are out of date.', action: 'Refresh from HubSpot in the messaging view.', owner: 'Anju', link: '#/hubspot/messaging' });
  const alertsHtml = alerts.length ? `<div class="grid g2">${alerts.map(a => `<div class="panel ${a.sev === 'risk' ? 'loss' : 'note'}"><div style="display:flex;gap:8px;align-items:baseline"><b>${esc(a.title)}</b>${pill(a.sev === 'risk' ? 'Risk' : 'Watch', a.sev === 'risk' ? 'p-low' : 'p-med')}</div><p class="muted" style="font-size:13px;margin-top:4px">${esc(a.evidence)}</p><p style="margin-top:6px">${esc(a.why)}</p><p style="margin-top:6px;font-size:13px"><b>Action:</b> ${esc(a.action)} <span class="muted">(${esc(a.owner)})</span> · <a href="${a.link}" style="color:inherit;text-decoration:underline">open the section</a></p></div>`).join('')}</div>` : empty('Nothing needs attention on the rules: CPL, seniority, geography, unowned MD leads, upload age and sync age all look fine.');

  // ---- links ---------------------------------------------------------------------------------
  const links = [
    ['ads/linkedin', 'Ads · LinkedIn', 'Spend, leads, CPL, month on month, account and seniority heat maps.'],
    ['ads/google', 'Ads · other platforms', 'Google, Meta, Taboola, ChatGPT, X and Bing: drop daily exports, get the same trends and read-out.'],
    ['email/instantly', 'Email · Instantly', 'Instantly GSI campaigns: Book a Demo, accounts, weeks, people lists.'],
    ['hubspot/messaging', 'HubSpot · Messaging', 'What leads are asking, by intent cluster, account and region.'],
    ['hubspot/leads', 'HubSpot · Leads', 'Bands, trend, heat maps, follow-up health, the full lead table.'],
    ['hubspot/pipeline', 'HubSpot · Pipeline', 'GSI/SI conversations by stage, partner and quarter, and what changed this week.'],
    ['linkedin/phantom', 'PhantomBuster', 'LinkedIn outreach phantoms: invites, acceptances, messages, replies per day.'],
    ['admin', 'Admin', 'GSI account list, designations, regions, targets, connections.'],
  ];

  // Channels at a glance picks its own comparison; the page still loads from the top bar and
  // Needs attention keeps the top-bar comparison. Only the glance table is redrawn on a change.
  const cmpGlance = sectionCompare(ctx, 'overview:glance', p => drawGlance(p));
  let TG = TP, dsGlance = dsPrev, lastPrev = cmp;
  async function drawGlance(p) {
    const box = el.querySelector('#o-glance-body'); if (!box) return;
    const data = p ? await memoGet(ctx, 'linkedin', { from: p.from, to: p.to }).catch(() => null) : null;
    if (!el.isConnected) return;
    TG = data ? liTotals(data) : null; dsGlance = data ? directorShare(data) : null; lastPrev = p;
    box.innerHTML = glanceHtml(p, TG);
  }

  el.innerHTML = `<div class="seghead">GSI and SI programme</div><h1>Overview</h1><div class="intro"><b>What this page is:</b> every channel side by side for the dates at the top (${esc(rangeLabel(from, to))}). <b>Channels at a glance</b> puts ads, email and HubSpot leads in one table. <b>Target vs today</b> takes the pace of the selected dates, scales it to a 30-day month and compares it with the monthly targets (Admin › Targets). <b>Needs attention</b> lists what the numbers flag this period. The <b>AI read-out</b> is Claude reading all of it and suggesting what to do; suggestions you track are checked again next time.</div>
    <div class="toc"><span class="tl">On this page</span><a href="#o-glance">Channels</a><a href="#o-target">Target vs today</a><a href="#o-alerts">Needs attention</a><a href="#o-board">Programme board</a><a href="#o-links">Sections</a><a href="#o-ai">AI read-out</a></div>
    ${section('Channels at a glance', `Paid ads and email produce hand-raisers; HubSpot shows what happened to the leads afterwards. Email numbers here come from the daily Instantly pull of every GSI-tagged campaign. LinkedIn changes are against the period chosen here. ${cmpGlance.html()}`, `<div id="o-glance-body">${spinner('Loading comparison')}</div>`, 'o-glance')}
    ${section('Target vs today', 'Monthly run-rate targets against the pace of the selected range.', targetsHtml, 'o-target')}
    ${section('Needs attention', 'Computed by rule from the data in range: CPL up more than 30% on the prior period, Director+ share down 10 points, one country over 70% of impressions, MD-band leads without an owner, no upload in 16 days, HubSpot not synced in 3 days.', alertsHtml, 'o-alerts')}
    ${section('Programme board', 'Every tracked action across ads, email and HubSpot by status. Change a status on the channel page; the next AI read-out is told what moved.', `<div id="ovBoard">${spinner('Loading actions')}</div>`, 'o-board')}
    ${section('Sections', '', `<div class="steps" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${links.map(([r, t, d]) => `<a class="step" href="#/${r}" style="text-decoration:none;color:inherit"><b>${esc(t)}</b><p class="muted" style="font-size:12.5px;margin-top:4px">${esc(d)}</p></a>`).join('')}</div>`, 'o-links')}
    ${section('AI read-out', 'Claude reads both channels and the target gap.', `<div id="ovInsights"></div>`, 'o-ai')}`;

  cmpGlance.wire(el);
  drawGlance(cmpGlance.prev);
  mountBoard(el.querySelector('#ovBoard'), ctx);
  ctx.mountInsights(el.querySelector('#ovInsights'), ctx, { scope: `overview:${from}:${to}`, kind: 'overview', title: 'Where the programme stands', inputProvider: () => ({
    range: { from, to, days }, targets,
    email: EM ? { sent: EM.sent, new_people: EM.newLeads, unique_opens: EM.opens, unique_clicks: EM.clicks, replies: EM.replies, opportunities: EM.opps, active_campaigns: EM.campaigns } : null,
    linkedin: T ? { spend: T.spend, impressions: T.impressions, clicks: T.clicks, leads: T.leads, cpl: T.cpl, videoViews: T.video, directorPlusShare: ds, topCountry: tc, prior: TG && lastPrev ? { label: lastPrev.label, spend: TG.spend, leads: TG.leads, cpl: TG.cpl, directorPlusShare: dsGlance } : null } : null,
    hubspot: H ? { leads: H.leads, withMessage: H.withMessage, withActivity: H.withActivity, target: H.target, md: H.md, md1: H.md1, md2: H.md2, unowned: H.unowned, mqls: H.mqls, adLeads: H.adLeads, adMqls: H.adMqls } : null,
    pace: { leads: leadsPace, demos: demoPace, spend: spendPace },
    alerts: alerts.map(a => ({ title: a.title, evidence: a.evidence, why: a.why, action: a.action, owner: a.owner })),
  }) });
}
