// Exact designations: the Job Title rows of the LinkedIn demographics exports (top 25 titles per export,
// programme-wide, no title x company cross-tab) and the job titles of HubSpot leads matched to target accounts.
// Pure functions, no DOM. Band rules come from linkedin-agg (bandWeights) so the ladder is the same everywhere.
import { bandWeights, segRows } from './linkedin-agg.mjs';

const n = v => Number(v) || 0;
export const BAND_ORDER = ['MD', 'MD-1', 'MD-2', 'Other', 'Unknown'];

/** Dominant band of a title: the heaviest weight from bandWeights; a 50/50 Director split reads as MD-1. */
export function dominantBand(title, bands) {
  const w = bandWeights(title, bands) || {};
  let best = 'Other', bw = 0;
  for (const b of ['MD', 'MD-1', 'MD-2', 'Other']) if ((w[b] || 0) > bw) { bw = w[b]; best = b; }
  return bw > 0 ? best : 'Other';
}

// Job Title rows of a window, with a tagged subset (a person's or ad set's export) only counted when
// the window has no untagged all-campaign rows for the segment, so shared impressions are not doubled.
function titleRows(w) {
  const rows = segRows(w && w.rows ? w.rows : [], 'Job Title');
  const untagged = rows.filter(r => !String(r.campaign || '').trim());
  return untagged.length ? untagged : rows;
}

/**
 * Exact titles reached across the demographics windows.
 * -> { titles: [{ title, impressions, clicks, ctr, people, band, windows }], byWindow: Map(title -> [impressions per window index]), total }
 * Titles are the strings LinkedIn exported (trimmed, case kept), summed across windows, impressions desc.
 */
export function titlesReached(windows, { bands, rf = 3 } = {}) {
  const W = Array.isArray(windows) ? windows : [];
  const by = new Map(), byWindow = new Map();
  W.forEach((w, i) => {
    for (const r of titleRows(w)) {
      const title = String(r.value ?? '').trim(); if (!title) continue;
      if (!by.has(title)) { by.set(title, { title, impressions: 0, clicks: 0, seen: new Set() }); byWindow.set(title, W.map(() => 0)); }
      const t = by.get(title); t.impressions += n(r.impressions); t.clicks += n(r.clicks); t.seen.add(i);
      byWindow.get(title)[i] += n(r.impressions);
    }
  });
  const freq = Number(rf) > 0 ? Number(rf) : 3;
  const titles = [...by.values()].map(t => ({
    title: t.title, impressions: t.impressions, clicks: t.clicks,
    ctr: t.impressions ? t.clicks / t.impressions * 100 : null,
    people: Math.round(t.impressions / freq),
    band: dominantBand(t.title, bands), windows: t.seen.size,
  })).sort((a, b) => b.impressions - a.impressions || a.title.localeCompare(b.title));
  const total = titles.reduce((a, t) => a + t.impressions, 0);
  return { titles, byWindow, total };
}

// ---- cohorts: exact titles grouped by a normalised stem ----------------------------------------
const DASHES = /[–—‒―‐‑]/g; // en/em dashes and friends -> hyphen
const REGION_WORDS = ['india', 'uk', 'u.k.', 'us', 'u.s.', 'usa', 'u.s.a.', 'americas', 'america', 'north america', 'latam', 'emea', 'apac', 'asean', 'asia', 'pacific', 'asia pacific', 'europe', 'middle east', 'mea', 'uae', 'gcc', 'anz', 'australia', 'singapore', 'japan', 'canada', 'germany', 'france', 'global', 'international', 'south asia', 'sea', 'ksa'];
// Seniority prefixes that do not change the role when the role is a top-band one ("Senior Partner" is a Partner;
// "Senior Manager" is not a Manager, and "Associate Director" is not a Director, so those keep their own cohort).
const APEX_STEMS = new Set(['partner', 'managing director', 'managing partner', 'founder', 'co-founder', 'cofounder', 'president', 'ceo', 'chief executive officer', 'owner', 'chairman', 'board member']);
const APEX_PREFIXES = ['senior', 'sr', 'equity', 'global', 'executive', 'founding', 'lead', 'principal', 'national', 'regional', 'group', 'general', 'salaried', 'non-equity', 'nonequity', 'client', 'engagement', 'advisory', 'consulting', 'tax', 'audit', 'assurance'];
const TRAIL_PREFIXES = ['the'];

