// LinkedIn lead-form leads (and lead spreadsheets from HubSpot or anywhere else): parsing, the one lead shape,
// de-duplication and every aggregation the Lead analytics page draws. Pure, no DOM, node-tested. The Pages
// Functions (functions/api/ca/li-leads.js, screenshots.js, _lib/query.js) import normaliseLead and leadKey
// from here so the server and the page agree on what a lead is and when two rows are the same lead.
//
// Lead shape (unknown = ''):
//   { submitted_at:'YYYY-MM-DD', first_name, last_name, email, company, title, seniority, country, city, industry,
//     company_size, campaign, campaign_group, ad, form, lead_type, phone, linkedin_url, source, extra:{} }
// source: 'csv' (an uploaded file), 'api' (the LinkedIn API pull), 'screenshot' (read by Claude), 'hubspot'
// (HubSpot GSI leads, converted on the page by fromHubspot; never stored).
import { parseRows, detectDelimiter, parseDate, normHeader } from '../csv.mjs';
import { matchAccount, bandWeights, regionOf, leadTypeOf, LEAD_TYPES, bucketKey } from './linkedin-agg.mjs';
import { tierOf, TIER_GROUP } from './tiers.mjs';
import { originOf } from './lead-origin.mjs';

export const LEAD_FIELDS = ['submitted_at', 'first_name', 'last_name', 'email', 'company', 'title', 'seniority', 'country', 'city', 'industry', 'company_size', 'campaign', 'campaign_group', 'ad', 'form', 'lead_type', 'phone', 'linkedin_url'];
export const LEAD_SOURCES = ['csv', 'api', 'screenshot', 'hubspot'];
export const SOURCE_LABEL = { csv: 'LinkedIn form file', api: 'LinkedIn API', screenshot: 'Screenshot', hubspot: 'HubSpot' };
export const MAX_EXTRA_KEYS = 40;

// Header synonyms, keys lowercased with non-letters stripped (normHeader). Order matters: each column is
// claimed once, fields resolve top to bottom. As in js/csv.mjs, the 2026 exports call the ad set "Ad Set Name"
// and the campaign group "Campaign Name"; older exports have "Campaign Name" + "Campaign Group Name".
const HEADERS = [
  ['email', ['emailaddress', 'email', 'workemail', 'businessemail', 'emailid', 'primaryemail', 'workemailaddress', 'contactemail']],
  ['first_name', ['firstname', 'givenname', 'first']],
  ['last_name', ['lastname', 'surname', 'familyname', 'last']],
  ['full_name', ['fullname', 'name', 'leadname', 'contactname', 'membername']],
  ['company', ['companyname', 'company', 'organization', 'organisation', 'employer', 'accountname', 'currentcompany', 'associatedcompany']],
  ['title', ['jobtitle', 'title', 'designation', 'position', 'currenttitle', 'role']],
  ['seniority', ['seniority', 'jobseniority', 'senioritylevel']],
  ['country', ['countryregion', 'country', 'countryname']],
  ['city', ['city', 'location', 'cityregion']],
  ['industry', ['industry', 'companyindustry']],
  ['company_size', ['companysize', 'numberofemployees', 'employees', 'companyheadcount', 'employeecount', 'headcount']],
  ['campaign', ['adsetname', 'adset', 'campaignname', 'campaign', 'leadcampaignname', 'utmcampaign']],
  ['campaign_group', ['campaigngroupname', 'campaigngroup', 'campaignname', 'campaign']],
  ['ad', ['adname', 'creativename', 'creative', 'ad', 'adtitle', 'adheadline']],
  ['form', ['leadformname', 'formname', 'leadgenformname', 'leadform', 'form', 'firstconversion', 'conversionform']],
  ['lead_type', ['leadtype']],
  ['submitted_at', ['submittedat', 'datesubmitted', 'submissiondate', 'submittedon', 'leadcreated', 'leadcreatedat', 'leadcreatedate', 'createdat', 'createdate', 'datecreated', 'createddate', 'date', 'timestamp', 'submitted']],
  ['phone', ['phonenumber', 'phone', 'mobile', 'mobilephone', 'mobilenumber', 'workphone']],
  ['linkedin_url', ['linkedinprofileurl', 'linkedinprofile', 'linkedinurl', 'profileurl', 'linkedin', 'memberprofileurl']],
];
// Columns that mean the file is an ad report, not a list of people.
const REPORT_COLS = ['impressions', 'totalspent', 'spend', 'clicks', 'segment', 'segmentvalue'];

