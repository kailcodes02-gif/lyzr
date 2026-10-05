// Ads channel for every platform other than LinkedIn (Google Ads, Meta, Taboola, ChatGPT, X,
// Microsoft Bing). One page for all of them: the platform comes from ctx.routeDef (js/app.mjs
// ROUTES). Numbers come from daily campaign or ad exports dropped on this page (js/ads-csv.mjs)
// and live in the same table as LinkedIn with a `platform` value, so the Overview, the trend
// explorer and the Claude read-out treat every platform the same way.
import * as A from '../lib/linkedin-agg.mjs';
import { mountTrend } from '../trend.mjs';
import { mountUploader } from '../uploader.mjs';
import { isEditorOf } from './linkedin.mjs';
import { PLATFORM_LABEL } from '../ads-csv.mjs';
import { sectionCompare, memoGet, deltaText } from '../compare.mjs';
import { NAVY, ORANGE } from '../palette.mjs';

const HOWTO = {
  google: { export: 'Google Ads › Campaigns (or Ads) › Download › CSV, segmented by Day', api: 'Google Ads API' },
  meta: { export: 'Ads Manager › Reports › Export › CSV, breakdown by Day (campaign or ad level)', api: 'Meta Marketing API' },
  taboola: { export: 'Backstage › Reports › Campaign summary › By day › Export CSV', api: 'Taboola Backstage API' },
  chatgpt: { export: 'the ChatGPT ads report export, by day', api: 'the OpenAI ads reporting API, when available' },
  x: { export: 'X Ads › Analytics › Export › by Day, campaign or promoted post level', api: 'X Ads API' },
  bing: { export: 'Microsoft Advertising › Reports › Campaign performance › Daily › Download CSV', api: 'Microsoft Advertising API' },
};
let charts = [], trendX = null;
export function destroy() { for (const c of charts) { try { c.destroy(); } catch { /* ignore */ } } charts = []; if (trendX) { trendX.destroy(); trendX = null; } }
const chart = (canvas, cfg) => { if (!window.Chart || !canvas) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; };
const platformOf = def => (def && def.route ? def.route.split('/')[1] : '') || 'google';

