// Leads analytics: bands, trend, heat maps, sources, follow-up health, full lead table and a
// Claude read-out. All aggregation lives in js/lib/leads-agg.mjs (unit-tested).
import { BANDS, enrich, applyFilters, summary, bucketCounts, withGrowth, crossTab, rowTotal, sourceBreakdown, ownerHealth, actionList, sortRows, toCsv, ownerKey, countBy, sortedEntries, clusterShort, sourceChannel, sourceDetail, recentActivity, gsiMatcher, hasActivity } from '../lib/leads-agg.mjs';
import { mountTrend } from '../trend.mjs';

export const route = 'leads';
export const title = 'Leads analytics';

const S = { gran: 'week', excludeSpam: true, gsiOnly: false, status: '', q: '', sort: { key: 'created_at', dir: -1 }, heatPick: null, limit: 200 };
let chart = null, trendX = null;
const HIST = { rows: null, at: 0 };
export function destroy() { if (chart) { try { chart.destroy(); } catch {} chart = null; } if (trendX) { trendX.destroy(); trendX = null; } }

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
  const head = `<div class="seghead">Channel · HubSpot</div><h1>Leads analytics</h1><p class="sub">Every HubSpot lead pulled by the GSI rules, counted by create date (IST), ${esc(rangeLabel(from, to))}. Bands follow the Settings conventions: MD, MD-1, MD-2, everyone else is Other.</p>`;
  el.innerHTML = head + spinner('Loading HubSpot leads');
  let data;
  try { data = await ctx.api.get('hubspot', { from, to }); } catch (e) { el.innerHTML = head + `<div class="empty">HubSpot data could not be loaded: ${esc(e.message || e)}</div>`; return; }
  const gsiOf = gsiMatcher((ctx.settings && ctx.settings.gsi_companies) || []);
  const decorate = list => list.map(r => ({ ...r, gsi: gsiOf(r), channel: sourceChannel(r), detail: sourceDetail(r), recent: recentActivity(r) }));
  const all = decorate(enrich(data.contacts || [], data.notes_by_contact || {}, accounts));
  // whole history for week-on-week / month-on-month (cached 10 minutes)
  if (!HIST.rows || Date.now() - HIST.at > 10 * 60e3) { try { const d = await ctx.api.get('hubspot', {}); HIST.rows = decorate(enrich(d.contacts || [], {}, accounts)); HIST.at = Date.now(); } catch { HIST.rows = all; } }
  if (!all.length) { el.innerHTML = head + empty(`No HubSpot leads for ${rangeLabel(from, to)}. Widen the range, or refresh HubSpot from the`, `<a href="#/messaging">messaging view</a>.`); return; }
  const bandPill = b => pill(b || 'Unknown', b === 'MD' ? 'p-high' : b === 'MD-1' ? 'p-med' : b === 'MD-2' ? 'p-low' : 'p-na');
  const spamN = all.filter(r => r.spam).length;

  function draw() {
    destroy();
    const rows = applyFilters(all, { excludeSpam: S.excludeSpam }).filter(r => (!S.gsiOnly || r.gsi) && (!S.status || (r.lead_status || 'No status') === S.status));
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

    el.innerHTML = head + `
      <div class="toc"><span class="tl">On this page</span><a href="#l-tiles">Numbers</a><a href="#l-status">Lead status</a><a href="#l-wow">Week / month</a><a href="#l-trend">Band trend</a><a href="#l-heat">Heat maps</a><a href="#l-sources">Sources</a><a href="#l-health">Follow-up health</a><a href="#l-table">All leads</a><a href="#l-ai">AI read-out</a>
        <span style="margin-left:auto;display:flex;gap:14px;align-items:center;font-size:12.5px;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="gsiToggle" ${S.gsiOnly ? 'checked' : ''}> GSI leads only</label>
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
        { k: 'Organic search', v: fmt(rows.filter(r => r.channel === 'Organic search').length), d: 'hs_analytics_source' },
        { k: 'No status set', v: fmt(rows.filter(r => !r.lead_status).length), d: 'lead status empty in HubSpot' },
      ]), 'l-tiles')}

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
    el.querySelector('#statusSel').onchange = e => { S.status = e.target.value; draw(); };
    const histRows = (HIST.rows || all).filter(r => (!S.excludeSpam || !r.spam) && (!S.gsiOnly || r.gsi));
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
      const csv = toCsv(shown, COLS.map(c => ({ h: c.h, f: c.csv || c.g || (r => r[c.k]) })).concat([{ h: 'Email', f: r => r.email }, { h: 'Country', f: r => r.country }, { h: 'HubSpot id', f: r => r.hs_id }]));
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
    }) });
  }
  draw();
}