/** Normalised stem of an exact title: head before the first separator, regional suffixes and apex seniority dropped. */
export function titleStem(title) {
  let t = String(title ?? '').replace(DASHES, '-').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // head before " - ", ",", "|", "/", "(", ";", ":", " at ", " @ ", " for " ("Head of AI" keeps its "of": that is the role)
  t = t.split(/\s+-\s+|\s*[,|;:(]\s*|\s+\/\s+|\s+at\s+|\s+@\s+|\s+for\s+/)[0].trim();
  t = t.replace(/[.'"`]+/g, '').replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim();
  // trailing region words ("partner india", "managing director asia pacific")
  let changed = true;
  while (changed) { changed = false; for (const r of [...REGION_WORDS].sort((a, b) => b.length - a.length)) { const re = new RegExp('\\s+' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'); if (re.test(t) && t.replace(re, '').trim()) { t = t.replace(re, '').trim(); changed = true; } } }
  // "the" and similar fillers in front
  for (const p of TRAIL_PREFIXES) if (t.startsWith(p + ' ')) t = t.slice(p.length + 1);
  // apex seniority prefixes, as long as what is left is an apex role (looped so "senior equity partner" folds too)
  changed = true;
  while (changed) {
    changed = false;
    for (const p of APEX_PREFIXES) {
      if (t.startsWith(p + ' ')) { const rest = t.slice(p.length + 1).trim(); if (APEX_STEMS.has(rest) || [...APEX_STEMS].some(s => rest.startsWith(s + ' ') || rest === s)) { t = rest; changed = true; break; } }
    }
  }
  // "partner and head of ai practice" -> "partner"
  const andIdx = t.indexOf(' and '); if (andIdx > 0 && APEX_STEMS.has(t.slice(0, andIdx))) t = t.slice(0, andIdx);
  return t;
}
const stemLabel = stem => stem.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of');

/**
 * Group exact titles (from titlesReached().titles) into cohorts by stem.
 * -> [{ cohort, stem, band, titles: [exact...], impressions, clicks, people, n }] impressions desc.
 * The cohort label is the exact title that leads the cohort when it equals the stem, else the stem in title case.
 */
export function titleCohorts(titles) {
  const by = new Map();
  for (const t of titles || []) {
    const stem = titleStem(t.title) || '(no title)';
    if (!by.has(stem)) by.set(stem, { stem, titles: [], impressions: 0, clicks: 0, people: 0, bandW: {} });
    const c = by.get(stem); c.titles.push(t); c.impressions += n(t.impressions); c.clicks += n(t.clicks); c.people += n(t.people);
    c.bandW[t.band || 'Other'] = (c.bandW[t.band || 'Other'] || 0) + (n(t.impressions) || 1);
  }
  return [...by.values()].map(c => {
    const sorted = c.titles.sort((a, b) => n(b.impressions) - n(a.impressions) || a.title.localeCompare(b.title));
    const exact = sorted.find(t => titleStem(t.title) === c.stem && String(t.title).toLowerCase().replace(DASHES, '-').trim() === c.stem);
    const band = Object.entries(c.bandW).sort((a, b) => b[1] - a[1] || BAND_ORDER.indexOf(a[0]) - BAND_ORDER.indexOf(b[0]))[0]?.[0] || 'Other';
    return { cohort: exact ? exact.title : stemLabel(c.stem), stem: c.stem, band, titles: sorted.map(t => t.title), impressions: c.impressions, clicks: c.clicks, ctr: c.impressions ? c.clicks / c.impressions * 100 : null, people: c.people, n: sorted.length };
  }).sort((a, b) => b.impressions - a.impressions || a.cohort.localeCompare(b.cohort));
}

/**
 * Designation cohorts per matched target account from HubSpot lead rows ({ account, jobtitle, band }).
 * -> [{ account, leads, bands: {MD, 'MD-1', 'MD-2', Other, Unknown}, titles: [{ title, n, band }], cohorts: [{ cohort, n }] }]
 * sorted by leads desc. Titles are the exact HubSpot strings (trimmed, case kept). limit <= 0 or Infinity = all.
 */
export function companyCohorts(leadRows, { limit = 20 } = {}) {
  const by = new Map();
  for (const r of leadRows || []) {
    const account = String((r && r.account) || '').trim(); if (!account) continue;
    if (!by.has(account)) by.set(account, { account, leads: 0, bands: { MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0, Unknown: 0 }, titles: new Map() });
    const a = by.get(account); a.leads++;
    const band = BAND_ORDER.includes(r.band) ? r.band : 'Unknown'; a.bands[band]++;
    const title = String(r.jobtitle ?? '').trim() || '(no title)';
    if (!a.titles.has(title)) a.titles.set(title, { title, n: 0, bandW: {} });
    const t = a.titles.get(title); t.n++; t.bandW[band] = (t.bandW[band] || 0) + 1;
  }
  const out = [...by.values()].map(a => {
    const titles = [...a.titles.values()].map(t => ({ title: t.title, n: t.n, band: Object.entries(t.bandW).sort((x, y) => y[1] - x[1] || BAND_ORDER.indexOf(x[0]) - BAND_ORDER.indexOf(y[0]))[0][0] }))
      .sort((x, y) => y.n - x.n || BAND_ORDER.indexOf(x.band) - BAND_ORDER.indexOf(y.band) || x.title.localeCompare(y.title));
    const co = new Map();
    for (const t of titles) { const s = t.title === '(no title)' ? '(no title)' : (titleStem(t.title) || '(no title)'); const label = s === '(no title)' ? s : stemLabel(s); co.set(label, (co.get(label) || 0) + t.n); }
    const cohorts = [...co.entries()].map(([cohort, n]) => ({ cohort, n })).sort((x, y) => y.n - x.n || x.cohort.localeCompare(y.cohort));
    return { account: a.account, leads: a.leads, bands: a.bands, titles, cohorts };
  }).sort((x, y) => y.leads - x.leads || (y.bands.MD + y.bands['MD-1']) - (x.bands.MD + x.bands['MD-1']) || x.account.localeCompare(y.account));
  const lim = Number(limit);
  return lim > 0 && isFinite(lim) ? out.slice(0, lim) : out;
}

/** "Partner ×3 · Director ×2" text for a titles list. */
export const titlesText = (titles, max = 8, sep = ' · ') => (titles || []).slice(0, max).map(t => `${t.title}${t.n > 1 ? ` ×${t.n}` : ''}`).join(sep) + ((titles || []).length > max ? `${sep}+${titles.length - max} more` : '');
