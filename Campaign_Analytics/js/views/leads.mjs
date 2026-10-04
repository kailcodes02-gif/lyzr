// Leads analytics: bands, trend, heat maps, sources, follow-up health, full lead table and a
// Claude read-out. All aggregation lives in js/lib/leads-agg.mjs (unit-tested).
import { BANDS, enrich, applyFilters, summary, bucketCounts, withGrowth, crossTab, rowTotal, sourceBreakdown, ownerHealth, actionList, sortRows, toCsv, ownerKey, countBy, sortedEntries, clusterShort, sourceChannel, sourceDetail, recentActivity, gsiMatcher, hasActivity, funnelCounts, funnelBySource, funnelByBucket, neverContacted, statusBreakdown, lastContactAt, firstContactAt, daysFrom, median, isFormLead, inGsiCampaign, gsiCampaignsOf, gsiSplit, gsiCampaignTable, replyType, share } from '../lib/leads-agg.mjs';
import { mountTrend } from '../trend.mjs';
import { sectionCompare, memoGet, deltaText } from '../compare.mjs';

export const route = 'leads';
export const title = 'Leads analytics';

const S = { gran: 'week', funnelGran: 'auto', excludeSpam: true, gsiOnly: false, gsiCampOnly: false, status: '', q: '', sort: { key: 'created_at', dir: -1 }, heatPick: null, limit: 200 };
let chart = null, trendX = null, funnelCharts = [];
let FUNNEL_SEQ = 0;
const HIST = { rows: null, at: 0 };
function killFunnelCharts() { for (const c of funnelCharts) { try { c.destroy(); } catch {} } funnelCharts = []; }
export function destroy() { if (chart) { try { chart.destroy(); } catch {} chart = null; } killFunnelCharts(); if (trendX) { trendX.destroy(); trendX = null; } }
async function copyText(ctx, text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
  ctx.toast(`Copied ${what}`);
}

