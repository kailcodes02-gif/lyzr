// Ads channel: LinkedIn Campaign Manager exports (performance per ad per day, demographics per window).
import * as A from '../lib/linkedin-agg.mjs';
import { mountTrend } from '../trend.mjs';
import { mountUploader } from '../uploader.mjs';
import { sectionCompare, memoGet, deltaText } from '../compare.mjs';
import { guideHtml, monthGrid, monthsBetween, gridHtml } from '../export-guide.mjs';
import { SERIES, NAVY, ORANGE, TEAL, VIOLET, withAlpha, personColor, LEAD_TYPE_COLORS } from '../palette.mjs';
export const route = 'linkedin';
export const title = 'Ads · LinkedIn';

const C = { orange: '#FE4B1E', navy: '#043E77', forest: '#063B28', oxblood: '#593D3D', stone: '#A8A298', g300: '#CFCCC7' };
const STAGE_COLOR = { ToFu: TEAL, MoFu: ORANGE, BoFu: NAVY, Other: C.g300 };
const APPROACH_COLOR = { 'Custom list': ORANGE, Native: NAVY, Combined: VIOLET, Retargeting: TEAL, Other: C.stone };
const METRIC_LABEL = { impressions: 'Impressions', clicks: 'Clicks', spend: 'Spend', sends: 'Sends', opens: 'Opens', leads: 'Leads' };
let charts = [], trendX = null;
export function destroy() { for (const c of charts) { try { c.destroy(); } catch { /* ignore */ } } charts = []; if (trendX) { trendX.destroy(); trendX = null; } }
const chart = (canvas, cfg) => { if (!window.Chart || !canvas) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; };

