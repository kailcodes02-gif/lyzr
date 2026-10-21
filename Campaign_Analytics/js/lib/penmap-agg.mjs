// Penetration map: the model behind the "GSI LinkedIn Penetration Map" report (Apr 1 to Oct 13, 2026),
// rebuilt from the uploaded LinkedIn exports so it stays current. Pure functions, no DOM, node-tested.
//
// The formulas are the report's, unchanged:
//   people            = impressions ÷ 3 (the agreed proxy; Admin › Targets › reach_frequency, default 3)
//   penetration       = people ÷ Apollo headcount for that firm, region and band (not capped: ≥ 100% shows SAT)
//   company × region  = iterative proportional fitting per demographics window: company totals (Company table) and
//                       region totals (Country table) are both matched exactly, seeded with each firm's Apollo
//                       headcount by region (peer average for firms without one); company pages whose name
//                       carries a country (KPMG India, Accenture in India, DGE, Al Rajhi) are pinned to it
//   bands             = that window's Job Seniority mix, applied in every region: MD = Partner, VP, CXO, Owner;
//                       MD-1 = Director; MD-2 = Manager; Sr IC = Senior; Junior = Entry, Training, Unpaid
//   lead-gen CPL      = lead-gen spend (ad sets with a lead generation objective) ÷ LinkedIn form leads
//   retargetable pool = people reached in the recent months (default the last 2, inside LinkedIn's 90-day window)
//   gap               = Apollo MD to MD-2 headcount − MD to MD-2 people reached in the recent months
//   warm now          = recent people ÷ headcount: Cold < 5%, Thin < 25%, Warm otherwise
//   plan              = per ad set: leads = spend ÷ CPL range, people = 1000 × spend ÷ CPM range ÷ 3,
//                       demo bookings = 12 to 25% of the expected leads

export const REG = ['India', 'US', 'UK', 'Middle East', 'APAC', 'Europe & other'];
export const ICPB = ['MD', 'MD-1', 'MD-2'];
export const ALLB = ['MD', 'MD-1', 'MD-2', 'Sr IC', 'Junior'];
export const POOL_REG = ['India', 'US', 'UK', 'Middle East', 'APAC'];
const n = v => Number(v) || 0;
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (k, withYear) => MON[+k.slice(5, 7) - 1] + (withYear ? " '" + k.slice(2, 4) : '');

// ---- regions ----
// Settings regions (Admin › Regions) roll countries into named regions; the map uses six columns.
const REGION_ALIAS = { 'india': 'India', 'united states': 'US', 'us': 'US', 'usa': 'US', 'north america': 'US', 'united kingdom': 'UK', 'uk': 'UK', 'middle east': 'Middle East', 'apac': 'APAC' };
// The report's Middle East is the Gulf plus Levant and Egypt; Türkiye and Cyprus sit in Europe & other.
const EUROPE_OVERRIDE = new Set(['türkiye', 'turkey', 'turkiye', 'cyprus']);
export function mapRegion(country, regions) {
  const c = String(country || '').trim().toLowerCase(); if (!c) return 'Europe & other';
  if (EUROPE_OVERRIDE.has(c)) return 'Europe & other';
  const map = regions && regions.regions ? regions.regions : (regions || {});
  for (const [region, list] of Object.entries(map)) if ((list || []).some(x => String(x).toLowerCase() === c)) return REGION_ALIAS[region.toLowerCase()] || 'Europe & other';
  return REGION_ALIAS[c] || FALLBACK_COUNTRY[c] || 'Europe & other';
}
const FALLBACK_COUNTRY = { 'united arab emirates': 'Middle East', 'uae': 'Middle East', 'saudi arabia': 'Middle East', 'qatar': 'Middle East', 'kuwait': 'Middle East', 'bahrain': 'Middle East', 'oman': 'Middle East', 'australia': 'APAC', 'singapore': 'APAC', 'japan': 'APAC', 'new zealand': 'APAC', 'canada': 'US', 'ireland': 'UK' };