export async function render(el, ctx) {
  destroy();
  const F = ctx.fmt, { esc, fmt, usd, pct } = F;
  const { from, to } = ctx.state;
  const def = ctx.routeDef || {};
  const platform = platformOf(def);
  const name = PLATFORM_LABEL[platform] || def.title || platform;
  const how = HOWTO[platform] || { export: 'a daily campaign export', api: 'its reporting API' };
  const head = `<div class="seghead">Ads · ${esc(name)}</div><h1>${esc(name)} ads</h1>`;
  el.innerHTML = `${head}<p class="sub">${esc(F.rangeLabel(from, to))}</p>${ctx.ui.spinner(`Loading ${name} data`)}`;

  const prev = ctx.state.prev || null;
  let data, histData;
  try {
    [data, histData] = await Promise.all([
      memoGet(ctx, 'linkedin', { from, to, platform }),
      memoGet(ctx, 'linkedin', { from: '2025-01-01', to: F.today(), platform }).catch(() => null),
    ]);
  } catch (e) { el.innerHTML = `${head}${ctx.ui.empty(`${name} data could not be loaded: ` + (e.message || e))}`; return; }
  const perf = (data.perf || []).filter(r => r.day >= from && r.day <= to);
  const hist = (histData && histData.perf) || perf;
  const uploads = data.uploads || [];
  const editor = isEditorOf(ctx);
  const uploaderBox = (open) => `<details class="card" style="margin:10px 0 0" ${open ? 'open' : ''}><summary style="cursor:pointer"><span class="ui-label">Upload ${esc(name)} exports</span> <span class="muted" style="font-size:13px">· ${uploads.length} file${uploads.length === 1 ? '' : 's'} so far, last ${uploads[0] ? esc(F.timeAgo(uploads[0].uploaded_at)) : 'never'}</span></summary><div id="uploader" style="margin-top:12px"></div></details>`;

  if (!perf.length) {
    el.innerHTML = `${head}<p class="sub">${esc(F.rangeLabel(from, to))}</p>
    <div class="intro">${uploads.length ? `No ${esc(name)} rows in this date range. Widen the dates, or upload the export that covers it below.` : `<b>Not connected yet.</b> ${esc(name)} has no API pull here; numbers come from exports by day. Export ${esc(how.export)} and drop the file below: it is recognised by its columns and this page fills in with spend, impressions, clicks, leads, week-on-week and month-on-month trends, a campaign table and a Claude read-out, and the platform joins the Overview.`}</div>
    ${uploaderBox(true)}
    <div class="grid g2" style="margin-top:16px">
      <div class="card soonbox"><div class="icotile">CSV</div><div><div class="ui-label">Now · uploads</div><h3 style="margin-top:6px">Drop exports here</h3><p class="muted" style="font-size:13.5px">One row per campaign (or ad) per day, with a date, a campaign name, impressions, clicks and cost. Excel files work too.</p></div></div>
      <div class="card soonbox"><div class="icotile">API</div><div><div class="ui-label">Later · daily pull</div><h3 style="margin-top:6px">Pull it automatically every morning</h3><p class="muted" style="font-size:13.5px">Through the ${esc(how.api)}, in the same 07:00 IST pull as Instantly and HubSpot. Needs access credentials for the ad account, stored as a secret on the site, never in the code.</p></div></div>
    </div>`;
    mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', platform, isEditor: editor, onDone: () => render(el, ctx) });
    return;
  }

  // ---- aggregates (the selected range) ----
  const tot = rows => { const t = A.totals(rows); t.cpc = A.div(t.spend, t.clicks); return t; };
  const T = tot(perf);
  const days = A.daysBetween(from, to);
  const perfDays = [...new Set(perf.map(r => r.day))].sort();
  const campsOf = rows => [...A.groupBy(rows, r => r.campaign || r.campaign_id)].map(([k, g]) => { const ds = [...new Set(g.map(r => r.day))].sort(); return { name: k, rows: g, ...tot(g), firstDay: ds[0], lastDay: ds[ds.length - 1], days_span: A.daysBetween(ds[0], ds[ds.length - 1]) }; }).sort((a, b) => b.spend - a.spend);
  const camps = campsOf(perf);
  const adsT = [...A.groupBy(perf, r => `${r.campaign}|${r.ad_name || r.ad_id}`)].map(([, rows]) => ({ campaign: rows[0].campaign, name: rows[0].ad_name || rows[0].ad_id, format: rows[0].format, ...tot(rows) })).sort((a, b) => b.leads - a.leads || b.clicks - a.clicks);
  const medCpl = A.median(camps.map(c => c.cpl));
  const daily = A.trend(perf, 'day');
  const best = camps.filter(c => c.leads > 0).sort((a, b) => a.cpl - b.cpl)[0];
  // Comparison rows for any range (memoised): the page loads with the top-bar comparison, each
  // section can then pick its own.
  const prevRows = async p => p ? ((await memoGet(ctx, 'linkedin', { from: p.from, to: p.to, platform }).catch(() => null)) || {}).perf || [] : [];

  let h = `${head}<p class="sub">${esc(F.rangeLabel(from, to))}. Leads are the platform's own conversion or lead count. Money is USD. ${prev ? `Compared ${esc(F.vsLabel(prev))} unless a section says otherwise.` : 'No comparison at the top; each section can still pick one.'}</p>
  <div class="card" style="font-size:13px;margin-bottom:6px"><b>Included data.</b> ${perfDays.length} of ${days} days have rows (${esc(F.dayLabel(perfDays[0]))} to ${esc(F.dayLabel(perfDays[perfDays.length - 1]))}), ${fmt(camps.length)} campaign${camps.length === 1 ? '' : 's'}, from ${uploads.length} upload${uploads.length === 1 ? '' : 's'}.</div>
  ${uploaderBox(false)}`;

  const cmpResults = sectionCompare(ctx, `ads:${platform}:results`, p => drawResults(p));
  const cmpCamps = sectionCompare(ctx, `ads:${platform}:campaigns`, p => drawCamps(p));
  h += ctx.ui.section('Results', `The headline numbers for the range, each compared with the period chosen here. ${cmpResults.html()}`, `<div id="p-results-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'p-results');
  h += ctx.ui.section('Spend and leads by day', 'Bars are spend, the line is leads. Weekends usually dip.', `<div class="card"><canvas id="dailyChart" height="110"></canvas></div>`, 'p-daily');
  h += ctx.ui.section('Week on week, month on month', 'The whole history for this platform, not only the selected dates. Toggle metrics, switch weeks and months, compare with the previous period or the average of all earlier periods, and see this period so far against the same days of earlier periods.', `<div id="trendX"></div>`, 'p-trend');
  h += ctx.ui.section('Campaigns', `Every campaign with spend in range. Verdict compares each campaign's cost per lead with the median across campaigns (${usd(medCpl)}). ${cmpCamps.html()}`, `<div id="p-campaigns-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'p-campaigns');
  if (adsT.length > camps.length) h += ctx.ui.section('Ads', 'Ad level, best lead count first.', ctx.ui.table({ cols: [
    { h: 'Ad', k: 'name', left: true, f: a => `<b>${esc(a.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(a.campaign)}${a.format ? ' · ' + esc(a.format) : ''}</span>` },
    { h: 'Spend', k: 'spend', f: a => usd(a.spend) }, { h: 'Impressions', k: 'impressions', f: a => fmt(a.impressions) }, { h: 'Clicks', k: 'clicks', f: a => fmt(a.clicks) }, { h: 'CTR', k: 'ctr', f: a => pct(a.ctr, 2) }, { h: 'Leads', k: 'leads', f: a => fmt(a.leads) }, { h: 'CPL', k: 'cpl', f: a => usd(a.cpl) },
  ], rows: adsT.slice(0, 40) }), 'p-ads');
  h += ctx.ui.section('AI read-out', `Claude reads the ${esc(name)} numbers above and says what to do. Suggestions you track are checked again next time.`, `<div id="aiPanel"></div>`, 'p-ai');
  el.innerHTML = h;
  cmpResults.wire(el); cmpCamps.wire(el);

  let TP = tot([]), prevCamps = new Map(), lastPrev = prev;
  async function drawResults(p) {
    const box = el.querySelector('#p-results-body'); if (!box) return;
    const rows = await prevRows(p); if (!el.isConnected) return;
    TP = tot(rows); lastPrev = p;
    const dl = (cur, prevV, invert = false) => deltaText(p, cur, prevV, invert);
    box.innerHTML = `<div class="hero">
    <div class="big"><div class="n">${fmt(T.leads)}</div><div class="l">${esc(name)} leads in ${esc(F.rangeLabel(from, to))}${p && TP.leads ? `, ${fmt(TP.leads)} ${esc(p.label)}` : ''}.</div>
      <div class="split">
        <div><b>${usd(T.cpl)}</b><span>blended cost per lead</span></div>
        <div><b>${usd(T.spend)}</b><span>spend</span></div>
        ${best ? `<div><b>${usd(best.cpl)}</b><span>best cost per lead (${esc(shortName(best.name))})</span></div>` : ''}
        <div><b>${pct(T.ctr, 2)}</b><span>click-through rate</span></div>
      </div></div>
    ${ctx.ui.tiles([
      { k: 'Total spend', v: usd(T.spend), d: dl(T.spend, TP.spend) },
      { k: 'Impressions', v: fmt(T.impressions), d: dl(T.impressions, TP.impressions) },
      { k: 'Clicks', v: fmt(T.clicks), d: dl(T.clicks, TP.clicks) },
      { k: 'CTR', v: pct(T.ctr, 2), d: dl(T.ctr, TP.ctr) },
      { k: 'Cost per click', v: usd(T.cpc, 2), d: dl(T.cpc, TP.cpc, true) },
      { k: 'CPM', v: usd(T.cpm, 2), d: dl(T.cpm, TP.cpm, true) },
      { k: 'Leads', v: fmt(T.leads), d: dl(T.leads, TP.leads) },
      { k: 'Cost per lead', v: usd(T.cpl), d: dl(T.cpl, TP.cpl, true) },
    ])}</div>`;
  }
  async function drawCamps(p) {
    const box = el.querySelector('#p-campaigns-body'); if (!box) return;
    const rows = await prevRows(p); if (!el.isConnected) return;
    prevCamps = new Map(campsOf(rows).map(c => [c.name, c]));
    const PT = tot(rows);
    box.innerHTML = ctx.ui.table({ cols: [
      { h: 'Campaign', k: 'name', left: true, f: c => `<b>${esc(c.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(F.dayLabel(c.firstDay))} to ${esc(F.dayLabel(c.lastDay))}</span>` },
      { h: 'Spend', k: 'spend', f: c => usd(c.spend) },
      { h: 'Impressions', k: 'impressions', f: c => fmt(c.impressions) },
      { h: 'Clicks', k: 'clicks', f: c => fmt(c.clicks) },
      { h: 'CTR', k: 'ctr', f: c => pct(c.ctr, 2) },
      { h: 'CPC', k: 'cpc', f: c => usd(c.cpc, 2) },
      { h: 'Leads', k: 'leads', f: c => fmt(c.leads) },
      { h: 'CPL', k: 'cpl', f: c => usd(c.cpl) },
      { h: p ? `Leads ${esc(p.label)}` : 'Leads (no comparison)', k: 'pl', f: c => { const q = prevCamps.get(c.name); return q ? `${fmt(q.leads)} <span class="muted">(${usd(q.cpl)})</span>` : '<span class="muted">–</span>'; } },
      { h: 'Verdict', k: 'v', left: true, f: c => { const v = A.verdict(c, medCpl); return ctx.ui.pill(v.label, v.cls); } },
    ], rows: camps, total: { name: 'Total', spend: usd(T.spend), impressions: fmt(T.impressions), clicks: fmt(T.clicks), ctr: pct(T.ctr, 2), cpc: usd(T.cpc, 2), leads: fmt(T.leads), cpl: usd(T.cpl), pl: p ? fmt(PT.leads) : '', v: '' } });
  }
  drawResults(cmpResults.prev); drawCamps(cmpCamps.prev);

  mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', platform, isEditor: editor, onDone: () => render(el, ctx) });

  chart(el.querySelector('#dailyChart'), { type: 'bar', data: { labels: daily.map(d => F.dayLabel(d.key)), datasets: [
    { type: 'bar', label: 'Spend', data: daily.map(d => d.spend), backgroundColor: NAVY, yAxisID: 'y' },
    { type: 'line', label: 'Leads', data: daily.map(d => d.leads), borderColor: ORANGE, backgroundColor: ORANGE, tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
  ] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Spend (USD)' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Leads' } } } } });

  trendX = mountTrend(el.querySelector('#trendX'), ctx, { id: 'ads:' + platform, items: hist, dayOf: r => r.day, range: { from, to }, defaults: { gran: 'week', metrics: ['spend', 'leads', 'cpl'], compare: 'avg' }, metrics: [
    { key: 'spend', label: 'Spend', fmt: 'usd', additive: true, fn: rows => tot(rows).spend },
    { key: 'impressions', label: 'Impressions', additive: true, fn: rows => tot(rows).impressions },
    { key: 'clicks', label: 'Clicks', additive: true, fn: rows => tot(rows).clicks },
    { key: 'leads', label: 'Leads', additive: true, fn: rows => tot(rows).leads },
    { key: 'ctr', label: 'CTR', fmt: 'pct', axis: 'right', fn: rows => tot(rows).ctr },
    { key: 'cpc', label: 'Cost per click', fmt: 'usd', axis: 'right', fn: rows => tot(rows).cpc },
    { key: 'cpl', label: 'Cost per lead', fmt: 'usd', axis: 'right', fn: rows => tot(rows).cpl },
    { key: 'cpm', label: 'CPM', fmt: 'usd', axis: 'right', fn: rows => tot(rows).cpm },
  ], note: `All ${name} rows uploaded so far; the selected dates are shaded.` });

  ctx.mountInsights(el.querySelector('#aiPanel'), ctx, { scope: `ads:${platform}:${from}:${to}`, kind: 'ads', channel: 'linkedin', title: 'What this means and what to do', inputProvider: () => ({
    platform: name, range: { from, to, days },
    totals: { spend: T.spend, impressions: T.impressions, clicks: T.clicks, ctr: T.ctr, cpc: T.cpc, cpm: T.cpm, leads: T.leads, cpl: T.cpl },
    prior: lastPrev ? { label: lastPrev.label, spend: TP.spend, impressions: TP.impressions, clicks: TP.clicks, ctr: TP.ctr, leads: TP.leads, cpl: TP.cpl } : null,
    campaigns: camps.slice(0, 15).map(c => ({ name: c.name, spend: c.spend, impressions: c.impressions, clicks: c.clicks, ctr: c.ctr, leads: c.leads, cpl: c.cpl, prior: prevCamps.get(c.name) ? { leads: prevCamps.get(c.name).leads, cpl: prevCamps.get(c.name).cpl } : null })),
    ads: adsT.slice(0, 10).map(a => ({ name: a.name, campaign: a.campaign, spend: a.spend, clicks: a.clicks, leads: a.leads, cpl: a.cpl })),
    daily: daily.map(d => ({ day: d.key, spend: d.spend, clicks: d.clicks, leads: d.leads })),
  }) });
}

function shortName(s) { s = String(s || ''); return s.length > 42 ? s.slice(0, 40) + '…' : s; }
