// Ads › Penetration map: the "GSI LinkedIn Penetration Map" report as a live page, computed from the uploaded
// LinkedIn exports with the report's formulas (js/lib/penmap-agg.mjs). Claude Sonnet writes the judgement parts
// (headlines, why things worked, what to do and not do, the spend plan, set-up steps, day-3 rules) through
// /api/ca/penmap-ai; until it has run, rule-based versions of the same sections are shown.
import * as A from '../lib/linkedin-agg.mjs';
import * as P from '../lib/penmap-agg.mjs';
import { tierOf as tierOfName, TIER_GROUP } from '../lib/tiers.mjs';
import { memoGet } from '../compare.mjs';
import { actionLog } from '../actions.mjs';

export const route = 'ads/penetration';
export const title = 'Ads · Penetration map';
const HOME = 'India';
const RCOL = { 'India': '#B8B4AD', 'US': '#043E77', 'UK': '#3D6E9E', 'Middle East': '#FE4B1E', 'APAC': '#8A857C', 'Europe & other': '#E3E1DE' };
const BAND_OPTS = [['ICP', 'MD to MD-2'], ['MD', 'MD'], ['MD-1', 'MD-1'], ['MD-2', 'MD-2'], ['Sr IC', 'Sr IC'], ['ALL', 'Everyone']];
let charts = [];
export function destroy() { for (const c of charts) { try { c.destroy(); } catch { /* ignore */ } } charts = []; }