const str = v => (v == null ? '' : String(v).trim());
const cap = (v, n = 300) => str(v).slice(0, n);
export const normName = s => String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');

/** A lead file's header row: people (email or a name) plus something about them, and no ad metrics. */
export function isLeadCsv(headers) {
  const h = new Set((headers || []).map(normHeader).filter(Boolean));
  if (REPORT_COLS.some(c => h.has(c))) return false;
  const has = f => HEADERS.find(([k]) => k === f)[1].some(s => h.has(s));
  const person = has('email') || (has('first_name') && has('last_name')) || h.has('fullname');
  const about = has('company') || has('title') || has('form') || has('submitted_at') || has('campaign');
  return person && about;
}

/** Any date the exports use -> 'YYYY-MM-DD' (or ''). Handles ISO, M/D/YYYY, D/M/YYYY when the day is over 12, "Sep 14, 2026", epoch ms. */
export function leadDay(v) {
  const s = str(v).replace(/^"|"$/g, '');
  if (!s) return '';
  if (/^\d{11,13}$/.test(s)) { const d = new Date(Number(s)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m.map(Number); if (y < 100) y += 2000;
    let mo = a, d = b; if (a > 12 && b <= 12) { mo = b; d = a; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const p = parseDate(s);
  if (p && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p)) return p;
  const t = Date.parse(s); return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/** Any object -> the lead shape. Unknown keys go to `extra` (non-empty values only, at most 40). */
export function normaliseLead(obj, source) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const out = {};
  for (const k of LEAD_FIELDS) out[k] = cap(o[k]);
  out.email = out.email.toLowerCase().replace(/^mailto:/, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) out.email = out.email.includes('@') ? out.email : '';
  out.submitted_at = leadDay(o.submitted_at);
  if (!out.first_name && !out.last_name && str(o.full_name || o.name)) { const parts = str(o.full_name || o.name).split(/\s+/); out.first_name = cap(parts.shift()); out.last_name = cap(parts.join(' ')); }
  out.lead_type = LEAD_TYPES.includes(out.lead_type.toLowerCase()) ? out.lead_type.toLowerCase() : '';
  const s = str(source || o.source).toLowerCase();
  out.source = LEAD_SOURCES.includes(s) ? s : 'csv';
  const extra = {};
  const skip = new Set([...LEAD_FIELDS, 'source', 'extra', 'full_name', 'name', 'doc_id']);
  const add = (k, v) => { if (Object.keys(extra).length >= MAX_EXTRA_KEYS) return; const val = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim(); if (val) extra[cap(k, 80)] = val.slice(0, 500); };
  if (o.extra && typeof o.extra === 'object' && !Array.isArray(o.extra)) for (const [k, v] of Object.entries(o.extra)) add(k, v);
  for (const [k, v] of Object.entries(o)) if (!skip.has(k)) add(k, v);
  out.extra = extra;
  return out;
}

/** The identity of a lead: email + day + form, or name + company when there is no email. null = cannot tell. */
export function leadKey(l) {
  const email = str(l && l.email).toLowerCase();
  if (email) return `e:${email}|${str(l.submitted_at).slice(0, 10)}|${normName(l.form)}`;
  const name = normName(`${str(l && l.first_name)} ${str(l && l.last_name)}`);
  const co = normName(l && l.company);
  return name && co ? `n:${name}|${co}` : null;
}

/** First occurrence wins. -> { leads, duplicates } (duplicates = the later copies). Leads with no key are kept. */
export function dedupeLeads(list) {
  const seen = new Set(), leads = [], duplicates = [];
  for (const l of list || []) { const k = leadKey(l); if (k && seen.has(k)) { duplicates.push(l); continue; } if (k) seen.add(k); leads.push(l); }
  return { leads, duplicates };
}

/**
 * Lead file text -> { rows:[lead], columns:{ header: field | 'extra' }, warnings, skipped, stats:{ from, to, leads, campaigns, forms, companies, no_email } }.
 * Throws when no header row with people in it is found in the first 20 lines.
 */
export function parseLeadCsv(text, fileName = '') {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/);
  let headAt = -1, delim = ',';
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (!lines[i].trim()) continue;
    const d = detectDelimiter(lines[i]); const cells = parseRows(lines[i], d)[0] || [];
    if (isLeadCsv(cells)) { headAt = i; delim = d; break; }
  }
  if (headAt < 0) throw new Error('Not a lead file: expected columns such as First Name, Last Name, Email, Company and Job Title.');
  const rows = parseRows(lines.slice(headAt).join('\n'), delim).filter(r => r.some(c => str(c)));
  const headers = (rows.shift() || []).map(str);
  const norm = headers.map(normHeader);
  const idx = {}, columns = {}, claimed = new Set();
  for (const [field, syns] of HEADERS) {
    for (const s of syns) { const i = norm.findIndex((n, j) => n === s && !claimed.has(j)); if (i >= 0) { idx[field] = i; claimed.add(i); columns[headers[i]] = field; break; } }
  }
  headers.forEach((h, i) => { if (!claimed.has(i) && h) columns[h] = 'extra'; });
  const out = []; let skipped = 0;
  for (const r of rows) {
    const o = {};
    for (const [f, i] of Object.entries(idx)) o[f] = r[i];
    const extra = {}; headers.forEach((h, i) => { if (!claimed.has(i) && h && str(r[i])) extra[h] = str(r[i]); });
    o.extra = extra;
    const lead = normaliseLead(o, 'csv');
    if (!lead.email && !lead.first_name && !lead.last_name) { skipped++; continue; }
    out.push(lead);
  }
  const warnings = [];
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} with no name or email skipped`);
  const noDate = out.filter(l => !l.submitted_at).length;
  if (noDate) warnings.push(`${noDate} lead${noDate === 1 ? ' has' : 's have'} no submission date`);
  if (idx.campaign === undefined) warnings.push('No campaign column: these leads cannot be joined to ad spend');
  const days = out.map(l => l.submitted_at).filter(Boolean).sort();
  const uniq = k => new Set(out.map(l => l[k]).filter(Boolean)).size;
  return { rows: out, columns, warnings, skipped, file_name: fileName, stats: { from: days[0] || null, to: days[days.length - 1] || null, leads: out.length, campaigns: uniq('campaign'), forms: uniq('form'), companies: uniq('company'), no_email: out.filter(l => !l.email).length } };
}

// ---- HubSpot -> lead shape (on the page only, never stored) ----
/** An enriched HubSpot contact (js/lib/leads-agg.mjs enrich) as a lead with source 'hubspot', plus origin fields. */
export function fromHubspot(c) {
  const o = originOf(c);
  const lead = normaliseLead({ submitted_at: c.day || c.created_at, first_name: c.first_name, last_name: c.last_name, email: c.email, company: c.company_raw || c.account, title: c.jobtitle, country: c.country, campaign: o.campaign, form: o.form || o.formType }, 'hubspot');
  return { ...lead, hs_id: c.hs_id, account_hs: c.account || '', band_hs: c.band || '', lead_source: o.leadSource || '', traffic: o.traffic || '', origin: o.label || '' };
}

// ---- small helpers ----
export const fullName = l => `${str(l.first_name)} ${str(l.last_name)}`.trim() || l.email || '(no name)';
export const dayOf = l => str(l.submitted_at).slice(0, 10);
export const inRange = (l, from, to) => { const d = dayOf(l); if (!d) return !from && !to; return (!from || d >= from) && (!to || d <= to); };
const emailDomain = e => { const s = str(e).toLowerCase(); const i = s.lastIndexOf('@'); return i < 0 ? '' : s.slice(i + 1); };
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'yahoo.co.in']);

/** The target account a lead works at: the company name first, then the email domain against the accounts' websites. null = not a target. */
const ACCOUNT_MEMO = new WeakMap(); // accounts array -> Map(company|domain -> account or null)
export function accountOf(l, accounts) {
  if (l.account_hs) return l.account_hs;
  const dom = emailDomain(l.email);
  const list = Array.isArray(accounts) ? accounts : [];
  if (!ACCOUNT_MEMO.has(list)) ACCOUNT_MEMO.set(list, new Map());
  const memo = ACCOUNT_MEMO.get(list), key = normName(l.company) + '|' + dom;
  if (memo.has(key)) return memo.get(key);
  let hit = matchAccount(l.company, list);
  if (!hit && dom && !FREE_MAIL.has(dom)) for (const a of list) { const doms = [a.domain, ...(a.domains || [])].filter(Boolean).map(x => String(x).toLowerCase()); if (doms.some(d => dom === d || dom.endsWith('.' + d))) { hit = a.name; break; } }
  memo.set(key, hit || null);
  return hit || null;
}
/** The band of one lead: HubSpot's own band when it has one, else the title through bandWeights (Director = MD-1 / MD-2 half each, reported as MD-1). */
export function bandOf(l, bands) {
  if (l.band_hs && l.band_hs !== 'Unknown') return l.band_hs;
  const w = bandWeights(l.title || l.seniority, bands);
  return ['MD', 'MD-1', 'MD-2', 'Other'].reduce((best, b) => (w[b] || 0) > (w[best] || 0) ? b : best, 'Other');
}
/** Fractional band counts over a list (a plain Director counts half MD-1, half MD-2). */
export function bandMix(list, bands) {
  const o = { MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0 };
  for (const l of list) { if (l.band_hs && l.band_hs !== 'Unknown') { o[o[l.band_hs] === undefined ? 'Other' : l.band_hs]++; continue; } const w = bandWeights(l.title || l.seniority, bands); for (const [b, f] of Object.entries(w)) o[b] += f; }
  return o;
}
export const leadRegion = (l, regions) => regionOf(l.country, regions);
/** MQL / conversation / playbook / other: the stored type, else the keyword rules over campaign, campaign group + form, ad. */
export function typeOf(l, rules) {
  if (LEAD_TYPES.includes(l.lead_type)) return l.lead_type;
  return leadTypeOf({ campaign: l.campaign, campaign_group: [l.campaign_group, l.form].filter(Boolean).join(' '), ad_name: l.ad }, rules);
}

// ---- aggregations ----
/** Count by a field name or a function. -> [{ key, count, leads }] most first. Empty keys become `blank`. */
export function leadsBy(list, key, blank = '(not given)') {
  const fn = typeof key === 'function' ? key : l => l[key];
  const m = new Map();
  for (const l of list) { const k = str(fn(l)) || blank; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return [...m.entries()].map(([k, leads]) => ({ key: k, count: leads.length, leads })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Campaigns joined to LinkedIn ad performance (ca_li_perf rows: campaign = ad set name, campaign_group, spend,
 * leads, lead_forms_opened, impressions, clicks) by normalised ad set name. One row per ad set that has leads
 * in the files or leads reported by LinkedIn. cpl = spend ÷ LinkedIn-reported leads (spend ÷ leads in the files
 * when LinkedIn reports none); completion = LinkedIn leads ÷ form opens.
 */
export function leadsByCampaign(list, perfRows = [], { rules } = {}) {
  const perf = new Map();
  for (const r of perfRows || []) {
    const k = normName(r.campaign) || '_none';
    const p = perf.get(k) || { name: str(r.campaign), group: str(r.campaign_group), spend: 0, li_leads: 0, form_opens: 0, impressions: 0, clicks: 0 };
    p.spend += Number(r.spend) || 0; p.li_leads += Number(r.leads) || 0; p.form_opens += Number(r.lead_forms_opened) || 0; p.impressions += Number(r.impressions) || 0; p.clicks += Number(r.clicks) || 0;
    if (!p.group && r.campaign_group) p.group = str(r.campaign_group);
    perf.set(k, p);
  }
  const perfKey = name => {
    const k = normName(name); if (!k) return null; if (perf.has(k)) return k;
    if (k.length >= 12) for (const pk of perf.keys()) if (pk.length >= 12 && (pk.startsWith(k) || k.startsWith(pk))) return pk;
    return null;
  };
  const rows = new Map();
  const rowFor = (k, name, group) => { if (!rows.has(k)) rows.set(k, { key: k, campaign: name, campaign_group: group, leads: [], spend: 0, li_leads: 0, form_opens: 0, impressions: 0, clicks: 0, in_perf: false }); return rows.get(k); };
  for (const l of list) {
    const pk = perfKey(l.campaign);
    const k = pk ? 'p:' + pk : 'f:' + (normName(l.campaign) || '_none');
    const r = rowFor(k, pk ? perf.get(pk).name : (str(l.campaign) || '(no campaign)'), pk ? perf.get(pk).group || str(l.campaign_group) : str(l.campaign_group));
    r.leads.push(l);
  }
  for (const [pk, p] of perf) { if (!(p.li_leads > 0) && !rows.has('p:' + pk)) continue; const r = rowFor('p:' + pk, p.name, p.group); Object.assign(r, { spend: p.spend, li_leads: p.li_leads, form_opens: p.form_opens, impressions: p.impressions, clicks: p.clicks, in_perf: true }); }
  return [...rows.values()].map(r => {
    const n = r.leads.length;
    const companies = leadsBy(r.leads, 'company').filter(x => x.key !== '(not given)').slice(0, 3).map(x => ({ company: x.key, count: x.count }));
    const lt = r.leads.length ? leadsBy(r.leads, l => typeOf(l, rules))[0].key : typeOf({ campaign: r.campaign, campaign_group: r.campaign_group }, rules);
    return { ...r, count: n, cpl: r.li_leads ? r.spend / r.li_leads : n && r.spend ? r.spend / n : null, cpl_files: n && r.spend ? r.spend / n : null, completion: r.form_opens ? r.li_leads / r.form_opens * 100 : null, gap: r.in_perf ? r.li_leads - n : null, lead_type: lt, top_companies: companies };
  }).sort((a, b) => b.count - a.count || b.li_leads - a.li_leads || b.spend - a.spend);
}

/** Leads per week or month, split by a key (default the source). -> { buckets:[k], series:{ key:[n...] }, keys:[...] } */
export function leadTrend(list, gran = 'week', keyFn = l => l.source) {
  const keys = new Map(), acc = new Map();
  for (const l of list) { const d = dayOf(l); if (!d) continue; const b = bucketKey(d, gran), k = str(keyFn(l)) || 'other'; keys.set(k, (keys.get(k) || 0) + 1); if (!acc.has(b)) acc.set(b, {}); acc.get(b)[k] = (acc.get(b)[k] || 0) + 1; }
  const buckets = [...acc.keys()].sort();
  const order = [...keys.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { buckets, keys: order, series: Object.fromEntries(order.map(k => [k, buckets.map(b => acc.get(b)[k] || 0)])) };
}

/**
 * One row per company (the matched target account, else the company as written, case folded).
 * -> [{ company, account, target, tier, tier_group, count, bands:{MD,MD-1,MD-2,Other}, md_share, campaigns:[{campaign,count}], titles:[{title,count}], leads }]
 */
export function companyTable(list, accounts = [], { accountTiers = {}, bands } = {}) {
  const m = new Map();
  for (const l of list) {
    const acc = accountOf(l, accounts);
    const raw = str(l.company) || (emailDomain(l.email) && !FREE_MAIL.has(emailDomain(l.email)) ? emailDomain(l.email) : '');
    const k = acc ? 'a:' + acc : 'c:' + (normName(raw) || '_none');
    if (!m.has(k)) m.set(k, { company: acc || raw || '(no company)', account: acc, leads: [] });
    m.get(k).leads.push(l);
  }
  return [...m.values()].map(c => {
    const b = bandMix(c.leads, bands); const n = c.leads.length;
    const tier = c.account ? tierOf(c.account, accountTiers, accounts) : null;
    return { ...c, target: !!c.account, tier, tier_group: tier ? TIER_GROUP[tier] : null, count: n, bands: b, md_share: n ? (b.MD + b['MD-1'] + b['MD-2']) / n * 100 : null, campaigns: leadsBy(c.leads, 'campaign', '(no campaign)').map(x => ({ campaign: x.key, count: x.count })), titles: leadsBy(c.leads, 'title').map(x => ({ title: x.key, count: x.count })) };
  }).sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
}

/** Campaign × company counts for the top campaigns (leads with a campaign only) and companies. -> { campaigns:[name], companies:[name], counts:[[n]] (companies × campaigns), max, cells:Map('ci|ri' -> leads) } */
export function campaignCompanyMatrix(list, accounts = [], { topCampaigns = 8, topCompanies = 15 } = {}) {
  const coName = l => accountOf(l, accounts) || str(l.company) || '(no company)';
  // Leads with no campaign are left out: a blank is not a campaign.
  const campaigns = leadsBy(list.filter(l => str(l.campaign)), 'campaign').slice(0, topCampaigns).map(x => x.key);
  const companies = leadsBy(list.filter(l => str(l.campaign)), coName).slice(0, topCompanies).map(x => x.key);
  const counts = companies.map(() => campaigns.map(() => 0)); const cells = new Map(); let max = 0;
  for (const l of list) {
    const ci = campaigns.indexOf(str(l.campaign)), ri = companies.indexOf(coName(l));
    if (ci < 0 || ri < 0) continue;
    counts[ri][ci]++; max = Math.max(max, counts[ri][ci]);
    const k = ri + '|' + ci; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(l);
  }
  return { campaigns, companies, counts, max, cells };
}

/** The KPI tiles. perfRows: LinkedIn performance rows in the same range. */
export function leadKpis(list, perfRows = [], { accounts = [], bands } = {}) {
  const by = s => list.filter(l => l.source === s).length;
  const spend = (perfRows || []).reduce((a, r) => a + (Number(r.spend) || 0), 0);
  const liLeads = (perfRows || []).reduce((a, r) => a + (Number(r.leads) || 0), 0);
  const opens = (perfRows || []).reduce((a, r) => a + (Number(r.lead_forms_opened) || 0), 0);
  const target = list.filter(l => accountOf(l, accounts)).length;
  const mix = bandMix(list, bands);
  const companies = new Set(list.map(l => accountOf(l, accounts) || normName(l.company)).filter(Boolean)).size;
  const linkedin = by('csv') + by('api');
  return {
    total: list.length, linkedin, files: by('csv'), api: by('api'), screenshot: by('screenshot'), hubspot: by('hubspot'), companies, target,
    target_share: list.length ? target / list.length * 100 : null,
    md_share: list.length ? (mix.MD + mix['MD-1'] + mix['MD-2']) / list.length * 100 : null, bands: mix,
    spend, li_leads: liLeads, form_opens: opens,
    cpl: liLeads ? spend / liLeads : linkedin && spend ? spend / linkedin : null,
    completion: opens ? liLeads / opens * 100 : null,
  };
}

/** Client-side CSV of leads. */
export const LEAD_CSV_COLS = ['submitted_at', 'first_name', 'last_name', 'email', 'company', 'title', 'seniority', 'country', 'city', 'industry', 'company_size', 'campaign', 'campaign_group', 'ad', 'form', 'lead_type', 'phone', 'linkedin_url', 'source'];
export function leadsToCsv(list, extraCols = []) {
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = [...LEAD_CSV_COLS.map(k => ({ h: k, f: l => l[k] })), ...extraCols];
  return [cols.map(c => cell(c.h)).join(','), ...list.map(l => cols.map(c => cell(c.f(l))).join(','))].join('\r\n');
}