const COLORS = { MD: '#043E77', 'MD-1': '#FE4B1E', 'MD-2': '#7A9CC6', Other: '#CFCCC7', Unknown: '#E3E1DE' };
const BAND_COLS = BANDS.map(b => ({ key: b, label: b }));
const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export async function render(el, ctx) {
  destroy();
  const { esc, fmt, pct, istDateTime, timeAgo, rangeLabel, bucketLabel, daysBetween } = ctx.fmt;
  const { tiles, pill, table, seg, section, spinner, empty } = ctx.ui;
  const { from, to } = ctx.state;
  const accounts = (ctx.settings && ctx.settings.accounts) || [];
  const now = Date.now();
  const head = `<div class="seghead">HubSpot · Leads</div><h1>GSI leads</h1><div class="intro"><b>GSI leads</b> are HubSpot contacts who submitted a form and work at a company on the GSI account list (Admin › GSI accounts). They are pulled from HubSpot every morning at 07:00 IST and counted by the date HubSpot created them, ${esc(rangeLabel(from, to))}. For each lead: company, designation band (MD, MD-1, MD-2 using that firm's own titles, everyone else Other), region, source, owner, lead status and the most recent activity.</div>`;
  el.innerHTML = head + spinner('Loading HubSpot leads');
  let data;
  try { data = await ctx.api.get('hubspot', { from, to }); } catch (e) { el.innerHTML = head + `<div class="empty">HubSpot data could not be loaded: ${esc(e.message || e)}</div>`; return; }
  const gsiOf = gsiMatcher((ctx.settings && ctx.settings.gsi_companies) || []);
  // Every pulled lead is at a GSI account (hubspot/refresh.js rules); extra names from Admin add to it.
  const decorate = list => list.map(r => ({ ...r, gsi: r.account || gsiOf(r), channel: sourceChannel(r), detail: sourceDetail(r), recent: recentActivity(r) }));
  // Only form leads count (isFormLead: HubSpot first conversion date set). Contacts an older pull rule stored are left out everywhere.
  const pulled = data.contacts || [];
  const nonFormN = pulled.filter(c => !isFormLead(c)).length;
  const all = decorate(enrich(pulled.filter(isFormLead), data.notes_by_contact || {}, accounts));
  const scopeLine = nonFormN ? `<p class="muted" id="scopeLine" style="font-size:12.5px;margin:-4px 0 12px">${fmt(nonFormN)} contact${nonFormN === 1 ? '' : 's'} in the store ${nonFormN === 1 ? 'is' : 'are'} not form leads (pulled by an older rule) and ${nonFormN === 1 ? 'is' : 'are'} left out; the next full HubSpot pull removes them.</p>` : '';
  // whole history for week-on-week / month-on-month (cached 10 minutes)
  { try { const d = await ctx.api.get('hubspot', {}); HIST.rows = decorate(enrich((d.contacts || []).filter(isFormLead), {}, accounts)); HIST.at = Date.now(); } catch { HIST.rows = all; } }
  if (!all.length) { el.innerHTML = head + scopeLine + empty(`No HubSpot leads for ${rangeLabel(from, to)}. Widen the range, or refresh HubSpot from the`, `<a href="#/hubspot/messaging">messaging view</a>.`); return; }
  const bandPill = b => pill(b || 'Unknown', b === 'MD' ? 'p-high' : b === 'MD-1' ? 'p-med' : b === 'MD-2' ? 'p-low' : 'p-na');
  const spamN = all.filter(r => r.spam).length;

  // The page filters (tests / spam, GSI only, status), applied the same way to the range, the comparison range and the lifetime pull.
  const filterRows = list => applyFilters(list, { excludeSpam: S.excludeSpam }).filter(r => (!S.gsiOnly || r.gsi) && (!S.gsiCampOnly || inGsiCampaign(r)) && (!S.status || (r.lead_status || 'No status') === S.status));
  let FUNNEL = null; // what the Sales funnel section last drew, for the AI read-out

  function draw() {
    destroy();
    const rows = filterRows(all);
    const cmpFunnel = sectionCompare(ctx, 'leads:funnel', p => drawFunnel(p));
    const byStatus = crossTab(rows, r => r.lead_status || 'No status', r => r.band || 'Unknown');
    const statuses = [...new Set(all.map(r => r.lead_status || 'No status'))].sort();
    const gsiN = rows.filter(r => r.gsi).length;
    const s = summary(rows);
    const buckets = withGrowth(bucketCounts(rows, S.gran, ctx.fmt.bucketKey));
    const byRegionBand = crossTab(rows, r => r.region || 'Other', r => r.band || 'Unknown');
    const targetRows = rows.filter(r => r.account);
    const byAccountBand = crossTab(targetRows, r => r.account, r => r.band || 'Unknown');
    const byAccountBucket = crossTab(targetRows, r => r.account, r => ctx.fmt.bucketKey(r.day, S.gran));
    const bySourceBand = crossTab(rows, r => r.channel, r => r.band || 'Unknown');
    const sources = sourceBreakdown(rows.map(r => ({ ...r, lead_source: r.channel })));
    const owners = ownerHealth(rows, now);
    const actions = actionList(rows, now, 7);
    const bucketKeys = buckets.map(b => b.key);
    const days = daysBetween(from, to);

    el.innerHTML = head + scopeLine + `
      <div class="toc"><span class="tl">On this page</span><a href="#l-tiles">Numbers</a><a href="#l-funnel">Sales funnel</a><a href="#l-status">Lead status</a><a href="#l-wow">Week / month</a><a href="#l-trend">Band trend</a><a href="#l-heat">Heat maps</a><a href="#l-sources">Sources</a><a href="#l-health">Follow-up health</a><a href="#l-table">All leads</a><a href="#l-ai">AI read-out</a>
        <span style="margin-left:auto;display:flex;gap:14px;align-items:center;font-size:12.5px;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="gsiToggle" ${S.gsiOnly ? 'checked' : ''}> GSI leads only</label>
        <label style="display:flex;gap:6px;align-items:center" title="Only leads that sit in at least one Instantly campaign tagged GSI"><input type="checkbox" id="gsiCampToggle" ${S.gsiCampOnly ? 'checked' : ''}> Leads in GSI-tagged campaigns only</label>
        <label style="display:flex;gap:6px;align-items:center">Status <select id="statusSel"><option value="">All</option>${statuses.map(x => `<option ${S.status === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="spamToggle" ${S.excludeSpam ? 'checked' : ''}> Exclude ${fmt(spamN)} tests / spam</label></span></div>
      ${section('Leads in range', '', tiles([
        { k: 'Leads', v: fmt(s.leads), d: `${fmt(s.leads / Math.max(1, days) * 30, 0)} a month at this pace` },
        { k: 'MD', v: fmt(s.md), d: pct(s.leads ? s.md / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'MD-1', v: fmt(s.md1), d: pct(s.leads ? s.md1 / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'MD-2', v: fmt(s.md2), d: pct(s.leads ? s.md2 / s.leads * 100 : null, 0) + ' of leads' },
        { k: 'Other / unknown band', v: fmt(s.other + s.unknown), d: `${fmt(s.unknown)} with no title` },
        { k: 'Target-account share', v: pct(s.leads ? s.target / s.leads * 100 : null, 0), d: `${fmt(s.target)} leads at named accounts` },
        { k: 'With activity', v: pct(s.leads ? s.withActivity / s.leads * 100 : null, 0), d: `${fmt(s.withActivity)} with notes or a logged touch` },
        { k: 'Unowned', v: fmt(s.unowned), d: s.unowned ? 'need an owner' : 'all leads owned' },
        { k: 'GSI leads', v: fmt(gsiN), d: `${pct(s.leads ? gsiN / s.leads * 100 : null, 0)} of leads, company on the GSI list` },
        { k: 'GSI form', v: fmt(rows.filter(r => r.channel === 'GSI form').length), d: 'source mentions GSI' },
        { k: 'In a GSI campaign', v: fmt(rows.filter(inGsiCampaign).length), d: `${pct(s.leads ? rows.filter(inGsiCampaign).length / s.leads * 100 : null, 0)} of leads are in a GSI-tagged Instantly campaign` },
        { k: 'Organic search', v: fmt(rows.filter(r => r.channel === 'Organic search').length), d: 'hs_analytics_source' },
        { k: 'No status set', v: fmt(rows.filter(r => !r.lead_status).length), d: 'lead status empty in HubSpot' },
      ]), 'l-tiles')}

      ${section('Sales funnel', `What sales did with the leads created in range. <b>Reached out</b> = HubSpot "Number of times contacted" or "Last contacted" is set, or a call, email or meeting is logged. <b>Replied (human)</b> = the lead wrote back themselves: a human reply email was read by the sync, or (before reply emails are stored) HubSpot shows a sales email reply and Instantly rated that reply with an interest status other than out of office. Leads whose only replies were automatic (out of office and similar) are shown beside it as <b>auto-reply only</b>, and HubSpot replies with nothing to say who wrote them as <b>reply type unknown</b>; neither passes the Replied step. <b>Demo booked</b> = lead status Demo Booked, any Demo or Intro Call status, Associated with a deal, or lifecycle MQL, SQL, Opportunity or Customer (an MQL is someone trying to book). <b>Demo completed</b> = a Demo Completed or Intro Call Completed status. <b>Sales prospect</b> = lifecycle SQL, Opportunity or Customer, or Associated with a deal. The funnel bars keep only leads that passed every earlier step; "any path" counts every lead at that stage whatever was logged before it, so a completed demo with no logged outreach still shows there. ${cmpFunnel.html()}`, `<div id="funnelBody">${spinner('Loading the funnel')}</div>`, 'l-funnel')}

      ${section('Lead status', 'HubSpot lead status (hs_lead_status) by band, with how many have any logged activity. Pick a status in the bar above to filter the whole page.', table({ cols: [
        { h: 'Lead status', k: 'st', left: true, f: r => `<b>${esc(r.st)}</b>` }, ...BANDS.map(b => ({ h: b, k: b, f: r => fmt(r[b] || 0) })), { h: 'Total', k: 'total', f: r => `<b>${fmt(r.total)}</b>` },
        { h: 'With activity', k: 'act', f: r => `${fmt(r.act)} (${pct(r.total ? r.act / r.total * 100 : null, 0)})` }, { h: 'GSI', k: 'gsi', f: r => fmt(r.gsi) }, { h: 'Unowned', k: 'un', f: r => r.un ? `<span class="down">${fmt(r.un)}</span>` : '0' },
      ], rows: [...byStatus.entries()].map(([st, m]) => { const list = rows.filter(r => (r.lead_status || 'No status') === st); return { st, ...Object.fromEntries(m), total: rowTotal(m), act: list.filter(hasActivity).length, gsi: list.filter(r => r.gsi).length, un: list.filter(r => !ownerKey(r)).length }; }).sort((a, b) => b.total - a.total) }), 'l-status')}

      ${section('Week on week and month on month', 'Every lead in the HubSpot pull, not only the selected range (the range is the darker bars). Toggle metrics, compare with the previous period or the average of earlier ones, and see the period in progress against the same days of earlier ones.', '<div id="wowBox"></div>', 'l-wow')}

      ${section('Band trend', 'New leads per period, stacked by band. Growth compares each period with the one before it; the last period may be partial.', `<div id="granSeg"></div><div class="card"><div class="chartbox"><canvas id="trendChart"></canvas></div></div>
        <div style="margin-top:14px">${table({ cols: [
          { h: 'Period', k: 'key', left: true, f: r => esc(bucketLabel(r.key, S.gran)) },
          ...BANDS.map(b => ({ h: b, k: b, f: r => fmt(r[b]) })),
          { h: 'Total', k: 'total', f: r => `<b>${fmt(r.total)}</b>` },
          { h: 'Growth', k: 'growth', f: r => r.growth == null ? '<span class="muted">–</span>' : `<span class="${r.growth >= 0 ? 'up' : 'down'}">${r.growth > 0 ? '+' : ''}${fmt(r.growth * 100, 0)}%</span>` },
        ], rows: buckets, total: { key: 'Total', ...Object.fromEntries(BANDS.map(b => [b, fmt(s[b === 'MD' ? 'md' : b === 'MD-1' ? 'md1' : b === 'MD-2' ? 'md2' : b === 'Other' ? 'other' : 'unknown'])])), total: fmt(s.leads), growth: '' } })}</div>`, 'l-trend')}

      ${section('Heat maps', 'Where the leads sit. Cells are counts on a square-root scale. In the account map, click a cell to list the people behind it.', `<div class="grid g2">
        <div class="card"><h3>Region × band</h3><div id="heatRegion"></div>${ctx.heat.legend()}</div>
        <div class="card"><h3>Source × band</h3><div id="heatSource"></div>${ctx.heat.legend()}</div>
        <div class="card"><h3>Account × band</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">Named target accounts only. ${fmt(rows.length - targetRows.length)} leads are outside the target list.</p><div id="heatAccount"></div>${ctx.heat.legend('navy')}</div>
        <div class="card"><h3>Account × ${S.gran}</h3><div id="heatAccountBucket" style="overflow-x:auto"></div>${ctx.heat.legend('navy')}</div>
      </div><div id="heatPick" style="margin-top:14px"></div>`, 'l-heat')}

      ${section('Sources', 'Where each lead came from: GSI form (any source field mentions GSI), LinkedIn lead form, then the HubSpot original source (organic search, paid social, direct, referral, offline import and so on), with the band mix and how many of each source are at target accounts.', table({ cols: [
        { h: 'Source', k: 'source', left: true, f: r => esc(r.source) }, { h: 'Leads', k: 'leads', f: r => fmt(r.leads) }, { h: 'Share', k: 'share', f: r => pct(r.leads / s.leads * 100, 0) },
        { h: 'MD', k: 'MD', f: r => fmt(r.MD) }, { h: 'MD-1', k: 'MD-1', f: r => fmt(r['MD-1']) }, { h: 'MD-2', k: 'MD-2', f: r => fmt(r['MD-2']) }, { h: 'Other', k: 'Other', f: r => fmt(r.Other + r.Unknown) },
        { h: 'MD / MD-1 share', k: 'mdshare', f: r => pct((r.MD + r['MD-1']) / r.leads * 100, 0) }, { h: 'Target accounts', k: 'target', f: r => `${fmt(r.target)} (${pct(r.target / r.leads * 100, 0)})` }, { h: 'With message', k: 'withMessage', f: r => fmt(r.withMessage) }, { h: 'With activity', k: 'active', f: r => pct(r.active / r.leads * 100, 0) },
      ], rows: sources }), 'l-sources')}

      ${section('Follow-up health', 'Who is working the leads. "Idle days" is the average age of leads that have no note or logged activity at all. The action list below is the set of MD and MD-1 leads at target accounts with no activity for 7 or more days.', `<div class="grid g2">
        <div>${table({ cols: [
          { h: 'Owner', k: 'owner', left: true, f: r => r.owner === 'Unassigned' ? '<span class="down">Unassigned</span>' : esc(r.owner) }, { h: 'Leads', k: 'leads', f: r => fmt(r.leads) }, { h: 'MD / MD-1', k: 'md', f: r => fmt(r.md) }, { h: 'Target', k: 'target', f: r => fmt(r.target) },
          { h: 'With activity', k: 'active', f: r => `${fmt(r.active)} (${pct(r.activeShare * 100, 0)})` }, { h: 'Last activity', k: 'lastActivity', f: r => r.lastActivity ? esc(timeAgo(r.lastActivity)) : '<span class="muted">none</span>' }, { h: 'Idle days (untouched)', k: 'avgIdleDays', f: r => r.avgIdleDays == null ? '<span class="muted">–</span>' : fmt(r.avgIdleDays, 0) },
        ], rows: owners })}</div>
        <div class="card"><h3>Action list: ${fmt(actions.length)} senior target-account leads idle 7+ days</h3>${actions.length ? `<div style="max-height:420px;overflow:auto">${actions.slice(0, 60).map(r => `<div style="border-top:1px solid var(--line);padding:8px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:baseline"><b>${esc(r.name)}</b><span class="muted">${esc(r.account)}${r.jobtitle ? ' · ' + esc(r.jobtitle) : ''}</span>${bandPill(r.band)}<span style="margin-left:auto" class="${r.idleDays >= 14 ? 'down' : ''}">${fmt(r.idleDays)} d ${r.touched ? 'since last touch' : 'untouched'}</span><span class="muted" style="flex-basis:100%;font-size:12.5px">${r.owner_name ? 'Owner ' + esc(r.owner_name) : '<span class="down">No owner</span>'} · created ${esc(istDateTime(r.created_at))}${r.lsa_message ? ' · “' + esc(truncate(r.lsa_message, 90)) + '”' : ''}</span></div>`).join('')}</div>` : '<p class="muted">Nothing outstanding. Every senior target-account lead was touched in the last 7 days.</p>'}</div>
      </div>`, 'l-health')}

      ${section('All leads', 'Search, click a header to sort, export what you see as CSV.', `<div class="row" style="margin-bottom:10px"><input type="search" id="leadQ" placeholder="Search name, company, title, message" value="${esc(S.q)}" style="min-width:280px"><span class="muted" id="leadCount" style="font-size:12.5px"></span><button class="btn tiny" id="csvBtn" style="margin-left:auto">Export CSV</button></div><div id="leadTable"></div>`, 'l-table')}
      ${section('AI read-out', 'Claude reads the aggregates on this page.', `<div id="leadsInsights"></div>`, 'l-ai')}`;

    // ---- wiring ------------------------------------------------------------------------------
    el.querySelector('#spamToggle').onchange = e => { S.excludeSpam = e.target.checked; draw(); };
    el.querySelector('#gsiToggle').onchange = e => { S.gsiOnly = e.target.checked; draw(); };
    el.querySelector('#gsiCampToggle').onchange = e => { S.gsiCampOnly = e.target.checked; draw(); };
    el.querySelector('#statusSel').onchange = e => { S.status = e.target.value; draw(); };
    const histRows = (HIST.rows || all).filter(r => (!S.excludeSpam || !r.spam) && (!S.gsiOnly || r.gsi) && (!S.gsiCampOnly || inGsiCampaign(r)));
    trendX = mountTrend(el.querySelector('#wowBox'), ctx, { id: 'leads', items: histRows, dayOf: r => r.day, range: { from, to }, defaults: { gran: 'week', metrics: ['leads', 'mdmd1', 'gsi'], compare: 'avg' }, metrics: [
      { key: 'leads', label: 'Leads', additive: true, fn: l => l.length },
      { key: 'mdmd1', label: 'MD + MD-1', additive: true, fn: l => l.filter(r => r.band === 'MD' || r.band === 'MD-1').length },
      { key: 'md2', label: 'MD-2', additive: true, fn: l => l.filter(r => r.band === 'MD-2').length },
      { key: 'gsi', label: 'GSI leads', additive: true, fn: l => l.filter(r => r.gsi).length },
      { key: 'target', label: 'Target-account leads', additive: true, fn: l => l.filter(r => r.account).length },
      { key: 'gsiform', label: 'GSI form', additive: true, fn: l => l.filter(r => r.channel === 'GSI form').length },
      { key: 'organic', label: 'Organic search', additive: true, fn: l => l.filter(r => r.channel === 'Organic search').length },
      { key: 'active', label: 'Worked (any activity)', additive: true, fn: l => l.filter(hasActivity).length },
      { key: 'seniorShare', label: 'MD + MD-1 share', fmt: 'pct', axis: 'right', fn: l => l.length ? l.filter(r => r.band === 'MD' || r.band === 'MD-1').length / l.length * 100 : null },
    ], note: 'Counted by HubSpot create date (IST). "Worked" is judged today, so older periods look better worked than recent ones.' });
    seg(el.querySelector('#granSeg'), [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], v => { S.gran = v; draw(); }, S.gran);

    // ---- sales funnel (its own comparison control; only this section redraws) ----------------
    cmpFunnel.wire(el);
    const loadRows = async params => { const d = await memoGet(ctx, 'hubspot', params); return filterRows(decorate(enrich((d.contacts || []).filter(isFormLead), d.notes_by_contact || {}, accounts))); };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const axisInk = dark ? '#B8B4AD' : '#6B675F', gridInk = dark ? '#34353A' : '#E3E1DE', legendInk = dark ? '#F1F0EE' : '#1F2022';
    async function drawFunnel(p) {
      const box = el.querySelector('#funnelBody'); if (!box) return;
      const seq = ++FUNNEL_SEQ;
      box.innerHTML = spinner('Loading the funnel');
      const [prevRows, lifeRows] = await Promise.all([p ? loadRows({ from: p.from, to: p.to }).catch(() => []) : [], loadRows({}).catch(() => null)]);
      if (seq !== FUNNEL_SEQ || !el.isConnected || el.querySelector('#funnelBody') !== box) return;
      killFunnelCharts();
      const F = funnelCounts(rows), FP = funnelCounts(prevRows), FL = lifeRows ? funnelCounts(lifeRows) : null;
      const gran = S.funnelGran === 'auto' ? (days > 70 ? 'month' : 'week') : S.funnelGran;
      const bySource = funnelBySource(rows);
      const byBucket = funnelByBucket(rows, gran, ctx.fmt.bucketKey);
      const never = neverContacted(rows);
      const statuses = statusBreakdown(rows);
      const medLast = median(rows.map(r => daysFrom(r.created_at, lastContactAt(r))).filter(x => x != null));
      const medFirst = median(rows.map(r => daysFrom(r.created_at, firstContactAt(r))).filter(x => x != null));
      const lifeFirst = lifeRows && lifeRows.length ? lifeRows.reduce((m, r) => !m || r.day < m ? r.day : m, null) : null;
      const stepRow = s => ({ ...s, prevN: FP.cumulative[s.key] });
      const split = gsiSplit(rows), camps = gsiCampaignTable(rows), RS = F.replies;
      const anyInstantly = rows.some(r => Array.isArray(r.instantly) && r.instantly.length);
      const pctOf = v => v == null ? '<span class="muted">–</span>' : pct(v * 100, 0);
      FUNNEL = { range: { from, to, generated: F.generated, cumulative: F.cumulative, raw: F.raw }, comparison: p ? { label: p.label, generated: FP.generated, cumulative: FP.cumulative, raw: FP.raw } : null, lifetime: FL ? { since: lifeFirst, generated: FL.generated, cumulative: FL.cumulative, raw: FL.raw } : null, origin: split.map(x => ({ origin: x.label, leads: x.n, share: x.share, demoBooked: x.booked })), gsiCampaigns: camps.slice(0, 15).map(x => ({ campaign: x.campaign_name, leads: x.generated, repliedHuman: x.repliedHuman, demoBooked: x.booked })), replies: { human: RS.human, autoOnly: RS.auto, unknown: RS.unknown }, bySource: bySource.slice(0, 8), byBucket: byBucket.slice(-8).map(b => ({ period: b.key, generated: b.generated, reached: b.reached, replied: b.replied, booked: b.booked, completed: b.completed, prospect: b.prospect, medianDaysToContact: b.medianDaysToContact })), neverContacted: { count: never.length, oldestSince: never[0] ? never[0].day : null }, medianDaysToLastContact: medLast, statuses: statuses.slice(0, 12).map(s => ({ status: s.label, n: s.n, countsAs: s.countsAs })) };

      box.innerHTML = `
        <h3>Where the leads came from</h3>
        <p class="muted" style="font-size:12.5px;margin-bottom:8px">Every lead here submitted a form. A lead counts as <b>in a GSI-tagged campaign</b> when its email sits in at least one Instantly campaign tagged GSI; everyone else is a form lead at a GSI account that no GSI campaign reached.${anyInstantly ? '' : ' <span class="down">No Instantly campaign data is matched to these leads yet, so every lead shows as not in a GSI campaign until the Instantly lead sync has run.</span>'}</p>
        <div id="originBox">${table({ cols: [
          { h: 'Origin', k: 'label', left: true, f: x => `<b>${esc(x.label)}</b>` },
          { h: 'Leads', k: 'n', f: x => `<b>${fmt(x.n)}</b>` },
          { h: 'Share', k: 'share', f: x => pctOf(x.share) },
          { h: 'Demo booked', k: 'booked', f: x => `${fmt(x.booked)} <span class="muted">(${pctOf(x.bookedShare)})</span>` },
        ], rows: split, total: { label: 'Generated', n: `<b>${fmt(F.generated)}</b>`, share: pctOf(F.generated ? 1 : null), booked: fmt(split.reduce((a, x) => a + x.booked, 0)) } })}</div>
        <div style="margin-top:12px" id="gsiCampBox">${camps.length ? table({ cols: [
          { h: 'GSI campaign', k: 'campaign_name', left: true, f: x => esc(x.campaign_name) },
          { h: 'Leads', k: 'generated', f: x => `<b>${fmt(x.generated)}</b>` },
          { h: 'Replied (human)', k: 'repliedHuman', f: x => fmt(x.repliedHuman) + (x.autoOnly ? ` <span class="muted">(+${fmt(x.autoOnly)} auto only)</span>` : '') },
          { h: 'Demo booked', k: 'booked', f: x => fmt(x.booked) },
        ], rows: camps }) + '<p class="muted" style="font-size:12.5px;margin-top:6px">A lead in two GSI campaigns counts under both, so this column can add up to more than the leads in GSI campaigns.</p>' : '<p class="muted">No lead in range sits in a GSI-tagged Instantly campaign.</p>'}</div>

        <h3 style="margin-top:18px">Replies</h3>
        <div id="replySplit">${tiles([
          { k: 'Human reply', v: fmt(RS.human), d: `${pctOf(share(RS.human, F.generated))} of leads; counts as Replied` },
          { k: 'Auto-reply only', v: fmt(RS.auto), d: 'out of office or similar, no human reply' },
          { k: 'Reply type unknown', v: fmt(RS.unknown), d: 'HubSpot shows a reply, no reply email stored yet' },
        ])}</div>

        <div class="grid g2w" style="margin-top:18px">
          <div class="card"><h3>Leads created ${esc(rangeLabel(from, to))}</h3><div class="chartbox short"><canvas id="funnelChart"></canvas></div></div>
          <div>${table({ cols: [
            { h: 'Stage', k: 'label', left: true, f: s => `<b>${esc(s.label)}</b>${s.key === 'replied' ? `<br><span class="muted" style="font-size:11.5px">auto-reply only ${fmt(RS.auto)} · reply type unknown ${fmt(RS.unknown)}</span>` : ''}` },
            { h: 'Leads', k: 'n', f: s => `<b>${fmt(s.n)}</b>` },
            { h: 'Of generated', k: 'g', f: s => pctOf(s.ofGenerated) },
            { h: 'Of previous step', k: 'p', f: s => s.ofPrev == null ? '<span class="muted">–</span>' : pctOf(s.ofPrev) },
            { h: 'Any path', k: 'raw', f: s => s.raw === s.n ? fmt(s.raw) : `${fmt(s.raw)} <span class="muted">(+${fmt(s.raw - s.n)})</span>` },
            { h: p ? `vs ${esc(p.label)}` : 'Comparison', k: 'd', left: true, f: s => deltaText(p, s.n, s.prevN) + (p && s.prevN ? ` <span class="muted">(${fmt(s.prevN)})</span>` : '') },
          ], rows: F.steps.map(stepRow) })}
          <p class="muted" style="font-size:12.5px;margin-top:8px">Median time from lead to last contact: ${medLast == null ? 'no contact dates yet' : fmt(medLast, 1) + ' days'}${medFirst != null && medLast != null && Math.abs(medFirst - medLast) >= 0.5 ? ` (first contact ${fmt(medFirst, 1)} days)` : ''}. HubSpot's "Last contacted" is the last touch, so the first touch is only known when calls, emails or meetings are logged as notes.</p></div>
        </div>

        <h3 style="margin-top:18px">Lifetime <span class="muted" style="font-weight:400;font-size:13px">all leads pulled so far${FL ? `: ${fmt(FL.generated)} leads${lifeFirst ? ` since ${esc(ctx.fmt.dayLabel(lifeFirst))}` : ''}` : ''}</span></h3>
        ${FL ? tiles(FL.steps.map(s => ({ k: s.label, v: fmt(s.n), d: `${s.ofGenerated == null ? '' : pct(s.ofGenerated * 100, 0) + ' of all leads'}${s.raw !== s.n ? ` · ${fmt(s.raw)} any path` : ''}` }))) : '<p class="muted">The lifetime pull could not be loaded.</p>'}

        <div style="margin-top:18px">
          <div><h3>By source</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">HubSpot lead source first (Book a demo form, LinkedIn, Contact us, a playbook or asset form, events, outbound), else the analytics source. Each column counts every lead that reached that stage, whatever path it took.</p>${table({ cols: [
            { h: 'Source', k: 'source', left: true, f: r => esc(r.source) }, { h: 'Generated', k: 'generated', f: r => `<b>${fmt(r.generated)}</b>` },
            { h: 'Reached out', k: 'reached', f: r => `${fmt(r.reached)} <span class="muted">(${pct(r.generated ? r.reached / r.generated * 100 : null, 0)})</span>` }, { h: 'Replied (human)', k: 'replied', f: r => fmt(r.replied) }, { h: 'Auto only', k: 'autoOnly', f: r => fmt(r.autoOnly || 0) },
            { h: 'Demo booked', k: 'booked', f: r => fmt(r.booked) }, { h: 'Demo completed', k: 'completed', f: r => fmt(r.completed) }, { h: 'Prospects', k: 'prospect', f: r => fmt(r.prospect) },
          ], rows: bySource, total: { source: 'Total', generated: fmt(F.generated), reached: `${fmt(F.raw.reached)} (${pct(F.generated ? F.raw.reached / F.generated * 100 : null, 0)})`, replied: fmt(F.raw.replied), autoOnly: fmt(RS.auto), booked: fmt(F.raw.booked), completed: fmt(F.raw.completed), prospect: fmt(F.raw.prospect) } })}</div>
          <div style="margin-top:18px"><h3>Lead status in HubSpot</h3><p class="muted" style="font-size:12.5px;margin-bottom:8px">What HubSpot calls each lead right now (hs_lead_status, portal label) and which funnel stage that status counts as.</p>${table({ cols: [
            { h: 'Status', k: 'label', left: true, f: r => r.label === r.status || !r.status ? esc(r.label) : `${esc(r.label)} <span class="muted">(${esc(r.status)})</span>` }, { h: 'Leads', k: 'n', f: r => `<b>${fmt(r.n)}</b>` },
            { h: 'Reached out', k: 'reached', f: r => fmt(r.reached) }, { h: 'Replied (human)', k: 'replied', f: r => fmt(r.replied) },
            { h: 'Counts as', k: 'countsAs', f: r => r.countsAs ? pill(r.countsAs, r.countsAs === 'Sales prospect' ? 'p-high' : r.countsAs === 'Demo completed' ? 'p-med' : 'p-low') : '<span class="muted">–</span>' },
          ], rows: statuses })}</div>
        </div>

        <h3 style="margin-top:18px">Outreach by date</h3>
        <p class="muted" style="font-size:12.5px;margin-bottom:8px">Leads by the ${gran} HubSpot created them, and how many of each ${gran}'s leads sales has reached out to since (judged today, so older periods look better worked than recent ones). "Days to contact" is the median from lead to last contact.</p>
        <div id="funnelGranSeg" style="margin-bottom:10px"></div>
        <div class="card"><div class="chartbox short"><canvas id="outreachChart"></canvas></div></div>
        <div style="margin-top:14px">
          <div>${table({ cols: [
            { h: gran === 'month' ? 'Month' : 'Week', k: 'key', left: true, f: b => esc(bucketLabel(b.key, gran)) }, { h: 'Leads', k: 'generated', f: b => `<b>${fmt(b.generated)}</b>` },
            { h: 'Reached out', k: 'reached', f: b => fmt(b.reached) }, { h: 'Not yet', k: 'notReached', f: b => b.notReached ? `<span class="down">${fmt(b.notReached)}</span>` : '0' }, { h: '% reached', k: 'reachedShare', f: b => pctOf(b.reachedShare) },
            { h: 'Days to contact', k: 'medianDaysToContact', f: b => b.medianDaysToContact == null ? '<span class="muted">–</span>' : fmt(b.medianDaysToContact, 1) },
            { h: 'Replied (human)', k: 'replied', f: b => fmt(b.replied) + (b.autoOnly ? ` <span class="muted">(+${fmt(b.autoOnly)} auto)</span>` : '') }, { h: 'Demos', k: 'booked', f: b => `${fmt(b.booked)}${b.completed ? ` <span class="muted">(${fmt(b.completed)} done)</span>` : ''}` },
          ], rows: byBucket })}</div>
        </div>
        <div class="card" style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>${never.length ? `<b>${fmt(never.length)}</b> lead${never.length === 1 ? '' : 's'} created in range ${never.length === 1 ? 'has' : 'have'} never been contacted; oldest since <b>${esc(ctx.fmt.dayLabel(never[0].day))}</b> (${esc(timeAgo(never[0].created_at))}).` : 'Every lead created in range has been contacted at least once.'}</span>${never.length ? `<button class="btn tiny" id="copyNever" style="margin-left:auto">Copy ${fmt(never.filter(r => r.email).length)} emails</button>` : ''}</div>`;

      seg(box.querySelector('#funnelGranSeg'), [{ value: 'auto', label: days > 70 ? 'Auto (month)' : 'Auto (week)' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], v => { S.funnelGran = v; drawFunnel(p); }, S.funnelGran);
      const copyBtn = box.querySelector('#copyNever');
      if (copyBtn) copyBtn.onclick = () => { const list = never.filter(r => r.email).map(r => r.email); copyText(ctx, list.join('\n'), `${list.length} emails`); };

      if (typeof Chart !== 'undefined') {
        const barOpts = extra => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: legendInk, boxWidth: 12 } }, tooltip: { mode: 'index' } }, ...extra });
        funnelCharts.push(new Chart(box.querySelector('#funnelChart'), { type: 'bar', data: { labels: F.steps.map(s => s.label), datasets: [
          { label: 'Passed every earlier step', data: F.steps.map(s => s.n), backgroundColor: '#043E77', borderWidth: 0 },
          { label: 'Any path', data: F.steps.map(s => s.raw), backgroundColor: '#7A9CC6', borderWidth: 0 },
        ] }, options: barOpts({ indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0, color: axisInk }, grid: { color: gridInk } }, y: { ticks: { color: axisInk }, grid: { display: false } } } }) }));
        funnelCharts.push(new Chart(box.querySelector('#outreachChart'), { type: 'bar', data: { labels: byBucket.map(b => bucketLabel(b.key, gran)), datasets: [
          { label: 'Reached out', data: byBucket.map(b => b.reached), backgroundColor: '#043E77', borderWidth: 0, stack: 'a' },
          { label: 'Not yet reached', data: byBucket.map(b => b.notReached), backgroundColor: '#FE4B1E', borderWidth: 0, stack: 'a' },
          { label: 'Demo booked', data: byBucket.map(b => b.booked), backgroundColor: '#CFCCC7', borderWidth: 0, stack: 'b' },
        ] }, options: barOpts({ scales: { x: { stacked: true, grid: { display: false }, ticks: { color: axisInk } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: axisInk }, grid: { color: gridInk } } } }) }));
      }
    }
    drawFunnel(cmpFunnel.prev);

    // chart
    if (typeof Chart !== 'undefined') {
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      chart = new Chart(el.querySelector('#trendChart'), { type: 'bar', data: { labels: buckets.map(b => bucketLabel(b.key, S.gran)), datasets: BANDS.filter(b => b !== 'Unknown' || rows.some(r => r.band === 'Unknown')).map(b => ({ label: b, data: buckets.map(x => x[b]), backgroundColor: COLORS[b], borderWidth: 0, stack: 'a' })) },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: dark ? '#B8B4AD' : '#6B675F' } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: dark ? '#B8B4AD' : '#6B675F' }, grid: { color: dark ? '#34353A' : '#E3E1DE' } } }, plugins: { legend: { position: 'bottom', labels: { color: dark ? '#F1F0EE' : '#1F2022', boxWidth: 12 } }, tooltip: { mode: 'index' } } } });
    }

    // heat maps
    const heatFrom = (m, cols, elId, color, onClick) => ctx.heat.renderHeat(el.querySelector(elId), { corner: '', rows: [...m.keys()].map(k => ({ key: k, label: k })), cols, cell: (r, c) => ({ v: (m.get(r) || new Map()).get(c) || 0 }), rowTotal: r => fmt(rowTotal(m.get(r))), colTotal: c => fmt([...m.values()].reduce((a, row) => a + (row.get(c) || 0), 0)), color, onClick });
    heatFrom(byRegionBand, BAND_COLS, '#heatRegion', 'orange', (r, c) => pickCell('region', r, c));
    heatFrom(bySourceBand, BAND_COLS, '#heatSource', 'orange', (r, c) => pickCell('source', r, c));
    if (byAccountBand.size) heatFrom(byAccountBand, BAND_COLS, '#heatAccount', 'navy', (r, c) => pickCell('account', r, c)); else el.querySelector('#heatAccount').innerHTML = '<p class="muted">No target-account leads in range.</p>';
    if (byAccountBucket.size) heatFrom(byAccountBucket, bucketKeys.map(k => ({ key: k, label: bucketLabel(k, S.gran) })), '#heatAccountBucket', 'navy', (r, c) => pickCell('accountBucket', r, c)); else el.querySelector('#heatAccountBucket').innerHTML = '<p class="muted">No target-account leads in range.</p>';
    function pickCell(kind, r, c) {
      const list = rows.filter(x => kind === 'region' ? (x.region || 'Other') === r && (x.band || 'Unknown') === c : kind === 'source' ? x.channel === r && (x.band || 'Unknown') === c : kind === 'account' ? x.account === r && (x.band || 'Unknown') === c : x.account === r && ctx.fmt.bucketKey(x.day, S.gran) === c);
      const label = kind === 'accountBucket' ? `${r} · ${bucketLabel(c, S.gran)}` : `${r} · ${c}`;
      el.querySelector('#heatPick').innerHTML = `<div class="card"><div style="display:flex;align-items:baseline;gap:10px"><h3 style="margin:0">${esc(label)}: ${fmt(list.length)} ${list.length === 1 ? 'person' : 'people'}</h3><button class="btn tiny ghost" id="pickClose" style="margin-left:auto">Close</button></div>${list.length ? table({ cols: [
        { h: 'Name', k: 'name', left: true, f: x => esc(x.name) }, { h: 'Title', k: 'jobtitle', left: true, f: x => esc(x.jobtitle || '–') }, { h: 'Company', k: 'company_raw', left: true, f: x => esc(x.account || x.company_raw || '–') }, { h: 'Band', k: 'band', f: x => bandPill(x.band) }, { h: 'Owner', k: 'owner_name', f: x => esc(x.owner_name || '–') }, { h: 'Created', k: 'created_at', f: x => esc(istDateTime(x.created_at)) }, { h: 'Last activity', k: 'last_activity_at', f: x => x.last_activity_at ? esc(timeAgo(x.last_activity_at)) : '<span class="muted">none</span>' }, { h: 'Message', k: 'lsa_message', left: true, f: x => esc(truncate(x.lsa_message, 90)) },
      ], rows: list.slice(0, 100) }) : ''}</div>`;
      el.querySelector('#pickClose').onclick = () => { el.querySelector('#heatPick').innerHTML = ''; };
      el.querySelector('#heatPick').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // full table
    const COLS = [
      { k: 'name', h: 'Name', left: true, f: r => `${esc(r.name)}<br><span class="muted" style="font-size:11.5px">${esc(r.email || '')}</span>`, csv: r => r.name },
      { k: 'company', h: 'Account / company', left: true, g: r => r.account || r.company_raw || '', f: r => r.account ? `<b>${esc(r.account)}</b>` : esc(r.company_raw || '–'), csv: r => r.account || r.company_raw || '' },
      { k: 'jobtitle', h: 'Title', left: true, f: r => esc(r.jobtitle || '–') },
      { k: 'band', h: 'Band', f: r => bandPill(r.band) },
      { k: 'region', h: 'Region', f: r => esc(r.region || 'Other'), csv: r => r.region || 'Other' },
      { k: 'status', h: 'Lead status', g: r => r.lead_status || '', f: r => r.lead_status ? esc(r.lead_status) : '<span class="muted">none</span>', csv: r => r.lead_status || '' },
      { k: 'gsi', h: 'GSI', g: r => r.gsi || '', f: r => r.gsi ? `<span class="pill p-high" title="Matches ${esc(r.gsi)} on the GSI list">GSI</span>` : '', csv: r => r.gsi || '' },
      { k: 'gsicamp', h: 'GSI campaign', left: true, g: r => gsiCampaignsOf(r).map(x => x.campaign_name).join(', '), f: r => { const l = gsiCampaignsOf(r); return l.length ? esc(truncate(l.map(x => x.campaign_name).join(', '), 60)) : '<span class="muted">–</span>'; }, csv: r => gsiCampaignsOf(r).map(x => x.campaign_name).join('; ') },
      { k: 'source', h: 'Source', g: r => r.channel, f: r => `${esc(r.channel)}${r.detail && r.detail !== r.channel ? `<br><span class="muted" style="font-size:11.5px">${esc(truncate(r.detail, 60))}</span>` : ''}`, csv: r => r.channel + (r.detail ? ' · ' + r.detail : '') },
      { k: 'owner', h: 'Owner', g: r => ownerKey(r), f: r => r.owner_name ? esc(r.owner_name) : '<span class="down">none</span>', csv: r => r.owner_name || '' },
      { k: 'created_at', h: 'Created (IST)', f: r => esc(istDateTime(r.created_at)), csv: r => istDateTime(r.created_at) },
      { k: 'recent', h: 'Recent activity', g: r => r.recent ? r.recent.ts : '', f: r => r.recent ? `<b style="font-weight:600">${esc(r.recent.label)}</b> · ${esc(timeAgo(r.recent.ts))}${r.recent.detail ? `<br><span class="muted" style="font-size:11.5px" title="${esc(r.recent.detail)}">${esc(truncate(r.recent.detail, 80))}</span>` : ''}` : '<span class="muted">nothing logged</span>', csv: r => r.recent ? `${r.recent.label} · ${istDateTime(r.recent.ts)}${r.recent.detail ? ' · ' + r.recent.detail : ''}` : '' },
      { k: 'notes_count', h: 'Notes', f: r => fmt(r.notes_count), g: r => Number(r.notes_count) || 0 },
      { k: 'lsa_message', h: 'Message', left: true, f: r => r.lsa_message ? `<span title="${esc(r.lsa_message)}">${esc(truncate(r.lsa_message, 90))}</span>` : '<span class="muted">–</span>' },
    ];
    let shown = [];
    function drawTable() {
      const list = applyFilters(rows, { q: S.q });
      const col = COLS.find(c => c.k === S.sort.key) || COLS.find(c => c.k === 'created_at');
      shown = sortRows(list, col.k, S.sort.dir, col.g);
      el.querySelector('#leadCount').textContent = `${fmt(Math.min(shown.length, S.limit))} of ${fmt(shown.length)} shown${S.q ? ` for "${S.q}"` : ''}`;
      el.querySelector('#leadTable').innerHTML = `<div class="tblwrap"><table><thead><tr>${COLS.map(c => `<th class="${c.left ? 'l' : ''}" data-sort="${c.k}" style="cursor:pointer;user-select:none">${esc(c.h)}${S.sort.key === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${shown.slice(0, S.limit).map(r => `<tr>${COLS.map(c => `<td class="${c.left ? 'l' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${shown.length > S.limit ? `<p class="muted" style="font-size:12.5px;margin-top:6px"><button class="btn tiny" id="moreBtn">Show ${fmt(Math.min(200, shown.length - S.limit))} more</button></p>` : ''}`;
      el.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'created_at' || k === 'notes_count' || k === 'recent' ? -1 : 1) }; drawTable(); });
      const more = el.querySelector('#moreBtn'); if (more) more.onclick = () => { S.limit += 200; drawTable(); };
    }
    drawTable();
    let t = null; el.querySelector('#leadQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.limit = 200; drawTable(); }, 150); };
    el.querySelector('#csvBtn').onclick = () => {
      const csv = toCsv(shown, COLS.map(c => ({ h: c.h, f: c.csv || c.g || (r => r[c.k]) })).concat([{ h: 'Reply type', f: r => ({ human: 'human', auto: 'auto-reply only', unknown: 'unknown' })[replyType(r)] || '' }, { h: 'Email', f: r => r.email }, { h: 'Country', f: r => r.country }, { h: 'HubSpot id', f: r => r.hs_id }]));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `lyzr-leads-${from}-to-${to}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      ctx.toast(`Exported ${fmt(shown.length)} leads`);
    };

    // AI
    ctx.mountInsights(el.querySelector('#leadsInsights'), ctx, { scope: `leads:${from}:${to}`, kind: 'leads', title: 'What the lead mix says', inputProvider: () => ({
      range: { from, to, days }, summary: s, bands: { MD: s.md, 'MD-1': s.md1, 'MD-2': s.md2, Other: s.other, Unknown: s.unknown },
      trend: buckets.map(b => ({ period: b.key, total: b.total, MD: b.MD, 'MD-1': b['MD-1'], 'MD-2': b['MD-2'], growth: b.growth })),
      regions: [...byRegionBand.entries()].map(([k, m]) => ({ region: k, total: rowTotal(m), ...Object.fromEntries(m) })),
      accounts: [...byAccountBand.entries()].map(([k, m]) => ({ account: k, total: rowTotal(m), ...Object.fromEntries(m) })).sort((a, b) => b.total - a.total).slice(0, 25),
      sources: sources.map(x => ({ source: x.source, leads: x.leads, MD: x.MD, 'MD-1': x['MD-1'], 'MD-2': x['MD-2'], target: x.target, active: x.active })),
      owners: owners.map(o => ({ owner: o.owner, leads: o.leads, active: o.active, md: o.md, avgIdleDays: o.avgIdleDays })),
      clusters: Object.fromEntries(sortedEntries(countBy(rows.filter(r => r.cluster), r => clusterShort(r.cluster)))),
      lead_status: [...byStatus.entries()].map(([k, m]) => ({ status: k, total: rowTotal(m) })), gsi_leads: gsiN, channels: Object.fromEntries(sortedEntries(countBy(rows, r => r.channel))),
      actionCount: actions.length, actionSample: actions.slice(0, 15).map(r => ({ account: r.account, title: r.jobtitle, band: r.band, owner: r.owner_name, idleDays: r.idleDays })),
      funnel: FUNNEL,
    }) });
  }
  draw();
}