// The report's number formats.
const fmt = n => n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString('en-US');
const usd = n => n == null || isNaN(n) || !isFinite(n) ? '–' : '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : (n >= 100 ? Math.round(n) : n.toFixed(n < 10 ? 1 : 0)));
const pct = n => n == null || isNaN(n) || !isFinite(n) ? '–' : (n * 100).toFixed(n < 0.1 ? 1 : 0) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const seg = (id, opts, cur) => `<div class="pm-seg" id="${id}" role="group">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
function shade(t) { t = Math.max(0, Math.min(1, t)); const a = [241, 240, 238], b = [4, 62, 119]; const c = a.map((v, i) => Math.round(v + (b[i] - v) * t)); return { bg: `rgb(${c})`, fg: t > 0.55 ? '#fff' : '#1F2022' }; }
function shadeAnti(t) { t = Math.max(0, Math.min(1, t)); const stops = [[255, 241, 236], [254, 75, 30], [142, 42, 16]]; const [a, b, f] = t < 0.6 ? [stops[0], stops[1], t / 0.6] : [stops[1], stops[2], (t - 0.6) / 0.4]; const c = a.map((v, i) => Math.round(v + (b[i] - v) * f)); return { bg: `rgb(${c})`, fg: t > 0.45 ? '#fff' : '#1F2022' }; }
function ensureCss() { if (document.getElementById('pm-css')) return; const l = document.createElement('link'); l.id = 'pm-css'; l.rel = 'stylesheet'; l.href = new URL('../../css/penmap.css', import.meta.url).href; document.head.appendChild(l); }
const LS = { get(k, d) { try { const v = localStorage.getItem('ca.pm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ca.pm.' + k, JSON.stringify(v)); } catch { /* private window */ } } };

export async function render(el, ctx) {
  destroy(); ensureCss();
  const F = ctx.fmt;
  const S = ctx.settings || {};
  const basis = LS.get('basis', 'all');
  const from = basis === 'all' ? '2025-01-01' : ctx.state.from, to = basis === 'all' ? F.today() : ctx.state.to;
  el.innerHTML = `<div class="seghead">Ads · Penetration map</div><h1>GSI LinkedIn penetration map</h1>${ctx.ui.spinner('Building the map from the LinkedIn exports')}`;
  let data;
  try { data = await memoGet(ctx, 'linkedin', { from, to }); }
  catch (e) { el.innerHTML = `<div class="seghead">Ads · Penetration map</div><h1>GSI LinkedIn penetration map</h1>${ctx.ui.empty('LinkedIn data could not be loaded: ' + (e.message || e))}`; return; }

  const accounts = Array.isArray(S.accounts) ? S.accounts : [], regions = S.regions || {};
  const icpPool = A.expandPool(Array.isArray(S.icp_pool) ? S.icp_pool : [], accounts, { estimates: Array.isArray(S.icp_estimates) ? S.icp_estimates : [] });
  const divisor = Number((S.targets || {}).reach_frequency) || 3;
  const recentN = LS.get('recentN', 2);
  const memo = new Map(); const matchAccount = v => { if (!memo.has(v)) memo.set(v, A.matchAccount(v, accounts)); return memo.get(v); };
  const tierOf = name => tierOfName(name, S.account_tiers, accounts);
  const perf = (data.perf || []).filter(r => (r.platform || 'linkedin') === 'linkedin' && r.day >= from && r.day <= to);
  const windows = A.mainWindows(A.activeWindows(data.demo || [])).map(w => ({ upload: w.upload, rows: windowRows(w) })).sort((a, b) => (a.upload.period_start || '') < (b.upload.period_start || '') ? -1 : 1);
  if (!perf.length && !windows.length) {
    el.innerHTML = `<div class="seghead">Ads · Penetration map</div><h1>GSI LinkedIn penetration map</h1>${ctx.ui.empty('No LinkedIn exports cover these dates yet. Upload the Ad Performance and Demographics exports on the LinkedIn page (or Upload CSVs) and this page fills in.', '<a class="btn tiny" href="#/uploads">Upload CSVs</a>')}`;
    return;
  }
  const M = P.buildModel({ perf, windows, accounts, icpPool, regions, matchAccount, divisor, recentMonths: recentN, mix: S.mix_defaults || null });
  const K = P.kpis(M, { home: HOME });
  const W = P.workedSplit(M);
  const recLabel = M.recent.map(m => P.monthShort(m)).join(' – ');
  const allLabel = M.months.length ? `${P.monthShort(M.months[0], true)} – ${M.lastDay ? F.dayLabel(M.lastDay) : P.monthShort(M.months[M.months.length - 1])}` : '';
  const AS = Object.fromEntries(M.adsets.map(a => [a.name, a]));
  const recentNote = `${recLabel}${M.lastDay ? ` (to ${F.dayLabel(M.lastDay)})` : ''}`;
  const st = { period: 'all', band: 'ICP', metric: 'people', sel: null, tier: 'all', q: '', sort: 'total', sortDir: -1, rows: LS.get('rows', 40), budget: LS.get('budget', 600), days: LS.get('days', 5),
    antiRegs: LS.get('antiRegs', P.POOL_REG.filter(r => r !== HOME)), antiBasis: 'recent', antiBand: 'ICP', antiTier: 'all', antiQ: '', antiNever: false, picked: null,
    gapRegs: LS.get('gapRegs', ['US', 'UK', 'Middle East']), spendSeries: LS.get('spendSeries', ['spend', 'leads']), regMode: 'share' };
  let AI = null; // Claude's plan, when generated

  // ---------- page skeleton ----------
  let h = `<div class="pm-wrap"><div class="seghead">Ads · Penetration map · ${esc(allLabel)}</div><h1>GSI LinkedIn penetration map</h1>
  <p class="sub">Who the LinkedIn spend has reached by company, seniority band and region, what produced leads, which accounts are still cold, and how to spend the next budget. Built from the uploaded exports with the report's formulas: 1 person = ${fmt(divisor)} impressions, penetration = people ÷ Apollo headcount for that firm, region and band.</p>
  <div class="pm-bar"><div class="pm-ctl"><span>Data</span>${seg('pm-basis', [['all', 'Whole history'], ['range', 'Top-bar dates']], basis)}</div>
  <div class="pm-ctl"><span>Recent window</span>${seg('pm-recent', [[1, 'Last month'], [2, 'Last 2 months'], [3, 'Last 3 months']], recentN)}</div>
  <span class="pm-note">Recent = ${esc(recentNote)}, inside LinkedIn's 90-day retargeting window. ${M.notes.windows.length} demographics window${M.notes.windows.length === 1 ? '' : 's'}, ${fmt(perf.length)} daily ad rows.</span></div>
  ${estimateNote()}`;
  h += `<section class="section" id="pm-summary"><div class="pm-kpis" id="pm-kpis"></div><div class="pm-callouts" id="pm-heads"></div><div class="pm-ai" id="pm-ai"></div></section>`;
  h += ctx.ui.section('01 · What happened: spend, leads and where impressions landed', `Lead-gen CPL = lead-gen spend ÷ LinkedIn form leads. Region mix comes from the demographics report (contextual country). Toggle the series to compare.`,
    `<div class="pm-grid2"><div class="pm-card"><h3>Spend and leads</h3><div class="pm-chips" id="pm-spend-chips"></div><div class="pm-chart"><canvas id="pm-ch-spend"></canvas></div></div>
     <div class="pm-card"><h3>Where impressions landed</h3><div class="pm-bar" style="margin:0 0 6px">${seg('pm-regmode', [['share', 'Share %'], ['imp', 'Impressions'], ['people', 'People']], 'share')}</div><div class="pm-chart"><canvas id="pm-ch-region"></canvas></div></div></div>
     <div class="pm-card pm-scroll" style="margin-top:12px"><table class="pm-t" id="pm-t-month"></table></div>`, 'pm-story');
  h += ctx.ui.section('02 · What worked and what did not', `Ad sets sorted by the rules (lead gen: CPL against the median; reach: CPM against the median). With Claude's read-out the rows are grouped and each says why.`,
    `<div class="pm-grid2"><div class="pm-card pm-scroll"><h3>Worked</h3><table class="pm-t" id="pm-t-good"></table></div><div class="pm-card pm-scroll"><h3>Did not work</h3><table class="pm-t" id="pm-t-bad"></table></div></div>
     <div class="pm-grid2" style="margin-top:12px"><div class="pm-card"><h3>What to do</h3><ul class="pm-list" id="pm-do"></ul></div><div class="pm-card"><h3>What not to do</h3><ul class="pm-list" id="pm-dont"></ul></div></div>`, 'pm-worked');
  h += ctx.ui.section('03 · Penetration heat map: people reached by company × region × band', `People ≈ impressions ÷ ${fmt(divisor)}. Band split: MD = Partner / MD / VP / CXO seniority, MD-1 = Director, MD-2 = Manager (incl. Senior Manager), Sr IC = LinkedIn “Senior”. Penetration = people ÷ Apollo headcount for that firm, region and band. Click a cell (or move with the arrow keys) for the band breakdown; click a column to sort.`,
    `<div class="pm-bar"><div class="pm-ctl"><span>Period</span>${seg('pm-period', [['all', 'All months'], ['recent', `${recLabel} (retargetable)`]], 'all')}</div>
     <div class="pm-ctl"><span>Band</span>${seg('pm-band', BAND_OPTS, 'ICP')}</div>
     <div class="pm-ctl"><span>Show</span>${seg('pm-metric', [['people', 'People'], ['pen', 'Penetration %']], 'people')}</div>
     <div class="pm-ctl"><span>Tier</span><select id="pm-tier">${tierOptions()}</select></div>
     <div class="pm-ctl"><span>Find</span><input type="search" id="pm-q" placeholder="Company" style="width:150px"></div>
     <div class="pm-ctl"><span>Rows</span><select id="pm-rows">${[[20, 'Top 20'], [40, 'Top 40'], [0, 'All']].map(([v, l]) => `<option value="${v}" ${+st.rows === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
     <div class="pm-hmwrap"><div><div class="pm-hmbox" id="pm-hmbox"><table class="pm-hm" id="pm-hm"></table></div><div class="pm-legend" id="pm-legend"></div></div><aside class="pm-card pm-detail" id="pm-detail" aria-live="polite"></aside></div>`, 'pm-heat');
  h += ctx.ui.section('04 · Anti heat map: accounts to target for penetration', `The reverse of the heat map: Apollo headcount the ads have <b>not</b> reached. Gap = headcount − people reached in the chosen window; the colour is priority = gap × (1 − coverage), so a big pool nobody has seen is the darkest and a warm one fades out. Tick rows to build the target list for the next company-targeted ad sets.`,
    `<div class="pm-anti-head"><b>Anti heat map.</b> <span class="pm-note">These are the accounts and regions where more spend buys new people, not repeats. ${esc(HOME)} is left out by default because it is already saturated at the big accounts.</span></div>
     <div class="pm-bar"><div class="pm-ctl"><span>Regions</span><div class="pm-chips" id="pm-anti-regs"></div></div>
     <div class="pm-ctl"><span>Reached in</span>${seg('pm-anti-basis', [['recent', `${recLabel} (retargetable)`], ['all', 'All months']], 'recent')}</div>
     <div class="pm-ctl"><span>Band</span>${seg('pm-anti-band', BAND_OPTS.slice(0, 4), 'ICP')}</div>
     <div class="pm-ctl"><span>Tier</span><select id="pm-anti-tier">${tierOptions()}</select></div>
     <div class="pm-ctl"><span>Find</span><input type="search" id="pm-anti-q" placeholder="Company" style="width:150px"></div>
     <label class="pm-ctl" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="pm-anti-never"> <span style="text-transform:none;letter-spacing:0;font-family:var(--font);font-size:13px;color:var(--ink)">Never reached only</span></label></div>
     <div class="pm-hmwrap"><div><div class="pm-hmbox" id="pm-antibox"><table class="pm-hm" id="pm-anti"></table></div><div class="pm-legend"><span>Low priority</span><span class="ramp anti"></span><span>High priority (square-root scale)</span><span>· <span class="pm-pill ok">Warm</span> = 25%+ reached, no need to push</span><span>· dashed = estimated headcount</span></div></div>
     <aside class="pm-card pm-detail" id="pm-targets"></aside></div>`, 'pm-anti-sec');
  h += ctx.ui.section(`05 · The non-${HOME} gap`, `Retargetable pool = people reached in ${esc(recentNote)} (inside LinkedIn's 90-day engagement window). Gap = Apollo MD to MD-2 headcount not yet reached in that window. Cold under 5%, Thin under 25%, Warm otherwise.`,
    `<div class="pm-kpis" id="pm-pools"></div><div class="pm-bar"><div class="pm-ctl"><span>Regions in the table</span><div class="pm-chips" id="pm-gap-regs"></div></div></div><div class="pm-card pm-scroll"><h3>Biggest gaps: the accounts to load into top-of-funnel</h3><table class="pm-t" id="pm-t-gap"></table></div>`, 'pm-gaps');
  h += ctx.ui.section('06 · The spend plan', `Each row's CPL or CPM range is this account's own result for the closest matching ad set, named in the row. Leads = spend ÷ CPL range; people = 1,000 × spend ÷ CPM range ÷ ${fmt(divisor)}; demo bookings = 12 to 25% of the expected leads if an SDR calls within 24 hours.`,
    `<div class="pm-bar"><div class="pm-ctl"><span>Budget</span>${seg('pm-budget', [[500, '$500'], [600, '$600'], [1000, '$1,000'], [2500, '$2,500']], st.budget)}</div><div class="pm-ctl"><span>Custom</span><input type="number" id="pm-budget-x" min="50" step="50" value="${st.budget}" style="width:100px"></div><div class="pm-ctl"><span>Over</span>${seg('pm-days', [[5, '5 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']], st.days)}</div><span class="pm-note" id="pm-plan-src"></span></div>
     <div class="pm-card pm-scroll"><table class="pm-t" id="pm-t-plan"></table></div><div class="pm-kpis" id="pm-plan-kpis"></div>
     <div class="pm-grid2" style="margin-top:12px"><div class="pm-card"><h3>Set-up, in order</h3><ol class="pm-steps" id="pm-steps"></ol></div><div class="pm-card"><h3>Day-3 rules</h3><ol class="pm-steps" id="pm-rules"></ol></div></div>`, 'pm-plan');
  h += ctx.ui.section('07 · How the numbers are built', '', `<div class="pm-card"><ol class="pm-steps" id="pm-method"></ol></div>`, 'pm-method-sec');
  h += '</div>';
  el.innerHTML = h;
  const $ = id => el.querySelector('#' + id);

  // ---------- 0. KPIs and headlines ----------
  function drawKpis() {
    const nh = K.nonHome;
    const list = [
      ['Spend', usd(K.spend), `${esc(allLabel)}, all LinkedIn campaigns`],
      ['Impressions', fmt(K.imp), `≈ ${fmt(K.people)} people at ${fmt(divisor)} impressions each`],
      ['Form leads', fmt(K.leads), `${fmt(K.lfo)} forms opened · ${pct(K.completion)} completed`],
      [`Lead-gen CPL, ${recLabel}`, usd(K.cplRecent), K.cplBefore != null ? `was ${usd(K.cplBefore)} before` : 'no earlier months', true],
      [`${HOME} share of impressions`, pct(K.homeShare), `US only ${pct(K.usShare)} · UK ${pct(K.ukShare)}`],
      [`Non-${HOME} regional sets, ${M.lastMonth ? P.monthShort(M.lastMonth) : '–'}`, !nh.sets.length ? '–' : nh.leads ? usd(nh.cpl) + ' CPL' : 'No leads', nh.sets.length ? `${fmt(nh.leads)} leads for ${usd(nh.spend)}${nh.leadRegions.length ? ` (from ${esc(nh.leadRegions.join(', '))})` : ''} · ${nh.sets.length} ad set${nh.sets.length === 1 ? '' : 's'}` : 'no ad set names a non-' + HOME + ' geography'],
    ];
    $('pm-kpis').innerHTML = list.map(([l, v, s, hl]) => `<div class="pm-kpi${hl ? ' hl' : ''}"><span class="k">${esc(l)}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('');
  }
  function ruleHeadlines() {
    const out = [];
    const bestLead = W.good.find(x => x.mode === 'lg');
    if (bestLead) out.push({ title: 'What produces cheap leads', body: `${bestLead.name} made ${fmt(bestLead.leads)} leads at ${usd(bestLead.cpl)} CPL${K.cplBefore != null ? `; before ${recLabel} the account averaged ${usd(K.cplBefore)}` : ''}.`, tone: 'good' });
    const zero = W.bad.filter(x => x.mode === 'lg' && !x.leads);
    if (zero.length) out.push({ title: 'Ad sets that spent with no leads', body: `${zero.length} lead-gen ad set${zero.length === 1 ? '' : 's'} spent ${usd(zero.reduce((a, x) => a + x.spend, 0))} for 0 leads, led by ${zero[0].name}.`, tone: 'bad' });
    const ms = M.monthly.filter(o => o.has_demo); if (ms.length >= 2) { const a = ms[ms.length - 2], b = ms[ms.length - 1]; const moves = P.REG.filter(r => r !== HOME).map(r => ({ r, d: b.reg[r] - a.reg[r] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)); const m = moves[0]; if (m) out.push({ title: `${m.r} ${m.d < 0 ? 'went colder' : 'warmed up'}`, body: `${m.r} impressions moved from ${pct(a.reg[m.r])} of delivery in ${a.label} to ${pct(b.reg[m.r])} in ${b.label}. Only ≈${fmt(M.regTotals.recent[m.r] / divisor)} ${m.r} people sit in the retargeting window, against ≈${fmt(M.regTotals.recent[HOME] / divisor)} in ${HOME}.`, tone: m.d < 0 ? 'bad' : 'good' }); }
    return out;
  }
  function drawHeads() {
    const heads = AI && AI.headlines && AI.headlines.length ? AI.headlines : ruleHeadlines();
    $('pm-heads').innerHTML = heads.map(x => `<div class="pm-co ${x.tone === 'bad' ? 'bad' : x.tone === 'good' ? 'good' : ''}"><b>${esc(x.title)}</b><p>${esc(x.body)}</p></div>`).join('');
  }

  // ---------- 1. charts and the month table ----------
  const SERIES_DEF = { spend: ['Spend', '#043E77', 'bar', 'y'], lgspend: ['Lead-gen spend', '#3D6E9E', 'bar', 'y'], leads: ['Form leads', '#FE4B1E', 'line', 'y1'], imp: ['Impressions', '#0E9F9F', 'line', 'y2'], people: ['≈ People', '#7A3FE4', 'line', 'y2'], clk: ['Clicks', '#1FA64A', 'line', 'y1'], cpl: ['Lead-gen CPL', '#E5A100', 'line', 'y'] };
  function drawSpend() {
    $('pm-spend-chips').innerHTML = Object.entries(SERIES_DEF).map(([k, [l, c]]) => `<button type="button" class="pm-chip" data-k="${k}" aria-pressed="${st.spendSeries.includes(k)}"><i style="background:${c}"></i>${esc(l)}</button>`).join('');
    $('pm-spend-chips').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; st.spendSeries = st.spendSeries.includes(k) ? st.spendSeries.filter(x => x !== k) : [...st.spendSeries, k]; LS.set('spendSeries', st.spendSeries); drawSpend(); });
    if (!window.Chart) return;
    const rows = M.monthly; const val = (r, k) => k === 'people' ? r.imp / divisor : k === 'cpl' ? (r.leads ? r.lgspend / r.leads : null) : r[k];
    const ds = st.spendSeries.map(k => { const [l, c, type, axis] = SERIES_DEF[k]; return { type, label: l, data: rows.map(r => val(r, k)), backgroundColor: c, borderColor: c, borderWidth: type === 'line' ? 2 : 0, pointRadius: type === 'line' ? 3 : 0, yAxisID: axis, order: type === 'line' ? 0 : 1, borderRadius: 2, tension: 0.2 }; });
    const used = new Set(ds.map(d => d.yAxisID));
    const old = charts.find(c => c.canvas && c.canvas.id === 'pm-ch-spend'); if (old) { old.destroy(); charts = charts.filter(c => c !== old); }
    charts.push(new Chart($('pm-ch-spend'), { data: { labels: rows.map(r => r.label + (r.m === M.lastMonth && M.lastDay && M.lastDay.slice(8) < '28' ? ` (to ${+M.lastDay.slice(8)})` : '')), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${/Spend|CPL/.test(c.dataset.label) ? usd(c.parsed.y) : fmt(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false } }, y: { display: used.has('y'), position: 'left', ticks: { callback: v => usd(v) } }, y1: { display: used.has('y1'), position: 'right', grid: { display: false } }, y2: { display: used.has('y2'), position: 'right', grid: { display: false }, ticks: { callback: v => F.compact(v) } } } } }));
  }
  function drawRegion() {
    if (!window.Chart) return;
    const rows = M.monthly.filter(r => r.has_demo); const mode = st.regMode;
    const old = charts.find(c => c.canvas && c.canvas.id === 'pm-ch-region'); if (old) { old.destroy(); charts = charts.filter(c => c !== old); }
    charts.push(new Chart($('pm-ch-region'), { type: 'bar', data: { labels: rows.map(r => r.label + (r.reg_estimated ? '*' : '')), datasets: P.REG.map(g => ({ label: g, data: rows.map(r => mode === 'share' ? r.reg[g] * 100 : mode === 'people' ? r.regimp[g] / divisor : r.regimp[g]), backgroundColor: RCOL[g], borderColor: '#CFCCC7', borderWidth: g === 'Europe & other' ? 1 : 0 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => { const r = rows[c.dataIndex]; return `${c.dataset.label}: ${pct(r.reg[c.dataset.label])} (${fmt(r.regimp[c.dataset.label])} impr., ≈${fmt(r.regimp[c.dataset.label] / divisor)} people)`; } } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: mode === 'share' ? 100 : undefined, ticks: { callback: v => mode === 'share' ? v + '%' : F.compact(v) } } } } }));
  }
  function drawMonthTable() {
    const T = M.tot, ra = M.regTotals.all, sa = Object.values(ra).reduce((a, b) => a + b, 0) || 1;
    $('pm-t-month').innerHTML = `<thead><tr><th>Month</th><th class="r">Spend</th><th class="r">Lead-gen spend</th><th class="r">Impr.</th><th class="r">≈ People</th><th class="r">Clicks</th><th class="r">CTR</th><th class="r">Leads</th><th class="r">Lead-gen CPL</th>${['India', 'US', 'UK', 'Middle East'].map(g => `<th class="r">${g === 'Middle East' ? 'ME' : g}</th>`).join('')}</tr></thead><tbody>` +
      M.monthly.map(r => `<tr><td>${esc(r.label)}${r.m === M.lastMonth && M.lastDay && M.lastDay.slice(8) < '28' ? ` (to ${+M.lastDay.slice(8)}th)` : ''}${r.reg_estimated ? ' <span class="pm-pill mute" title="No Country export for this month: the default mix is used">mix</span>' : ''}</td><td class="r">${usd(r.spend)}</td><td class="r">${usd(r.lgspend)}</td><td class="r">${fmt(r.imp)}</td><td class="r">${fmt(r.imp / divisor)}</td><td class="r">${fmt(r.clk)}</td><td class="r">${r.imp ? pct(r.clk / r.imp) : '–'}</td><td class="r">${fmt(r.leads)}</td><td class="r">${r.leads ? usd(r.lgspend / r.leads) : '–'}</td>${['India', 'US', 'UK', 'Middle East'].map(g => `<td class="r">${r.has_demo ? pct(r.reg[g]) : '–'}</td>`).join('')}</tr>`).join('') +
      `<tr class="tot"><td>Total</td><td class="r">${usd(T.spend)}</td><td class="r">${usd(T.lgspend)}</td><td class="r">${fmt(T.imp)}</td><td class="r">${fmt(T.imp / divisor)}</td><td class="r">${fmt(T.clk)}</td><td class="r">${T.imp ? pct(T.clk / T.imp) : '–'}</td><td class="r">${fmt(T.leads)}</td><td class="r">${T.leads ? usd(T.lgspend / T.leads) : '–'}</td>${['India', 'US', 'UK', 'Middle East'].map(g => `<td class="r">${pct(ra[g] / sa)}</td>`).join('')}</tr></tbody>`;
  }

  // ---------- 2. worked / did not ----------
  const sumSets = names => names.reduce((o, nm) => { const a = AS[nm]; if (a) { o.spend += a.spend; o.imp += a.imp; o.leads += a.leads; o.lfo += a.lfo; o.vv += a.vv; o.clk += a.clk; o.found++; } return o; }, { spend: 0, imp: 0, leads: 0, lfo: 0, vv: 0, clk: 0, found: 0 });
  const wRow = (label, a, mode, why) => { const cpl = a.leads ? a.spend / a.leads : null, cpm = a.imp ? 1000 * a.spend / a.imp : null; return `<tr><td><div>${esc(label)}</div><div class="why">${esc(why)}</div></td><td class="r">${usd(a.spend)}</td><td class="r">${mode === 'aw' ? usd(cpm) + ' CPM' : `${fmt(a.leads)} · ${cpl ? usd(cpl) : '–'}`}</td></tr>`; };
  function drawWorked() {
    const H = '<thead><tr><th>Ad set</th><th class="r">Spend</th><th class="r">Leads · CPL / CPM</th></tr></thead><tbody>';
    const fromAi = list => (list || []).map(x => { const a = sumSets(x.adsets); return a.found ? wRow(x.label, a, x.mode === 'awareness' ? 'aw' : 'lg', x.why) : ''; }).join('');
    const good = AI && AI.worked && AI.worked.length ? fromAi(AI.worked) : W.good.map(x => wRow(x.name, AS[x.name], x.mode, x.why)).join('');
    const bad = AI && AI.did_not_work && AI.did_not_work.length ? fromAi(AI.did_not_work) : W.bad.map(x => wRow(x.name, AS[x.name], x.mode, x.why)).join('');
    $('pm-t-good').innerHTML = H + (good || '<tr><td colspan="3" class="muted">Nothing clears the bar yet.</td></tr>') + '</tbody>';
    $('pm-t-bad').innerHTML = H + (bad || '<tr><td colspan="3" class="muted">Nothing flagged.</td></tr>') + '</tbody>';
    const li = (list, empty) => list && list.length ? list.map(s => `<li>${esc(s)}</li>`).join('') : `<li class="muted" style="list-style:none;margin-left:-18px">${empty}</li>`;
    $('pm-do').innerHTML = li(AI && AI.do, 'Generate the Claude read-out above for the list.');
    $('pm-dont').innerHTML = li(AI && AI.dont, 'Generate the Claude read-out above for the list.');
  }

  // ---------- 3. heat map ----------
  const monthsOf = () => st.period === 'all' ? M.months : M.recent;
  function hmRows() {
    const q = st.q.trim().toLowerCase();
    let comps = M.companies.filter(c => (!q || c.toLowerCase().includes(q)) && tierOk(c, st.tier));
    const ms = monthsOf();
    const vals = new Map(comps.map(c => [c, P.REG.map(r => P.cellVal(M, c, r, { band: st.band, metric: st.metric, months: ms }))]));
    const total = c => vals.get(c).reduce((a, x) => a + x.p, 0);
    const key = c => st.sort === 'name' ? c.toLowerCase() : st.sort === 'total' ? total(c) : (vals.get(c)[P.REG.indexOf(st.sort)].v ?? -1);
    comps.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (st.sort === 'name' ? 1 : st.sortDir); });
    if (+st.rows) comps = comps.slice(0, +st.rows);
    return { comps, vals, total };
  }
  function drawHM() {
    const { comps, vals, total } = hmRows();
    let maxV = 0; for (const c of comps) for (const x of vals.get(c)) if (x.v != null && isFinite(x.v)) maxV = Math.max(maxV, x.v);
    const sc = v => st.metric === 'pen' ? Math.min(v, 1) : Math.sqrt(v / (maxV || 1));
    const sortAttr = k => st.sort === k ? ' aria-sort="descending"' : '';
    let h = `<thead><tr><th data-sort="name"${sortAttr('name')}>Company</th>${P.REG.map(r => `<th data-sort="${esc(r)}"${sortAttr(r)}>${esc(r)}</th>`).join('')}<th data-sort="total"${sortAttr('total')}>Total</th></tr></thead><tbody>`;
    const colTot = P.REG.map(() => 0);
    comps.forEach((c, i) => {
      const t = tierOf(c);
      h += `<tr><td class="name" title="${esc(c)}">${esc(c)}<span class="tier">${esc(t || '')}</span></td>`;
      P.REG.forEach((r, j) => {
        const x = vals.get(c)[j]; colTot[j] += x.p;
        const s = x.v == null ? { bg: 'var(--surface)', fg: '#8A857C' } : shade(sc(x.v));
        const txt = x.v == null ? (st.metric === 'pen' ? '–' : fmt(x.p)) : st.metric === 'pen' ? pct(Math.min(x.v, 9.99)) : fmt(x.v);
        const sat = st.metric === 'pen' && x.v >= 1 ? '<span class="sat">SAT</span>' : '';
        const isSel = st.sel && st.sel[0] === c && st.sel[1] === r; const est = P.poolEst(M, c, r) && st.metric === 'pen';
        const tb = st.band === 'ALL' || st.band === 'Sr IC' ? P.ICPB : P.bandsOf(st.band), tpo = P.pool(M, c, r, tb), tpp = P.people(M, c, r, tb, monthsOf());
        const tip = `${c} · ${r}: ${fmt(x.p)} people${tpo ? ` · ${pct(tpp / tpo)} of ${fmt(tpo)} ${tb === P.ICPB ? 'MD to MD-2' : st.band} in Apollo${P.poolEst(M, c, r) ? ' (estimated headcount)' : ''}` : ' · no Apollo headcount'}`;
        h += `<td class="c${isSel ? ' sel' : ''}${est ? ' est' : ''}" tabindex="${isSel || (!st.sel && i === 0 && j === 0) ? 0 : -1}" data-i="${i}" data-j="${j}" style="background:${s.bg};color:${s.fg}" title="${esc(tip)}">${txt}${sat}</td>`;
      });
      h += `<td class="tot">${fmt(total(c))}</td></tr>`;
    });
    h += `</tbody><tfoot><tr><td>${comps.length} compan${comps.length === 1 ? 'y' : 'ies'}</td>${colTot.map(v => `<td>${fmt(v)}</td>`).join('')}<td>${fmt(colTot.reduce((a, b) => a + b, 0))}</td></tr></tfoot>`;
    const t = $('pm-hm'); t.innerHTML = comps.length ? h : `<tbody><tr><td class="name">No company matches these filters.</td></tr></tbody>`;
    $('pm-legend').innerHTML = `<span>${st.metric === 'pen' ? '0%' : '0'}</span><span class="ramp"></span><span>${st.metric === 'pen' ? '100%+' : fmt(maxV) + ' people (square-root scale)'}</span><span>${st.metric === 'pen' ? '· SAT = impressions ÷ ' + fmt(divisor) + ' exceed headcount; extra spend there buys frequency, not new people. “–” = no Apollo headcount. Dashed = estimated headcount.' : '· Total = all six regions for the selected band and period. Footer = column totals.'}</span>`;
    t.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; if (st.sort === k && k !== 'name') st.sortDir *= -1; else { st.sort = k; st.sortDir = -1; } drawHM(); });
    t.querySelectorAll('td.c').forEach(td => {
      const go = () => { st.sel = [comps[+td.dataset.i], P.REG[+td.dataset.j]]; drawHM(); drawDetail(); const n = $('pm-hm').querySelector('td.c.sel'); if (n) n.focus({ preventScroll: true }); };
      td.onclick = go;
      td.onkeydown = e => { const i = +td.dataset.i, j = +td.dataset.j; const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } else if (mv) { e.preventDefault(); const ni = Math.max(0, Math.min(comps.length - 1, i + mv[0])), nj = Math.max(0, Math.min(P.REG.length - 1, j + mv[1])); st.sel = [comps[ni], P.REG[nj]]; drawHM(); drawDetail(); const n = $('pm-hm').querySelector('td.c.sel'); if (n) n.focus({ preventScroll: false }); } };
    });
  }
  function drawDetail() {
    const d = $('pm-detail'); const [c, r] = st.sel || [M.companies[0], HOME]; if (!c) { d.innerHTML = '<p class="muted">No company reached yet.</p>'; return; }
    const D = P.cellDetail(M, c, r, { band: st.band, months: monthsOf(), home: HOME });
    const mx = Math.max(1, ...D.monthly.map(x => x.v));
    d.innerHTML = `<div class="ui-label">${esc(c)} · ${esc(r)} · ${st.period === 'all' ? esc(allLabel) : esc(recLabel)}</div>
      <div class="pm-big" style="margin-top:6px">${fmt(D.icp)}</div><div class="pm-note">MD to MD-2 people reached${D.icpPool ? ` · ${pct(D.icp / D.icpPool)} of ${fmt(D.icpPool)} in Apollo${D.est ? ' (estimated)' : ''}` : ''}</div>
      <table class="pm-t" style="margin-top:10px"><thead><tr><th>Band</th><th class="r">People</th><th class="r">Headcount</th><th class="r">Reached</th></tr></thead><tbody>
      ${D.rows.map(x => `<tr><td>${x.b}</td><td class="r">${fmt(x.p)}</td><td class="r">${x.po ? fmt(x.po) : '–'}</td><td class="r">${x.pen == null ? '–' : (x.pen >= 1 ? '<span class="pm-pill warn">Saturated</span>' : pct(x.pen))}</td></tr>`).join('')}</tbody></table>
      <div class="ui-label" style="margin-top:12px">People by month · ${st.band === 'ICP' ? 'MD to MD-2' : st.band === 'ALL' ? 'everyone' : esc(st.band)} <span style="color:var(--orange)">■</span> recent</div>
      <div class="pm-bars">${D.monthly.map(x => `<div class="${M.recent.includes(x.m) ? 'rec' : ''}" style="height:${Math.max(2, 70 * x.v / mx)}px" title="${esc(x.label)}: ${fmt(x.v)}"></div>`).join('')}</div>
      <div class="pm-barl">${D.monthly.map(x => `<span>${esc(x.label)}</span>`).join('')}</div>
      <div class="pm-hint ${D.tone}">${esc(D.hint)}</div>
      ${D.icpPool && r !== HOME && D.recentICP / D.icpPool < 0.25 ? `<button class="btn tiny" id="pm-add-target" style="margin-top:10px">Add to the target list</button>` : ''}`;
    const add = d.querySelector('#pm-add-target'); if (add) add.onclick = () => { pickedSet().add(c + '|' + r); savePicked(); drawAnti(); ctx.toast(`${c} · ${r} added to the target list.`); };
  }

  // ---------- 4. anti heat map ----------
  const pickedSet = () => { if (!st.picked) st.picked = new Set(LS.get('picked', [])); return st.picked; };
  const savePicked = () => LS.set('picked', [...pickedSet()]);
  function antiData() { return P.antiHeat(M, { regions: st.antiRegs, band: st.antiBand, basis: st.antiBasis, tierOf, tierFilter: st.antiTier, search: st.antiQ }); }
  function drawAnti() {
    $('pm-anti-regs').innerHTML = P.POOL_REG.map(r => `<button type="button" class="pm-chip" data-r="${esc(r)}" aria-pressed="${st.antiRegs.includes(r)}">${esc(r)}</button>`).join('');
    $('pm-anti-regs').querySelectorAll('button').forEach(b => b.onclick = () => { const r = b.dataset.r; st.antiRegs = st.antiRegs.includes(r) ? st.antiRegs.filter(x => x !== r) : P.POOL_REG.filter(x => x === r || st.antiRegs.includes(x)); if (!st.antiRegs.length) st.antiRegs = [r]; LS.set('antiRegs', st.antiRegs); drawAnti(); });
    const AH = antiData(); let rows = AH.rows; if (st.antiNever) rows = rows.filter(x => x.never);
    const why = Object.fromEntries(((AI && AI.target_accounts) || []).map(t => [t.account.toLowerCase(), t]));
    const picked = pickedSet();
    if (!picked.size && !LS.get('pickedTouched', false)) rows.flatMap(x => st.antiRegs.map(r => ({ k: x.c + '|' + r, cl: x.cells[r] }))).filter(o => o.cl && o.cl.po && o.cl.status !== 'Warm').sort((a, b) => b.cl.pri - a.cl.pri).slice(0, 15).forEach(o => picked.add(o.k));
    let h = `<thead><tr><th style="text-align:left">Account</th>${st.antiRegs.map(r => `<th>${esc(r)}</th>`).join('')}<th>Gap</th><th>Reached</th></tr></thead><tbody>`;
    rows.slice(0, 120).forEach(x => {
      const w = why[x.c.toLowerCase()];
      h += `<tr><td class="name" title="${esc(w ? w.why : x.c)}">${esc(x.c)}<span class="tier">${esc(x.tier || '')}</span>${x.never ? ' <span class="pm-pill bad">never reached</span>' : ''}${w ? ' <span class="pm-pill navy" title="' + esc(w.why) + '">AI pick</span>' : ''}</td>`;
      for (const r of st.antiRegs) {
        const cl = x.cells[r];
        if (!cl || !cl.po) { h += `<td class="c" style="color:#8A857C;cursor:default" title="No Apollo headcount">–</td>`; continue; }
        const warm = cl.status === 'Warm'; const s = warm ? { bg: '#EEF6F1', fg: '#2F8F5B' } : shadeAnti(Math.sqrt(cl.pri / AH.maxPri));
        const on = picked.has(x.c + '|' + r);
        h += `<td class="c${cl.est ? ' est' : ''}${on ? ' pick' : ''}" tabindex="0" data-k="${esc(x.c + '|' + r)}" style="background:${s.bg};color:${s.fg}" title="${esc(`${x.c} · ${r}: ${fmt(cl.reached)} of ${fmt(cl.po)} reached (${pct(cl.cov)}), gap ${fmt(cl.gap)}. Click to ${on ? 'remove from' : 'add to'} the target list.`)}">${warm ? 'warm' : fmt(cl.gap)}<span class="pm-sub">${pct(Math.min(cl.cov, 9.99))} reached</span></td>`;
      }
      h += `<td class="tot">${fmt(x.gap)}</td><td class="tot">${pct(x.cov)}</td></tr>`;
    });
    h += '</tbody>';
    $('pm-anti').innerHTML = rows.length ? h : '<tbody><tr><td class="name">No account with headcount matches these filters.</td></tr></tbody>';
    $('pm-anti').querySelectorAll('td.c[data-k]').forEach(td => { const tog = () => { const k = td.dataset.k; if (picked.has(k)) picked.delete(k); else picked.add(k); LS.set('pickedTouched', true); savePicked(); drawAnti(); }; td.onclick = tog; td.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } }; });
    drawTargets(AH);
  }
  function targetList(AH) {
    const byC = new Map(AH.rows.map(x => [x.c, x]));
    return [...pickedSet()].map(k => { const [c, r] = k.split('|'); const x = byC.get(c); const cl = x && x.cells[r]; return cl && cl.po ? { c, r, tier: x.tier, ...cl } : (() => { const po = P.pool(M, c, r, P.ICPB); if (!po) return null; const reached = P.people(M, c, r, P.ICPB, st.antiBasis === 'recent' ? M.recent : M.months); return { c, r, tier: tierOf(c), po, reached, gap: Math.max(po - reached, 0), cov: reached / po, pri: 0 }; })(); }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  }
  function drawTargets(AH) {
    const list = targetList(AH); const tot = list.reduce((a, x) => a + x.gap, 0);
    const box = $('pm-targets');
    box.innerHTML = `<div class="ui-label">Target list · ${list.length} account-region pair${list.length === 1 ? '' : 's'}</div>
      <div class="pm-big" style="margin-top:6px">${fmt(tot)}</div><div class="pm-note">people not yet reached in these cells (${st.antiBand === 'ICP' ? 'MD to MD-2' : esc(st.antiBand)})</div>
      <div class="pm-scroll" style="max-height:300px;margin-top:8px"><table class="pm-t"><tbody>${list.map(x => `<tr><td>${esc(x.c)}<div class="why">${esc(x.r)}${x.tier ? ' · ' + esc(x.tier) : ''}</div></td><td class="r">${fmt(x.gap)}<div class="why">${pct(x.cov)} reached</div></td><td class="r"><button class="btn tiny ghost" data-rm="${esc(x.c + '|' + x.r)}" title="Remove">×</button></td></tr>`).join('') || '<tr><td class="muted">Click cells in the anti heat map to add them.</td></tr>'}</tbody></table></div>
      <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="btn tiny" id="pm-copy">Copy company names</button><button class="btn tiny" id="pm-csv">Download CSV</button><button class="btn tiny primary" id="pm-track">Track as an action</button><button class="btn tiny ghost" id="pm-clear">Clear</button></div>
      <p class="pm-note" style="margin-top:8px">The CSV has the company, website, region, the countries in that region with headcount, tier, headcount, reached and gap: upload the names as a LinkedIn company list (Matched audiences) for the next native or company-targeted ad set.</p>`;
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pickedSet().delete(b.dataset.rm); LS.set('pickedTouched', true); savePicked(); drawAnti(); });
    box.querySelector('#pm-clear').onclick = () => { pickedSet().clear(); LS.set('pickedTouched', true); savePicked(); drawAnti(); };
    box.querySelector('#pm-copy').onclick = async () => { const names = [...new Set(list.map(x => x.c))].join('\n'); try { await navigator.clipboard.writeText(names); ctx.toast(`${new Set(list.map(x => x.c)).size} company names copied.`); } catch { ctx.toast('Copy failed: your browser blocked the clipboard.', 'err'); } };
    box.querySelector('#pm-csv').onclick = () => {
      const acc = name => accounts.find(a => a.name === name) || {};
      const rows = [['Company', 'Website', 'Region', 'Countries', 'Tier', 'MD to MD-2 headcount', 'Reached', 'Gap', 'Coverage']].concat(list.map(x => { const p = M.pools[x.c + '|' + x.r] || {}; return [x.c, acc(x.c).domain || (acc(x.c).domains || [])[0] || '', x.r, (p.countries || []).join('; '), x.tier || '', Math.round(x.po), Math.round(x.reached), Math.round(x.gap), (x.cov * 100).toFixed(1) + '%']; }));
      const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `anti-heat-map-targets-${F.today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    box.querySelector('#pm-track').onclick = async () => {
      if (!list.length) return ctx.toast('The target list is empty.', 'err');
      const top = list.slice(0, 12).map(x => `${x.c} (${x.r}, gap ${fmt(x.gap)})`).join('; ');
      try { await ctx.api.post('actions', { channel: 'linkedin', title: `Load ${list.length} anti heat map accounts into a company-targeted ad set`, detail: `${fmt(tot)} MD to MD-2 people not reached. ${top}${list.length > 12 ? '…' : ''}`, owner: 'paid ads lead', source: 'manual', scope: 'penmap:anti' }); ctx.toast('Added to the action tracker.'); }
      catch (e) { ctx.toast('Could not track: ' + e.message, 'err'); }
    };
  }

  // ---------- 5. gaps ----------
  function drawGaps() {
    const rr = M.regTotals.recent, s = Object.values(rr).reduce((a, b) => a + b, 0) || 1;
    $('pm-pools').innerHTML = P.POOL_REG.map(g => `<div class="pm-kpi${g === 'US' ? ' hl' : ''}"><span class="k">${esc(g)} · ${esc(recLabel)}</span><span class="v">${fmt(rr[g] / divisor)}</span><span class="s">people in the retargeting window · ${pct(rr[g] / s)} of recent impressions</span></div>`).join('');
    $('pm-gap-regs').innerHTML = P.POOL_REG.filter(r => r !== HOME).map(r => `<button type="button" class="pm-chip" data-r="${esc(r)}" aria-pressed="${st.gapRegs.includes(r)}">${esc(r)}</button>`).join('');
    $('pm-gap-regs').querySelectorAll('button').forEach(b => b.onclick = () => { const r = b.dataset.r; st.gapRegs = st.gapRegs.includes(r) ? st.gapRegs.filter(x => x !== r) : [...st.gapRegs, r]; if (!st.gapRegs.length) st.gapRegs = [r]; LS.set('gapRegs', st.gapRegs); drawGaps(); });
    const list = P.gaps(M, { regions: st.gapRegs, limit: 15, companies: M.companies });
    $('pm-t-gap').innerHTML = `<thead><tr><th>Company</th><th>Region</th><th class="r">MD to MD-2 headcount</th><th class="r">Reached ${esc(allLabel)}</th><th class="r">Reached ${esc(recLabel)}</th><th class="r">Warm now</th><th class="r">Gap</th></tr></thead><tbody>` +
      (list.map(x => { const cls = x.status === 'Cold' ? 'bad' : x.status === 'Thin' ? 'warn' : 'ok'; return `<tr><td>${esc(x.c)}</td><td>${esc(x.r)}</td><td class="r">${fmt(x.po)}${x.est ? ' <span class="pm-pill mute" title="Derived or Claude-estimated headcount">est</span>' : ''}</td><td class="r">${fmt(x.all)}</td><td class="r">${fmt(x.rec)}</td><td class="r"><span class="pm-pill ${cls}">${x.status}</span> ${pct(Math.min(x.warm, 1))}</td><td class="r">${fmt(x.gap)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No reached company has headcount in these regions.</td></tr>') + '</tbody>';
  }

  // ---------- 6. plan ----------
  function planRows() {
    if (AI && AI.plan && AI.plan.rows && AI.plan.rows.length) return { src: 'ai', title: AI.plan.title, rows: AI.plan.rows.map(r => ({ key: r.key, obj: r.objective, name: r.name, tgt: r.targeting, bench: r.benchmark, share: r.share, cplLo: r.cpl_low, cplHi: r.cpl_high, cpmLo: r.cpm_low, cpmHi: r.cpm_high })) };
    return { src: 'rule', title: '', rows: P.rulePlan(M, { home: HOME }) };
  }
  function drawPlan() {
    const PR = planRows(); const N = P.planNumbers(PR.rows, { budget: st.budget, days: st.days, divisor });
    $('pm-plan-src').innerHTML = PR.src === 'ai' ? `Plan by Claude${PR.title ? ': ' + esc(PR.title) : ''}. Budget shares are Claude's; the maths is the page's.` : 'Starting plan from the rules (best CPL and cheapest CPM ad sets of the recent months). Generate the Claude read-out above for a written plan.';
    $('pm-t-plan').innerHTML = `<thead><tr><th>Ad set</th><th>Benchmark used</th><th class="r">Daily</th><th class="r">${st.days} days</th><th class="r">Expected</th></tr></thead><tbody>` +
      (N.rows.map(p => `<tr><td><span class="pm-tag">${esc(p.key)} · ${esc(p.obj)}</span><div>${esc(p.name)}</div><div class="why">${esc(p.tgt)}</div></td><td class="why">${esc(p.bench)}</td><td class="r">$${fmt(p.daily)}/day</td><td class="r">${usd(p.spend)}</td><td class="r">${p.leadsLo != null ? `<b>${Math.floor(p.leadsLo)}–${Math.round(p.leadsHi)} leads</b><div class="why">at $${fmt(p.cplLo)}–$${fmt(p.cplHi)} CPL</div>` : `<b>${fmt(p.peopleLo)}–${fmt(p.peopleHi)} people</b><div class="why">${fmt(p.impLo)}–${fmt(p.impHi)} impr. at $${fmt(p.cpmLo)}–$${fmt(p.cpmHi)} CPM</div>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Not enough ad set history to plan from.</td></tr>') +
      `<tr class="tot"><td>Total</td><td></td><td class="r">$${fmt(N.daily)}/day</td><td class="r">${usd(N.tot)}</td><td class="r">${Math.floor(N.leadsLo)}–${Math.round(N.leadsHi)} leads · ${fmt(N.peopleLo)}–${fmt(N.peopleHi)} new people</td></tr></tbody>`;
    const kp = [
      [`Non-${HOME} leads, ${st.days} days`, `${Math.floor(N.leadsLo)}–${Math.round(N.leadsHi)}`, `≈${Math.round(N.leadsMid)} expected; ${M.lastMonth ? P.monthShort(M.lastMonth) : 'latest month'} non-${HOME} sets made ${fmt(K.nonHome.leads)}`],
      ['Lead-gen CPL', `${usd(N.lgCplLo)}–${usd(N.lgCplHi)}`, K.nonHome.sets.length ? `vs ${usd(K.nonHome.cpl)} for the ${M.lastMonth ? P.monthShort(M.lastMonth) : 'latest'} non-${HOME} regional sets` : 'lead-gen spend ÷ leads'],
      ['All-in cost per lead', `${usd(N.allCplLo)}–${usd(N.allCplHi)}`, 'total spend ÷ leads, reach spend included'],
      [`New non-${HOME} people`, `${fmt(N.peopleLo)}–${fmt(N.peopleHi)}`, 'top-of-funnel, retargetable next month'],
      ['Demo bookings', `${N.demosLo}–${N.demosHi}`, '12–25% of leads, if SDR calls within 24h'],
    ];
    $('pm-plan-kpis').innerHTML = kp.map(([l, v, s], i) => `<div class="pm-kpi${i === 0 ? ' hl' : ''}"><span class="k">${esc(l)}</span><span class="v">${v}</span><span class="s">${esc(s)}</span></div>`).join('');
    const steps = AI && AI.setup_steps && AI.setup_steps.length ? AI.setup_steps : [
      `Pause before launch: ad sets on the "did not work" list above, and ${HOME}-only ad sets where the heat map shows SAT at MD to MD-2.`,
      'Build the matched audiences now (they take 24 to 48 hours to fill): lead-form openers from the recent months, video viewers 50%+, company-page visitors (90 days). Exclude ' + HOME + ' on each.',
      'Upload the anti heat map target list (section 04) as a company list and use it on the reach rows.',
      'Launch the lead-gen rows and the reach rows the same day so the video-viewer pools start filling for next month.',
      'Route every lead to an SDR within 24 hours with the playbook follow-up and a demo ask.',
    ];
    const rules = AI && AI.day3_rules && AI.day3_rules.length ? AI.day3_rules : (() => { const L = N.rows.find(r => r.cplHi); const T = N.rows.find(r => r.cpmHi); return [L ? `${L.key} CPL above $${fmt(L.cplHi)} after $100 spent: narrow the seniority to Director+ and swap the headline.` : null, L ? `${L.key} under $${fmt(L.cplLo)} CPL: move $10/day from the reach rows into it.` : null, T ? `${T.key} CPM above $${fmt(T.cpmHi * 1.2)} after 2 days: switch to brand awareness with a CPM cap.` : null, 'An ad set delivering under $5/day: the audience is too small; fold it into the main lead-gen ad set.', 'Any ad set with frequency above 4 in 5 days: rotate the creative.'].filter(Boolean); })();
    $('pm-steps').innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join('');
    $('pm-rules').innerHTML = rules.map(s => `<li>${esc(s)}</li>`).join('');
  }

  // ---------- 7. method ----------
  function drawMethod() {
    const est = [M.notes.countryEstimated.length ? `No Country table for ${M.notes.countryEstimated.map(m => P.monthShort(m)).join(', ')}: the default country mix is used there (Admin › Reach pools).` : '', M.notes.bandEstimated.length ? `No Job Seniority table for ${M.notes.bandEstimated.map(m => P.monthShort(m)).join(', ')}: the band mix falls back to the Job Title buckets or the default mix.` : ''].filter(Boolean).join(' ');
    const list = [
      `Sources: ${new Set(perf.map(r => r.day.slice(0, 7))).size} months of LinkedIn ad performance and ${M.notes.windows.length} demographics window${M.notes.windows.length === 1 ? '' : 's'} (${M.notes.windows.map(w => P.monthShort(w.month)).join(', ')}). Where two uploads cover the same dates, the newest is used. Ad-level totals: ${usd(M.tot.spend)}, ${fmt(M.tot.imp)} impressions, ${fmt(M.tot.leads)} form leads.`,
      `People = impressions ÷ ${fmt(divisor)} (agreed proxy, Admin › Targets › reach frequency). LinkedIn's Reach column is daily and cannot be summed into unique people, so it is not used. Over several months real frequency is higher than ${fmt(divisor)} in heavily targeted cells, so “SAT” cells are an upper bound. The LinkedIn page's penetration cube uses a reach curve instead and never passes 100%.`,
      `LinkedIn exports each dimension separately (company, country, seniority) with no cross-tab. Company × region is estimated each month by iterative proportional fitting: company totals and region totals are both matched exactly, seeded with each firm's Apollo MD to MD-2 headcount by region (peer averages for firms without one); the gap between the country table and the top company pages is fitted as "other companies". Company pages whose name carries a country (KPMG India, Accenture in India, DGE, Al Rajhi) are pinned to it. The original report seeded with all-seniority headcount by country, which the dashboard does not hold, so individual cells can differ from it by about a tenth; company and region totals match it exactly.`,
      `Bands use that month's seniority mix: MD = Partner, VP (LinkedIn files Managing Director under VP), CXO, Owner; MD-1 = Director; MD-2 = Manager, which holds Senior Manager; Sr IC = “Senior”. The same mix is applied in every region that month, which is the largest source of error. ${est}`,
      `Headcounts are the Apollo MD / MD-1 / MD-2 pools in Admin › Reach pools (rows derived from category ratios or estimated by Claude are marked est and drawn dashed). Middle East = UAE + KSA in the pools; for impressions it is the Gulf, Levant and Egypt (Türkiye and Cyprus count as Europe & other). APAC = Australia + Singapore + Japan.`,
      `Lead country is not in the exports. Non-${HOME} CPL is measured only from ad sets whose name fixes the geography. Lead-gen spend = spend of ad sets with a lead generation objective.`,
      `Claude Sonnet writes the headlines, the grouping and reasons in "what worked", the do and do-not lists, the plan rows (with the benchmark ad set for every range), the set-up steps and the day-3 rules, from the numbers on this page, the screenshots uploaded on Lead analytics and the tracked actions. Every number in the tables is computed here, not by Claude.`,
    ];
    $('pm-method').innerHTML = list.map(s => `<li>${esc(s)}</li>`).join('');
  }

  // ---------- Claude ----------
  async function aiInput() {
    let screens = [];
    try { const d = await ctx.api.get('li-leads'); screens = ((d && d.screens) || []).map(s => ({ title: s.title, kind: s.kind, summary: s.summary, metrics: (s.metrics || []).slice(0, 40), period: s.period })); } catch { /* lead analytics not available */ }
    const AH = P.antiHeat(M, { regions: P.POOL_REG.filter(r => r !== HOME), tierOf });
    return P.aiInput(M, { home: HOME, budget: 600, days: 5, gapsList: P.gaps(M, { regions: ['US', 'UK', 'Middle East', 'APAC'], limit: 25, companies: M.companies }), antiRows: AH.rows, worked: W, k: K, screens, actionLog: await actionLog(ctx, 'linkedin') });
  }
  let aiState = { loading: false, err: null, meta: null };
  function drawAiBar() {
    const m = aiState.meta;
    $('pm-ai').innerHTML = `<span class="tag orange">AI</span><span>${m ? `Claude read-out ${m.cached ? 'cached' : 'generated'} ${esc(F.timeAgo(m.created_at))}${m.model ? ' · ' + esc(m.model) : ''}. It writes the headlines, the do and do-not lists, the spend plan and the rules below.` : 'Rule-based headlines and plan shown. Generate the Claude read-out for the written headlines, what to do and not do, and a spend plan grounded in this account\'s ad sets.'}</span>
      <button class="btn tiny${m ? '' : ' primary'}" id="pm-gen" ${aiState.loading ? 'disabled' : ''}>${aiState.loading ? '<span class="spin"></span> Thinking' : m ? 'Regenerate' : 'Generate with Claude'}</button>${aiState.err ? `<span class="err">${esc(aiState.err)}</span>` : ''}${AI && AI.summary ? `<span class="pm-note" style="flex-basis:100%">${esc(AI.summary)}</span>` : ''}`;
    $('pm-gen').onclick = () => runAi(!!m);
  }
  function drawAll() { drawHeads(); drawWorked(); drawAnti(); drawPlan(); drawAiBar(); }
  async function runAi(force) {
    aiState = { ...aiState, loading: true, err: null }; drawAiBar();
    try { const input = await aiInput(); const r = await ctx.api.post('penmap-ai', { scope: 'penmap:main', input, force: force && !!(ctx.user && ctx.user.isEditor !== false) }); AI = r.content; aiState = { loading: false, err: null, meta: r }; }
    catch (e) { aiState = { ...aiState, loading: false, err: e.status === 403 ? 'Only editors can regenerate a cached read-out.' : e.message || String(e) }; }
    drawAll();
  }

  // ---------- wire controls ----------
  const bindSeg = (id, fn) => { const g = $(id); if (!g) return; g.querySelectorAll('button').forEach(b => b.onclick = () => { g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); fn(b.dataset.v); }); };
  bindSeg('pm-basis', v => { LS.set('basis', v); render(el, ctx); });
  bindSeg('pm-recent', v => { LS.set('recentN', +v); render(el, ctx); });
  bindSeg('pm-regmode', v => { st.regMode = v; drawRegion(); });
  bindSeg('pm-period', v => { st.period = v; drawHM(); drawDetail(); });
  bindSeg('pm-band', v => { st.band = v; drawHM(); drawDetail(); });
  bindSeg('pm-metric', v => { st.metric = v; drawHM(); });
  $('pm-tier').onchange = e => { st.tier = e.target.value; drawHM(); };
  $('pm-q').oninput = e => { st.q = e.target.value; drawHM(); };
  $('pm-rows').onchange = e => { st.rows = +e.target.value; LS.set('rows', st.rows); drawHM(); };
  bindSeg('pm-anti-basis', v => { st.antiBasis = v; drawAnti(); });
  bindSeg('pm-anti-band', v => { st.antiBand = v; drawAnti(); });
  $('pm-anti-tier').onchange = e => { st.antiTier = e.target.value; drawAnti(); };
  $('pm-anti-q').oninput = e => { st.antiQ = e.target.value; drawAnti(); };
  $('pm-anti-never').onchange = e => { st.antiNever = e.target.checked; drawAnti(); };
  bindSeg('pm-budget', v => { st.budget = +v; $('pm-budget-x').value = v; LS.set('budget', st.budget); drawPlan(); });
  $('pm-budget-x').onchange = e => { const v = Math.max(50, Math.round(+e.target.value || 0)); st.budget = v; LS.set('budget', v); $('pm-budget').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.v === v))); drawPlan(); };
  bindSeg('pm-days', v => { st.days = +v; LS.set('days', st.days); drawPlan(); });

  st.sel = M.companies.length ? [M.companies[0], HOME] : null;
  drawKpis(); drawHeads(); drawSpend(); drawRegion(); drawMonthTable(); drawWorked(); drawHM(); drawDetail(); drawAnti(); drawGaps(); drawPlan(); drawMethod(); drawAiBar();
  // A Claude read-out cached for this page is shown straight away (no new call).
  try { const r = await ctx.api.get('penmap-ai', { scope: 'penmap:main' }); if (r && r.content) { AI = r.content; aiState.meta = r; drawAll(); } } catch { /* none yet */ }

  function tierOptions() { return [['all', 'All tiers'], ['Tier 1', 'Tier 1 (GSI, Big Four, MBB)'], ['Tier 2', 'Tier 2 (SI, other)'], ['GSI', 'GSI'], ['Big Four', 'Big Four'], ['MBB', 'MBB'], ['SI', 'SI'], ['Other', 'Other']].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); }
  function tierOk(c, f) { if (f === 'all') return true; const t = tierOf(c); return t === f || TIER_GROUP[t] === f; }
  function estimateNote() {
    const a = M.notes.countryEstimated, b = M.notes.bandEstimated; if (!a.length && !b.length) return '';
    return `<p class="note" style="font-size:12.5px;margin:0 0 8px"><b>Estimated mix for some months.</b> ${a.length ? `No Country table for ${a.map(m => P.monthShort(m)).join(', ')}. ` : ''}${b.length ? `No Job Seniority table for ${b.map(m => P.monthShort(m)).join(', ')}. ` : ''}Upload the full Demographics export for those months (it carries every breakdown) for the real split.</p>`;
  }
}

// One window's rows, with per-campaign rows folded: when the export carries a campaign column, untagged rows win
// for a segment and campaign rows are summed only where no untagged row exists, so no impression is counted twice.
function windowRows(w) {
  const rows = w.rows || [];
  const untagged = new Set(rows.filter(r => !String(r.campaign || '').trim()).map(r => r.segment));
  const keep = rows.filter(r => !String(r.campaign || '').trim() || !untagged.has(r.segment));
  const m = new Map();
  for (const r of keep) { const k = r.segment + '\u0000' + r.value; const o = m.get(k) || { segment: r.segment, value: r.value, impressions: 0, clicks: 0, spend: 0, leads: 0 }; o.impressions += Number(r.impressions) || 0; o.clicks += Number(r.clicks) || 0; o.spend += Number(r.spend) || 0; o.leads += Number(r.leads) || 0; m.set(k, o); }
  return [...m.values()];
}
