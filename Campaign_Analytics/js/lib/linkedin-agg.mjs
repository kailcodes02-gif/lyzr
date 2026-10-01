// Pure aggregation for the LinkedIn ads channel. No DOM, no globals, unit-tested in node.
// Inputs are the normalised rows produced by js/csv.mjs (perf rows keyed by day, demo rows by segment/value).

export const METRICS = ['spend', 'impressions', 'reach', 'clicks', 'leads', 'lead_forms_opened', 'sends', 'opens', 'video_views', 'engagements', 'conversions'];
const n = v => Number(v) || 0;
export const sum = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);
export const div = (a, b) => b ? a / b : null;

export function totals(rows) {
  const t = {}; for (const k of METRICS) t[k] = 0;
  for (const r of rows) for (const k of METRICS) t[k] += n(r[k]);
  t.ctr = div(t.clicks, t.impressions) == null ? null : t.clicks / t.impressions * 100;
  t.cpl = div(t.spend, t.leads);
  t.completion = t.lead_forms_opened ? t.leads / t.lead_forms_opened * 100 : null;
  t.open_rate = t.sends ? t.opens / t.sends * 100 : null;
  t.cpm = t.impressions ? t.spend / t.impressions * 1000 : null;
  return t;
}
export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

// ---- time buckets ----
export const monthKey = iso => iso.slice(0, 7);
export const weekKey = iso => { const d = new Date(iso + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }; // Monday
export const bucketKey = (iso, gran) => gran === 'month' ? monthKey(iso) : gran === 'week' ? weekKey(iso) : iso;
export function trend(rows, gran = 'day') {
  const g = groupBy(rows.filter(r => r.day), r => bucketKey(r.day, gran));
  return [...g.keys()].sort().map(key => ({ key, days: new Set(g.get(key).map(r => r.day)).size, ...totals(g.get(key)) }));
}
export const growth = (cur, prev) => (prev == null || !prev) ? null : (cur - prev) / prev * 100;
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
export const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
export const previousRange = (from, to) => { const len = daysBetween(from, to); return { from: addDays(from, -len), to: addDays(from, -1) }; };
export const overlaps = (aFrom, aTo, bFrom, bTo) => aFrom <= bTo && bFrom <= aTo;

// ---- funnel stages ----
export const DEFAULT_STAGES = {
  BoFu: ['conversation', 'book a demo', 'book-a-demo', 'bookademo', 'demo', 'retarget', 'message ad', 'inmail', 'conversion'],
  MoFu: ['playbook', 'lead gen', 'leadgen', 'lead generation', 'workshop', 'webinar', 'whitepaper', 'ebook', 'assessment', 'document'],
  ToFu: ['awareness', 'amplification', 'website visit', 'website visits', 'brand', 'engagement', 'video', 'traffic', 'persona', 'post'],
};
export const STAGE_ORDER = ['ToFu', 'MoFu', 'BoFu', 'Other'];

// ---- lead types (Kailash's bifurcation, 2026-10-01) ----
// A lead-form submission is one of: MQL (someone trying to book a demo, bottom of the funnel),
// Conversation ad lead (bottom), Playbook lead (middle) or Other form lead / NQL (everything
// else: branding, "marketers both", persona posts; top of the funnel). Decided from the ad set
// name, the program name and the ad format. Keywords are editable in Admin (lead_rules).
export const LEAD_TYPES = ['mql', 'conversation', 'playbook', 'other'];
export const LEAD_LABELS = { mql: 'MQL (book a demo)', conversation: 'Conversation ad leads', playbook: 'Playbook leads', other: 'Other form leads (NQL)' };
export const LEAD_STAGE = { mql: 'BoFu', conversation: 'BoFu', playbook: 'MoFu', other: 'ToFu' };
export const DEFAULT_LEAD_RULES = {
  conversation: ['conversation', 'message ad', 'sponsored messaging', 'inmail', 'conversation ad'],
  mql: ['book a demo', 'book-a-demo', 'bookademo', 'book demo', 'demo', 'meeting', 'consultation'],
  playbook: ['playbook', 'roadmap', 'guide', 'ebook', 'e-book', 'whitepaper', 'report', 'workshop', 'webinar'],
};
const hasKw = (text, kws) => { const t = String(text || '').toLowerCase(); return !!t && (kws || []).some(k => k && t.includes(String(k).toLowerCase())); };
export function leadTypeOf(row, rules = DEFAULT_LEAD_RULES) {
  const R = { ...DEFAULT_LEAD_RULES, ...(rules || {}) };
  const names = [row.campaign, row.campaign_group, row.ad_name];
  // Conversation ads first: the format says it, or the ad set carries sends, or the name does.
  if (hasKw(row.format, R.conversation) || hasKw(row.objective, ['conversation']) || n(row.sends) > 0 || names.some(x => hasKw(x, R.conversation))) return 'conversation';
  if (names.slice(0, 2).some(x => hasKw(x, R.mql))) return 'mql';
  if (names.some(x => hasKw(x, R.playbook))) return 'playbook';
  return 'other';
}
/** Leads, spend and campaigns per lead type for a set of daily rows. */
export function leadSplit(rows, rules) {
  const out = {}; for (const t of LEAD_TYPES) out[t] = { type: t, label: LEAD_LABELS[t], stage: LEAD_STAGE[t], leads: 0, spend: 0, impressions: 0, clicks: 0, campaigns: new Map() };
  let total = 0;
  for (const r of rows) {
    const t = leadTypeOf(r, rules), o = out[t], L = n(r.leads);
    o.leads += L; o.spend += n(r.spend); o.impressions += n(r.impressions); o.clicks += n(r.clicks); total += L;
    const k = r.campaign || r.campaign_id || '(no ad set)'; const c = o.campaigns.get(k) || { name: k, group: r.campaign_group || '', leads: 0, spend: 0 }; c.leads += L; c.spend += n(r.spend); o.campaigns.set(k, c);
  }
  for (const t of LEAD_TYPES) { const o = out[t]; o.cpl = div(o.spend, o.leads); o.share = total ? o.leads / total * 100 : null; o.campaigns = [...o.campaigns.values()].sort((a, b) => b.leads - a.leads || b.spend - a.spend); }
  return { types: LEAD_TYPES.map(t => out[t]), total, byType: out };
}
/** Lead type per time bucket: { buckets:[k], series:{ type:[n...] } }. */
export function leadTrend(rows, gran = 'week', rules) {
  const keys = new Set(), acc = {}; for (const t of LEAD_TYPES) acc[t] = {};
  for (const r of rows) { if (!r.day || !n(r.leads)) continue; const k = bucketKey(r.day, gran), t = leadTypeOf(r, rules); keys.add(k); acc[t][k] = (acc[t][k] || 0) + n(r.leads); }
  const buckets = [...keys].sort();
  return { buckets, series: Object.fromEntries(LEAD_TYPES.map(t => [t, buckets.map(k => acc[t][k] || 0)])) };
}
export function stageOf(row, stages = DEFAULT_STAGES) {
  const s = stages || DEFAULT_STAGES;
  // Program (campaign group) name first, then the ad set name. BoFu keywords win, then ToFu
  // (so "Website visits" and "Awareness" beat the generic "lead gen"), then MoFu.
  for (const text of [row.campaign_group, row.campaign]) {
    const t = String(text || '').toLowerCase(); if (!t) continue;
    for (const st of ['BoFu', 'ToFu', 'MoFu']) if ((s[st] || []).some(k => t.includes(String(k).toLowerCase()))) return st;
  }
  // Nothing matched: "the rest are all at the top of the funnel" (branding), so ToFu, not Other.
  return 'ToFu';
}
export function stageSplit(rows, gran = 'month', stages) {
  const out = {}; for (const st of STAGE_ORDER) out[st] = { spend: {}, leads: {}, impressions: {} };
  const keys = new Set();
  for (const r of rows) { if (!r.day) continue; const st = stageOf(r, stages), k = bucketKey(r.day, gran); keys.add(k); for (const m of ['spend', 'leads', 'impressions']) out[st][m][k] = (out[st][m][k] || 0) + n(r[m]); }
  const buckets = [...keys].sort();
  const totalsByStage = {}; for (const st of STAGE_ORDER) totalsByStage[st] = { spend: Object.values(out[st].spend).reduce((a, b) => a + b, 0), leads: Object.values(out[st].leads).reduce((a, b) => a + b, 0), impressions: Object.values(out[st].impressions).reduce((a, b) => a + b, 0) };
  return { buckets, byStage: out, totals: totalsByStage };
}

// ---- programs, campaigns, verdicts ----
export const monthLabel = k => { const [y, m] = k.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + (y ? " '" + y.slice(2) : ''); };
export function median(arr) { const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
export function verdict(p, medianCpl) {
  const days = p.days_span || 0;
  if (p.leads >= 10 && medianCpl != null && p.cpl != null && p.cpl < medianCpl) return { label: 'High', cls: 'p-high', reason: `${p.leads} leads at $${Math.round(p.cpl)} each, under the $${Math.round(medianCpl)} median. Scale carefully and refresh creative before fatigue.` };
  if (p.spend > 100 && !p.leads) return { label: 'Low', cls: 'p-low', reason: `$${Math.round(p.spend)} spent with no leads. Pause or rework unless its job is reach only.` };
  if (days < 14) return { label: 'Too early', cls: 'p-na', reason: `Only ${days} day${days === 1 ? '' : 's'} of data. Judge after 14 days.` };
  if (p.leads >= 10 && p.cpl != null && medianCpl != null) return { label: 'Medium', cls: 'p-med', reason: `${p.leads} leads but $${Math.round(p.cpl)} per lead is above the $${Math.round(medianCpl)} median. Tighten the audience or the offer.` };
  if (!p.leads) return { label: 'Medium', cls: 'p-med', reason: `No leads on $${Math.round(p.spend)}. Fine if its job is reach; otherwise attach a lead path.` };
  return { label: 'Medium', cls: 'p-med', reason: `${p.leads} lead${p.leads === 1 ? '' : 's'} at $${Math.round(p.cpl)} each. Not enough volume to call it yet.` };
}
function summarise(name, rows) {
  const t = totals(rows);
  const days = [...new Set(rows.filter(r => n(r.spend) > 0 || n(r.impressions) > 0 || n(r.sends) > 0).map(r => r.day))].sort();
  const months = [...new Set(days.map(monthKey))].sort();
  return { name, ...t, days_active: days.length, days_span: days.length ? daysBetween(days[0], days[days.length - 1]) : 0, first_day: days[0] || null, last_day: days[days.length - 1] || null, months, months_label: months.map(monthLabel).join(', ') };
}
export function programs(rows, stages) {
  const byGroup = groupBy(rows, r => r.campaign_group || r.campaign || '(no campaign group)');
  const progs = [...byGroup.entries()].map(([name, rs]) => {
    const p = summarise(name, rs); p.stage = stageOf(rs[0], stages);
    const byC = groupBy(rs, r => r.campaign || '(no ad set)');
    p.campaigns = [...byC.entries()].map(([cn, crs]) => ({ ...summarise(cn, crs), stage: stageOf(crs[0], stages) }));
    p.campaigns.sort((a, b) => b.leads - a.leads || b.spend - a.spend);
    return p;
  });
  const med = median(progs.filter(p => p.leads > 0).map(p => p.cpl));
  const medC = median(progs.flatMap(p => p.campaigns).filter(c => c.leads > 0).map(c => c.cpl));
  for (const p of progs) { p.verdict = verdict(p, med); for (const c of p.campaigns) c.verdict = verdict(c, medC); }
  progs.sort((a, b) => b.leads - a.leads || b.spend - a.spend);
  return { programs: progs, median_cpl: med, median_campaign_cpl: medC };
}
export function ads(rows) {
  const g = groupBy(rows, r => (r.ad_id || '') + '\u0000' + (r.ad_name || ''));
  return [...g.entries()].map(([k, rs]) => { const [ad_id, ad_name] = k.split('\u0000'); return { ad_id, ad_name: ad_name || ad_id || '(unnamed ad)', campaign: rs[0].campaign, campaign_group: rs[0].campaign_group, format: rs[0].format, ...totals(rs) }; })
    .filter(a => a.spend > 0 || a.impressions > 0 || a.sends > 0)
    .sort((a, b) => b.leads - a.leads || (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.spend - a.spend);
}

// ---- demographics helpers ----
const normName = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
const initials = s => String(s || '').replace(/\(.*?\)/g, '').split(/[\s&/]+/).filter(w => w && !/^(and|the|of|in)$/i.test(w)).map(w => w[0]).join('').toLowerCase();
// Map a LinkedIn company page name to a canonical account (accounts = seed/accounts.json). null when not a target.
export function matchAccount(value, accounts) {
  const v = normName(value); if (!v || !Array.isArray(accounts)) return null;
  for (const a of accounts) {
    const names = [a.name, ...(a.aliases || [])];
    for (const nm of names) { const nn = normName(nm); if (nn && nn === v) return a.name; }
    const par = String(a.name).match(/\(([^)]+)\)/); if (par && normName(par[1]) === v) return a.name;
  }
  for (const a of accounts) {
    const names = [a.name, ...(a.aliases || [])];
    if (v.length <= 4 && names.some(nm => initials(nm) === v)) return a.name;
    if (v.length >= 5 && names.some(nm => { const nn = normName(nm); return nn.startsWith(v) || v.startsWith(nn) && nn.length >= 5; })) return a.name;
  }
  return null;
}
export function regionOf(country, regions) {
  const map = regions && regions.regions ? regions.regions : regions;
  if (!map) return 'Other';
  const c = String(country || '').trim().toLowerCase();
  for (const [region, list] of Object.entries(map)) if ((list || []).some(x => String(x).toLowerCase() === c)) return region;
  return 'Other';
}
// Designation band weights for a LinkedIn job title. bands = seed/band_titles.json (global lists), Director splits 50/50.
export const BANDS = ['MD', 'MD-1', 'MD-2', 'Other'];
export function bandWeights(title, bands) {
  const g = (bands && bands.global) ? bands.global : (bands || {});
  const t = String(title || '').toLowerCase().trim();
  const hit = list => (list || []).some(x => t === String(x).toLowerCase() || t.includes(String(x).toLowerCase()));
  if (!t) return { Other: 1 };
  if (/^director$|^director\b(?!.*(senior|associate|assistant|managing))/.test(t) && !hit(g.MD) && !hit(g.MD1)) return { 'MD-1': 0.5, 'MD-2': 0.5 };
  if (hit(g.MD)) return { MD: 1 };
  if (hit(g.MD1)) return { 'MD-1': 1 };
  if (hit(g.MD2)) return { 'MD-2': 1 };
  if (/\bdirector\b/.test(t)) return { 'MD-1': 0.5, 'MD-2': 0.5 };
  return { Other: 1 };
}
export function bandShares(titleRows, bands, metric = 'impressions') {
  const out = { MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0 }; let total = 0;
  for (const r of titleRows) { const w = bandWeights(r.value, bands); const v = n(r[metric]); total += v; for (const [b, f] of Object.entries(w)) out[b] += v * f; }
  const share = {}; for (const b of BANDS) share[b] = total ? out[b] / total : 0;
  return { counts: out, share, total };
}
/** Which demographics segments a set of rows carries, e.g. ['Company'] when only the company export was uploaded. */
export const segmentsPresent = rows => [...new Set((rows || []).map(r => r.segment).filter(Boolean))];
export const segRows = (rows, segment) => rows.filter(r => normName(r.segment) === normName(segment));
export const SEGMENTS = { company: 'Company', seniority: 'Job Seniority', title: 'Job Title', func: 'Job Function', country: 'Country', location: 'Location', size: 'Company Size' };

// Sum a metric across rows for a segment, grouped by a label function.
export function segmentShare(rows, segment, metric, labelFn = r => r.value) {
  const m = new Map(); let total = 0;
  for (const r of segRows(rows, segment)) { const k = labelFn(r); const v = n(r[metric]); total += v; m.set(k, (m.get(k) || 0) + v); }
  return { total, values: m };
}

// ---- penetration: account x country for a band ----
// People reached = account impressions x country share x band share, divided by frequency.
// Penetration = people reached / ICP pool headcount (icp_pool rows: company, country, md, md1, md2).
export function penetration({ windows, accounts, icp_pool, bands, frequency = 3.5, band = 'All', countries }) {
  const poolKey = (c, ct) => normName(c) + '||' + normName(ct);
  const pool = new Map();
  for (const p of icp_pool || []) pool.set(poolKey(p.company, p.country), { MD: n(p.md), 'MD-1': n(p.md1), 'MD-2': n(p.md2) });
  const ctys = countries && countries.length ? countries : [...new Set((icp_pool || []).map(p => p.country))];
  const cell = new Map(); // key -> { imp, reached:{MD,MD-1,MD-2}, pool }
  const accImp = new Map();
  for (const w of windows || []) {
    const rows = w.rows || [];
    const comp = segRows(rows, 'Company');
    const geo = segmentShare(rows, 'Country', 'impressions');
    const bs = bandShares(segRows(rows, 'Job Title'), bands, 'impressions');
    for (const r of comp) {
      const acc = matchAccount(r.value, accounts); if (!acc) continue;
      const imp = n(r.impressions); if (!imp) continue;
      accImp.set(acc, (accImp.get(acc) || 0) + imp);
      for (const ct of ctys) {
        const cs = geo.total ? (geo.values.get(ct) || 0) / geo.total : 0; if (!cs) continue;
        const k = acc + '||' + ct;
        if (!cell.has(k)) cell.set(k, { account: acc, country: ct, imp: 0, reached: { MD: 0, 'MD-1': 0, 'MD-2': 0 }, pool: pool.get(poolKey(acc, ct)) || null });
        const c = cell.get(k); c.imp += imp * cs;
        for (const b of ['MD', 'MD-1', 'MD-2']) c.reached[b] += imp * cs * (bs.share[b] || 0) / (frequency || 3.5);
      }
    }
  }
  // Pool-only cells: a reached account's countries that have a headcount but got no impressions,
  // so unreached regions show as 0% and the company's denominator is its whole pool.
  for (const acc of accImp.keys()) for (const ct of ctys) { const k = acc + '||' + ct, p = pool.get(poolKey(acc, ct)); if (p && !cell.has(k)) cell.set(k, { account: acc, country: ct, imp: 0, reached: { MD: 0, 'MD-1': 0, 'MD-2': 0 }, pool: p }); }
  const cells = [...cell.values()].map(c => {
    const reached = band === 'All' ? c.reached.MD + c.reached['MD-1'] + c.reached['MD-2'] : c.reached[band] || 0;
    const p = c.pool ? (band === 'All' ? c.pool.MD + c.pool['MD-1'] + c.pool['MD-2'] : c.pool[band]) : null;
    return { ...c, reached_band: reached, pool_band: p, pct: p ? reached / p * 100 : null };
  });
  const accountsSorted = [...accImp.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return { cells, accounts: accountsSorted, countries: ctys, frequency, band };
}
/**
 * Cumulative penetration cube: company x region x designation band, every window in range summed.
 * Built on penetration() (company x country cells); countries roll up to regions with regionOf.
 * Returns { accounts:[{ account, category, total:{reached,pool,pct per band + All}, regions:{ [region]: same } }],
 *           regions:[ordered region names], bands:['MD','MD-1','MD-2'] }.
 * Accounts are ordered by estimated people reached (all bands); regions by total reached.
 */
export const PEN_BANDS = ['MD', 'MD-1', 'MD-2'];
export function penetrationCube({ windows, accounts, icp_pool, bands, frequency = 3.5, regions }) {
  // Every country with a pool row plus every country seen in the windows, so reach outside the pool geographies still counts.
  const countries = [...new Set([...(icp_pool || []).map(p => p.country), ...(windows || []).flatMap(w => segRows(w.rows || [], 'Country').map(r => r.value))])].filter(Boolean);
  const P = penetration({ windows, accounts, icp_pool, bands, frequency, band: 'All', countries });
  const blank = () => { const o = {}; for (const b of [...PEN_BANDS, 'All']) o[b] = { reached: 0, pool: 0, pct: null, has_pool: false }; return o; };
  const add = (t, c) => {
    for (const b of PEN_BANDS) { t[b].reached += c.reached[b] || 0; t.All.reached += c.reached[b] || 0; if (c.pool) { t[b].pool += c.pool[b] || 0; t.All.pool += c.pool[b] || 0; t[b].has_pool = true; t.All.has_pool = true; } }
  };
  const finish = t => { for (const b of [...PEN_BANDS, 'All']) t[b].pct = t[b].has_pool && t[b].pool ? t[b].reached / t[b].pool * 100 : null; return t; };
  const byAcc = new Map(), regionReach = new Map();
  for (const c of P.cells) {
    const region = regionOf(c.country, regions);
    if (!byAcc.has(c.account)) byAcc.set(c.account, { account: c.account, category: (accounts || []).find(a => a.name === c.account)?.category || '', total: blank(), regions: {} });
    const a = byAcc.get(c.account);
    if (!a.regions[region]) a.regions[region] = blank();
    add(a.total, c); add(a.regions[region], c);
    regionReach.set(region, (regionReach.get(region) || 0) + PEN_BANDS.reduce((x, b) => x + (c.reached[b] || 0), 0));
  }
  const list = [...byAcc.values()].map(a => { finish(a.total); for (const r of Object.keys(a.regions)) finish(a.regions[r]); return a; }).sort((x, y) => y.total.All.reached - x.total.All.reached);
  const regionList = [...regionReach.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
  return { accounts: list, regions: regionList, bands: PEN_BANDS, frequency };
}
export const PEN_BREAKS = [5, 15, 35, 70];
export const penLevel = pct => pct == null ? 0 : pct < 5 ? 1 : pct < 15 ? 2 : pct < 35 ? 3 : pct < 70 ? 4 : 5;

// Geography written into an ad set name, used to pick creatives per country in the cell detail.
const GEO_WORDS = { 'India': ['india', 'ind '], 'United States': ['|us|', ' us ', 'usa', 'united states', 'north america', 'na|'], 'United Kingdom': ['uk', 'united kingdom', 'britain'], 'Saudi Arabia': ['saudi', 'ksa', 'middle east', 'gcc', 'mea'], 'United Arab Emirates': ['uae', 'dubai', 'emirates', 'middle east', 'gcc', 'mea'], 'Australia': ['australia', 'anz', 'apac'], 'Japan': ['japan', 'apac'], 'Singapore': ['singapore', 'apac', 'sea', 'asean'] };
export function adSetCountries(name, countries) {
  const t = ' ' + String(name || '').toLowerCase().replace(/\|/g, '|') + ' ';
  const hits = (countries || Object.keys(GEO_WORDS)).filter(c => (GEO_WORDS[c] || [c.toLowerCase()]).some(w => t.includes(w)));
  return hits; // empty = global / list-defined
}
export function creativesForCountry(perfRows, country, countries, limit = 6) {
  const g = groupBy(perfRows, r => r.ad_name || r.ad_id);
  const out = [];
  for (const [name, rs] of g) {
    const geos = adSetCountries(rs[0].campaign + ' ' + (rs[0].campaign_group || ''), countries);
    const exclusive = geos.length > 0;
    if (exclusive && !geos.includes(country)) continue;
    const t = totals(rs); if (!t.impressions && !t.sends) continue;
    out.push({ ad_name: name, campaign: rs[0].campaign, exclusive, ...t });
  }
  return out.sort((a, b) => b.leads - a.leads || (b.ctr || 0) - (a.ctr || 0) || b.impressions - a.impressions).slice(0, limit);
}

// ---- White Path: targeting approach, ad sets, scorecard ----
// Approach is read from the ad set name. "Combined" is checked first so a name such as
// "Custom + Native" lands there instead of in Custom list.
export const APPROACHES = ['Custom list', 'Native', 'Combined', 'Retargeting', 'Other'];
export function approachOf(name) {
  const t = String(name || '');
  if (/combined|mix|\+/i.test(t)) return 'Combined';
  if (/custom|list|upload|matched|abm/i.test(t)) return 'Custom list';
  if (/native|heatmap|seniorit|title|function/i.test(t)) return 'Native';
  if (/retarget|website|visit|engag/i.test(t)) return 'Retargeting';
  return 'Other';
}
// One row per ad set (LinkedIn campaign). Active = spend in the last 7 days of the range (to, or the
// last day with rows when no range is given). prevRows adds { spend, leads, cpl, impressions, ctr } from the comparison range.
export function adSets(rows, { to, prevRows } = {}) {
  const days = rows.map(r => r.day).filter(Boolean).sort();
  const end = to || days[days.length - 1] || null;
  const cutoff = end ? addDays(end, -6) : null;
  const key = r => r.campaign || '(no ad set)';
  const g = groupBy(rows, key), prevG = prevRows ? groupBy(prevRows, key) : null;
  const out = [...g.entries()].map(([name, rs]) => {
    const s = summarise(name, rs);
    const recent = cutoff ? rs.filter(r => r.day >= cutoff && r.day <= end).reduce((a, r) => a + n(r.spend), 0) : 0;
    const o = { ...s, campaign_group: rs[0].campaign_group || '', objective: rs[0].objective || '', approach: approachOf(name), status: recent > 0 ? 'Active' : 'Paused', recent_spend: recent, prev: null };
    if (prevG && prevG.has(name)) { const pt = totals(prevG.get(name)); o.prev = { spend: pt.spend, leads: pt.leads, cpl: pt.cpl, impressions: pt.impressions, ctr: pt.ctr }; }
    return o;
  });
  return out.sort((a, b) => b.spend - a.spend);
}
// Approaches side by side. Grade A = CTR at or above the median and CPM at or below it, B = one of the two, C = neither.
// Medians are taken across the approaches that have impressions; message-only approaches get no grade.
export function scorecard(sets) {
  const g = groupBy(sets, s => s.approach);
  const rows = APPROACHES.filter(a => g.has(a)).map(a => {
    const ss = g.get(a); const t = { approach: a, sets: ss.length, names: ss.map(s => s.name) };
    for (const k of ['spend', 'impressions', 'clicks', 'leads', 'sends', 'opens']) t[k] = ss.reduce((x, s) => x + n(s[k]), 0);
    t.ctr = t.impressions ? t.clicks / t.impressions * 100 : null; t.cpm = t.impressions ? t.spend / t.impressions * 1000 : null; t.cpl = div(t.spend, t.leads);
    return t;
  });
  const withImp = rows.filter(r => r.impressions > 0);
  const median_ctr = median(withImp.map(r => r.ctr)), median_cpm = median(withImp.map(r => r.cpm));
  const p2 = v => (Math.round(v * 100) / 100).toFixed(2), d0 = v => Math.round(v);
  for (const r of rows) {
    if (!r.impressions) { r.grade = null; r.verdict = r.sends ? 'Message ads only: sends carry no impressions, so CTR and CPM do not apply.' : 'No impressions in this range.'; continue; }
    const goodCtr = r.ctr >= median_ctr, goodCpm = r.cpm <= median_cpm;
    r.grade = goodCtr && goodCpm ? 'A' : (goodCtr || goodCpm) ? 'B' : 'C';
    if (r.grade === 'A') r.verdict = `Clicks at ${p2(r.ctr)}% and reach at $${p2(r.cpm)} per 1,000 both beat or match the medians. Put more budget here.`;
    else if (goodCtr) r.verdict = `People click (${p2(r.ctr)}% CTR) but reach is dear at $${p2(r.cpm)} per 1,000 against a $${p2(median_cpm)} median. Widen the audience to bring the cost down.`;
    else if (goodCpm) r.verdict = `Cheap reach at $${p2(r.cpm)} per 1,000 but only ${p2(r.ctr)}% click against a ${p2(median_ctr)}% median. Refresh the creative before scaling.`;
    else r.verdict = `$${p2(r.cpm)} per 1,000 and ${p2(r.ctr)}% CTR are both on the wrong side of the medians on $${d0(r.spend)}. Pause or rebuild the audience.`;
  }
  return { rows, median_ctr, median_cpm };
}

// ---- messaging senders ----
// Sender persona from an ad or ad set name: a short "Name:" prefix (one or two words), or a first word from the
// known sender list. Several names can be passed; the first that yields a sender wins.
export const SENDERS = ['ani', 'jessica', 'siva', 'kailash', 'anju', 'praveen', 'bharath', 'pooja'];
/** A team member's first name found in free text (a file name like "Sept_Anju_Company.csv" or an ad set name), else ''. */
export function personFromText(text) { for (const tok of String(text || '').split(/[^A-Za-z]+/)) if (SENDERS.includes(tok.toLowerCase())) return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase(); return ''; }
const capWords = s => s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
export function senderOf(...names) {
  for (const raw of names) {
    const s = String(raw || '').trim(); if (!s) continue;
    const m = s.match(/^([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)\s*:/); if (m) return capWords(m[1].trim());
    const w = s.match(/^([A-Za-z]+)\b/); if (w && SENDERS.includes(w[1].toLowerCase())) return capWords(w[1]);
    // Ad set names are pipe-separated ("WP|Jessica|GSI&SI|Website visits", "ANI|Priority Acc|GSI/SI"):
    // any token that is a known sender's first name counts.
    for (const tok of s.split(/[|\/,\-–]+/)) { const first = tok.trim().split(/\s+/)[0] || ''; if (SENDERS.includes(first.toLowerCase())) return capWords(first); }
  }
  return 'Unknown sender';
}
// Message and conversation ads (rows with sends) grouped by sender, then by ad set inside each sender.
export function messagingBySender(rows) {
  const msg = rows.filter(r => n(r.sends) > 0);
  const bySender = groupBy(msg, r => senderOf(r.ad_name, r.campaign));
  const rates = o => { o.open_rate = o.sends ? o.opens / o.sends * 100 : null; o.click_to_open = o.opens ? o.clicks / o.opens * 100 : null; o.cpl = div(o.spend, o.leads); return o; };
  const senders = [...bySender.entries()].map(([sender, rs]) => {
    const bySet = groupBy(rs, r => r.campaign || '(no ad set)');
    const sets = [...bySet.entries()].map(([name, srs]) => { const t = totals(srs); const ad = srs.find(r => r.ad_name) || srs[0]; return rates({ name, ad_name: ad.ad_name || '', campaign_group: srs[0].campaign_group || '', spend: t.spend, sends: t.sends, opens: t.opens, clicks: t.clicks, leads: t.leads }); }).sort((a, b) => b.sends - a.sends);
    const o = { sender, sets }; for (const k of ['spend', 'sends', 'opens', 'clicks', 'leads']) o[k] = sets.reduce((a, s) => a + s[k], 0);
    return rates(o);
  });
  return senders.sort((a, b) => b.sends - a.sends);
}

// ---- creative audience reach ----
// Top creatives by impressions with the job titles and countries of the demographics rows whose campaign is the
// creative's ad set. has_split is false when no demographics row carries a campaign value.
export function creativeAudience(perfRows, demoRows, { top = 6, limit = 5 } = {}) {
  const split = (demoRows || []).filter(r => String(r.campaign || '').trim());
  const creatives = ads(perfRows).filter(a => a.impressions > 0 || a.sends > 0).sort((a, b) => b.impressions - a.impressions || b.sends - a.sends).slice(0, top);
  const topOf = (rows, segment) => { const sh = segmentShare(rows, segment, 'impressions'); return [...sh.values.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, impressions]) => ({ value, impressions, share: sh.total ? impressions / sh.total * 100 : 0 })); };
  return { has_split: split.length > 0, creatives: creatives.map(c => { const rows = split.filter(r => normName(r.campaign) === normName(c.campaign)); return { ad_name: c.ad_name, campaign: c.campaign, format: c.format, impressions: c.impressions, clicks: c.clicks, ctr: c.ctr, leads: c.leads, sends: c.sends, has_rows: rows.length > 0, titles: topOf(rows, 'Job Title'), countries: topOf(rows, 'Country') }; }) };
}

// ---- asset x company split ----
// Company rows that carry a campaign value, mapped to canonical accounts (else Other) x the approach of that campaign.
export function assetCompanySplit(demoRows, accounts, { limit = 25 } = {}) {
  const rows = segRows(demoRows || [], 'Company').filter(r => String(r.campaign || '').trim());
  const cells = new Map(), compTot = new Map(), apprSet = new Set();
  for (const r of rows) {
    const company = matchAccount(r.value, accounts) || 'Other', approach = approachOf(r.campaign); apprSet.add(approach);
    const k = company + '||' + approach;
    if (!cells.has(k)) cells.set(k, { company, approach, impressions: 0, clicks: 0, sets: new Set() });
    const c = cells.get(k); c.impressions += n(r.impressions); c.clicks += n(r.clicks); c.sets.add(r.campaign);
    compTot.set(company, (compTot.get(company) || 0) + n(r.impressions));
  }
  const companies = [...compTot.entries()].filter(e => e[0] !== 'Other').sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, limit);
  if (compTot.has('Other')) companies.push('Other');
  const list = [...cells.values()].map(c => ({ ...c, sets: [...c.sets], ctr: c.impressions ? c.clicks / c.impressions * 100 : null }));
  // Approaches with no impressions at all (message-only ad sets) would be an empty column.
  const approaches = APPROACHES.filter(a => apprSet.has(a) && list.some(c => c.approach === a && c.impressions > 0));
  const byKey = new Map(list.map(c => [c.company + '||' + c.approach, c]));
  return { has_split: rows.length > 0, companies, approaches, cells: list, at: (company, approach) => byKey.get(company + '||' + approach) || null };
}

// ---- reach vs contacts ----
// Company impressions (matched accounts, else "Other pages") against uploaded contact list sizes
// (contact_lists = { 'Account name': number }, keys matched like page names). est_reach = impressions / frequency.
export function reachVsContacts(demoRows, accounts, { contact_lists, frequency = 3, limit = 30 } = {}) {
  const has_contacts = !!contact_lists && typeof contact_lists === 'object' && Object.keys(contact_lists).length > 0;
  const contacts = new Map();
  if (has_contacts) for (const [k, v] of Object.entries(contact_lists)) { const acc = matchAccount(k, accounts) || k; contacts.set(acc, (contacts.get(acc) || 0) + n(v)); }
  const m = new Map();
  const bucket = company => { if (!m.has(company)) m.set(company, { company, matched: company !== 'Other pages', impressions: 0, clicks: 0 }); return m.get(company); };
  for (const r of segRows(demoRows || [], 'Company')) { const c = bucket(matchAccount(r.value, accounts) || 'Other pages'); c.impressions += n(r.impressions); c.clicks += n(r.clicks); }
  for (const acc of contacts.keys()) bucket(acc);
  const f = frequency || 3;
  const all = [...m.values()].map(c => { const ct = has_contacts && contacts.has(c.company) ? contacts.get(c.company) : null; const est = c.impressions / f; return { ...c, contacts: ct, est_reach: est, ratio: ct ? est / ct : null }; });
  const named = all.filter(c => c.matched).sort((a, b) => b.impressions - a.impressions).slice(0, limit);
  const rows = [...named, ...all.filter(c => !c.matched)];
  const total = { contacts: has_contacts ? all.reduce((a, c) => a + (c.contacts || 0), 0) : null, impressions: all.reduce((a, c) => a + c.impressions, 0), clicks: all.reduce((a, c) => a + c.clicks, 0) };
  total.est_reach = total.impressions / f; total.ratio = total.contacts ? total.est_reach / total.contacts : null;
  return { has_contacts, frequency: f, rows, total };
}

// ---- geography x seniority per audience ----
// LinkedIn reports Country and Job Seniority as separate lists, so each cell is the region total spread by the
// seniority mix of the same audience (an estimate). Audience = demographics campaign value when the rows carry one,
// otherwise a single "All audiences" table.
export const SENIORITY_ORDER = ['Unpaid', 'Training', 'Entry', 'Senior', 'Manager', 'Director', 'VP', 'CXO', 'Partner', 'Owner'];
export const ALL_AUDIENCES = 'All audiences';
export function geoSeniority(demoRows, { regions, metric = 'impressions' } = {}) {
  const rows = demoRows || [];
  const split = rows.filter(r => String(r.campaign || '').trim());
  const groups = split.length ? groupBy(split, r => r.campaign) : new Map([[ALL_AUDIENCES, rows]]);
  const audiences = [];
  for (const [name, rs] of groups) {
    const geo = segmentShare(rs, 'Country', metric, r => regionOf(r.value, regions));
    const sen = segmentShare(rs, 'Job Seniority', metric);
    const regionsSorted = [...geo.values.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const senKeys = [...sen.values.keys()].filter(k => sen.values.get(k) > 0);
    const seniorities = [...SENIORITY_ORDER.filter(k => senKeys.includes(k)), ...senKeys.filter(k => !SENIORITY_ORDER.includes(k))];
    const cells = {}, regionTotal = {}, senTotal = {};
    for (const r of regionsSorted) { cells[r] = {}; regionTotal[r] = geo.values.get(r); for (const s of seniorities) { const v = geo.values.get(r) * (sen.values.get(s) / sen.total); cells[r][s] = v; senTotal[s] = (senTotal[s] || 0) + v; } }
    audiences.push({ name, approach: name === ALL_AUDIENCES ? null : approachOf(name), total: geo.total && sen.total ? geo.total : 0, regions: regionsSorted, seniorities, cells, regionTotal, senTotal });
  }
  audiences.sort((a, b) => b.total - a.total);
  // Audiences with no country or seniority rows (message-only ad sets) are dropped unless nothing else exists.
  const live = audiences.filter(a => a.total > 0);
  return { split: split.length > 0, estimated: true, metric, audiences: live.length ? live : audiences.slice(0, 1) };
}

// ---- achieved / not achieved bullets ----
export function bullets({ rows, prevRows, demoWindows, prevDemoWindows, from, to, stages, bands }) {
  const ach = [], miss = [];
  if (!rows.length) return { achieved: ach, missed: miss };
  const t = totals(rows);
  const P = programs(rows, stages);
  const withLeads = P.programs.flatMap(p => p.campaigns).filter(c => c.leads > 0);
  if (withLeads.length) {
    const top = [...withLeads].sort((a, b) => b.leads - a.leads)[0];
    ach.push({ b: 'Best ad set by leads.', s: `${top.name}: ${top.leads} leads at $${Math.round(top.cpl)} each (${Math.round(top.leads / t.leads * 100)}% of all leads).` });
    const cheap = [...withLeads].filter(c => c.leads >= 3).sort((a, b) => a.cpl - b.cpl)[0];
    if (cheap && cheap.name !== top.name) ach.push({ b: 'Cheapest leads.', s: `${cheap.name}: $${Math.round(cheap.cpl)} per lead on ${cheap.leads} leads.` });
  }
  const topProg = P.programs.find(p => p.leads > 0);
  if (topProg) ach.push({ b: 'Best program.', s: `${topProg.name} produced ${topProg.leads} of ${t.leads} leads at $${Math.round(topProg.cpl)} per lead.` });
  // CPL trend, first half vs second half
  const days = daysBetween(from, to);
  if (days >= 8 && t.leads >= 4) {
    const mid = addDays(from, Math.floor(days / 2) - 1);
    const a = totals(rows.filter(r => r.day <= mid)), b = totals(rows.filter(r => r.day > mid));
    if (a.leads && b.leads) {
      const item = { b: b.cpl <= a.cpl ? 'Cost per lead improved through the period.' : 'Cost per lead rose in the second half.', s: `$${Math.round(a.cpl)} (${from} to ${mid}) to $${Math.round(b.cpl)} (${addDays(mid, 1)} to ${to}), ${a.leads} then ${b.leads} leads.` };
      (b.cpl <= a.cpl ? ach : miss).push(item);
    }
  }
  if (prevRows && prevRows.length) {
    const p = totals(prevRows);
    if (p.leads && t.leads) { const g = growth(t.leads, p.leads); (g >= 0 ? ach : miss).push({ b: g >= 0 ? 'Leads grew against the previous period.' : 'Leads fell against the previous period.', s: `${t.leads} vs ${p.leads} (${g > 0 ? '+' : ''}${Math.round(g)}%) on ${p.spend ? (growth(t.spend, p.spend) > 0 ? '+' : '') + Math.round(growth(t.spend, p.spend)) + '%' : 'new'} spend.` }); }
    if (p.cpl && t.cpl) { const g = growth(t.cpl, p.cpl); (g <= 0 ? ach : miss).push({ b: g <= 0 ? 'Cost per lead is down.' : 'Cost per lead is up.', s: `$${Math.round(t.cpl)} vs $${Math.round(p.cpl)} in the previous period (${g > 0 ? '+' : ''}${Math.round(g)}%).` }); }
  }
  // Zero-lead spend
  const dead = P.programs.flatMap(p => p.campaigns).filter(c => c.spend > 100 && !c.leads && c.stage !== 'ToFu');
  if (dead.length) miss.push({ b: 'Spend with no leads.', s: dead.slice(0, 4).map(c => `${c.name} $${Math.round(c.spend)}`).join(', ') + (dead.length > 4 ? ` and ${dead.length - 4} more` : '') + '.' });
  // Conversation ads
  if (t.sends > 50) {
    const conv = rows.filter(r => n(r.sends) > 0); const ct = totals(conv);
    const item = { b: ct.leads ? 'Message ads open but rarely convert.' : 'Message ads did not convert.', s: `${Math.round(ct.open_rate)}% open rate on ${ct.sends} sends, ${ct.clicks} clicks, ${ct.leads} leads${ct.leads ? ` at $${Math.round(ct.cpl)} each` : ''}.` };
    (ct.leads && ct.cpl && t.cpl && ct.cpl < t.cpl * 1.5 ? ach : miss).push(item);
  }
  // Seniority and geography from demographics
  const senShare = ws => { let dir = 0, all = 0; for (const w of ws || []) for (const r of segRows(w.rows, 'Job Seniority')) { const v = n(r.impressions); all += v; if (/director|vp|cxo|partner|owner/i.test(r.value)) dir += v; } return all ? dir / all * 100 : null; };
  const s1 = senShare(demoWindows), s0 = senShare(prevDemoWindows);
  if (s1 != null) {
    const item = { b: s0 != null && s1 < s0 - 3 ? 'Seniority drifted down.' : 'Director and above share held.', s: `Director and above are ${Math.round(s1)}% of impressions${s0 != null ? ` vs ${Math.round(s0)}% in the previous period` : ''}.` };
    (s0 != null && s1 < s0 - 3 ? miss : ach).push(item);
  }
  let geoTop = null; { const g = new Map(); let all = 0; for (const w of demoWindows || []) for (const r of segRows(w.rows, 'Country')) { const v = n(r.impressions); all += v; g.set(r.value, (g.get(r.value) || 0) + v); } if (all) { const [c, v] = [...g.entries()].sort((a, b) => b[1] - a[1])[0]; geoTop = { country: c, share: v / all * 100 }; } }
  if (geoTop) (geoTop.share > 70 ? miss : ach).push({ b: geoTop.share > 70 ? 'Geography is concentrated.' : 'Geography is spread.', s: `${geoTop.country} took ${Math.round(geoTop.share)}% of impressions in the included demographics windows.` });
  // Band share
  if ((demoWindows || []).some(w => segRows(w.rows, 'Job Title').length)) {
    const bs = bandShares((demoWindows || []).flatMap(w => segRows(w.rows, 'Job Title')), bands);
    const icp = (bs.share.MD + bs.share['MD-1'] + bs.share['MD-2']) * 100;
    (icp >= 40 ? ach : miss).push({ b: icp >= 40 ? 'ICP bands take a healthy share.' : 'Most impressions fall outside the MD bands.', s: `MD, MD-1 and MD-2 titles are ${Math.round(icp)}% of title impressions (MD ${Math.round(bs.share.MD * 100)}%, MD-1 ${Math.round(bs.share['MD-1'] * 100)}%, MD-2 ${Math.round(bs.share['MD-2'] * 100)}%).` });
  }
  return { achieved: ach, missed: miss };
}