// Geography written into an ad set name. A set "fixes the geography" when it names regions and is not a combined one.
const GEO_PHRASES = [['middle east', 'Middle East'], ['saudi', 'Middle East'], ['dubai', 'Middle East'], ['emirates', 'Middle East'], ['qatar', 'Middle East'], ['united states', 'US'], ['north america', 'US'], ['united kingdom', 'UK'], ['australia', 'APAC'], ['singapore', 'APAC'], ['japan', 'APAC'], ['apac', 'APAC'], ['india', 'India'], ['europe', 'Europe & other'], ['emea', 'Europe & other']];
const GEO_TOKENS = { us: 'US', usa: 'US', uk: 'UK', uae: 'Middle East', ksa: 'Middle East', gcc: 'Middle East', mea: 'Middle East', anz: 'APAC', sea: 'APAC' };
export function geoOfName(name) {
  const t = String(name || '').toLowerCase();
  if (/combined\s*region|all\s*regions|global/.test(t)) return { regions: [], fixed: false, combined: true };
  const out = new Set();
  for (const [p, r] of GEO_PHRASES) if (t.includes(p)) out.add(r);
  for (const tok of t.split(/[^a-z]+/)) if (GEO_TOKENS[tok]) out.add(GEO_TOKENS[tok]);
  return { regions: [...out], fixed: out.size > 0, combined: false };
}
// Company pages whose LinkedIn name carries a country, pinned to that region in the fit.
const PIN_WORDS = [[/\bindia\b/, 'India'], [/\b(uk|united kingdom|britain)\b/, 'UK'], [/\b(usa|us|united states|america)\b/, 'US'], [/\b(uae|dubai|abu dhabi|saudi|ksa|qatar|middle east|emirates|riyadh)\b/, 'Middle East'], [/\b(australia|singapore|japan|apac)\b/, 'APAC'], [/^(dge|department of government enablement)\b/, 'Middle East'], [/\bal ?rajhi\b/, 'Middle East']];
export function pinnedRegion(companyName) {
  const t = String(companyName || '').toLowerCase().replace(/[()]/g, ' ');
  for (const [re, r] of PIN_WORDS) if (re.test(t)) return r;
  return null;
}

// ---- bands from LinkedIn Job Seniority ----
export function seniorityBand(value) {
  const t = String(value || '').toLowerCase();
  if (/cxo|chief|partner|owner|\bvp\b|vice president|managing director/.test(t)) return 'MD';
  if (/director/.test(t)) return 'MD-1';
  if (/manager/.test(t)) return 'MD-2';
  if (/^senior$|^senior\b/.test(t)) return 'Sr IC';
  return 'Junior';
}

// ---- iterative proportional fitting ----
// seed: rows × cols (non-negative), rowT: row targets, colT: column targets (rescaled to the row total).
export function ipf(seed, rowT, colT, { iters = 200, tol = 1e-7 } = {}) {
  const R = seed.length, C = colT.length;
  const rowSum = rowT.reduce((a, b) => a + b, 0), colSum = colT.reduce((a, b) => a + b, 0);
  const ct = colSum > 0 ? colT.map(v => v * rowSum / colSum) : colT.map(() => rowSum / C);
  const m = seed.map(r => r.slice());
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < R; i++) { const s = m[i].reduce((a, b) => a + b, 0); const f = s > 0 ? rowT[i] / s : 0; for (let j = 0; j < C; j++) m[i][j] *= f; }
    let err = 0;
    for (let j = 0; j < C; j++) { let s = 0; for (let i = 0; i < R; i++) s += m[i][j]; const f = s > 0 ? ct[j] / s : 0; if (s > 0) err = Math.max(err, Math.abs(s - ct[j]) / Math.max(1, ct[j])); for (let i = 0; i < R; i++) m[i][j] *= f; }
    if (err < tol) break;
  }
  // Finish on the rows so company totals are exact (regions are then within tol).
  for (let i = 0; i < R; i++) { const s = m[i].reduce((a, b) => a + b, 0); const f = s > 0 ? rowT[i] / s : 0; for (let j = 0; j < C; j++) m[i][j] *= f; }
  return m;
}

// ---- pools: Apollo MD / MD-1 / MD-2 by company and region ----
// icpPool rows: { company, country, md, md1, md2, est? } (already expanded with derived and Claude rows).
export function poolsByRegion(icpPool, regions) {
  const out = {};
  for (const p of icpPool || []) {
    const r = mapRegion(p.country, regions); if (!POOL_REG.includes(r)) continue;
    const k = p.company + '|' + r; const o = out[k] || (out[k] = { MD: 0, 'MD-1': 0, 'MD-2': 0, est: false, countries: [] });
    o.MD += n(p.md); o['MD-1'] += n(p.md1); o['MD-2'] += n(p.md2); if (p.est) o.est = true; if (!o.countries.includes(p.country)) o.countries.push(p.country);
  }
  return out;
}

const seg = (rows, s) => (rows || []).filter(r => norm(r.segment) === norm(s));
const isLeadGen = obj => /lead/i.test(String(obj || ''));

/**
 * Build the whole model from performance rows (ca_li_perf, LinkedIn) and demographics windows ({upload, rows}).
 * opts: { accounts, icpPool (expanded), regions, matchAccount, divisor = 3, recentMonths = 2, mix }
 */
