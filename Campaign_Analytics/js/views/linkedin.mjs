// Ads channel: LinkedIn Campaign Manager exports (performance per ad per day, demographics per window).
import * as A from '../lib/linkedin-agg.mjs';
import { mountTrend } from '../trend.mjs';
import { mountUploader } from '../uploader.mjs';
export const route = 'linkedin';
export const title = 'Ads · LinkedIn';

const C = { orange: '#FE4B1E', navy: '#043E77', forest: '#063B28', oxblood: '#593D3D', stone: '#A8A298', g300: '#CFCCC7' };
const STAGE_COLOR = { ToFu: C.stone, MoFu: C.orange, BoFu: C.navy, Other: C.g300 };
const METRIC_LABEL = { impressions: 'Impressions', clicks: 'Clicks', spend: 'Spend', sends: 'Sends', opens: 'Opens', leads: 'Leads' };
let charts = [], trendX = null;
export function destroy() { for (const c of charts) { try { c.destroy(); } catch { /* ignore */ } } charts = []; if (trendX) { trendX.destroy(); trendX = null; } }
const chart = (canvas, cfg) => { if (!window.Chart || !canvas) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; };

export async function render(el, ctx) {
  destroy();
  const F = ctx.fmt, { esc, fmt, usd, pct } = F;
  const { from, to } = ctx.state;
  el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1><p class="sub">${esc(F.rangeLabel(from, to))}</p>${ctx.ui.spinner('Loading LinkedIn data')}`;
  if (window.Chart) { Chart.defaults.font.family = "'General Sans','Inter',system-ui,sans-serif"; Chart.defaults.color = css('--ink2') || '#6B675F'; Chart.defaults.borderColor = css('--line') || '#E3E1DE'; }

  // Comparison range from the global "Compare with" control (null = no comparison).
  const prev = ctx.state.prev || null;
  let data, prevData, histData;
  try { [data, prevData, histData] = await Promise.all([ctx.api.get('linkedin', { from, to }), (prev ? ctx.api.get('linkedin', { from: prev.from, to: prev.to }).catch(() => null) : Promise.resolve(null)), ctx.api.get('linkedin', { from: '2025-01-01', to: F.today() }).catch(() => null)]); }
  catch (e) { el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1>${ctx.ui.empty('LinkedIn data could not be loaded: ' + (e.message || e))}`; return; }
  const S = ctx.settings || {};
  const accounts = Array.isArray(S.accounts) ? S.accounts : [], bands = S.bands || {}, icp_pool = Array.isArray(S.icp_pool) ? S.icp_pool : [], regions = S.regions || {}, stages = S.stages || undefined;
  const frequency = Number((S.targets || {}).frequency) || 3.5;
  const perf = (data.perf || []).filter(r => r.day >= from && r.day <= to);
  const prevPerf = (prevData && prevData.perf) || [];
  const windows = [...(data.demo || [])].sort((a, b) => a.upload.period_start < b.upload.period_start ? -1 : 1);
  const prevWindows = (prevData && prevData.demo) || [];
  const demoRows = windows.flatMap(w => w.rows);
  const uploads = data.uploads || [];

  if (!perf.length && !windows.length) {
    el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1><p class="sub">${esc(F.rangeLabel(from, to))}</p>` +
      `<div class="intro">${uploads.length ? 'No LinkedIn data in this date range. Widen the dates, or upload the exports that cover it below.' : '<b>No LinkedIn exports yet.</b> LinkedIn has no API connection here: numbers come from Campaign Manager exports. Drop them below (many files at once is fine) and this page fills in.'}</div>` +
      ctx.ui.section('Upload LinkedIn exports', '', '<div id="uploader"></div>');
    mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', isEditor: isEditorOf(ctx), onDone: () => render(el, ctx) });
    return;
  }

  // ---- aggregates ----
  const T = A.totals(perf), TP = A.totals(prevPerf);
  const days = A.daysBetween(from, to);
  const perfDays = [...new Set(perf.map(r => r.day))].sort();
  const P = A.programs(perf, stages);
  const ads = A.ads(perf);
  const stageGran = days > 70 ? 'month' : days > 21 ? 'week' : 'day';
  const SS = A.stageSplit(perf, stageGran, stages);
  const bullets = A.bullets({ rows: perf, prevRows: prevPerf, demoWindows: windows, prevDemoWindows: prevWindows, from, to, stages, bands });
  const matched = new Map(); // canonical account -> impressions in range
  for (const r of A.segRows(demoRows, 'Company')) { const a = A.matchAccount(r.value, accounts); if (a && (Number(r.impressions) || 0) > 0) matched.set(a, (matched.get(a) || 0) + Number(r.impressions)); }
  const metricsPresent = Object.keys(METRIC_LABEL).filter(m => demoRows.some(r => Number(r[m]) > 0));
  const winLabel = w => `${F.dayLabel(w.upload.period_start)} to ${F.dayLabel(w.upload.period_end)}`;
  const dl = (cur, prevV, invert = false) => { if (!prev) return '<span class="muted">no comparison</span>'; if (prevV == null || !prevV || cur == null) return '<span class="muted">nothing to compare</span>'; const g = (cur - prevV) / prevV * 100; const good = invert ? g <= 0 : g >= 0; return `<span class="${good ? 'up' : 'down'}">${g > 0 ? '+' : ''}${fmt(g, 0)}%</span> vs ${esc(prev.label)}`; };
  const topSet = P.programs.flatMap(p => p.campaigns).filter(c => c.leads > 0).sort((a, b) => b.leads - a.leads)[0];

  // ---- page ----
  let h = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1>
  <p class="sub">${esc(F.rangeLabel(from, to))}. Leads are LinkedIn lead form submissions. Money is USD. ${prev ? `Compared ${esc(F.vsLabel(prev))}.` : 'No comparison selected.'}</p>
  <div class="card" style="font-size:13px;margin-bottom:6px"><b>Included data.</b> Performance: ${perfDays.length ? `${perfDays.length} of ${days} days have rows (${esc(F.dayLabel(perfDays[0]))} to ${esc(F.dayLabel(perfDays[perfDays.length - 1]))})` : 'no daily rows in this range'}.
  Demographics: ${windows.length ? `${windows.length} window${windows.length === 1 ? '' : 's'} overlap this range: ${windows.map(w => esc(winLabel(w))).join('; ')}. Demographics are totals per export window, so a person seen in two windows is counted twice.` : 'no export window overlaps this range.'}</div>`;

  h += `<details class="card" style="margin:10px 0 0" ${uploads.length ? '' : 'open'}><summary style="cursor:pointer"><span class="ui-label">Upload LinkedIn exports</span> <span class="muted" style="font-size:13px">· ${uploads.length} file${uploads.length === 1 ? '' : 's'} so far, last ${uploads[0] ? esc(F.timeAgo(uploads[0].uploaded_at)) : 'never'}</span></summary><div id="uploader" style="margin-top:12px"></div></details>`;

  // 1. hero + tiles
  h += ctx.ui.section('Results', 'The headline numbers for the range, each compared with the same number of days before it.', `
  <div class="hero">
    <div class="big"><div class="n">${fmt(T.leads)}</div><div class="l">LinkedIn leads in ${esc(F.rangeLabel(from, to))}${prev && TP.leads ? `, ${fmt(TP.leads)} ${esc(prev.label)}` : ''}.</div>
      <div class="split">
        <div><b>${usd(T.cpl)}</b><span>blended cost per lead</span></div>
        <div><b>${usd(T.spend)}</b><span>spend</span></div>
        ${topSet ? `<div><b>${fmt(topSet.leads)}</b><span>leads from the best ad set (${esc(shortName(topSet.name))})</span></div>` : ''}
        <div><b>${fmt(SS.totals.ToFu.leads)}</b><span>leads from awareness spend (${usd(SS.totals.ToFu.spend)})</span></div>
      </div></div>
    ${ctx.ui.tiles([
      { k: 'Total spend', v: usd(T.spend), d: dl(T.spend, TP.spend) },
      { k: 'Impressions', v: fmt(T.impressions), d: dl(T.impressions, TP.impressions) },
      { k: 'Reach (sum of daily)', v: fmt(T.reach), d: 'Not de-duplicated across days' },
      { k: 'Clicks', v: fmt(T.clicks), d: `${pct(T.ctr, 2)} CTR` },
    ]).replace('class="tiles"', 'class="tiles" style="grid-template-columns:1fr 1fr"')}
  </div>
  ${ctx.ui.tiles([
    { k: 'CTR', v: pct(T.ctr, 2), d: dl(T.ctr, TP.ctr) },
    { k: 'Leads', v: fmt(T.leads), d: dl(T.leads, TP.leads) },
    { k: 'Lead form completion', v: pct(T.completion, 1), d: `${fmt(T.leads)} submits from ${fmt(T.lead_forms_opened)} opens` },
    { k: 'Cost per lead', v: usd(T.cpl), d: dl(T.cpl, TP.cpl, true) },
    { k: 'Message ad opens', v: pct(T.open_rate, 1), d: `${fmt(T.opens)} of ${fmt(T.sends)} sends` },
    { k: 'Video views', v: fmt(T.video_views), d: dl(T.video_views, TP.video_views) },
    { k: 'Accounts reached', v: `${fmt(matched.size)} of ${fmt(accounts.length)}`, d: windows.length ? 'Named target pages in demographics' : 'Needs a demographics upload' },
    { k: 'Awareness CPM', v: usd(SS.totals.ToFu.impressions ? SS.totals.ToFu.spend / SS.totals.ToFu.impressions * 1000 : null, 2), d: 'ToFu spend per 1,000 impressions' },
  ])}`);

  // 2. achieved / not achieved
  const li = list => list.length ? `<ul>${list.map(b => `<li><b>${esc(b.b)}</b> ${esc(b.s)}</li>`).join('')}</ul>` : '<p class="muted" style="margin-top:8px">Nothing to report yet for this range.</p>';
  h += ctx.ui.section('What worked and what did not', 'Rule-based reads of the numbers above. Each line only appears when the data behind it exists.', `<div class="grid g2"><div class="panel win"><h3>Achieved</h3>${li(bullets.achieved)}</div><div class="panel loss"><h3>Not achieved</h3>${li(bullets.missed)}</div></div>`);

  // 3. trend (whole history)
  h += ctx.ui.section('Week on week and month on month', 'The whole history of uploaded performance data (the selected range is the darker bars). Switch metrics on and off, compare with the previous week or month or with the average of all earlier ones, and see the week or month in progress against the same days of earlier ones, with a straight-line projection.', `<div id="trendX"></div>`);

  // 3a. reach heat maps: impressions ÷ reach_frequency (default 3) = people
  const rf = Number((S.targets || {}).reach_frequency) || 3;
  h += ctx.ui.section('Reach: people by account, designation and region', `Estimated people reached, counting ${fmt(rf, 1)} impressions as one person (Admin › Targets). Columns are the demographics export windows in the selected dates; the last columns total them and compare with ${prev ? esc(prev.label) : 'nothing (pick a comparison at the top)'}. A person seen in two windows counts twice.`, `<div id="reachSeg"></div><div class="card"><div class="tblwrap" style="border:none" id="reachHeat"></div>${ctx.heat.legend('orange', 'square-root scale on the current windows')}</div>`);

  // 3b. reach quality over time
  h += ctx.ui.section('Where the ads land and how that changes', 'Every demographics window uploaded so far, oldest to newest: the share of impressions by region, seniority, designation band and named target accounts. A falling line is where reach quality is dropping.', `<div id="qualSeg"></div><div class="card"><div class="chartbox"><canvas id="qualChart"></canvas></div></div><div class="tblwrap" style="margin-top:10px" id="qualTable"></div>`);

  // 4. funnel
  const stageNote = stages ? 'Stage keywords come from Settings (stages).' : 'Default keywords: ToFu = awareness, amplification, website visits, brand, engagement; MoFu = playbook, lead gen, workshop, webinar; BoFu = conversation, book a demo, retargeting, conversion. Add a "stages" key in Settings to change them.';
  const stageCallout = st => { const t = SS.totals[st]; const all = T.spend || 1; return { b: `${usd(t.spend)} ${st}`, s: `${fmt(t.spend / all * 100, 0)}% of spend, ${fmt(t.leads)} lead${t.leads === 1 ? '' : 's'}${t.leads ? ` at ${usd(t.spend / t.leads)} each` : ''}, ${fmt(T.impressions ? t.impressions / T.impressions * 100 : 0, 0)}% of impressions.` }; };
  h += ctx.ui.section('Funnel by stage', `Every campaign mapped to a funnel stage from its program and ad set name. ${esc(stageNote)}`, `<div class="grid g2"><div class="card"><h3>Spend by stage</h3><div class="chartbox"><canvas id="stageSpend"></canvas></div></div><div class="card"><h3>Leads by stage</h3><div class="chartbox"><canvas id="stageLeads"></canvas></div></div></div>${ctx.ui.callouts(['ToFu', 'MoFu', 'BoFu'].map(stageCallout))}${SS.totals.Other.spend ? `<p class="muted" style="font-size:12.5px;margin-top:8px">${usd(SS.totals.Other.spend)} of spend matched no stage keyword and is shown as Other.</p>` : ''}`);

  // 5. programs
  const progRows = [];
  for (const p of P.programs) { progRows.push({ ...p, level: 0 }); for (const c of p.campaigns) progRows.push({ ...c, level: 1 }); }
  h += ctx.ui.section('Programs and campaigns', `Each program (campaign group) and its ad sets: what it cost, what it returned, and a verdict. High = 10 or more leads under the median cost per lead (${usd(P.median_campaign_cpl)} for ad sets). Low = over $100 with no leads. Too early = under 14 days of data.`,
    `<div class="tblwrap"><table><thead><tr><th class="l">Program / ad set</th><th>Stage</th><th class="l">Months active</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>Leads</th><th>CPL</th><th>Verdict</th><th class="l">Why</th></tr></thead><tbody>${progRows.map(r => `<tr${r.level ? '' : ' style="background:var(--soft)"'}><td class="l" style="${r.level ? 'padding-left:26px' : 'font-weight:600'}">${esc(r.name)}</td><td>${esc(r.stage)}</td><td class="l" style="min-width:120px">${esc(r.months_label)}</td><td>${usd(r.spend)}</td><td>${r.impressions ? fmt(r.impressions) : (r.sends ? fmt(r.sends) + ' sends' : '–')}</td><td>${fmt(r.clicks)}</td><td>${fmt(r.leads)}</td><td>${usd(r.cpl)}</td><td>${ctx.ui.pill(r.verdict.label, r.verdict.cls)}</td><td class="l" style="white-space:normal;min-width:260px;font-size:13px">${esc(r.verdict.reason)}</td></tr>`).join('')}</tbody></table></div>`);

  // 6. ads
  const topAds = ads.slice(0, 12);
  h += ctx.ui.section('Ads and creatives', 'Which creatives produced leads, ranked by leads then cost per lead. Concentration on one asset is the thing to watch.', `<div class="grid g2"><div class="card"><h3>Top creatives, leads and spend</h3><div class="chartbox tall"><canvas id="adChart"></canvas></div></div><div class="card pad0"><div class="tblwrap" style="border:none"><table><thead><tr><th class="l">Creative</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead><tbody>${topAds.map(a => `<tr><td class="l" style="white-space:normal;min-width:220px">${esc(a.ad_name)}<br><span class="muted" style="font-size:12px">${esc(shortName(a.campaign || ''))}${a.format ? ' · ' + esc(a.format) : ''}</span></td><td>${usd(a.spend)}</td><td>${a.impressions ? fmt(a.impressions) : (a.sends ? fmt(a.sends) + ' sends' : '–')}</td><td>${pct(a.ctr, 2)}</td><td>${fmt(a.leads)}</td><td>${usd(a.cpl)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No ads in range</td></tr>'}</tbody></table></div></div></div>`);

  // 7. heat maps
  if (!windows.length) {
    h += ctx.ui.section('Heat maps', 'Who saw the ads by account, seniority, geography, designation band and job function, and how much of each ICP pool was reached.', ctx.ui.empty('No demographics export covers this range. Upload one in the box at the top of this page.'));
  } else {
    const segBox = id => `<div id="${id}"></div>`;
    h += ctx.ui.section('Heat maps', 'Who saw the ads, from the demographics exports. Columns are export windows; a person can appear in more than one window.', `
      <div class="card"><h3>Target accounts by window</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Company page values mapped to the canonical accounts in Settings. Pages that match no account are grouped under Other pages.</p>${segBox('accSeg')}<div class="tblwrap" style="border:none" id="accHeat"></div>${ctx.heat.legend('orange', 'square-root scale, per metric')}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Seniority share</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Share of each window's total for the chosen metric, by LinkedIn job seniority.</p>${segBox('senSeg')}<div class="tblwrap" style="border:none" id="senHeat"></div></div>
        <div class="card"><h3>Geography share</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Share of each window by country, or grouped into the regions from Settings.</p>${segBox('geoSeg')}<div class="tblwrap" style="border:none" id="geoHeat"></div></div>
        <div class="card"><h3>Designation band share</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Job titles mapped to MD, MD-1 and MD-2 with the title buckets in Settings. Director splits half to MD-1 and half to MD-2. Everything else is Other.</p>${segBox('bandSeg')}<div class="tblwrap" style="border:none" id="bandHeat"></div></div>
        <div class="card"><h3>Job function share</h3><p class="muted" style="font-size:13px;margin-bottom:8px">Share of each window by LinkedIn job function.</p>${segBox('funSeg')}<div class="tblwrap" style="border:none" id="funHeat"></div></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Penetration: account by country</h3>
        <p class="muted" style="font-size:13px;margin-bottom:8px">How much of each ICP pool the ads reached in the included windows. Cells show the share of the pool and people reached over pool size. Click a cell for the per-band numbers and the creatives that served that country.</p>
        ${segBox('penSeg')}<div class="tblwrap" style="border:none" id="penHeat"></div>
        <div class="legend" id="penLegend"></div>
        <p class="muted" style="font-size:12.5px;margin-top:10px" id="penMethod"></p>
        <div id="penDetail" style="margin-top:14px"></div></div>`);
  }
  h += `<div class="section" id="aiPanel"></div>`;
  el.innerHTML = h;
  mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', isEditor: isEditorOf(ctx), onDone: () => render(el, ctx) });

  // ---- trend explorer (whole history) ----
  const hist = ((histData && histData.perf) || perf);
  const tot = rows => A.totals(rows);
  trendX = mountTrend(el.querySelector('#trendX'), ctx, { id: 'linkedin', items: hist, dayOf: r => r.day, range: { from, to }, defaults: { gran: 'week', metrics: ['spend', 'leads', 'cpl'], compare: 'avg' }, metrics: [
    { key: 'spend', label: 'Spend', fmt: 'usd', additive: true, fn: rows => tot(rows).spend },
    { key: 'impressions', label: 'Impressions', additive: true, fn: rows => tot(rows).impressions },
    { key: 'clicks', label: 'Clicks', additive: true, fn: rows => tot(rows).clicks },
    { key: 'leads', label: 'Leads', additive: true, fn: rows => tot(rows).leads },
    { key: 'reach', label: 'Reach (sum of daily)', additive: true, fn: rows => tot(rows).reach },
    { key: 'video_views', label: 'Video views', additive: true, fn: rows => tot(rows).video_views },
    { key: 'ctr', label: 'CTR', fmt: 'pct', axis: 'right', fn: rows => tot(rows).ctr },
    { key: 'cpl', label: 'Cost per lead', fmt: 'usd', axis: 'right', fn: rows => tot(rows).cpl },
    { key: 'cpm', label: 'CPM', fmt: 'usd', axis: 'right', fn: rows => tot(rows).cpm },
  ], note: 'Reach is the sum of LinkedIn daily per-ad reach, so the same person can count more than once. Message sends carry spend without impressions, so CTR and CPM exclude them.' });

  // ---- reach quality over time (all demographics windows) ----
  const allWin = [...(((histData && histData.demo) || data.demo) || [])].sort((a, b) => (a.upload.period_start || '') < (b.upload.period_start || '') ? -1 : 1);
  let qMode = 'region';
  const drawQual = () => {
    const labels = allWin.map(winLabel);
    let seriesMap = new Map();
    const put = (k, i, v) => { if (!seriesMap.has(k)) seriesMap.set(k, allWin.map(() => 0)); seriesMap.get(k)[i] = v; };
    allWin.forEach((w, i) => {
      if (qMode === 'band') { const b = A.bandShares(A.segRows(w.rows, 'Job Title'), bands); for (const k of A.BANDS) put(k, i, Math.round(b.share[k] * 1000) / 10); }
      else if (qMode === 'accounts') { const rowsC = A.segRows(w.rows, 'Company'); const totI = rowsC.reduce((a, r) => a + (Number(r.impressions) || 0), 0); const m = rowsC.filter(r => A.matchAccount(r.value, accounts)).reduce((a, r) => a + (Number(r.impressions) || 0), 0); put('Named target accounts', i, totI ? Math.round(m / totI * 1000) / 10 : 0); }
      else {
        const seg = qMode === 'region' ? 'Country' : 'Job Seniority';
        const sh = A.segmentShare(w.rows, seg, 'impressions', qMode === 'region' ? r => A.regionOf(r.value, regions) : r => r.value);
        for (const [k, v] of sh.values) put(k, i, sh.total ? Math.round(v / sh.total * 1000) / 10 : 0);
        if (qMode === 'seniority') { const dp = ['Director', 'VP', 'CXO', 'Partner', 'Owner'].reduce((a, k) => a + (sh.values.get(k) || 0), 0); put('Director and above', i, sh.total ? Math.round(dp / sh.total * 1000) / 10 : 0); }
      }
    });
    let keys = [...seriesMap.keys()].sort((a, b) => seriesMap.get(b).reduce((x, y) => x + y, 0) - seriesMap.get(a).reduce((x, y) => x + y, 0));
    if (qMode === 'seniority') keys = ['Director and above', ...keys.filter(k => k !== 'Director and above')].slice(0, 7);
    else keys = keys.slice(0, 8);
    const palette = ['#043E77', '#FE4B1E', '#1F2022', '#A8A298', '#6B675F', '#CFCCC7', '#8A857C', '#B8B4AD'];
    const cv = el.querySelector('#qualChart'); const old = charts.find(c => c.canvas === cv); if (old) { old.destroy(); charts = charts.filter(c => c !== old); }
    if (!allWin.length) { el.querySelector('#qualTable').innerHTML = ctx.ui.empty('No demographics export uploaded yet.'); return; }
    chart(cv, { type: 'line', data: { labels, datasets: keys.map((k, i) => ({ label: k, data: seriesMap.get(k), borderColor: palette[i % palette.length], backgroundColor: palette[i % palette.length], borderWidth: k === 'Director and above' || i === 0 ? 3 : 2, pointRadius: 3, tension: .25 })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)}%` } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } }, x: { grid: { display: false } } } } });
    const lastI = allWin.length - 1;
    el.querySelector('#qualTable').innerHTML = `<table><thead><tr><th class="l">${qMode === 'region' ? 'Region' : qMode === 'seniority' ? 'Seniority' : qMode === 'band' ? 'Band' : 'Share'}</th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Change, first to last</th></tr></thead><tbody>${keys.map(k => { const v = seriesMap.get(k); const d = lastI > 0 ? v[lastI] - v[0] : null; return `<tr><td class="l"><b>${esc(k)}</b></td>${v.map(x => `<td>${fmt(x, 1)}%</td>`).join('')}<td class="${d == null ? 'muted' : d >= 0 ? 'up' : 'down'}">${d == null ? '–' : (d > 0 ? '+' : '') + fmt(d, 1) + ' pts'}</td></tr>`; }).join('')}</tbody></table>`;
  };
  ctx.ui.seg(el.querySelector('#qualSeg'), [{ value: 'region', label: 'Regions' }, { value: 'seniority', label: 'Seniority' }, { value: 'band', label: 'Designation bands' }, { value: 'accounts', label: 'Target accounts' }], v => { qMode = v; drawQual(); }, qMode);
  drawQual();

  // ---- reach heat maps (impressions ÷ rf) ----
  // One Map(rowKey -> people) per window, for the chosen dimension.
  const reachMaps = (wins, dim) => wins.map(w => {
    const m = new Map();
    const put = (k, imp) => { if (imp) m.set(k, (m.get(k) || 0) + imp / rf); };
    if (dim === 'account') for (const r of A.segRows(w.rows, 'Company')) put(A.matchAccount(r.value, accounts) || 'Other pages', Number(r.impressions) || 0);
    else if (dim === 'band') { const b = A.bandShares(A.segRows(w.rows, 'Job Title'), bands, 'impressions'); for (const k of A.BANDS) put(k, b.counts[k] || 0); }
    else { const sh = A.segmentShare(w.rows, 'Country', 'impressions', r => A.regionOf(r.value, regions)); for (const [k, v] of sh.values) put(k, v); }
    return m;
  });
  const sumMaps = maps => { const t = new Map(); for (const m of maps) for (const [k, v] of m) t.set(k, (t.get(k) || 0) + v); return t; };
  let reachDim = 'account';
  const drawReach = () => {
    const box = el.querySelector('#reachHeat');
    if (!windows.length) { box.innerHTML = ctx.ui.empty('No demographics export covers this range. Upload one at the top of this page.'); return; }
    const curMaps = reachMaps(windows, reachDim), curTot = sumMaps(curMaps);
    const cmpTot = prev ? sumMaps(reachMaps(prevWindows, reachDim)) : null;
    const keys = [...new Set([...curTot.keys(), ...(cmpTot ? cmpTot.keys() : [])])].filter(k => (curTot.get(k) || 0) > 0 || (cmpTot && cmpTot.get(k) > 0));
    let rows = keys.map(k => ({ key: k, label: k, sub: reachDim === 'account' ? ((accounts.find(a => a.name === k) || {}).category || (k === 'Other pages' ? 'pages matching no account' : '')) : '' }));
    if (reachDim === 'band') rows = A.BANDS.filter(b => keys.includes(b)).map(b => ({ key: b, label: b }));
    else rows.sort((a, b) => (curTot.get(b.key) || 0) - (curTot.get(a.key) || 0));
    if (reachDim === 'account') rows = rows.slice(0, 40);
    const cols = windows.map((w, i) => ({ key: 'w' + i, label: winLabel(w) }));
    cols.push({ key: 'cur', label: 'Selected dates' });
    if (prev) { cols.push({ key: 'cmp', label: prev.label.replace(/^the /, '') }); cols.push({ key: 'chg', label: 'Change' }); }
    const maxCur = Math.max(1, ...curMaps.flatMap(m => [...m.values()]));
    ctx.heat.renderHeat(box, { corner: reachDim === 'account' ? 'Account' : reachDim === 'band' ? 'Designation' : 'Region', rows, cols, sortRows: false, scale: 'sqrt', max: maxCur, cell: (r, c) => {
      if (c.startsWith('w')) { const v = curMaps[+c.slice(1)].get(r) || 0; return { v, text: v ? fmt(v) : '–' }; }
      if (c === 'cur') { const v = curTot.get(r) || 0; return { v: null, text: fmt(v), title: `${r}: ${fmt(v)} people in the selected dates (${fmt(v * rf)} impressions ÷ ${rf})` }; }
      if (c === 'cmp') { const v = cmpTot.get(r) || 0; return { v: null, text: v ? fmt(v) : '–', title: `${r}: ${fmt(v)} people ${prev.label}` }; }
      const a = curTot.get(r) || 0, b = cmpTot.get(r) || 0; const g = A.growth(a, b);
      return { v: null, text: g == null ? (a ? 'new' : '–') : (g > 0 ? '+' : '') + fmt(g, 0) + '%', title: `${r}: ${fmt(a)} now vs ${fmt(b)} ${prev.label}` };
    }, colTotal: c => c.startsWith('w') ? fmt([...curMaps[+c.slice(1)].values()].reduce((x, y) => x + y, 0)) : c === 'cur' ? fmt([...curTot.values()].reduce((x, y) => x + y, 0)) : c === 'cmp' ? fmt([...cmpTot.values()].reduce((x, y) => x + y, 0)) : (() => { const a = [...curTot.values()].reduce((x, y) => x + y, 0), b = [...cmpTot.values()].reduce((x, y) => x + y, 0); const g = A.growth(a, b); return g == null ? '–' : (g > 0 ? '+' : '') + fmt(g, 0) + '%'; })() });
    box.querySelectorAll('td.c').forEach(td => { if (/^(cur|cmp|chg)$/.test(td.dataset.c)) { td.style.background = 'var(--offwhite)'; td.style.color = ''; if (td.dataset.c === 'chg') td.classList.add(/^\+/.test(td.textContent) ? 'up' : /^-/.test(td.textContent) ? 'down' : 'muted'); } });
  };
  ctx.ui.seg(el.querySelector('#reachSeg'), [{ value: 'account', label: 'Accounts' }, { value: 'band', label: 'Designation bands' }, { value: 'region', label: 'Regions' }], v => { reachDim = v; drawReach(); }, reachDim);
  drawReach();

  // ---- funnel charts ----
  const stackChart = (id, key, money) => chart(el.querySelector('#' + id), { type: 'bar', data: { labels: SS.buckets.map(k => F.bucketLabel(k, stageGran)), datasets: A.STAGE_ORDER.filter(st => st !== 'Other' || SS.totals.Other[key]).map(st => ({ label: st, data: SS.buckets.map(k => Math.round((SS.byStage[st][key][k] || 0) * 100) / 100), backgroundColor: STAGE_COLOR[st], borderRadius: 4 })) },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (money ? usd(c.raw) : fmt(c.raw)) } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } } });
  stackChart('stageSpend', 'spend', true); stackChart('stageLeads', 'leads', false);

  // ---- ads chart ----
  const adTop = topAds.slice(0, 10);
  chart(el.querySelector('#adChart'), { type: 'bar', data: { labels: adTop.map(a => shortName(a.ad_name, 38)), datasets: [
    { label: 'Leads', data: adTop.map(a => a.leads), backgroundColor: C.orange, borderRadius: 4, xAxisID: 'x' },
    { label: 'Spend ($)', data: adTop.map(a => Math.round(a.spend)), backgroundColor: C.stone, borderRadius: 4, xAxisID: 'x2' }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { afterBody: it => { const a = adTop[it[0].dataIndex]; return 'CPL: ' + (a.leads ? usd(a.cpl) : 'no leads') + '\nImpressions: ' + fmt(a.impressions); } } } },
      scales: { x: { position: 'bottom', beginAtZero: true, title: { display: true, text: 'Leads' } }, x2: { position: 'top', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'Spend ($)' } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } } });

  // ---- heat maps ----
  let penSummary = null;
  if (windows.length) {
    const cols = windows.map((w, i) => ({ key: String(i), label: winLabel(w) }));
    const metricSeg = (id, onChange, initial = 'impressions') => ctx.ui.seg(el.querySelector('#' + id), metricsPresent.map(m => ({ value: m, label: METRIC_LABEL[m] })), onChange, metricsPresent.includes(initial) ? initial : metricsPresent[0]);

    // (a) accounts
    const drawAcc = metric => {
      const perWin = windows.map(w => { const m = new Map(); for (const r of A.segRows(w.rows, 'Company')) { const a = A.matchAccount(r.value, accounts) || 'Other pages'; m.set(a, (m.get(a) || 0) + (Number(r[metric]) || 0)); } return m; });
      const names = new Set(); perWin.forEach(m => m.forEach((v, k) => { if (v) names.add(k); }));
      const rows = [...names].map(k => ({ key: k, label: k, sub: k === 'Other pages' ? 'pages matching no account' : (accounts.find(a => a.name === k) || {}).category || '' }));
      ctx.heat.renderHeat(el.querySelector('#accHeat'), { corner: 'Account', rows, cols, cell: (r, c) => ({ v: perWin[+c].get(r) || 0 }), rowTotal: r => fmt(perWin.reduce((s, m) => s + (m.get(r) || 0), 0)), colTotal: c => fmt([...perWin[+c].values()].reduce((a, b) => a + b, 0)), scale: 'sqrt' });
    };
    metricSeg('accSeg', drawAcc); drawAcc(metricsPresent[0] === 'impressions' ? 'impressions' : metricsPresent[0]);

    // share maps (b, c, d, e)
    const shareMap = (elId, segment, metric, labelFn, corner) => {
      const perWin = windows.map(w => A.segmentShare(w.rows, segment, metric, labelFn));
      const names = new Set(); perWin.forEach(s => s.values.forEach((v, k) => { if (v) names.add(k); }));
      const rows = [...names].map(k => ({ key: k, label: k }));
      ctx.heat.renderHeat(el.querySelector('#' + elId), { corner, rows, cols, scale: 'linear', max: 100, cell: (r, c) => { const s = perWin[+c]; const v = s.values.get(r) || 0; const sh = s.total ? v / s.total * 100 : 0; return { v: sh, text: sh ? fmt(sh, sh < 1 ? 1 : 0) + '%' : '–', title: `${r} · ${cols[+c].label}: ${fmt(v)} ${METRIC_LABEL[metric].toLowerCase()} (${fmt(sh, 1)}%)` }; } });
    };
    metricSeg('senSeg', m => shareMap('senHeat', 'Job Seniority', m, r => r.value, 'Seniority')); shareMap('senHeat', 'Job Seniority', metricsPresent[0], r => r.value, 'Seniority');
    let geoMode = 'region', geoMetric = metricsPresent[0];
    const drawGeo = () => shareMap('geoHeat', 'Country', geoMetric, geoMode === 'region' ? r => A.regionOf(r.value, regions) : r => r.value, geoMode === 'region' ? 'Region' : 'Country');
    const geoSeg = el.querySelector('#geoSeg'); geoSeg.innerHTML = '<div id="geoMode"></div><div id="geoMetric"></div>'; geoSeg.style.display = 'flex'; geoSeg.style.gap = '14px'; geoSeg.style.flexWrap = 'wrap';
    ctx.ui.seg(el.querySelector('#geoMode'), [{ value: 'region', label: 'Regions' }, { value: 'country', label: 'Countries' }], v => { geoMode = v; drawGeo(); }, 'region');
    metricSeg('geoMetric', m => { geoMetric = m; drawGeo(); }); drawGeo();
    const drawBand = metric => {
      const perWin = windows.map(w => A.bandShares(A.segRows(w.rows, 'Job Title'), bands, metric));
      const rows = A.BANDS.map(b => ({ key: b, label: b }));
      ctx.heat.renderHeat(el.querySelector('#bandHeat'), { corner: 'Band', rows, cols, scale: 'linear', max: 100, sortRows: false, cell: (r, c) => { const s = perWin[+c]; const sh = s.share[r] * 100; return { v: sh, text: s.total ? fmt(sh, sh < 1 ? 1 : 0) + '%' : '·', title: `${r} · ${cols[+c].label}: ${fmt(s.counts[r])} of ${fmt(s.total)} title ${METRIC_LABEL[metric].toLowerCase()}` }; } });
    };
    metricSeg('bandSeg', drawBand); drawBand(metricsPresent[0]);
    metricSeg('funSeg', m => shareMap('funHeat', 'Job Function', m, r => r.value, 'Function')); shareMap('funHeat', 'Job Function', metricsPresent[0], r => r.value, 'Function');

    // (f) penetration
    const countries = [...new Set(icp_pool.map(p => p.country))];
    const levelAlpha = [0, .08, .25, .45, .7, 1];
    el.querySelector('#penLegend').innerHTML = [['under 5%', 1], ['5 to 15%', 2], ['15 to 35%', 3], ['35 to 70%', 4], ['over 70%', 5]].map(([l, k]) => `<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;background:rgba(254,75,30,${levelAlpha[k]})"></i>${l}</span>`).join('') + '<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px dashed var(--g300)"></i>no headcount</span>';
    el.querySelector('#penMethod').innerHTML = `Method. Estimated people reached = impressions ÷ ${fmt(frequency, 1)} (frequency, editable in Settings › Targets). Penetration = estimated people reached ÷ Apollo headcount for the company, country and band. Company × country allocation uses the global country share because LinkedIn exports no cross-tab; the band split uses the Job Title mix of the same windows. Windows included: ${windows.map(w => esc(winLabel(w))).join('; ')}.`;
    const detail = el.querySelector('#penDetail');
    let penBand = 'All';
    const drawPen = () => {
      const R = A.penetration({ windows, accounts, icp_pool, bands, frequency, band: penBand, countries });
      const byKey = new Map(R.cells.map(c => [c.account + '||' + c.country, c]));
      const rows = R.accounts.map(a => ({ key: a, label: a, sub: (accounts.find(x => x.name === a) || {}).category || '' }));
      if (!rows.length) { el.querySelector('#penHeat').innerHTML = ctx.ui.empty('No company page in these windows matches a target account.'); return; }
      ctx.heat.renderHeat(el.querySelector('#penHeat'), { corner: 'Account', rows, cols: countries.map(c => ({ key: c, label: c.replace('United ', 'U.') })), scale: 'linear', max: 5, sortRows: false,
        cell: (r, c) => { const x = byKey.get(r + '||' + c); if (!x || x.pool_band == null) return { v: null, text: '·', title: `${r} · ${c}: no headcount in the ICP pool` }; return { v: A.penLevel(x.pct), text: fmt(x.pct, x.pct < 10 ? 1 : 0) + '%', sub: `${fmt(x.reached_band)} / ${fmt(x.pool_band)}`, title: `${r} · ${c} · ${penBand}\nPeople reached (est.): ${fmt(x.reached_band)}\nICP pool: ${fmt(x.pool_band)}\nPenetration: ${fmt(x.pct, 1)}%\nClick for detail` }; },
        onClick: (r, c) => showDetail(r, c, byKey.get(r + '||' + c)) });
      penSummary = R.cells.filter(c => c.pct != null).sort((a, b) => b.pct - a.pct);
    };
    const showDetail = (acc, country, x) => {
      const pool = x && x.pool; const reached = x ? x.reached : { MD: 0, 'MD-1': 0, 'MD-2': 0 };
      const bandRow = b => { const p = pool ? pool[b] : null; return `<tr><td class="l"><b>${b}</b></td><td>${fmt(reached[b])}</td><td>${p != null ? fmt(p) : '–'}</td><td>${p ? fmt(reached[b] / p * 100, 1) + '%' : '–'}</td></tr>`; };
      const tt = reached.MD + reached['MD-1'] + reached['MD-2'], pt = pool ? pool.MD + pool['MD-1'] + pool['MD-2'] : 0;
      const cres = A.creativesForCountry(perf, country, countries);
      detail.innerHTML = `<div class="card" style="background:var(--soft)"><h3>${esc(acc)} · ${esc(country)}</h3><div class="grid g2" style="margin-top:8px"><div>
        <div class="tblwrap"><table><thead><tr><th class="l">Designation</th><th>People reached (est.)</th><th>ICP pool (Apollo)</th><th>Penetration</th></tr></thead><tbody>${['MD', 'MD-1', 'MD-2'].map(bandRow).join('')}<tr class="total"><td class="l">All ICP</td><td>${fmt(tt)}</td><td>${pt ? fmt(pt) : '–'}</td><td>${pt ? fmt(tt / pt * 100, 1) + '%' : '–'}</td></tr></tbody></table></div>
        <p class="muted" style="font-size:12.5px;margin-top:8px">People reached is impressions ÷ ${fmt(frequency, 1)} spread by country share and title mix, summed over the included windows, so a person seen in two windows counts twice. Unique people sit below the number shown.</p></div>
        <div><div class="tblwrap"><table><thead><tr><th class="l">Best creatives serving ${esc(country)}</th><th>Impr.</th><th>CTR</th><th>Leads</th></tr></thead><tbody>${cres.map(c => `<tr><td class="l" style="white-space:normal;min-width:200px">${esc(shortName(c.ad_name, 70))}${c.exclusive ? ' <span class="tag">named geography</span>' : ''}<br><span class="muted" style="font-size:12px">${esc(shortName(c.campaign || '', 60))}</span></td><td>${c.impressions ? fmt(c.impressions) : fmt(c.sends) + ' sends'}</td><td>${pct(c.ctr, 2)}</td><td>${fmt(c.leads)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No creatives in range for this country</td></tr>'}</tbody></table></div>
        <p class="muted" style="font-size:12.5px;margin-top:8px">Creatives are matched by the geography written in the ad set name; ad sets without one ran to shared audiences, so every account in that audience saw the same ads.</p></div></div></div>`;
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    ctx.ui.seg(el.querySelector('#penSeg'), [{ value: 'All', label: 'All bands' }, { value: 'MD', label: 'MD' }, { value: 'MD-1', label: 'MD-1' }, { value: 'MD-2', label: 'MD-2' }], v => { penBand = v; drawPen(); }, 'All');
    drawPen();
  }

  // ---- 8. AI panel ----
  const inputProvider = () => {
    const wk = A.trend(perf, 'week').map(b => ({ week: b.key, spend: Math.round(b.spend), impressions: b.impressions, clicks: b.clicks, leads: b.leads, cpl: b.cpl && Math.round(b.cpl) }));
    const progs = P.programs.map(p => ({ name: p.name, stage: p.stage, spend: Math.round(p.spend), impressions: p.impressions, clicks: p.clicks, leads: p.leads, cpl: p.cpl && Math.round(p.cpl), verdict: p.verdict.label, months: p.months_label, top_ad_sets: p.campaigns.slice(0, 3).map(c => ({ name: c.name, spend: Math.round(c.spend), leads: c.leads, cpl: c.cpl && Math.round(c.cpl), verdict: c.verdict.label })) }));
    const share = (segment, top = 8) => { const s = A.segmentShare(demoRows, segment, 'impressions'); return [...s.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ [segment === 'Country' ? 'country' : 'value']: k, share_pct: s.total ? Math.round(v / s.total * 1000) / 10 : null })); };
    const bs = A.bandShares(A.segRows(demoRows, 'Job Title'), bands);
    const input = {
      range: { from, to, days }, previous_range: prev ? { from: prev.from, to: prev.to, label: prev.label } : null,
      totals: round(T), previous_totals: prevPerf.length ? round(TP) : null,
      trend_by_week: wk.slice(-16),
      stage_split: Object.fromEntries(Object.entries(SS.totals).map(([k, v]) => [k, { spend: Math.round(v.spend), leads: v.leads, impressions: v.impressions }])),
      programs: progs,
      top_ads: ads.slice(0, 6).map(a => ({ name: a.ad_name, spend: Math.round(a.spend), leads: a.leads, cpl: a.cpl && Math.round(a.cpl), ctr: a.ctr && Math.round(a.ctr * 100) / 100 })),
      bottom_ads: ads.filter(a => a.spend > 50 && !a.leads).slice(-5).map(a => ({ name: a.ad_name, spend: Math.round(a.spend), impressions: a.impressions })),
      achieved: bullets.achieved.map(b => b.b + ' ' + b.s), not_achieved: bullets.missed.map(b => b.b + ' ' + b.s),
      demographics_windows: windows.map(winLabel),
      seniority_share: share('Job Seniority'), geography_share: share('Country'), function_share: share('Job Function', 6),
      band_share: Object.fromEntries(A.BANDS.map(b => [b, Math.round(bs.share[b] * 1000) / 10])),
      accounts_reached: { count: matched.size, of: accounts.length, top: [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ account: k, impressions: v })) },
      penetration: penSummary ? { frequency, top: penSummary.slice(0, 6).map(c => ({ account: c.account, country: c.country, pct: Math.round(c.pct * 10) / 10, reached: Math.round(c.reached_band), pool: c.pool_band })), bottom: penSummary.slice(-6).map(c => ({ account: c.account, country: c.country, pct: Math.round(c.pct * 10) / 10, reached: Math.round(c.reached_band), pool: c.pool_band })) } : null,
      targets: S.targets || null,
    };
    let s = JSON.stringify(input);
    if (s.length > 40000) { input.programs = input.programs.slice(0, 8).map(p => ({ ...p, top_ad_sets: p.top_ad_sets.slice(0, 1) })); input.trend_by_week = input.trend_by_week.slice(-8); s = JSON.stringify(input); }
    return JSON.parse(s.length > 40000 ? s.slice(0, 40000) : s);
  };
  ctx.mountInsights(el.querySelector('#aiPanel'), ctx, { scope: `ads:linkedin:${from}:${to}`, kind: 'ads', title: 'What this means and what to do', inputProvider });
}

function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function shortName(s, max = 44) { s = String(s || '').replace(/\|/g, ' | '); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function round(t) { const o = {}; for (const [k, v] of Object.entries(t)) o[k] = v == null ? null : Math.round(v * 100) / 100; return o; }

// Editors can upload. The shell loads settings.editors; demo mode is always an editor.
export function isEditorOf(ctx) {
  if (ctx.demo) return true;
  const list = (ctx.settings && ctx.settings.editors) || [];
  return list.includes(String((ctx.user && ctx.user.email) || '').toLowerCase());
}