export async function render(el, ctx) {
  destroy();
  const F = ctx.fmt, { esc, fmt, usd, pct } = F;
  const { from, to } = ctx.state;
  el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1><p class="sub">${esc(F.rangeLabel(from, to))}</p>${ctx.ui.spinner('Loading LinkedIn data')}`;
  if (window.Chart) { Chart.defaults.font.family = "'General Sans','Inter',system-ui,sans-serif"; Chart.defaults.color = css('--ink2') || '#4A4744'; Chart.defaults.borderColor = css('--line') || '#E3E1DE'; }

  // Comparison range from the global "Compare with" control (null = no comparison). The page loads
  // against it; the sections that show a comparison can then each pick their own (sectionCompare).
  const prev = ctx.state.prev || null;
  // Comparison data (perf rows + demographics windows) for any range, memoised, so a section that
  // switches its comparison back and forth never refetches, and the current range is fetched once.
  const prevBundle = async p => { if (!p) return { perf: [], demo: [] }; const d = (await memoGet(ctx, 'linkedin', { from: p.from, to: p.to }).catch(() => null)) || {}; return { perf: d.perf || [], demo: d.demo || [] }; };
  let data, histData;
  try { [data, , histData] = await Promise.all([memoGet(ctx, 'linkedin', { from, to }), prevBundle(prev), memoGet(ctx, 'linkedin', { from: '2025-01-01', to: F.today() }).catch(() => null)]); }
  catch (e) { el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1>${ctx.ui.empty('LinkedIn data could not be loaded: ' + (e.message || e))}`; return; }
  const S = ctx.settings || {};
  const accounts = Array.isArray(S.accounts) ? S.accounts : [], bands = S.bands || {}, icp_pool = Array.isArray(S.icp_pool) ? S.icp_pool : [], regions = S.regions || {}, stages = S.stages || undefined;
  const frequency = Number((S.targets || {}).frequency) || 3.5;
  const rf = Number((S.targets || {}).reach_frequency) || 3; // impressions per person for the reach estimates
  const perf = (data.perf || []).filter(r => r.day >= from && r.day <= to);
  const windows = [...(data.demo || [])].sort((a, b) => a.upload.period_start < b.upload.period_start ? -1 : 1);
  const allDemoRows = windows.flatMap(w => w.rows);          // everything, for the per-person / per-ad-set section
  const demoRows = A.aggregateRows(windows);                  // all-campaign aggregates: tagged subsets not counted twice
  // Which demographics breakdowns were uploaded for this range. LinkedIn exports one dimension per file
  // (Company, Job Title, Job Seniority, Country/Region, Job Function); several sections need more than Company.
  const segsPresent = A.segmentsPresent(demoRows);
  const NEED = { 'Job Title': 'Job Title (designation bands MD / MD-1 / MD-2)', 'Country': 'Country/Region (regions)', 'Job Seniority': 'Job Seniority', 'Job Function': 'Job Function', 'Company': 'Company' };
  const missingSegs = Object.keys(NEED).filter(k => !segsPresent.includes(k));
  const needMsg = segs => { const miss = segs.filter(k => !segsPresent.includes(k)); return miss.length ? ctx.ui.empty(`The demographics uploads for these dates hold only ${segsPresent.join(', ') || 'nothing'}. Upload the Professional Demographics export again: the file carries every breakdown (${miss.map(k => NEED[k]).join(', ')}) and replaces the older copy.`) : ''; };
  const uploads = data.uploads || [];
  // Reach pools: Apollo counts, plus derived rows (category ratios) and Claude estimates (Admin › Reach pools),
  // so every reached account has a denominator; derived rows are flagged `est` and drawn as estimates.
  const mix = S.mix_defaults || null;
  const icpEstimates = Array.isArray(S.icp_estimates) ? S.icp_estimates : [];
  const poolAll = A.expandPool(icp_pool, accounts, { estimates: icpEstimates });
  const poolCountries = [...new Set(poolAll.map(p => p.country))];
  const mixNote = segs => { const miss = segs.filter(k => !segsPresent.includes(k)); if (!miss.length) return ''; const what = miss.map(k => k === 'Job Title' ? 'designation mix' : 'country mix').join(' and '); return `<p class="note" style="font-size:12.5px;margin:0 0 8px"><b>Estimated ${what}.</b> No ${miss.join(' or ')} export covers these dates, so the split uses the ${esc((mix && mix.source) || A.DEFAULT_MIX.source)} (Admin › Reach pools). Upload the Professional Demographics export for these dates again (it carries every breakdown) for the real split.</p>`; };

  if (!perf.length && !windows.length) {
    el.innerHTML = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1><p class="sub">${esc(F.rangeLabel(from, to))}</p>` +
      `<div class="intro">${uploads.length ? 'No LinkedIn data in this date range. Widen the dates, or upload the exports that cover it below.' : '<b>No LinkedIn exports yet.</b> LinkedIn has no API connection here: numbers come from Campaign Manager exports. Drop them below (many files at once is fine) and this page fills in.'}</div>` +
      guideHtml() + ctx.ui.section('Upload LinkedIn exports', '', '<div id="uploader"></div>');
    mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', isEditor: isEditorOf(ctx), onDone: () => render(el, ctx) });
    return;
  }

  // ---- aggregates ----
  const T = A.totals(perf);
  const days = A.daysBetween(from, to);
  const perfDays = [...new Set(perf.map(r => r.day))].sort();
  const P = A.programs(perf, stages);
  const ads = A.ads(perf);
  const stageGran = days > 70 ? 'month' : days > 21 ? 'week' : 'day';
  const SS = A.stageSplit(perf, stageGran, stages);
  const matched = new Map(); // canonical account -> impressions in range
  for (const r of A.segRows(demoRows, 'Company')) { const a = A.matchAccount(r.value, accounts); if (a && (Number(r.impressions) || 0) > 0) matched.set(a, (matched.get(a) || 0) + Number(r.impressions)); }
  const metricsPresent = Object.keys(METRIC_LABEL).filter(m => demoRows.some(r => Number(r[m]) > 0));
  const winLabel = w => `${F.dayLabel(w.upload.period_start)} to ${F.dayLabel(w.upload.period_end)}`;
  const topSet = P.programs.flatMap(p => p.campaigns).filter(c => c.leads > 0).sort((a, b) => b.leads - a.leads)[0];
  // White Path sections: ad sets, targeting approach, senders, creative reach, company splits.
  // The scorecard and the efficiency map only read the current range; the ad set table adds its
  // own comparison figures in drawAdSets below.
  const sets = A.adSets(perf, { to });
  const SC = A.scorecard(sets);
  const senders = A.messagingBySender(perf);
  const CA = A.creativeAudience(perf, demoRows);
  const ACS = A.assetCompanySplit(demoRows, accounts);
  const RC = A.reachVsContacts(demoRows, accounts, { contact_lists: S.contact_lists, frequency: rf });
  // Compact delta under a table figure (spend, leads, CPL) against a comparison range p.
  const sd = (p, cur, prevV, invert = false) => { if (!p) return ''; if (prevV == null || !prevV || cur == null) return `<br><span class="muted" style="font-size:11px">${cur && !prevV ? 'new' : '–'}</span>`; const g = (cur - prevV) / prevV * 100; const good = invert ? g <= 0 : g >= 0; return `<br><span class="${good ? 'up' : 'down'}" style="font-size:11px" title="${esc(p.label)}: ${invert ? usd(prevV) : fmt(prevV)}">${g > 0 ? '+' : ''}${fmt(g, 0)}%</span>`; };

  // Per-section comparison controls. Each starts on the top-bar comparison (prev) and redraws only
  // its own section when changed.
  const cmpResults = sectionCompare(ctx, 'linkedin:results', p => drawResults(p));
  const cmpWorked = sectionCompare(ctx, 'linkedin:worked', p => drawWorked(p));
  const cmpReach = sectionCompare(ctx, 'linkedin:reach', p => drawReach(p));
  const cmpSets = sectionCompare(ctx, 'linkedin:adsets', p => drawAdSets(p));
  const cmpLeads = sectionCompare(ctx, 'linkedin:leadtypes', p => drawLeadTypes(p));
  const cmpPeople = sectionCompare(ctx, 'linkedin:people', p => drawPeople(p));

  // ---- page ----
  let h = `<div class="seghead">Ads · LinkedIn</div><h1>LinkedIn ads</h1>
  <p class="sub">${esc(F.rangeLabel(from, to))}. Leads are LinkedIn lead form submissions. Money is USD. ${prev ? `Compared ${esc(F.vsLabel(prev))} unless a section says otherwise.` : 'No comparison at the top; each section can still pick one.'}</p>
  <div class="card" style="font-size:13px;margin-bottom:6px"><b>Included data.</b> Performance: ${perfDays.length ? `${perfDays.length} of ${days} days have rows (${esc(F.dayLabel(perfDays[0]))} to ${esc(F.dayLabel(perfDays[perfDays.length - 1]))})` : 'no daily rows in this range'}.
  Demographics: ${windows.length ? `${windows.length} window${windows.length === 1 ? '' : 's'} overlap this range: ${windows.map(w => esc(winLabel(w))).join('; ')}. Breakdowns uploaded: <b>${esc(segsPresent.join(', ') || 'none')}</b>${missingSegs.length ? ` <span class="down">(missing: ${esc(missingSegs.join(', '))}; an older company-only upload. Upload the Professional Demographics file for these dates again to get every breakdown)</span>` : ''}. Demographics are totals per export window, so a person seen in two windows is counted twice.` : 'no export window overlaps this range.'}</div>`;

  h += `<details class="card guidebox" style="margin:10px 0 0" ${missingSegs.includes('Job Title') || missingSegs.includes('Country') ? 'open' : ''}><summary style="cursor:pointer"><span class="ui-label" style="color:var(--accent)">What to export from LinkedIn every 2 weeks</span> <span class="muted" style="font-size:13px">· 2 files, and which months are in</span></summary><div style="margin-top:12px">${guideHtml({ compact: true })}<div style="margin-top:14px"><div class="ui-label" style="margin-bottom:6px">Months in so far</div>${gridHtml(monthGrid(uploads, monthsBetween('2026-04', F.today().slice(0, 7))))}</div><p class="muted" style="font-size:12.5px;margin-top:8px">Drop files in the box below or on the <a href="#/uploads">Upload CSVs</a> page.</p></div></details>`;
  h += `<details class="card" style="margin:10px 0 0" ${uploads.length ? '' : 'open'}><summary style="cursor:pointer"><span class="ui-label">Upload LinkedIn exports</span> <span class="muted" style="font-size:13px">· ${uploads.length} file${uploads.length === 1 ? '' : 's'} so far, last ${uploads[0] ? esc(F.timeAgo(uploads[0].uploaded_at)) : 'never'}</span></summary><div id="uploader" style="margin-top:12px"></div></details>`;

  // 1. hero + tiles (filled by drawResults against the comparison chosen in the section)
  h += ctx.ui.section('Results', `The headline numbers for the range, each compared with the period chosen here. ${cmpResults.html()}`, `<div id="li-results-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'li-results');

  // 1b. leads by type: MQL (book a demo) / conversation ad / playbook / other (NQL)
  const leadRules = S.lead_rules || undefined;
  const LS = A.leadSplit(perf, leadRules);
  h += ctx.ui.section('Leads by type', `Every lead-form submission sorted by what asked for it: <b>MQL</b> = someone trying to book a demo (bottom of the funnel), <b>conversation ad leads</b> (bottom), <b>playbook leads</b> (middle), and <b>other form leads</b> such as branding or persona posts (top, NQL). Decided from the ad set, program and ad names and the ad format; keywords in Admin › Targets › Lead types. ${cmpLeads.html()}`, `<div id="li-leadtypes-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'li-leadtypes');

  // 1c. brand awareness and engagement by team member (boosted posts, from the performance rows)
  const BP = A.byPerson(perf);
  h += ctx.ui.section('Brand awareness and engagement by person', `Boosted posts and ads run from a team member\'s name (Ani, Anju, Siva, Jessica…), read from the ad set, program and ad names in the performance export. For each person: impressions, reach, clicks, engagements (reactions, comments, shares, follows, clicks counted by LinkedIn), engagement rate, video views, leads and spend, with the posts that did it. The account × designation × region split per person lives in "Audiences by person or ad set" below and needs the demographics exports filtered to that person. ${cmpPeople.html()}`, `<div id="li-people-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'li-people');

  // 2. achieved / not achieved (filled by drawWorked)
  const li = list => list.length ? `<ul>${list.map(b => `<li><b>${esc(b.b)}</b> ${esc(b.s)}</li>`).join('')}</ul>` : '<p class="muted" style="margin-top:8px">Nothing to report yet for this range.</p>';
  h += ctx.ui.section('What worked and what did not', `Rule-based reads of the numbers above, against the period chosen here. Each line only appears when the data behind it exists. ${cmpWorked.html()}`, `<div id="li-worked-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'li-worked');

  // 3. trend (whole history)
  h += ctx.ui.section('Week on week and month on month', 'The whole history of uploaded performance data (the selected range is the darker bars). Switch metrics on and off, compare with the previous week or month or with the average of all earlier ones, and see the week or month in progress against the same days of earlier ones, with a straight-line projection.', `<div id="trendX"></div>`);

  // 3a. reach heat maps: impressions ÷ reach_frequency (default 3) = people
  h += ctx.ui.section('Reach: people by account, designation and region', `Estimated people reached, counting ${fmt(rf, 1)} impressions as one person (Admin › Targets). Columns are the demographics export windows in the selected dates; the last columns total them and compare with the period chosen here. A person seen in two windows counts twice. ${cmpReach.html()}`, `<div id="reachSeg"></div><div class="card"><div class="tblwrap" style="border:none" id="reachHeat"></div>${ctx.heat.legend('orange', 'square-root scale on the current windows')}</div>`, 'li-reach');

  // 3a. cumulative penetration cube: company x region x designation
  h += ctx.ui.section('Penetration by company, region and designation', `Cumulative over every demographics window in the selected dates: for each company, how much of its MD, MD-1 and MD-2 pool in each region the ads reached, against the real pool. Impressions land in a company × country × band cell through the window's country share and job-title mix (LinkedIn exports no cross-tab); pool = Apollo headcount per company, country and band (Admin › Reach pools), countries rolled up with Admin › Regions. <b>People reached</b> comes from a reach curve, not a plain division: with λ exposures per person in the pool, the share reached is 1 − (1 + λ/k)<sup>−k</sup> (the negative-binomial reach model used in media planning), calibrated so that one window averages ${fmt(frequency, 1)} impressions per person reached (Admin › Targets). One window therefore equals impressions ÷ ${fmt(frequency, 1)}; further windows add fewer new people and the figure flattens towards the pool instead of passing it. <b>Exposure</b> = impressions per person in the pool; <b>Frequency</b> = impressions per person reached. Click a company row to open or close its regions.`, `<div class="row" style="gap:16px;flex-wrap:wrap;align-items:center"><div id="cubeMetric"></div><div id="cubeRegion"></div><span id="cubeCount" class="muted" style="font-size:12.5px"></span></div><div class="card"><div class="tblwrap" style="border:none" id="cubeHeat"></div><div class="legend" id="cubeLegend"></div></div>`, 'li-cube');

  // 3a1. optional parts built in their own modules (js/views/parts/*): account tiers, exact designations.
  h += `<div id="li-tiers"></div><div id="li-designations"></div>`;

  // 3a2. audiences by person or ad set: demographics exports tagged at upload (or carrying a campaign column)
  h += ctx.ui.section('Audiences by person or ad set', 'For boosted posts of a team member (Ani, Anju, Siva…) or any single ad set: which accounts, designation bands and regions that audience actually reached. Comes from demographics exports filtered to that person\'s campaigns before download and tagged with the name in the upload box (Company, Job Title and Country exports per month). Pick a name to see its penetration map.', `<div id="personSeg"></div><div id="personBody"></div>`, 'li-persons');

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

  // 6a. ad set performance (filled by drawAdSets)
  h += ctx.ui.section('Ad set performance', `Every ad set in the range, largest spend first. Active means it spent in the last 7 days of the range (${esc(F.dayLabel(A.addDays(to, -6)))} to ${esc(F.dayLabel(to))}); otherwise Paused. CPM and CTR need impressions, so message ad sets show sends and open rate instead. The small figures under spend, leads and CPL compare with the period chosen here. ${cmpSets.html()}`,
    `<div id="li-adsets-body">${ctx.ui.spinner('Loading comparison')}</div>`, 'li-adsets');

  // 6b. targeting scorecard
  const maxCpm = Math.max(1, ...SC.rows.map(r => r.cpm || 0));
  const gradeCls = g => g === 'A' ? 'p-high' : g === 'B' ? 'p-med' : 'p-low';
  h += ctx.ui.section('Targeting scorecard', `Ad sets grouped by the targeting approach written in their name: Custom list (custom, list, upload, matched, ABM), Native (native, heatmap, seniority, title, function), Combined (combined, mix, +), Retargeting (retarget, website, visit, engage), else Other. Grade A = CTR at or above the median (${pct(SC.median_ctr, 2)}) and CPM at or below it (${usd(SC.median_cpm, 2)}); B = one of the two; C = neither.`,
    `<div class="tblwrap"><table><thead><tr><th class="l">Approach</th><th>Sets</th><th>Spend</th><th>Impressions</th><th>CTR</th><th class="l">CPM</th><th>Leads</th><th>CPL</th><th>Grade</th><th class="l">Verdict</th></tr></thead><tbody>${SC.rows.map(r => `<tr><td class="l"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${APPROACH_COLOR[r.approach]};margin-right:6px;vertical-align:-1px"></span><b>${esc(r.approach)}</b></td><td>${fmt(r.sets)}</td><td>${usd(r.spend)}</td><td>${r.impressions ? fmt(r.impressions) : (r.sends ? fmt(r.sends) + ' sends' : '–')}</td><td>${pct(r.ctr, 2)}</td><td class="l" style="min-width:170px">${r.cpm != null ? `<div style="display:flex;align-items:center;gap:8px"><div style="flex:none;width:90px;height:8px;background:var(--fill);border-radius:4px;overflow:hidden"><div style="width:${Math.round(r.cpm / maxCpm * 100)}%;height:100%;background:${C.navy}"></div></div><span>${usd(r.cpm, 2)}</span></div>` : '–'}</td><td>${fmt(r.leads)}</td><td>${usd(r.cpl)}</td><td>${r.grade ? ctx.ui.pill(r.grade, gradeCls(r.grade)) : '<span class="muted">n/a</span>'}</td><td class="l" style="white-space:normal;min-width:280px;font-size:13px">${esc(r.verdict)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No ad sets in range</td></tr>'}</tbody></table></div>`);

  // 6c. efficiency map
  h += ctx.ui.section('The efficiency map', 'Each ad set placed by cost per 1,000 impressions (across) and click rate (up). Bubble size is spend, colour is the targeting approach. Top left is the best corner: cheap reach that people click. Message ad sets have no impressions and are left out.', `<div class="card"><div class="chartbox tall" id="wpEffBox"><canvas id="wpEff"></canvas></div></div>`);

  // 6d. messaging by sender
  h += ctx.ui.section('Messaging ads by sender', 'Conversation and message ads grouped by the sending profile, read from the ad or ad set name. Open rate is opens over sends; click to open is clicks over opens. Click a sender row to see its ad sets.', senders.length ?
    `<div class="tblwrap"><table id="wpMsg"><thead><tr><th class="l">Sender / ad set</th><th>Ad sets</th><th>Spend</th><th>Sends</th><th>Opens</th><th>Open rate</th><th>Clicks</th><th>Click to open</th><th>Leads</th><th>CPL</th></tr></thead><tbody>${senders.map((s, i) => `<tr class="wp-sender" data-i="${i}" style="cursor:pointer;background:var(--soft)"><td class="l" style="font-weight:600"><span class="wp-caret" style="display:inline-block;width:14px;color:var(--ink2)">+</span>${esc(s.sender)}</td><td>${fmt(s.sets.length)}</td><td>${usd(s.spend)}</td><td>${fmt(s.sends)}</td><td>${fmt(s.opens)}</td><td>${pct(s.open_rate, 1)}</td><td>${fmt(s.clicks)}</td><td>${pct(s.click_to_open, 1)}</td><td>${fmt(s.leads)}</td><td>${usd(s.cpl)}</td></tr>${s.sets.map(x => `<tr class="wp-set" data-i="${i}" style="display:none"><td class="l" style="padding-left:26px;white-space:normal;min-width:220px">${esc(shortName(x.name, 60))}<br><span class="muted" style="font-size:12px">${esc(shortName(x.ad_name, 60))}</span></td><td></td><td>${usd(x.spend)}</td><td>${fmt(x.sends)}</td><td>${fmt(x.opens)}</td><td>${pct(x.open_rate, 1)}</td><td>${fmt(x.clicks)}</td><td>${pct(x.click_to_open, 1)}</td><td>${fmt(x.leads)}</td><td>${usd(x.cpl)}</td></tr>`).join('')}`).join('')}</tbody></table></div>`
    : ctx.ui.empty('No message or conversation ads (rows with sends) in this range.'));

  // 6e. creative audience reach
  const reachList = (items, unit) => items.length ? items.map(t => `<div style="font-size:12.5px;padding:3px 0"><div style="display:flex;justify-content:space-between;gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.value)}</span><span class="muted" style="flex:none">${fmt(t.impressions)} · ${pct(t.share, 0)}</span></div><div style="height:4px;background:var(--fill);border-radius:2px;margin-top:2px"><div style="width:${Math.min(100, Math.round(t.share))}%;height:100%;background:${C.navy};border-radius:2px"></div></div></div>`).join('') : `<p class="muted" style="font-size:12.5px">No ${unit} rows</p>`;
  h += ctx.ui.section('Creative audience reach', 'The top creatives by impressions and who saw each one: the top job titles and countries from the demographics rows of the ad set that ran it. LinkedIn demographics only split by ad set when the export carries a campaign column.', (CA.creatives.length ? `${CA.has_split ? '' : `<p class="muted" style="font-size:13px;margin-bottom:8px">The demographics exports in this range have no campaign split, so reach cannot be tied to a creative. Export demographics by campaign and upload them again.</p>`}<div class="grid g2">${CA.creatives.map(c => `<div class="card"><h3 style="white-space:normal">${esc(shortName(c.ad_name, 80))}</h3><p class="muted" style="font-size:12px;margin:2px 0 8px">${esc(shortName(c.campaign || '', 60))}${c.format ? ' · ' + esc(c.format) : ''} · ${c.impressions ? fmt(c.impressions) + ' impressions' : fmt(c.sends) + ' sends'} · ${pct(c.ctr, 2)} CTR · ${fmt(c.leads)} lead${c.leads === 1 ? '' : 's'}</p>${c.has_rows ? `<div class="grid g2" style="gap:14px"><div><div class="ui-label" style="font-size:10.5px;margin-bottom:4px">Top job titles</div>${reachList(c.titles, 'job title')}</div><div><div class="ui-label" style="font-size:10.5px;margin-bottom:4px">Top countries</div>${reachList(c.countries, 'country')}</div></div>` : `<p class="muted" style="font-size:12.5px">${CA.has_split ? 'No demographics rows for this ad set in the included windows.' : 'No campaign split in the demographics exports.'}</p>`}</div>`).join('')}</div>` : ctx.ui.empty('No creatives with impressions in this range.')));

  // 6f. asset x company split
  h += ctx.ui.section('Asset × company split', 'Which targeting approach put ads in front of which target account, from the demographics rows that carry an ad set (campaign) value. Company pages are matched to the accounts in Settings; pages matching no account are grouped as Other.', ACS.has_split ? `<div id="wpAssetSeg"></div><div class="card"><div class="tblwrap" style="border:none" id="wpAsset"></div>${ctx.heat.legend('navy', 'square-root scale, per metric')}</div>` : ctx.ui.empty('The demographics exports in this range have no campaign split, so impressions cannot be tied to an ad set. Export demographics by campaign and upload them again.'));

  // 6g. reach vs contacts
  h += ctx.ui.section('Reach vs contacts by company', `Impressions per company from the demographics windows in range, turned into estimated people by counting ${fmt(rf, 1)} impressions as one person (Admin › Targets, reach_frequency). Contacts are the uploaded list sizes per account. A ratio above 1 means the ads reached more people than the list holds, which happens when native targeting is layered on top of a list.`,
    `${RC.has_contacts ? '' : '<p class="muted" style="font-size:13px;margin-bottom:8px">Add contact list sizes in Admin › Targets as contact_lists</p>'}<div class="tblwrap"><table><thead><tr><th class="l">Company</th><th>Contacts</th><th>Impressions</th><th>Est. reach</th><th>Reach ÷ contacts</th><th>Clicks</th></tr></thead><tbody>${RC.rows.map(r => `<tr><td class="l">${esc(r.company)}${r.company === 'Other pages' ? '<br><span class="muted" style="font-size:11.5px">pages matching no account</span>' : ''}</td><td>${r.contacts != null ? fmt(r.contacts) : '–'}</td><td>${fmt(r.impressions)}</td><td>${fmt(r.est_reach)}</td><td>${r.ratio != null ? fmt(r.ratio, 2) + 'x' : '–'}</td><td>${fmt(r.clicks)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No company rows in the demographics windows for this range</td></tr>'}${RC.rows.length ? `<tr class="total"><td class="l">Total</td><td>${RC.total.contacts != null ? fmt(RC.total.contacts) : '–'}</td><td>${fmt(RC.total.impressions)}</td><td>${fmt(RC.total.est_reach)}</td><td>${RC.total.ratio != null ? fmt(RC.total.ratio, 2) + 'x' : '–'}</td><td>${fmt(RC.total.clicks)}</td></tr>` : ''}</tbody></table></div>`);

  // 6h. geography x seniority x audience
  h += ctx.ui.section('Geography × seniority × audience', 'For each audience (an ad set with its own demographics rows, or all audiences together), where the impressions landed by region and seniority. LinkedIn reports region and seniority as separate lists, so each cell is the region total spread by the seniority mix of the same audience: an estimate, not a count.', windows.length ? `<div id="wpGeoSeg" style="display:flex;gap:14px;flex-wrap:wrap"><div id="wpGeoAud"></div><div id="wpGeoMetric"></div></div><div class="card"><div class="tblwrap" style="border:none" id="wpGeo"></div>${ctx.heat.legend('orange', 'square-root scale on the chosen audience')}</div>` : ctx.ui.empty('No demographics export covers this range. Upload one at the top of this page.'));

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
  cmpResults.wire(el); cmpWorked.wire(el); cmpReach.wire(el); cmpSets.wire(el); cmpLeads.wire(el); cmpPeople.wire(el);
  mountUploader(el.querySelector('#uploader'), ctx, { channel: 'linkedin', isEditor: isEditorOf(ctx), onDone: () => render(el, ctx) });

  // ---- sections with their own comparison: each fetches the comparison rows it needs (memoised)
  // and redraws only itself. lastPrev / TP / lastBullets feed the AI read-out below. ----
  let TP = A.totals([]), TPn = 0, lastPrev = prev, lastBullets = { achieved: [], missed: [] }, lastWorkedPrev = prev;
  let peopleChart = null, lastPeoplePrev = null, BPP = null;
  async function drawPeople(p) {
    const box = el.querySelector('#li-people-body'); if (!box) return;
    const prevRows = p ? (await prevBundle(p)).perf : []; if (!el.isConnected) return;
    BPP = A.byPerson(prevRows); lastPeoplePrev = p;
    const prevOf = who => BPP.people.find(x => x.person === who) || null;
    if (!BP.people.length) { box.innerHTML = ctx.ui.empty('No ad set, program or ad name in this range carries a team member\'s name (Ani, Anju, Siva, Jessica…). Boosted posts are recognised by the name in the ad set name.'); return; }
    const tiles = BP.people.map((o, i) => { const q = prevOf(o.person); return { k: o.person, v: `${fmt(o.impressions)} <span class="muted" style="font-size:13px;font-weight:400">impressions</span>`, d: `${fmt(o.engagements)} engagements (${pct(o.eng_rate, 2)}) · ${fmt(o.clicks)} clicks · ${o.video_views ? fmt(o.video_views) + ' video views · ' : ''}${usd(o.spend)}<br>${deltaText(p, o.impressions, q ? q.impressions : null)} on impressions · ${deltaText(p, o.engagements, q ? q.engagements : null)} on engagements` }; });
    const gran = days > 70 ? 'month' : 'week';
    const buckets = [...new Set(perf.map(r => A.bucketKey(r.day, gran)))].sort();
    const series = BP.people.map(o => buckets.map(k => perf.filter(r => A.bucketKey(r.day, gran) === k && A.peopleIn(r.campaign, r.campaign_group, r.ad_name).includes(o.person)).reduce((a, r) => a + (Number(r.impressions) || 0), 0)));
    const postRows = BP.people.flatMap(o => o.ad_sets.slice(0, 6).map(c => ({ ...c, person: o.person })));
    box.innerHTML = `${ctx.ui.tiles(tiles)}
      <div class="grid g2" style="margin-top:12px">
        <div class="card"><h3>Impressions by person, ${gran === 'month' ? 'month by month' : 'week by week'}</h3><div class="chartbox"><canvas id="peopleChart"></canvas></div></div>
        <div class="card"><h3>Posts and ads by person</h3>${ctx.ui.table({ cols: [
          { h: 'Person', k: 'person', left: true, f: r => `<b>${esc(r.person)}</b>` },
          { h: 'Post / ad set', k: 'name', left: true, f: r => esc(shortName(r.name, 58)) },
          { h: 'Impressions', k: 'impressions', f: r => fmt(r.impressions) }, { h: 'Engagements', k: 'engagements', f: r => fmt(r.engagements) }, { h: 'Eng. rate', k: 'er', f: r => pct(r.impressions ? r.engagements / r.impressions * 100 : null, 2) }, { h: 'Clicks', k: 'clicks', f: r => fmt(r.clicks) }, { h: 'Video views', k: 'video_views', f: r => fmt(r.video_views) }, { h: 'Leads', k: 'leads', f: r => fmt(r.leads) }, { h: 'Spend', k: 'spend', f: r => usd(r.spend) },
        ], rows: postRows })}</div>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Not attributed to a person: ${fmt(BP.unattributed.impressions)} impressions, ${fmt(BP.unattributed.engagements)} engagements, ${fmt(BP.unattributed.leads)} leads (playbook, conversation and other ad sets with no name in them).</p>`;
    if (peopleChart) { try { peopleChart.destroy(); } catch { /* ignore */ } charts = charts.filter(c => c !== peopleChart); peopleChart = null; }
    peopleChart = chart(el.querySelector('#peopleChart'), { type: 'bar', data: { labels: buckets.map(k => F.bucketLabel(k, gran)), datasets: BP.people.map((o, i) => ({ label: o.person, data: series[i], backgroundColor: personColor(o.person, i), stack: 'p' })) }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } } });
  }
  let leadChart = null, lastLeadPrev = null, LSP = null;
  async function drawLeadTypes(p) {
    const box = el.querySelector('#li-leadtypes-body'); if (!box) return;
    const prevRows = p ? (await prevBundle(p)).perf : []; if (!el.isConnected) return;
    LSP = A.leadSplit(prevRows, leadRules); lastLeadPrev = p;
    const TYPE_COLOR = LEAD_TYPE_COLORS;
    const tiles = LS.types.map(t => { const q = LSP.byType[t.type]; return { k: t.label, v: `${fmt(t.leads)} <span class="muted" style="font-size:13px;font-weight:400">${t.share != null ? pct(t.share, 0) + ' of leads' : ''}</span>`, d: `${t.leads ? usd(t.cpl) + ' per lead · ' : ''}${t.campaigns.length} ad set${t.campaigns.length === 1 ? '' : 's'} · ${t.stage}<br>${deltaText(p, t.leads, q ? q.leads : null)}` }; });
    const gran = days > 70 ? 'month' : 'week';
    const trend = A.leadTrend(perf, gran, leadRules);
    const rows = LS.types.flatMap(t => t.campaigns.filter(c => c.leads > 0 || c.spend > 100).slice(0, 12).map(c => ({ ...c, type: t })));
    box.innerHTML = `${ctx.ui.tiles(tiles)}
      <div class="grid g2" style="margin-top:12px">
        <div class="card"><h3>Leads by type, ${gran === 'month' ? 'month by month' : 'week by week'}</h3><div class="chartbox"><canvas id="leadTypeChart"></canvas></div></div>
        <div class="card"><h3>Which ad sets bring which leads</h3>${rows.length ? ctx.ui.table({ cols: [
          { h: 'Type', k: 't', left: true, f: r => `<span class="pill" style="background:${TYPE_COLOR[r.type.type]};color:#fff">${esc(r.type.label.replace(/ \(.*\)$/, ''))}</span>` },
          { h: 'Ad set', k: 'name', left: true, f: r => `<b>${esc(shortName(r.name, 60))}</b>${r.group ? `<br><span class="muted" style="font-size:11.5px">${esc(shortName(r.group, 50))}</span>` : ''}` },
          { h: 'Leads', k: 'leads', f: r => fmt(r.leads) }, { h: 'Spend', k: 'spend', f: r => usd(r.spend) }, { h: 'CPL', k: 'cpl', f: r => usd(r.leads ? r.spend / r.leads : null) },
          { h: p ? `Leads ${esc(p.label)}` : 'Leads (no comparison)', k: 'pl', f: r => { const q = (LSP.byType[r.type.type].campaigns || []).find(x => x.name === r.name); return q ? fmt(q.leads) : '<span class="muted">–</span>'; } },
        ], rows }) : '<p class="muted" style="font-size:13px">No ad set with leads in this range.</p>'}</div>
      </div>`;
    if (leadChart) { try { leadChart.destroy(); } catch { /* ignore */ } charts = charts.filter(c => c !== leadChart); leadChart = null; }
    leadChart = chart(el.querySelector('#leadTypeChart'), { type: 'bar', data: { labels: trend.buckets.map(k => F.bucketLabel(k, gran)), datasets: A.LEAD_TYPES.map(t => ({ label: A.LEAD_LABELS[t], data: trend.series[t], backgroundColor: TYPE_COLOR[t], stack: 'leads' })) }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Leads' } } } } });
  }
  async function drawResults(p) {
    const box = el.querySelector('#li-results-body'); if (!box) return;
    const rows = (await prevBundle(p)).perf; if (!el.isConnected) return;
    TP = A.totals(rows); TPn = rows.length; lastPrev = p;
    const dl = (cur, prevV, invert = false) => deltaText(p, cur, prevV, invert);
    box.innerHTML = `<div class="hero">
    <div class="big"><div class="n">${fmt(T.leads)}</div><div class="l">LinkedIn leads in ${esc(F.rangeLabel(from, to))}${p && TP.leads ? `, ${fmt(TP.leads)} ${esc(p.label)}` : ''}.</div>
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
    { k: 'Engagements', v: fmt(T.engagements), d: `${pct(T.impressions ? T.engagements / T.impressions * 100 : null, 2)} engagement rate · ${dl(T.engagements, TP.engagements)}` },
    { k: 'Reactions · comments · shares', v: `${fmt(T.reactions)} · ${fmt(T.comments)} · ${fmt(T.shares)}`, d: `${fmt(T.follows)} follows` },
    { k: 'Accounts reached', v: `${fmt(matched.size)} of ${fmt(accounts.length)}`, d: windows.length ? 'Named target pages in demographics' : 'Needs a demographics upload' },
    { k: 'Awareness CPM', v: usd(SS.totals.ToFu.impressions ? SS.totals.ToFu.spend / SS.totals.ToFu.impressions * 1000 : null, 2), d: 'ToFu spend per 1,000 impressions' },
  ])}`;
  }
  async function drawWorked(p) {
    const box = el.querySelector('#li-worked-body'); if (!box) return;
    const b = await prevBundle(p); if (!el.isConnected) return;
    lastBullets = A.bullets({ rows: perf, prevRows: b.perf, demoWindows: windows, prevDemoWindows: b.demo, from, to, stages, bands }); lastWorkedPrev = p;
    box.innerHTML = `<div class="grid g2"><div class="panel win"><h3>Achieved</h3>${li(lastBullets.achieved)}</div><div class="panel loss"><h3>Not achieved</h3>${li(lastBullets.missed)}</div></div>`;
  }
  async function drawAdSets(p) {
    const box = el.querySelector('#li-adsets-body'); if (!box) return;
    const rows = (await prevBundle(p)).perf; if (!el.isConnected) return;
    const setsP = A.adSets(perf, { to, prevRows: p ? rows : null });
    box.innerHTML = `<div class="tblwrap"><table><thead><tr><th class="l">Ad set</th><th>Status</th><th class="l">Approach</th><th>Spend</th><th>Reach</th><th>Impressions</th><th>CPM</th><th>CTR</th><th>Clicks</th><th>Leads</th><th>Sends</th><th>Open rate</th><th>CPL</th></tr></thead><tbody>${setsP.map(s => `<tr><td class="l" style="white-space:normal;min-width:220px">${esc(shortName(s.name, 60))}<br><span class="muted" style="font-size:12px">${esc(shortName(s.campaign_group || '', 50))}</span></td><td>${ctx.ui.pill(s.status, s.status === 'Active' ? 'p-high' : 'p-na')}</td><td class="l">${esc(s.approach)}</td><td>${usd(s.spend)}${sd(p, s.spend, s.prev && s.prev.spend)}</td><td>${s.reach ? fmt(s.reach) : '–'}</td><td>${s.impressions ? fmt(s.impressions) : '–'}</td><td>${usd(s.cpm, 2)}</td><td>${pct(s.ctr, 2)}</td><td>${fmt(s.clicks)}</td><td>${fmt(s.leads)}${sd(p, s.leads, s.prev && s.prev.leads)}</td><td>${s.sends ? fmt(s.sends) : '–'}</td><td>${pct(s.open_rate, 1)}</td><td>${usd(s.cpl)}${sd(p, s.cpl, s.prev && s.prev.cpl, true)}</td></tr>`).join('') || '<tr><td colspan="13" class="muted">No ad sets in range</td></tr>'}</tbody></table></div>`;
  }
  drawResults(cmpResults.prev); drawWorked(cmpWorked.prev); drawAdSets(cmpSets.prev); drawLeadTypes(cmpLeads.prev); drawPeople(cmpPeople.prev);

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
    { key: 'engagements', label: 'Engagements', additive: true, fn: rows => tot(rows).engagements },
    { key: 'eng_rate', label: 'Engagement rate', fmt: 'pct', axis: 'right', fn: rows => { const t = tot(rows); return t.impressions ? t.engagements / t.impressions * 100 : null; } },
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
      if (qMode === 'band') { const b = A.bandSharesOrMix(w.rows, bands, mix); for (const k of A.BANDS) put(k, i, Math.round(b.share[k] * 1000) / 10); }
      else if (qMode === 'accounts') { const rowsC = A.segRows(w.rows, 'Company'); const totI = rowsC.reduce((a, r) => a + (Number(r.impressions) || 0), 0); const m = rowsC.filter(r => A.matchAccount(r.value, accounts)).reduce((a, r) => a + (Number(r.impressions) || 0), 0); put('Named target accounts', i, totI ? Math.round(m / totI * 1000) / 10 : 0); }
      else {
        const seg = qMode === 'region' ? 'Country' : 'Job Seniority';
        const sh = qMode === 'region' ? (() => { const g = A.countryShareOrMix(w.rows, mix); const m = new Map(); for (const [ct, v] of g.values) { const k = A.regionOf(ct, regions); m.set(k, (m.get(k) || 0) + v); } return { total: g.total, values: m }; })() : A.segmentShare(w.rows, seg, 'impressions', r => r.value);
        for (const [k, v] of sh.values) put(k, i, sh.total ? Math.round(v / sh.total * 1000) / 10 : 0);
        if (qMode === 'seniority') { const dp = ['Director', 'VP', 'CXO', 'Partner', 'Owner'].reduce((a, k) => a + (sh.values.get(k) || 0), 0); put('Director and above', i, sh.total ? Math.round(dp / sh.total * 1000) / 10 : 0); }
      }
    });
    let keys = [...seriesMap.keys()].sort((a, b) => seriesMap.get(b).reduce((x, y) => x + y, 0) - seriesMap.get(a).reduce((x, y) => x + y, 0));
    if (qMode === 'seniority') keys = ['Director and above', ...keys.filter(k => k !== 'Director and above')].slice(0, 7);
    else keys = keys.slice(0, 8);
    const palette = SERIES;
    const cv = el.querySelector('#qualChart'); const old = charts.find(c => c.canvas === cv); if (old) { old.destroy(); charts = charts.filter(c => c !== old); }
    if (!allWin.length) { el.querySelector('#qualTable').innerHTML = ctx.ui.empty('No demographics export uploaded yet.'); return; }
    { const need = qMode === 'seniority' ? ['Job Seniority'] : []; const allRows = allWin.flatMap(w => w.rows); const have = A.segmentsPresent(allRows); const miss = need.filter(k => !have.includes(k)); if (miss.length) { el.querySelector('#qualTable').innerHTML = ctx.ui.empty(`Needs the ${miss.map(k => NEED[k]).join(' and ')} demographics export (uploaded so far: ${have.join(', ') || 'none'}).`); { const cv = el.querySelector('#qualChart'); const old = charts.find(c => c.canvas === cv); if (old) { old.destroy(); charts = charts.filter(c => c !== old); } } return; } }
    chart(cv, { type: 'line', data: { labels, datasets: keys.map((k, i) => ({ label: k, data: seriesMap.get(k), borderColor: palette[i % palette.length], backgroundColor: palette[i % palette.length], borderWidth: k === 'Director and above' || i === 0 ? 3 : 2, pointRadius: 3, tension: .25 })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)}%` } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } }, x: { grid: { display: false } } } } });
    const lastI = allWin.length - 1;
    const qualNote = qMode === 'band' ? mixNote(['Job Title']) : qMode === 'region' ? mixNote(['Country']) : '';
    el.querySelector('#qualTable').innerHTML = qualNote + `<table><thead><tr><th class="l">${qMode === 'region' ? 'Region' : qMode === 'seniority' ? 'Seniority' : qMode === 'band' ? 'Band' : 'Share'}</th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Change, first to last</th></tr></thead><tbody>${keys.map(k => { const v = seriesMap.get(k); const d = lastI > 0 ? v[lastI] - v[0] : null; return `<tr><td class="l"><b>${esc(k)}</b></td>${v.map(x => `<td>${fmt(x, 1)}%</td>`).join('')}<td class="${d == null ? 'muted' : d >= 0 ? 'up' : 'down'}">${d == null ? '–' : (d > 0 ? '+' : '') + fmt(d, 1) + ' pts'}</td></tr>`; }).join('')}</tbody></table>`;
  };
  ctx.ui.seg(el.querySelector('#qualSeg'), [{ value: 'region', label: 'Regions' }, { value: 'seniority', label: 'Seniority' }, { value: 'band', label: 'Designation bands' }, { value: 'accounts', label: 'Target accounts' }], v => { qMode = v; drawQual(); }, qMode);
  drawQual();

  // ---- reach heat maps (impressions ÷ rf) ----
  // One Map(rowKey -> people) per window, for the chosen dimension.
  const reachMaps = (wins, dim) => wins.map(w => {
    const m = new Map();
    const put = (k, imp) => { if (imp) m.set(k, (m.get(k) || 0) + imp / rf); };
    if (dim === 'account') for (const r of A.segRows(w.rows, 'Company')) put(A.matchAccount(r.value, accounts) || 'Other pages', Number(r.impressions) || 0);
    else if (dim === 'band') { const b = A.bandSharesOrMix(w.rows, bands, mix); for (const k of A.BANDS) put(k, b.counts[k] || 0); }
    else if (dim === 'title') for (const r of A.segRows(w.rows, 'Job Title')) put(String(r.value || '').trim(), Number(r.impressions) || 0);
    else { const g = A.countryShareOrMix(w.rows, mix); const compTot = g.estimated ? A.segRows(w.rows, 'Company').reduce((a, r) => a + (Number(r.impressions) || 0), 0) : 1; const byRegion = new Map(); for (const [ct, v] of g.values) { const k = A.regionOf(ct, regions); byRegion.set(k, (byRegion.get(k) || 0) + (g.estimated ? v * compTot : v)); } for (const [k, v] of byRegion) put(k, v); }
    return m;
  });
  const sumMaps = maps => { const t = new Map(); for (const m of maps) for (const [k, v] of m) t.set(k, (t.get(k) || 0) + v); return t; };
  // p is the comparison range for this section (its own control, starting on the top-bar one); the
  // dimension toggle redraws with the last one used.
  let reachDim = 'account', reachPrev = cmpReach.prev;
  const drawReach = async (p = reachPrev) => {
    const box = el.querySelector('#reachHeat'); if (!box) return;
    reachPrev = p;
    if (!windows.length) { box.innerHTML = ctx.ui.empty('No demographics export covers this range. Upload one at the top of this page.'); return; }
    const reachNote = reachDim === 'band' ? mixNote(['Job Title']) : reachDim === 'region' ? mixNote(['Country']) : reachDim === 'title' && !segsPresent.includes('Job Title') ? '<p class="note" style="font-size:12.5px;margin:0 0 8px"><b>No Job Title breakdown in these dates.</b> Upload the Professional Demographics export for these dates again (it carries every breakdown) to see the exact titles reached.</p>' : '';
    const prevWindows = (await prevBundle(p)).demo; if (!el.isConnected || p !== reachPrev) return;
    const prev = p;
    const curMaps = reachMaps(windows, reachDim), curTot = sumMaps(curMaps);
    const cmpTot = prev ? sumMaps(reachMaps(prevWindows, reachDim)) : null;
    const keys = [...new Set([...curTot.keys(), ...(cmpTot ? cmpTot.keys() : [])])].filter(k => (curTot.get(k) || 0) > 0 || (cmpTot && cmpTot.get(k) > 0));
    let rows = keys.map(k => ({ key: k, label: k, sub: reachDim === 'account' ? ((accounts.find(a => a.name === k) || {}).category || (k === 'Other pages' ? 'pages matching no account' : '')) : '' }));
    if (reachDim === 'band') rows = A.BANDS.filter(b => keys.includes(b)).map(b => ({ key: b, label: b }));
    else rows.sort((a, b) => (curTot.get(b.key) || 0) - (curTot.get(a.key) || 0));
    if (reachDim === 'account' || reachDim === 'title') rows = rows.slice(0, 40);
    if (reachDim === 'title') for (const r of rows) { const w = A.bandWeights(r.key, bands); const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0]; r.sub = top && top[0] !== 'Other' ? top[0] : ''; }
    const cols = windows.map((w, i) => ({ key: 'w' + i, label: winLabel(w) }));
    cols.push({ key: 'cur', label: 'Selected dates' });
    if (prev) { cols.push({ key: 'cmp', label: prev.label.replace(/^the /, '') }); cols.push({ key: 'chg', label: 'Change' }); }
    const maxCur = Math.max(1, ...curMaps.flatMap(m => [...m.values()]));
    ctx.heat.renderHeat(box, { corner: reachDim === 'account' ? 'Account' : reachDim === 'band' ? 'Designation band' : reachDim === 'title' ? 'Exact title (as exported)' : 'Region', rows, cols, sortRows: false, scale: 'sqrt', max: maxCur, cell: (r, c) => {
      if (c.startsWith('w')) { const v = curMaps[+c.slice(1)].get(r) || 0; return { v, text: v ? fmt(v) : '–' }; }
      if (c === 'cur') { const v = curTot.get(r) || 0; return { v: null, text: fmt(v), title: `${r}: ${fmt(v)} people in the selected dates (${fmt(v * rf)} impressions ÷ ${rf})` }; }
      if (c === 'cmp') { const v = cmpTot.get(r) || 0; return { v: null, text: v ? fmt(v) : '–', title: `${r}: ${fmt(v)} people ${prev.label}` }; }
      const a = curTot.get(r) || 0, b = cmpTot.get(r) || 0; const g = A.growth(a, b);
      return { v: null, text: g == null ? (a ? 'new' : '–') : (g > 0 ? '+' : '') + fmt(g, 0) + '%', title: `${r}: ${fmt(a)} now vs ${fmt(b)} ${prev.label}` };
    }, colTotal: c => c.startsWith('w') ? fmt([...curMaps[+c.slice(1)].values()].reduce((x, y) => x + y, 0)) : c === 'cur' ? fmt([...curTot.values()].reduce((x, y) => x + y, 0)) : c === 'cmp' ? fmt([...cmpTot.values()].reduce((x, y) => x + y, 0)) : (() => { const a = [...curTot.values()].reduce((x, y) => x + y, 0), b = [...cmpTot.values()].reduce((x, y) => x + y, 0); const g = A.growth(a, b); return g == null ? '–' : (g > 0 ? '+' : '') + fmt(g, 0) + '%'; })() });
    if (reachDim === 'account') {
      // Company pages that matched no account, so a missing account can be spotted (e.g. a page name the list does not know).
      const un = new Map(); for (const w of windows) for (const r of A.segRows(w.rows, 'Company')) if (!A.matchAccount(r.value, accounts)) un.set(r.value, (un.get(r.value) || 0) + (Number(r.impressions) || 0));
      const top = [...un.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      if (top.length) box.insertAdjacentHTML('beforeend', `<p class="muted" style="font-size:12.5px;margin-top:8px"><b>Pages not matched to any account</b> (${fmt(un.size)}; add them as aliases in Admin › GSI accounts if they belong to one): ${top.map(([k, v]) => `${esc(k)} (${fmt(v / rf)})`).join(', ')}.</p>`);
    }
    if (reachNote) box.insertAdjacentHTML('afterbegin', reachNote);
    box.querySelectorAll('td.c').forEach(td => { if (/^(cur|cmp|chg)$/.test(td.dataset.c)) { td.style.background = 'var(--offwhite)'; td.style.color = ''; if (td.dataset.c === 'chg') td.classList.add(/^\+/.test(td.textContent) ? 'up' : /^-/.test(td.textContent) ? 'down' : 'muted'); } });
  };
  ctx.ui.seg(el.querySelector('#reachSeg'), [{ value: 'account', label: 'Accounts' }, { value: 'title', label: 'Exact designations' }, { value: 'band', label: 'Designation bands' }, { value: 'region', label: 'Regions' }], v => { reachDim = v; drawReach(); }, reachDim);
  drawReach();

  // ---- penetration cube (company x region x band, cumulative) ----
  let cube = A.penetrationCube({ windows, accounts, icp_pool: poolAll, bands, frequency, regions, mix });
  let cubeMetric = 'pct', cubeRegion = 'all', cubeLimit = 25; const cubeOpen = new Set();
  const cubeVal = (t, b) => cubeMetric === 'pct' ? t[b].pct : cubeMetric === 'reached' ? t[b].reached : cubeMetric === 'exposure' ? t[b].exposure : cubeMetric === 'freq' ? t[b].freq : t[b].pool;
  const cubeCell = (t, b, who) => {
    if (!t) return { v: null, text: '·' };
    const x = t[b];
    const estTag = x.est_pool ? ' est.' : '';
    if (cubeMetric === 'pct') { if (x.pct == null || !x.reached) return { v: null, text: x.reached ? '·' : '–', sub: x.reached ? `${fmt(x.reached)} reached, no pool` : '', title: `${who} · ${b}: ${x.reached ? 'no headcount for this pool yet (estimate it with Claude below)' : 'nobody reached'}` }; return { v: A.penLevel(x.pct), text: fmt(x.pct, x.pct < 10 ? 1 : 0) + '%', sub: `${fmt(x.reached_pooled)} / ${fmt(x.pool)}${estTag}`, title: `${who} · ${b}\nPeople reached: ${fmt(x.reached_pooled)} of ${fmt(x.pool)}${x.reached > x.reached_pooled + 0.5 ? ` (+${fmt(x.reached - x.reached_pooled)} in countries with no pool)` : ''}${x.est_pool ? ' (pool estimated: ' + (t.All.sources || []).join('; ') + ')' : ' (Apollo pool)'}\nImpressions: ${fmt(x.imp)} = ${fmt(x.exposure, 2)} per person in the pool, ${fmt(x.freq, 1)} per person reached\nPenetration: ${fmt(x.pct, 1)}%` }; }
    if (cubeMetric === 'exposure' || cubeMetric === 'freq') { const v = cubeVal(t, b); if (v == null) return { v: null, text: x.imp ? '·' : '–', title: `${who} · ${b}: ${x.imp ? fmt(x.imp) + ' impressions, no pool' : 'nobody reached'}` }; return { v: cubeMetric === 'exposure' ? A.exposureLevel(v) : Math.min(5, Math.max(1, Math.ceil(v / 2))), text: fmt(v, v < 10 ? 1 : 0), sub: cubeMetric === 'exposure' ? `${fmt(x.imp)} imp` : `${fmt(x.reached)} people`, title: `${who} · ${b}\n${fmt(x.imp)} impressions on ${cubeMetric === 'exposure' ? fmt(x.pool) + ' people in the pool' : fmt(x.reached) + ' people reached'}: ${fmt(v, 2)} each` }; }
    const v = cubeVal(t, b); return { v: v || 0, text: v ? fmt(v) : '–', title: `${who} · ${b}: ${fmt(v)} ${cubeMetric === 'reached' ? 'people reached (est.)' : 'people in the ICP pool'}` };
  };
  const drawCube = () => {
    const box = el.querySelector('#cubeHeat'); if (!box) return;
    const list = cube.accounts.filter(a => cubeRegion === 'all' || a.regions[cubeRegion]);
    if (cubeRegion !== 'all') list.sort((x, y) => (y.regions[cubeRegion].All.reached || 0) - (x.regions[cubeRegion].All.reached || 0));
    const shown = list.slice(0, cubeLimit);
    const rows = [], src = new Map();
    for (const a of shown) {
      if (cubeRegion === 'all') {
        rows.push({ key: a.account, label: a.account, sub: `${a.category ? a.category + ' · ' : ''}${Object.keys(a.regions).length} region${Object.keys(a.regions).length === 1 ? '' : 's'}${cubeOpen.has(a.account) ? '' : ' · click to open'}`, cls: 'grp' }); src.set(a.account, [a.total, a.account]);
        if (cubeOpen.has(a.account)) for (const r of cube.regions.filter(r => a.regions[r])) { const k = a.account + '\u0001' + r; rows.push({ key: k, label: r, cls: 'child' }); src.set(k, [a.regions[r], `${a.account} · ${r}`]); }
      } else { rows.push({ key: a.account, label: a.account, sub: a.category || '' }); src.set(a.account, [a.regions[cubeRegion], `${a.account} · ${cubeRegion}`]); }
    }
    if (!rows.length) { box.innerHTML = ctx.ui.empty('No company page in these windows matches a target account with a reach pool.'); el.querySelector('#cubeCount').textContent = ''; return; }
    const cols = [...cube.bands, 'All'].map(b => ({ key: b, label: b === 'All' ? 'All bands' : b }));
    ctx.heat.renderHeat(box, { corner: cubeRegion === 'all' ? 'Company / region' : `Company · ${cubeRegion}`, rows, cols, sortRows: false, scale: /^(pct|exposure|freq)$/.test(cubeMetric) ? 'linear' : 'sqrt', max: /^(pct|exposure|freq)$/.test(cubeMetric) ? 5 : undefined,
      cell: (r, c) => { const [t, who] = src.get(r) || []; return cubeCell(t, c, who); },
      onClick: cubeRegion === 'all' ? (r) => { if (r.includes('\u0001')) return; if (cubeOpen.has(r)) cubeOpen.delete(r); else cubeOpen.add(r); drawCube(); } : undefined });
    box.querySelectorAll('td.c').forEach(td => { const [t] = src.get(td.dataset.r) || []; const x = t && t[td.dataset.c]; if (x && x.est_pool) td.classList.add('est'); });
    const noPool = cube.accounts.filter(a => !a.total.All.has_pool).map(a => a.account);
    const estN = poolAll.filter(p => p.est).length, claudeN = icpEstimates.length;
    box.insertAdjacentHTML('afterbegin', mixNote(['Job Title', 'Country']) + `<p class="muted" style="font-size:12.5px;margin:0 0 8px">Pools: ${fmt(icp_pool.length)} Apollo counts${estN ? `, ${fmt(estN)} derived or estimated rows (dashed cells)` : ''}${claudeN ? `, ${fmt(claudeN)} from Claude` : ''}.${noPool.length ? ` <b>${fmt(noPool.length)} reached account${noPool.length === 1 ? '' : 's'} with no headcount yet</b>: ${esc(noPool.slice(0, 8).join(', '))}${noPool.length > 8 ? '…' : ''}.${isEditorOf(ctx) ? ` <button class="btn tiny" data-estimate>Estimate with Claude</button>` : ''}` : ''}</p>`);
    const estBtn = box.querySelector('[data-estimate]');
    if (estBtn) estBtn.onclick = async () => {
      estBtn.disabled = true; estBtn.innerHTML = '<span class="spin"></span> Estimating';
      try {
        let done = 0; const all = [];
        for (let i = 0; i < noPool.length; i += 12) { const r = await ctx.api.post('icp-estimate', { accounts: noPool.slice(i, i + 12), countries: poolCountries }); all.push(...(r.estimates || [])); done += (r.estimates || []).length; estBtn.innerHTML = `<span class="spin"></span> ${fmt(done)} rows so far`; }
        try { ctx.settings = await ctx.api.get('settings'); } catch { /* keep */ }
        ctx.toast(`${fmt(all.length)} headcount estimates saved. Redrawing.`);
        render(el, ctx);
      } catch (e) { estBtn.disabled = false; estBtn.textContent = 'Estimate with Claude'; ctx.toast('Estimate failed: ' + (e.message || e), 'err'); }
    };
    box.querySelectorAll('tr.child td.c').forEach(td => td.classList.remove('click'));
    box.querySelectorAll('tr.grp td.l').forEach(td => { td.style.cursor = 'pointer'; td.onclick = () => { const k = td.parentElement.querySelector('td.c')?.dataset.r; if (!k) return; if (cubeOpen.has(k)) cubeOpen.delete(k); else cubeOpen.add(k); drawCube(); }; });
    el.querySelector('#cubeCount').innerHTML = `${fmt(shown.length)} of ${fmt(list.length)} companies${list.length > cubeLimit ? ` · <a href="#" data-more>show all</a>` : cubeLimit > 25 && list.length > 25 ? ` · <a href="#" data-less>show top 25</a>` : ''}`;
    const more = el.querySelector('#cubeCount [data-more]'); if (more) more.onclick = e => { e.preventDefault(); cubeLimit = 10000; drawCube(); };
    const less = el.querySelector('#cubeCount [data-less]'); if (less) less.onclick = e => { e.preventDefault(); cubeLimit = 25; drawCube(); };
    el.querySelector('#cubeLegend').innerHTML = cubeMetric === 'pct' ? [['under 5%', 1], ['5 to 15%', 2], ['15 to 35%', 3], ['35 to 70%', 4], ['over 70%', 5]].map(([l, k]) => `<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;background:${ctx.heat.cellColor(k, 5, { scale: 'linear' })}"></i>${l}</span>`).join('') + '<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px dashed var(--ink2)"></i>dashed = estimated pool</span><span>· = reached but no pool</span><span>Never above 100%: repeated impressions raise frequency, not people</span>' : cubeMetric === 'exposure' ? [['under 0.5', 1], ['0.5 to 2', 2], ['2 to 5', 3], ['5 to 10', 4], ['10 and over', 5]].map(([l, k]) => `<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;background:${ctx.heat.cellColor(k, 5, { scale: 'linear' })}"></i>${l}</span>`).join('') + '<span>impressions per person in the pool; above 5 the same people are seeing the ads again</span>' : cubeMetric === 'freq' ? '<span>impressions per person reached; one window averages ' + fmt(frequency, 1) + '</span>' : ctx.heat.legend('orange');
  };
  ctx.ui.seg(el.querySelector('#cubeMetric'), [{ value: 'pct', label: 'Penetration %' }, { value: 'reached', label: 'People reached' }, { value: 'pool', label: 'ICP pool' }, { value: 'exposure', label: 'Exposure' }, { value: 'freq', label: 'Frequency' }], v => { cubeMetric = v; drawCube(); }, cubeMetric);
  ctx.ui.seg(el.querySelector('#cubeRegion'), [{ value: 'all', label: 'All regions' }, ...cube.regions.map(r => ({ value: r, label: r }))], v => { cubeRegion = v; drawCube(); }, cubeRegion);
  drawCube();

  // ---- parts: tiers and designations (each in its own module; a missing or failing part never breaks the page) ----
  const partData = { windows, allWindows: windows, perf, prevBundle, accounts, bands, icp_pool: poolAll, regions, frequency, rf, mix, from, to, prev: ctx.state.prev || null, segsPresent, cube, isEditor: isEditorOf(ctx), rerender: () => render(el, ctx) };
  for (const [id, file] of [['li-tiers', 'tiers'], ['li-designations', 'designations']]) {
    const slot = el.querySelector('#' + id); if (!slot) continue;
    import(`./parts/${file}.mjs`).then(m => m.mount(slot, ctx, partData)).catch(e => { if (!/Failed to fetch|not found|404/i.test(String(e && e.message))) console.error(file, e); });
  }

  // ---- audiences by person / ad set ----
  {
    const tags = [...new Set(allDemoRows.map(r => r.campaign).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const body = el.querySelector('#personBody'), segEl = el.querySelector('#personSeg');
    if (!tags.length) { segEl.innerHTML = ''; body.innerHTML = ctx.ui.empty('No tagged demographics in this range yet. In Campaign Manager filter the campaigns to one person\'s boosted posts (or one ad set), export Demographics by Company, Job Title and Country, and type the name in the "Covers" box when uploading. Each name then gets its own account × designation × region map here.'); }
    else {
      const drawPerson = tag => {
        const wins = windows.map(w => ({ upload: w.upload, rows: w.rows.filter(r => r.campaign === tag) })).filter(w => w.rows.length);
        const rows = wins.flatMap(w => w.rows);
        const have = A.segmentsPresent(rows);
        const cube = A.penetrationCube({ windows: wins, accounts, icp_pool: poolAll, bands, frequency, regions, mix });
        const accs = cube.accounts.slice(0, 12);
        const regionsSeen = cube.regions;
        const totalReach = cube.accounts.reduce((a, x) => a + x.total.All.reached, 0);
        const bandTot = {}; for (const b of A.PEN_BANDS) bandTot[b] = cube.accounts.reduce((a, x) => a + x.total[b].reached, 0);
        const topBand = [...A.PEN_BANDS].sort((x, y) => bandTot[y] - bandTot[x])[0];
        const regionTot = {}; for (const a of cube.accounts) for (const [r, t] of Object.entries(a.regions)) regionTot[r] = (regionTot[r] || 0) + t.All.reached;
        const topRegion = Object.entries(regionTot).sort((a, b) => b[1] - a[1])[0];
        const best = cube.accounts.filter(a => a.total.All.pct != null).sort((a, b) => b.total.All.pct - a.total.All.pct)[0];
        let out = `<div class="card" style="font-size:13.5px"><b>${esc(tag)}</b>: ${esc(wins.map(w => winLabel(w)).join('; '))}. Breakdowns: ${esc(have.join(', ') || 'none')}${['Job Title', 'Country'].some(k => !have.includes(k)) ? ` <span class="muted">(${['Job Title', 'Country'].filter(k => !have.includes(k)).join(' and ')} split estimated from the programme mix)</span>` : ''}.
          ${accs.length ? `About <b>${fmt(totalReach)}</b> people at target accounts reached (impressions ÷ ${fmt(frequency, 1)}); most were <b>${esc(accs[0].account)}</b> (${fmt(accs[0].total.All.reached)})${topBand && bandTot[topBand] ? `, the <b>${esc(topBand)}</b> band saw the most (${fmt(bandTot[topBand])})` : ''}${topRegion ? `, mainly in <b>${esc(topRegion[0])}</b> (${fmt(topRegion[1])})` : ''}${best ? `. Deepest penetration: <b>${esc(best.account)}</b> at ${pct(best.total.All.pct, 0)} of its pool` : ''}.` : 'No company page here matches a target account.'}</div>`;
        if (accs.length) {
          out += `<div class="grid g2" style="margin-top:12px"><div class="card"><h3>People reached by account and region</h3><div class="tblwrap" style="border:none" id="personGeo"></div></div><div class="card"><h3>People reached by account and designation</h3><div class="tblwrap" style="border:none" id="personBand"></div></div></div>`;
        }
        body.innerHTML = out;
        if (!accs.length) return;
        const rws = accs.map(a => ({ key: a.account, label: a.account, sub: a.category || '' }));
        ctx.heat.renderHeat(el.querySelector('#personGeo'), { corner: 'Account', rows: rws, cols: [...regionsSeen.map(r => ({ key: r, label: r })), { key: '__all', label: 'All' }], sortRows: false, scale: 'sqrt',
          cell: (r, c) => { const a = accs.find(x => x.account === r); const t = c === '__all' ? a.total : a.regions[c]; const v = t ? t.All.reached : 0; return { v: Math.round(v), text: v ? fmt(v) : '–', sub: t && t.All.pct != null ? pct(t.All.pct, 0) + ' of pool' : '', title: `${r} · ${c === '__all' ? 'all regions' : c}: ${fmt(v)} people reached${t && t.All.pct != null ? `, ${pct(t.All.pct, 1)} of the pool` : ''}` }; } });
        ctx.heat.renderHeat(el.querySelector('#personBand'), { corner: 'Account', rows: rws, cols: [...A.PEN_BANDS.map(b => ({ key: b, label: b })), { key: 'All', label: 'All bands' }], sortRows: false, scale: 'sqrt',
          cell: (r, c) => { const a = accs.find(x => x.account === r); const t = a.total[c]; const v = t ? t.reached : 0; return { v: Math.round(v), text: v ? fmt(v) : '–', sub: t && t.pct != null ? pct(t.pct, 0) + ' of pool' : '', title: `${r} · ${c}: ${fmt(v)} people reached${t && t.pct != null ? `, ${pct(t.pct, 1)} of the pool` : ''}` }; } });
      };
      ctx.ui.seg(segEl, tags.map(t => ({ value: t, label: t.length > 40 ? t.slice(0, 38) + '…' : t })), v => drawPerson(v), tags[0]);
      drawPerson(tags[0]);
    }
  }

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

  // ---- efficiency map (bubble: CPM x CTR, size = spend, colour = approach) ----
  const effSets = sets.filter(s => s.impressions > 0 && s.cpm != null);
  if (effSets.length) {
    const maxSp = Math.max(1, ...effSets.map(s => s.spend));
    chart(el.querySelector('#wpEff'), { type: 'bubble', data: { datasets: A.APPROACHES.filter(a => effSets.some(s => s.approach === a)).map(a => ({ label: a, data: effSets.filter(s => s.approach === a).map(s => ({ x: Math.round(s.cpm * 100) / 100, y: Math.round(s.ctr * 100) / 100, r: 5 + 22 * Math.sqrt(s.spend / maxSp), set: s })), backgroundColor: withAlpha(APPROACH_COLOR[a], .7), borderColor: APPROACH_COLOR[a], borderWidth: 1 })) },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: it => shortName(it[0].raw.set.name, 60), label: c => { const s = c.raw.set; return [`Spend ${usd(s.spend)}`, `Leads ${fmt(s.leads)}`, `CPM ${usd(s.cpm, 2)}`, `CTR ${pct(s.ctr, 2)}`, `Impressions ${fmt(s.impressions)}`]; } } } },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'CPM ($ per 1,000 impressions)' }, ticks: { callback: v => '$' + v } }, y: { beginAtZero: true, title: { display: true, text: 'CTR' }, ticks: { callback: v => v + '%' } } } } });
  } else el.querySelector('#wpEffBox').innerHTML = ctx.ui.empty('No ad set with impressions in this range.');

  // ---- messaging: expand a sender's ad sets ----
  const msgTable = el.querySelector('#wpMsg');
  if (msgTable) msgTable.querySelectorAll('tr.wp-sender').forEach(tr => tr.addEventListener('click', () => { const open = tr.dataset.open === '1'; tr.dataset.open = open ? '0' : '1'; tr.querySelector('.wp-caret').textContent = open ? '+' : '–'; msgTable.querySelectorAll(`tr.wp-set[data-i="${tr.dataset.i}"]`).forEach(x => { x.style.display = open ? 'none' : ''; }); }));

  // ---- asset x company heat map ----
  if (ACS.has_split) {
    let acsMetric = 'impressions';
    const drawAsset = () => {
      const rows = ACS.companies.map(k => ({ key: k, label: k, sub: k === 'Other' ? 'pages matching no account' : (accounts.find(a => a.name === k) || {}).category || '' }));
      const cols = ACS.approaches.map(a => ({ key: a, label: a }));
      const colTot = c => ACS.cells.filter(x => x.approach === c).reduce((s, x) => ({ impressions: s.impressions + x.impressions, clicks: s.clicks + x.clicks }), { impressions: 0, clicks: 0 });
      const rowTot = r => ACS.cells.filter(x => x.company === r).reduce((s, x) => ({ impressions: s.impressions + x.impressions, clicks: s.clicks + x.clicks }), { impressions: 0, clicks: 0 });
      const show = t => acsMetric === 'ctr' ? pct(t.impressions ? t.clicks / t.impressions * 100 : null, 2) : fmt(t[acsMetric]);
      ctx.heat.renderHeat(el.querySelector('#wpAsset'), { corner: 'Account', rows, cols, color: 'navy', scale: acsMetric === 'ctr' ? 'linear' : 'sqrt', sortRows: false,
        cell: (r, c) => { const x = ACS.at(r, c); if (!x || !x.impressions) return { v: null, text: '·', title: `${r} · ${c}: no impressions` }; const v = acsMetric === 'ctr' ? x.ctr : x[acsMetric]; return { v, text: acsMetric === 'ctr' ? pct(v, 2) : fmt(v), sub: acsMetric === 'ctr' ? `${fmt(x.impressions)} impr.` : `${pct(x.ctr, 2)} CTR`, title: `${r} · ${c}\nImpressions ${fmt(x.impressions)}\nClicks ${fmt(x.clicks)}\nCTR ${pct(x.ctr, 2)}\nAd sets: ${x.sets.join('; ')}` }; },
        rowTotal: r => show(rowTot(r)), colTotal: c => show(colTot(c)) });
    };
    ctx.ui.seg(el.querySelector('#wpAssetSeg'), [{ value: 'impressions', label: 'Impressions' }, { value: 'clicks', label: 'Clicks' }, { value: 'ctr', label: 'CTR' }], v => { acsMetric = v; drawAsset(); }, acsMetric);
    drawAsset();
  }

  // ---- geography x seniority per audience ----
  if (windows.length) {
    const G0 = A.geoSeniority(demoRows, { regions, metric: 'impressions' });
    let geoAud = G0.audiences[0] ? G0.audiences[0].name : null, geoMet = 'impressions';
    const drawGeoSen = () => {
      const box = el.querySelector('#wpGeo');
      const G = A.geoSeniority(demoRows, { regions, metric: geoMet });
      const aud = G.audiences.find(a => a.name === geoAud) || G.audiences[0];
      if (!aud || !aud.total) { box.innerHTML = ctx.ui.empty('No country and seniority rows for this audience in the included windows.'); return; }
      const unit = METRIC_LABEL[geoMet].toLowerCase();
      ctx.heat.renderHeat(box, { corner: 'Region', rows: aud.regions.map(r => ({ key: r, label: r })), cols: aud.seniorities.map(s => ({ key: s, label: s })), scale: 'sqrt', sortRows: false,
        cell: (r, c) => { const v = (aud.cells[r] || {})[c] || 0; return { v, text: v >= 1 ? fmt(v) : '–', title: `${r} · ${c}: about ${fmt(v)} ${unit} (estimated: region total spread by the seniority mix)` }; },
        rowTotal: r => fmt(aud.regionTotal[r]), colTotal: c => fmt(aud.senTotal[c]) });
    };
    ctx.ui.seg(el.querySelector('#wpGeoAud'), G0.audiences.map(a => ({ value: a.name, label: a.name === A.ALL_AUDIENCES ? a.name : shortName(a.name, 36) })), v => { geoAud = v; drawGeoSen(); }, geoAud);
    ctx.ui.seg(el.querySelector('#wpGeoMetric'), [{ value: 'impressions', label: 'Impressions' }, { value: 'clicks', label: 'Clicks' }], v => { geoMet = v; drawGeoSen(); }, geoMet);
    drawGeoSen();
  }

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
    const countries = poolCountries;
    el.querySelector('#penLegend').innerHTML = [['under 5%', 1], ['5 to 15%', 2], ['15 to 35%', 3], ['35 to 70%', 4], ['over 70%', 5]].map(([l, k]) => `<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;background:${ctx.heat.cellColor(k, 5, { scale: 'linear' })}"></i>${l}</span>`).join('') + '<span><i style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px dashed var(--g300)"></i>no headcount</span>';
    el.querySelector('#penMethod').innerHTML = `Method. Estimated people reached = impressions ÷ ${fmt(frequency, 1)} (frequency, editable in Settings › Targets). Penetration = estimated people reached ÷ Apollo headcount for the company, country and band. Company × country allocation uses the global country share because LinkedIn exports no cross-tab; the band split uses the Job Title mix of the same windows. Windows included: ${windows.map(w => esc(winLabel(w))).join('; ')}.`;
    const detail = el.querySelector('#penDetail');
    let penBand = 'All';
    const drawPen = () => {
      const R = A.penetration({ windows, accounts, icp_pool: poolAll, bands, frequency, band: penBand, countries, mix });
      const byKey = new Map(R.cells.map(c => [c.account + '||' + c.country, c]));
      const rows = R.accounts.map(a => ({ key: a, label: a, sub: (accounts.find(x => x.name === a) || {}).category || '' }));
      if (!rows.length) { el.querySelector('#penHeat').innerHTML = ctx.ui.empty('No company page in these windows matches a target account.'); return; }
      ctx.heat.renderHeat(el.querySelector('#penHeat'), { corner: 'Account', rows, cols: countries.map(c => ({ key: c, label: c.replace('United ', 'U.') })), scale: 'linear', max: 5, sortRows: false,
        cell: (r, c) => { const x = byKey.get(r + '||' + c); if (!x || x.pool_band == null) return { v: null, text: '·', title: `${r} · ${c}: no headcount in the ICP pool` }; return { v: A.penLevel(x.pct), text: fmt(x.pct, x.pct < 10 ? 1 : 0) + '%', sub: `${fmt(x.reached_band)} / ${fmt(x.pool_band)}`, title: `${r} · ${c} · ${penBand}\nPeople reached (est.): ${fmt(x.reached_band)}\nICP pool: ${fmt(x.pool_band)}\nPenetration: ${fmt(x.pct, 1)}%\nClick for detail` }; },
        onClick: (r, c) => showDetail(r, c, byKey.get(r + '||' + c)) });
      el.querySelector('#penHeat').querySelectorAll('td.c').forEach(td => { const x = byKey.get(td.dataset.r + '||' + td.dataset.c); if (x && x.pool && x.pool.est) td.classList.add('est'); });
      el.querySelector('#penHeat').insertAdjacentHTML('afterbegin', mixNote(['Job Title', 'Country']));
      penSummary = R.cells.filter(c => c.pct != null).sort((a, b) => b.pct - a.pct);
    };
    const showDetail = (acc, country, x) => {
      const pool = x && x.pool; const reached = x ? x.reached : { MD: 0, 'MD-1': 0, 'MD-2': 0 };
      const bandRow = b => { const p = pool ? pool[b] : null; return `<tr><td class="l"><b>${b}</b></td><td>${fmt(reached[b])}</td><td>${p != null ? fmt(p) : '–'}</td><td>${p ? fmt(reached[b] / p * 100, 1) + '%' : '–'}</td></tr>`; };
      const tt = reached.MD + reached['MD-1'] + reached['MD-2'], pt = pool ? pool.MD + pool['MD-1'] + pool['MD-2'] : 0;
      const cres = A.creativesForCountry(perf, country, countries);
      detail.innerHTML = `<div class="card" style="background:var(--soft)"><h3>${esc(acc)} · ${esc(country)}</h3><div class="grid g2" style="margin-top:8px"><div>
        <div class="tblwrap"><table><thead><tr><th class="l">Designation</th><th>People reached (est.)</th><th>ICP pool${pool && pool.est ? ' (estimated)' : ' (Apollo)'}</th><th>Penetration</th></tr></thead><tbody>${['MD', 'MD-1', 'MD-2'].map(bandRow).join('')}<tr class="total"><td class="l">All ICP</td><td>${fmt(tt)}</td><td>${pt ? fmt(pt) : '–'}</td><td>${pt ? fmt(tt / pt * 100, 1) + '%' : '–'}</td></tr></tbody></table></div>
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
      range: { from, to, days }, previous_range: lastPrev ? { from: lastPrev.from, to: lastPrev.to, label: lastPrev.label } : null,
      totals: round(T), previous_totals: lastPrev && TPn ? round(TP) : null,
      trend_by_week: wk.slice(-16),
      by_person: BP.people.map(o => ({ person: o.person, impressions: o.impressions, engagements: o.engagements, eng_rate_pct: o.eng_rate == null ? null : Math.round(o.eng_rate * 100) / 100, clicks: o.clicks, video_views: o.video_views, leads: o.leads, spend: Math.round(o.spend), prior_impressions: BPP && BPP.people.find(x => x.person === o.person) ? BPP.people.find(x => x.person === o.person).impressions : null, top_posts: o.ad_sets.slice(0, 3).map(c => ({ name: c.name, impressions: c.impressions, engagements: c.engagements })) })),
      engagement: { engagements: T.engagements, rate_pct: T.impressions ? Math.round(T.engagements / T.impressions * 10000) / 100 : null, reactions: T.reactions, comments: T.comments, shares: T.shares, follows: T.follows, video_views: T.video_views },
      lead_types: { compared_with: lastLeadPrev ? lastLeadPrev.label : null, types: LS.types.map(t => ({ type: t.label, stage: t.stage, leads: t.leads, share_pct: t.share == null ? null : Math.round(t.share), spend: Math.round(t.spend), cpl: t.cpl == null ? null : Math.round(t.cpl), prior_leads: LSP ? LSP.byType[t.type].leads : null, top_ad_sets: t.campaigns.slice(0, 3).map(c => ({ name: c.name, leads: c.leads })) })) },
      stage_split: Object.fromEntries(Object.entries(SS.totals).map(([k, v]) => [k, { spend: Math.round(v.spend), leads: v.leads, impressions: v.impressions }])),
      programs: progs,
      top_ads: ads.slice(0, 6).map(a => ({ name: a.ad_name, spend: Math.round(a.spend), leads: a.leads, cpl: a.cpl && Math.round(a.cpl), ctr: a.ctr && Math.round(a.ctr * 100) / 100 })),
      bottom_ads: ads.filter(a => a.spend > 50 && !a.leads).slice(-5).map(a => ({ name: a.ad_name, spend: Math.round(a.spend), impressions: a.impressions })),
      achieved: lastBullets.achieved.map(b => b.b + ' ' + b.s), not_achieved: lastBullets.missed.map(b => b.b + ' ' + b.s), bullets_compared_with: lastWorkedPrev ? lastWorkedPrev.label : null,
      demographics_windows: windows.map(winLabel),
      seniority_share: share('Job Seniority'), geography_share: share('Country'), function_share: share('Job Function', 6),
      band_share: Object.fromEntries(A.BANDS.map(b => [b, Math.round(bs.share[b] * 1000) / 10])),
      accounts_reached: { count: matched.size, of: accounts.length, top: [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ account: k, impressions: v })) },
      penetration_cube: cube.accounts.slice(0, 10).map(a => ({ account: a.account, reached: Math.round(a.total.All.reached), pct_all: a.total.All.pct == null ? null : Math.round(a.total.All.pct * 10) / 10, by_band: Object.fromEntries(A.PEN_BANDS.map(b => [b, a.total[b].pct == null ? null : Math.round(a.total[b].pct * 10) / 10])), by_region: Object.fromEntries(Object.entries(a.regions).map(([r, t]) => [r, { reached: Math.round(t.All.reached), pct: t.All.pct == null ? null : Math.round(t.All.pct * 10) / 10 }])) })),
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