export function buildModel({ perf = [], windows = [], accounts = [], icpPool = [], regions = {}, matchAccount, divisor = 3, recentMonths = 2, mix = null, smoothing = 1e-4, residual = 'peer' } = {}) {
  const match = matchAccount || ((v) => v);
  const pools = poolsByRegion(icpPool, regions);
  const D = divisor > 0 ? divisor : 3;

  // 1. monthly performance
  const monthly = new Map();
  const mrow = k => monthly.get(k) || (monthly.set(k, { m: k, spend: 0, imp: 0, clk: 0, leads: 0, lfo: 0, sends: 0, opens: 0, lgspend: 0, vv: 0, days: new Set(), reg: {}, regimp: {}, reg_estimated: false }), monthly.get(k));
  const adsets = new Map(); const msg = { spend: 0, sends: 0, opens: 0, leads: 0, imp: 0 };
  let lastDay = '';
  for (const r of perf) {
    if (!r.day) continue; const k = r.day.slice(0, 7); const o = mrow(k);
    o.spend += n(r.spend); o.imp += n(r.impressions); o.clk += n(r.clicks); o.leads += n(r.leads); o.lfo += n(r.lead_forms_opened); o.sends += n(r.sends); o.opens += n(r.opens); o.vv += n(r.video_views); o.days.add(r.day);
    if (isLeadGen(r.objective)) o.lgspend += n(r.spend);
    if (r.day > lastDay) lastDay = r.day;
    const name = r.campaign || r.campaign_id || '(no ad set)';
    const a = adsets.get(name) || (adsets.set(name, { name, group: r.campaign_group || '', obj: r.objective || '', format: r.format || '', spend: 0, imp: 0, clk: 0, leads: 0, lfo: 0, vv: 0, sends: 0, opens: 0, months: new Set(), byMonth: {}, first: r.day, last: r.day }), adsets.get(name));
    for (const [f, src] of [['spend', 'spend'], ['imp', 'impressions'], ['clk', 'clicks'], ['leads', 'leads'], ['lfo', 'lead_forms_opened'], ['vv', 'video_views'], ['sends', 'sends'], ['opens', 'opens']]) { a[f] += n(r[src]); const bm = a.byMonth[k] || (a.byMonth[k] = { spend: 0, imp: 0, clk: 0, leads: 0, lfo: 0, vv: 0, sends: 0, opens: 0 }); bm[f] += n(r[src]); }
    if (n(r.spend) > 0 || n(r.impressions) > 0 || n(r.sends) > 0) a.months.add(k);
    if (r.day < a.first) a.first = r.day; if (r.day > a.last) a.last = r.day;
    if (!a.obj && r.objective) a.obj = r.objective;
    if (n(r.sends) > 0 || /conversation|message/i.test(r.format || '') || /conversation|message/i.test(r.objective || '')) { msg.spend += n(r.spend); msg.sends += n(r.sends); msg.opens += n(r.opens); msg.leads += n(r.leads); msg.imp += n(r.impressions); }
  }

  // 2. demographics windows -> cells (company|region|band|month), region totals, band shares
  const CELL = new Map(); const add = (k, v) => CELL.set(k, (CELL.get(k) || 0) + v);
  const compImp = new Map(); const compEng = {};
  const regByMonth = {}; const bshare = {}; const notes = { countryEstimated: [], bandEstimated: [], windows: [] };
  // Peer seed: average normalised Apollo region mix over firms with a pool.
  const firms = [...new Set(Object.keys(pools).map(k => k.split('|')[0]))];
  const peer = REG.map(() => 0); let peerN = 0;
  for (const f of firms) { const v = REG.map(r => { const p = pools[f + '|' + r]; return p ? p.MD + p['MD-1'] + p['MD-2'] : 0; }); const s = v.reduce((a, b) => a + b, 0); if (s > 0) { v.forEach((x, i) => { peer[i] += x / s; }); peerN++; } }
  const peerSeed = peerN ? peer.map(v => v / peerN) : REG.map(() => 1 / REG.length);
  const smooth = v => { const s = v.reduce((a, b) => a + b, 0) || 1; return v.map(x => x / s + smoothing); };

  for (const w of windows || []) {
    const rows = w.rows || []; const up = w.upload || {};
    const k = String(up.period_start || '').slice(0, 7); if (!k) continue;
    const comp = seg(rows, 'Company').filter(r => n(r.impressions) > 0);
    // region margins from the Country table (or the default mix, flagged)
    const regT = REG.map(() => 0);
    const ctry = seg(rows, 'Country');
    if (ctry.length) for (const r of ctry) regT[REG.indexOf(mapRegion(r.value, regions))] += n(r.impressions);
    else { const cs = (mix && mix.country_share) || DEFAULT_COUNTRY_MIX; for (const [c, v] of Object.entries(cs)) regT[REG.indexOf(mapRegion(c, regions))] += v; if (comp.length) notes.countryEstimated.push(k); }
    const rm = regByMonth[k] || (regByMonth[k] = { imp: REG.map(() => 0), estimated: false });
    if (ctry.length) REG.forEach((r, i) => { rm.imp[i] += regT[i]; }); else if (comp.length) { rm.estimated = true; const tot = comp.reduce((a, r) => a + n(r.impressions), 0), s = regT.reduce((a, b) => a + b, 0) || 1; REG.forEach((r, i) => { rm.imp[i] += tot * regT[i] / s; }); }
    // band shares from Job Seniority (else Job Title buckets, else the default mix)
    const sen = seg(rows, 'Job Seniority'); const bs = { MD: 0, 'MD-1': 0, 'MD-2': 0, 'Sr IC': 0, Junior: 0 };
    if (sen.length) { let t = 0; for (const r of sen) { const b = seniorityBand(r.value); bs[b] += n(r.impressions); t += n(r.impressions); } for (const b of ALLB) bs[b] = t ? bs[b] / t : 0; }
    else { const m = (mix && mix.band_share) || { MD: 0.1127, 'MD-1': 0.1593, 'MD-2': 0.3912, Other: 0.3368 }; bs.MD = m.MD || 0; bs['MD-1'] = m['MD-1'] || 0; bs['MD-2'] = m['MD-2'] || 0; bs.Junior = m.Other || 0; if (comp.length) notes.bandEstimated.push(k); }
    // A month with two windows keeps an impression-weighted mix.
    const compTot = comp.reduce((a, r) => a + n(r.impressions), 0);
    if (!bshare[k]) bshare[k] = { _w: 0 }; const B = bshare[k];
    for (const b of ALLB) B[b] = ((B[b] || 0) * B._w + bs[b] * compTot) / ((B._w + compTot) || 1); B._w += compTot;
    notes.windows.push({ month: k, from: up.period_start, to: up.period_end, companies: comp.length, country: ctry.length > 0, seniority: sen.length > 0 });
    if (!comp.length) continue;
    // seed rows: pinned, own Apollo mix, or peer average
    const seedRows = comp.map(r => {
      const pin = pinnedRegion(r.value); if (pin) return REG.map(x => x === pin ? 1 : 0);
      const acc = match(r.value);
      const own = acc ? REG.map(x => { const p = pools[acc + '|' + x]; return p ? p.MD + p['MD-1'] + p['MD-2'] : 0; }) : null;
      return smooth(own && own.some(v => v > 0) ? own : peerSeed);
    });
    // Residual row: the country table covers every company, the company table only the top pages, so the
    // difference is fitted as "other companies" and the named firms are matched against the real region totals.
    const rowT = comp.map(r => n(r.impressions)); const gapImp = regT.reduce((a, b) => a + b, 0) - rowT.reduce((a, b) => a + b, 0);
    const useResidual = residual !== 'none' && ctry.length && gapImp > 0;
    if (useResidual) { seedRows.push(residual === 'margin' ? regT.map(v => v || 1e-9) : smooth(peerSeed)); rowT.push(gapImp); }
    const fit = ipf(seedRows, rowT, regT);
    comp.forEach((r, i) => {
      const acc = match(r.value); if (!acc) return;
      compImp.set(acc, (compImp.get(acc) || 0) + n(r.impressions));
      const e = compEng[acc] || (compEng[acc] = { imp: 0, clk: 0, byMonth: {} }); e.imp += n(r.impressions); e.clk += n(r.clicks); const em = e.byMonth[k] || (e.byMonth[k] = { imp: 0, clk: 0 }); em.imp += n(r.impressions); em.clk += n(r.clicks);
      REG.forEach((reg, j) => { const v = fit[i][j]; if (!(v > 0)) return; for (const b of ALLB) add(acc + '|' + reg + '|' + b + '|' + k, v * bs[b]); });
    });
  }
  for (const k of Object.keys(bshare)) delete bshare[k]._w;

  const demoMonths = Object.keys(regByMonth).sort();
  const perfMonths = [...monthly.keys()].sort();
  const months = [...new Set([...perfMonths, ...demoMonths])].sort();
  const withYear = months.length && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const recent = (demoMonths.length ? demoMonths : months).slice(-Math.max(1, recentMonths));
  const monthlyRows = months.map(k => {
    const o = monthly.get(k) || mrow(k); const rm = regByMonth[k]; const tot = rm ? rm.imp.reduce((a, b) => a + b, 0) : 0;
    o.label = monthShort(k, withYear); o.days = o.days.size || 0;
    REG.forEach((r, i) => { o.regimp[r] = rm ? rm.imp[i] : 0; o.reg[r] = tot ? rm.imp[i] / tot : 0; });
    o.reg_estimated = !!(rm && rm.estimated); o.has_demo = !!rm;
    return o;
  });
  const regTotals = { all: Object.fromEntries(REG.map(r => [r, 0])), recent: Object.fromEntries(REG.map(r => [r, 0])) };
  for (const k of demoMonths) REG.forEach((r, i) => { regTotals.all[r] += regByMonth[k].imp[i]; if (recent.includes(k)) regTotals.recent[r] += regByMonth[k].imp[i]; });
  const tot = { spend: 0, imp: 0, clk: 0, leads: 0, lfo: 0, lgspend: 0, sends: 0, opens: 0, vv: 0 };
  for (const o of monthlyRows) for (const f of Object.keys(tot)) tot[f] += o[f] || 0;
  const companies = [...compImp.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const lastMonth = perfMonths[perfMonths.length - 1] || null;
  const sets = [...adsets.values()].map(a => ({ ...a, months: [...a.months].sort(), geo: geoOfName(a.name + ' ' + a.group) }));

  const model = { divisor: D, months, demoMonths, recent, lastDay, lastMonth, monthly: monthlyRows, tot, adsets: sets, msg, CELL, companies, compEng, pools, regTotals, bshare, notes };
  return model;
}

// Default country mix when a window has no Country table (Apr to Aug 2026 programme mix, Admin › Reach pools).
const DEFAULT_COUNTRY_MIX = { 'India': 0.4838, 'United States': 0.3067, 'United Kingdom': 0.0207, 'Saudi Arabia': 0.0185, 'United Arab Emirates': 0.0156, 'Australia': 0.0141, 'Japan': 0.0097, 'Singapore': 0.0034, 'Germany': 0.0033, 'Italy': 0.0065, 'Spain': 0.0057 };

// ---- the report's accessors ----
export const bandsOf = b => b === 'ICP' ? ICPB : b === 'ALL' ? ALLB : [b];
export function imp(M, c, r, bands, months) { let s = 0; for (const b of bands) for (const m of months) s += M.CELL.get(c + '|' + r + '|' + b + '|' + m) || 0; return s; }
export const people = (M, c, r, bands, months) => imp(M, c, r, bands, months) / M.divisor;
export function pool(M, c, r, bands) { const p = M.pools[c + '|' + r]; if (!p) return null; let s = 0; for (const b of bands) { if (p[b] == null) return null; s += p[b]; } return s || null; }
export const poolEst = (M, c, r) => !!(M.pools[c + '|' + r] && M.pools[c + '|' + r].est);

/** Heat-map cell exactly as the report: people, or penetration (Sr IC and Everyone fall back to MD to MD-2). */
export function cellVal(M, c, r, { band = 'ICP', metric = 'people', months }) {
  const bands = bandsOf(band), ms = months || M.months; const p = people(M, c, r, bands, ms);
  if (metric === 'people') return { v: p, p };
  if (band === 'Sr IC' || band === 'ALL') { const pb = people(M, c, r, ICPB, ms), po = pool(M, c, r, ICPB); if (po == null) return { v: null, p }; return { v: pb / po, p, po }; }
  const po = pool(M, c, r, bands); if (po == null) return { v: null, p }; return { v: p / po, p, po };
}

/** The detail panel's read of one cell (the report's hint rules). */
export function cellDetail(M, c, r, { band = 'ICP', months, home = 'India' } = {}) {
  const ms = months || M.months;
  const rows = ['MD', 'MD-1', 'MD-2', 'Sr IC'].map(b => { const p = people(M, c, r, [b], ms), po = b === 'Sr IC' ? null : pool(M, c, r, [b]); return { b, p, po, pen: po ? p / po : null }; });
  const icp = people(M, c, r, ICPB, ms), icpPool = pool(M, c, r, ICPB);
  const monthly = M.months.map(m => ({ m, label: monthShort(m), v: people(M, c, r, bandsOf(band), [m]) }));
  const recentICP = people(M, c, r, ICPB, M.recent);
  let hint, tone;
  if (icpPool) {
    const pen = icp / icpPool;
    if (r === home && pen >= 1) { hint = `Saturated. Hold ${home} spend here; new impressions are repeats.`; tone = 'warn'; }
    else if (r !== home && recentICP / icpPool < 0.15) { hint = `Cold: only ${fmtN(recentICP)} of ${fmtN(icpPool)} MD to MD-2 reached in the recent months. Add to the non-${home} reach list.`; tone = 'bad'; }
    else if (r !== home) { hint = 'Warm enough to retarget: include in the retargeting and lead-gen audiences.'; tone = 'ok'; }
    else { hint = `Partly reached. ${home} is not the priority this cycle.`; tone = 'mute'; }
  } else { hint = 'No Apollo headcount for this firm and region, so penetration cannot be computed.'; tone = 'mute'; }
  return { rows, icp, icpPool, pen: icpPool ? icp / icpPool : null, monthly, recentICP, hint, tone, est: poolEst(M, c, r) };
}

// ---- headline numbers ----
export function kpis(M, { home = 'India' } = {}) {
  const T = M.tot, byM = Object.fromEntries(M.monthly.map(r => [r.m, r]));
  const rec = M.recent.filter(k => byM[k]), pre = M.months.filter(k => !M.recent.includes(k) && byM[k]);
  const sumF = (ks, f) => ks.reduce((s, k) => s + (byM[k][f] || 0), 0);
  const so = { spend: sumF(rec, 'lgspend'), leads: sumF(rec, 'leads') }, preSO = { spend: sumF(pre, 'lgspend'), leads: sumF(pre, 'leads') };
  const regAll = M.regTotals.all, all = Object.values(regAll).reduce((a, b) => a + b, 0);
  const share = r => all ? regAll[r] / all : null;
  // Non-home regional sets in the latest month: ad sets whose name fixes a geography outside the home region.
  const nonHome = M.adsets.filter(a => a.geo.fixed && !a.geo.regions.includes(home) && M.lastMonth && a.byMonth[M.lastMonth]);
  const ni = nonHome.reduce((o, a) => { const b = a.byMonth[M.lastMonth]; o.spend += b.spend; o.leads += b.leads; o.imp += b.imp; return o; }, { spend: 0, leads: 0, imp: 0 });
  const niLeadRegions = [...new Set(nonHome.filter(a => a.byMonth[M.lastMonth].leads > 0).flatMap(a => a.geo.regions))];
  return {
    spend: T.spend, imp: T.imp, people: T.imp / M.divisor, leads: T.leads, lfo: T.lfo, completion: T.lfo ? T.leads / T.lfo : null,
    cplRecent: so.leads ? so.spend / so.leads : null, cplBefore: preSO.leads ? preSO.spend / preSO.leads : null, recentSpend: so.spend, recentLeads: so.leads,
    homeShare: share(home), usShare: share('US'), ukShare: share('UK'),
    nonHome: { sets: nonHome.map(a => a.name), spend: ni.spend, leads: ni.leads, imp: ni.imp, cpl: ni.spend / Math.max(ni.leads, 1), leadRegions: niLeadRegions },
  };
}

// ---- what worked and what did not (rules; Claude adds the "why") ----
const med = arr => { const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export function workedSplit(M, { limit = 8 } = {}) {
  const sets = M.adsets.filter(a => a.spend > 0);
  const lead = sets.filter(a => isLeadGen(a.obj) || a.leads > 0 || a.sends > 0), aw = sets.filter(a => !lead.includes(a) && a.imp >= 1000);
  const medCpl = med(lead.filter(a => a.leads > 0).map(a => a.spend / a.leads));
  const medCpm = med(aw.map(a => 1000 * a.spend / a.imp));
  const good = [], bad = [];
  for (const a of lead) {
    const cpl = a.leads ? a.spend / a.leads : null; const comp = a.lfo ? a.leads / a.lfo : null;
    const base = { name: a.name, mode: 'lg', spend: a.spend, leads: a.leads, cpl, imp: a.imp, lfo: a.lfo, months: a.months };
    if (cpl != null && medCpl != null && cpl <= medCpl && a.leads >= 2) good.push({ ...base, why: `${a.leads} leads at ${usdS(cpl)} CPL, at or under the ${usdS(medCpl)} median${comp != null ? `; ${pctS(comp)} of form openers submit` : ''}.`, score: a.leads / cpl });
    else if (!a.leads && a.spend >= Math.max(100, (medCpl || 50) * 2)) bad.push({ ...base, why: `${usdS(a.spend)} spent for 0 leads${a.lfo ? `; ${a.lfo} people opened the form` : ''}${a.imp ? `, CPM ${usdS(1000 * a.spend / a.imp)}` : ''}.`, score: a.spend });
    else if (cpl != null && medCpl != null && cpl >= 2 * medCpl) bad.push({ ...base, why: `${usdS(cpl)} CPL, more than twice the ${usdS(medCpl)} median.`, score: a.spend });
  }
  for (const a of aw) {
    const cpm = 1000 * a.spend / a.imp; const base = { name: a.name, mode: 'aw', spend: a.spend, imp: a.imp, cpm, vv: a.vv, ctr: a.imp ? a.clk / a.imp : null, months: a.months };
    if (medCpm != null && cpm <= medCpm) good.push({ ...base, why: `${usdS(cpm)} CPM against a ${usdS(medCpm)} median${a.vv ? `; ${fmtN(a.vv)} video views` : ''}.`, score: a.imp / a.spend });
    else if (medCpm != null && cpm >= 2 * medCpm) bad.push({ ...base, why: `${usdS(cpm)} CPM, more than twice the ${usdS(medCpm)} median: the audience is too small to buy reach.`, score: a.spend });
  }
  good.sort((a, b) => b.score - a.score); bad.sort((a, b) => b.score - a.score);
  return { good: good.slice(0, limit), bad: bad.slice(0, limit), medCpl, medCpm };
}

// ---- non-home gap: the accounts to load into top-of-funnel ----
export function gaps(M, { regions = ['US', 'UK', 'Middle East'], limit = 15, companies } = {}) {
  const list = [];
  const comps = companies || allPoolCompanies(M);
  for (const c of comps) for (const r of regions) {
    const po = pool(M, c, r, ICPB); if (!po) continue;
    const rec = people(M, c, r, ICPB, M.recent), all = people(M, c, r, ICPB, M.months);
    const w = rec / po; list.push({ c, r, po, rec, all, gap: Math.max(po - rec, 0), warm: w, status: w < 0.05 ? 'Cold' : w < 0.25 ? 'Thin' : 'Warm', est: poolEst(M, c, r) });
  }
  list.sort((a, b) => b.gap - a.gap);
  return limit ? list.slice(0, limit) : list;
}
export const allPoolCompanies = M => [...new Set([...M.companies, ...Object.keys(M.pools).map(k => k.split('|')[0])])];

// ---- anti heat map: accounts and regions with headcount the ads have not reached ----
// priority = gap × (1 − coverage), so a big pool nobody has seen ranks first and a warm one drops out.
export function antiHeat(M, { regions = POOL_REG, band = 'ICP', basis = 'recent', tierOf, tierFilter = 'all', search = '' } = {}) {
  const bands = band === 'ALL' || band === 'Sr IC' ? ICPB : bandsOf(band); const ms = basis === 'recent' ? M.recent : M.months;
  const q = norm(search);
  const rows = [];
  for (const c of allPoolCompanies(M)) {
    if (q && !norm(c).includes(q)) continue;
    const tier = tierOf ? tierOf(c) : null;
    if (tierFilter !== 'all' && tier && !(tierFilter === tier || tierFilter === TIER_GROUP_OF[tier])) continue;
    const cells = {}; let tgap = 0, tpool = 0, treach = 0, tpri = 0, everAll = 0;
    for (const r of regions) {
      const po = pool(M, c, r, bands); const reached = people(M, c, r, bands, ms), ever = people(M, c, r, bands, M.months); everAll += ever;
      if (!po) { cells[r] = { po: null, reached, ever }; continue; }
      const cov = reached / po, gap = Math.max(po - reached, 0), pri = gap * (1 - Math.min(cov, 1));
      cells[r] = { po, reached, ever, cov, gap, pri, status: cov < 0.05 ? 'Cold' : cov < 0.25 ? 'Thin' : 'Warm', est: poolEst(M, c, r) };
      tgap += gap; tpool += po; treach += reached; tpri += pri;
    }
    if (!tpool) continue;
    rows.push({ c, tier, cells, gap: tgap, pool: tpool, reached: treach, cov: treach / tpool, pri: tpri, never: everAll === 0 });
  }
  rows.sort((a, b) => b.pri - a.pri);
  const maxPri = Math.max(1, ...rows.flatMap(r => Object.values(r.cells).map(x => x.pri || 0)));
  return { rows, maxPri, regions, months: ms };
}
const TIER_GROUP_OF = { GSI: 'Tier 1', 'Big Four': 'Tier 1', MBB: 'Tier 1', SI: 'Tier 2', Other: 'Tier 2' };

// ---- the spend plan ----
// rows: [{ key, obj, name, tgt, bench, share, cplLo?, cplHi?, cpmLo?, cpmHi? }]; share = part of the budget.
export function planNumbers(rows, { budget = 600, days = 5, divisor = 3 } = {}) {
  let tot = 0, lLo = 0, lHi = 0, iLo = 0, iHi = 0, lgSpend = 0;
  const shareSum = rows.reduce((a, r) => a + (n(r.share) || 0), 0) || 1;
  const out = rows.map(p => {
    const daily = Math.max(1, Math.round(budget * (n(p.share) / shareSum) / days)); const s = daily * days; tot += s;
    if (p.cplLo && p.cplHi) { const lo = s / p.cplHi, hi = s / p.cplLo; lLo += lo; lHi += hi; lgSpend += s; return { ...p, daily, spend: s, leadsLo: lo, leadsHi: hi }; }
    const lo = p.cpmHi ? 1000 * s / p.cpmHi : 0, hi = p.cpmLo ? 1000 * s / p.cpmLo : 0; iLo += lo; iHi += hi; return { ...p, daily, spend: s, impLo: lo, impHi: hi, peopleLo: lo / divisor, peopleHi: hi / divisor };
  });
  const mid = (lLo + lHi) / 2;
  return { rows: out, tot, days, daily: tot / days, leadsLo: lLo, leadsHi: lHi, leadsMid: mid, lgSpend, impLo: iLo, impHi: iHi, peopleLo: iLo / divisor, peopleHi: iHi / divisor,
    lgCplLo: lHi ? lgSpend / lHi : null, lgCplHi: lLo ? lgSpend / lLo : null, allCplLo: lHi ? tot / lHi : null, allCplHi: lLo ? tot / lLo : null,
    demosLo: Math.max(1, Math.round(mid * 0.12)), demosHi: Math.round(mid * 0.25) };
}

/** A starting plan from the account's own results when Claude has not written one: half leads, half reach, outside the home region. */
export function rulePlan(M, { home = 'India' } = {}) {
  const sets = M.adsets.filter(a => a.spend > 0);
  const recentSets = sets.filter(a => a.months.some(m => M.recent.includes(m)));
  const pick = recentSets.length ? recentSets : sets;
  const lead = pick.filter(a => a.leads > 0).map(a => ({ a, cpl: a.spend / a.leads })).sort((x, y) => x.cpl - y.cpl);
  const aw = pick.filter(a => !a.leads && a.imp > 1000).map(a => ({ a, cpm: 1000 * a.spend / a.imp })).sort((x, y) => x.cpm - y.cpm);
  const nonHome = x => !x.a.geo.regions.includes(home);
  const retarget = lead.find(x => /retarget/i.test(x.a.name));
  const best = lead.find(x => nonHome(x) && x !== retarget) || lead[0];
  const reach = aw.filter(nonHome).slice(0, 3); if (!reach.length) reach.push(...aw.slice(0, 2));
  const rows = [];
  const rng = v => [Math.round(v * 0.85), Math.round(v * 1.4)];
  if (best) { const [lo, hi] = rng(best.cpl); rows.push({ key: 'L1', obj: 'Lead gen', name: `Duplicate “${best.a.name}” outside ${home}`, tgt: `Same form and creative; one ad set across the non-${home} regions so LinkedIn optimises freely. Exclude ${home} and existing leads.`, bench: `${best.a.name}: ${usdS(best.cpl)} CPL`, share: 0.34, cplLo: lo, cplHi: hi }); }
  if (retarget) { const [lo, hi] = rng(retarget.cpl); rows.push({ key: 'L2', obj: 'Lead gen', name: 'Warm retargeting outside ' + home, tgt: 'Lead-form openers who did not submit, video viewers 50%+, company-page and website visitors. Exclude existing leads.', bench: `${retarget.a.name}: ${usdS(retarget.cpl)} CPL`, share: 0.16, cplLo: lo, cplHi: hi }); }
  reach.forEach((x, i) => { const [lo, hi] = rng(x.cpm); rows.push({ key: 'T' + (i + 1), obj: /video/i.test(x.a.name + x.a.format) ? 'Video views' : 'Brand awareness', name: `Reach like “${x.a.name}”`, tgt: 'Target-account list from the anti heat map below, Manager to CXO, outside ' + home + '.', bench: `${x.a.name}: ${usdS(x.cpm)} CPM`, share: 0.5 / reach.length, cpmLo: lo, cpmHi: hi }); });
  return rows;
}

const fmtN = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-US');
const usdS = v => v == null || !isFinite(v) ? '–' : '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v < 10 ? 1 : 0));
const pctS = v => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
export const F = { fmtN, usdS, pctS };

/** Compact input for the Claude plan (numbers only, trimmed). */
export function aiInput(M, { home = 'India', budget, days, gapsList, antiRows, worked, k, screens, actionLog } = {}) {
  const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
  return {
    period: { from: M.months[0], to: M.lastDay, recent_months: M.recent, home_region: home, people_per_impression: `1 person = ${M.divisor} impressions` },
    totals: { ...Object.fromEntries(Object.entries(M.tot).map(([a, b]) => [a, r2(b)])) },
    kpis: k ? { cpl_recent: r2(k.cplRecent), cpl_before: r2(k.cplBefore), home_share: r2(k.homeShare), us_share: r2(k.usShare), uk_share: r2(k.ukShare), non_home_sets_latest_month: { ...k.nonHome, cpl: r2(k.nonHome.cpl) } } : null,
    monthly: M.monthly.map(o => ({ month: o.m, spend: r2(o.spend), lead_gen_spend: r2(o.lgspend), impressions: o.imp, clicks: o.clk, leads: o.leads, form_opens: o.lfo, sends: o.sends, opens: o.opens, video_views: o.vv, region_share: Object.fromEntries(REG.map(r => [r, r2(o.reg[r])])) })),
    region_impressions: { all: M.regTotals.all, recent: M.regTotals.recent },
    ad_sets: [...M.adsets].sort((a, b) => b.spend - a.spend).slice(0, 60).map(a => ({ name: a.name, group: a.group, objective: a.obj, months: a.months, geo: a.geo.regions, spend: r2(a.spend), impressions: a.imp, clicks: a.clk, leads: a.leads, form_opens: a.lfo, video_views: a.vv, sends: a.sends, opens: a.opens, cpl: a.leads ? r2(a.spend / a.leads) : null, cpm: a.imp ? r2(1000 * a.spend / a.imp) : null, latest_month: M.lastMonth && a.byMonth[M.lastMonth] ? Object.fromEntries(Object.entries(a.byMonth[M.lastMonth]).map(([x, y]) => [x, r2(y)])) : null })),
    message_ads: { ...M.msg },
    rule_worked: worked ? { worked: worked.good.map(x => x.name), did_not: worked.bad.map(x => x.name), median_cpl: r2(worked.medCpl), median_cpm: r2(worked.medCpm) } : null,
    non_home_gaps: (gapsList || []).slice(0, 25).map(g => ({ company: g.c, region: g.r, md_to_md2_headcount: Math.round(g.po), reached_all: Math.round(g.all), reached_recent: Math.round(g.rec), warm: g.status, gap: Math.round(g.gap) })),
    anti_heat_map: (antiRows || []).slice(0, 25).map(a => ({ company: a.c, tier: a.tier, headcount: Math.round(a.pool), reached_recent: Math.round(a.reached), gap: Math.round(a.gap), never_reached: a.never, regions: Object.fromEntries(Object.entries(a.cells).filter(([, x]) => x.po).map(([r, x]) => [r, { gap: Math.round(x.gap), status: x.status }])) })),
    budget: { amount: budget, days },
    screenshots: (screens || []).slice(0, 10),
    action_log: actionLog || [],
  };
}
