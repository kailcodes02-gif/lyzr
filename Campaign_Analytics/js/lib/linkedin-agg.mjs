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
export function stageOf(row, stages = DEFAULT_STAGES) {
  const s = stages || DEFAULT_STAGES;
  // Program (campaign group) name first, then the ad set name. BoFu keywords win, then ToFu
  // (so "Website visits" and "Awareness" beat the generic "lead gen"), then MoFu.
  for (const text of [row.campaign_group, row.campaign]) {
    const t = String(text || '').toLowerCase(); if (!t) continue;
    for (const st of ['BoFu', 'ToFu', 'MoFu']) if ((s[st] || []).some(k => t.includes(String(k).toLowerCase()))) return st;
  }
  return 'Other';
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
  const cells = [...cell.values()].map(c => {
    const reached = band === 'All' ? c.reached.MD + c.reached['MD-1'] + c.reached['MD-2'] : c.reached[band] || 0;
    const p = c.pool ? (band === 'All' ? c.pool.MD + c.pool['MD-1'] + c.pool['MD-2'] : c.pool[band]) : null;
    return { ...c, reached_band: reached, pool_band: p, pct: p ? reached / p * 100 : null };
  });
  const accountsSorted = [...accImp.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return { cells, accounts: accountsSorted, countries: ctys, frequency, band };
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
