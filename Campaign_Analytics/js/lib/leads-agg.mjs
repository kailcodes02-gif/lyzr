// Pure helpers for the HubSpot messaging and Leads analytics views. No DOM, no fetch,
// so they run under `node --test` (tests/frontend/leads.test.mjs).
// Everything here works on the contact row shape of ca_hs_contacts (see ARCHITECTURE.md).
import { bucketKey as defaultBucketKey } from '../fmt.mjs';

export const BANDS = ['MD', 'MD-1', 'MD-2', 'Other', 'Unknown'];
export const COMPANY_TYPES = ['Big Four', 'MBB / Strategy', 'Global SI', 'Indian IT / BPM', 'Advisory', 'Other', 'Not a target account'];

// The 10 intent clusters of the Lead Message Intelligence report. Keywords are matched as
// whole words (case-insensitive) against lsa_message. `functional` clusters take part in the
// "three or more functions named = internal workflow automation" rule.
export const CLUSTERS = [
  { id: 'sales', label: 'Sales, SDR and lead gen automation', short: 'Sales / SDR', functional: true, priority: 5,
    kw: ['sdr', 'sdrs', 'bdr', 'bdrs', 'lead gen', 'lead-gen', 'lead generation', 'prospecting', 'prospect', 'lead scoring', 'lead-scoring', 'outbound', 'inbound lead', 'inbound leads', 'sales', 'pre-sales', 'presales', 'cold call', 'cold calling', 'appointment setting', 'pipeline', 'revenue', 'quota', 'account executive', 'deal'] },
  { id: 'demo', label: 'Demo and capability discovery', short: 'Demo / Discovery', functional: false, priority: 8,
    kw: ['demo', 'capability', 'capabilities', 'discovery', 'how it works', 'how does it work', 'overview', 'walkthrough', 'walk through', 'see the product', 'product tour', 'trial', 'what it is', 'understand the product', 'show me', 'see how', 'want to see', 'like to see'] },
  { id: 'hr', label: 'HR and people operations', short: 'HR', functional: true, priority: 1,
    kw: ['hr', 'hr operations', 'hr processes', 'hr organisation', 'hr organization', 'hr team', 'human resources', 'recruit', 'recruitment', 'recruiting', 'hiring', 'hire', 'onboarding', 'people ops', 'people operations', 'talent', 'payroll', 'l&d', 'learning and development', 'employee', 'employees', 'hire to retire', 'attrition', 'workforce', 'staffing'] },
  { id: 'marketing', label: 'Marketing, content and social automation', short: 'Marketing', functional: true, priority: 4,
    kw: ['marketing', 'content', 'social', 'social media', 'linkedin', 'posts', 'seo', 'ads', 'google ads', 'facebook ads', 'paid ads', 'cmo', 'campaign', 'campaigns', 'brand', 'copywriting', 'ga4', 'blog', 'newsletter'] },
  { id: 'cs', label: 'Customer service and support', short: 'Customer service', functional: true, priority: 2,
    kw: ['customer service', 'customer support', 'support', 'helpdesk', 'help desk', 'contact center', 'contact centre', 'call center', 'call centre', 'collections', 'ticket', 'tickets', 'customer experience', 'cx', 'service desk', 'chatbot', 'faq'] },
  { id: 'finance', label: 'Finance, banking and compliance', short: 'Finance / Banking', functional: true, priority: 3,
    kw: ['finance', 'financial', 'banking', 'bank', 'compliance', 'compliant', 'claim', 'claims', 'underwriting', 'credit', 'forecasting', 'insurance', 'audit', 'invoice', 'invoices', 'accounts payable', 'kyc', 'aml', 'lending', 'loan', 'treasury', 'fintech'] },
  { id: 'platform', label: 'Enterprise platform evaluation', short: 'Platform evaluation', functional: false, priority: 6,
    kw: ['platform', 'platforms', 'framework', 'partnership', 'partnerships', 'partner', 'partner program', 'workspace', 'replace', 'foundry', 'copilot studio', 'evaluate', 'evaluating', 'evaluation', 'for clients', 'for our clients', 'for our customers', 'white label', 'white-label', 'resell', 'build platform', 'enterprise agentic', 'agentic framework', 'rfi', 'rfp', 'vendor evaluation', 'poc', 'proof of concept'] },
  { id: 'workflow', label: 'Internal and workflow automation', short: 'Workflow automation', functional: false, priority: 10,
    kw: ['workflow', 'workflows', 'work flow', 'operations', 'ops', 'logistics', 'supply chain', 'procurement', 'supplier', 'manufacturing', 'back office', 'back-office', 'reconciliation', 'unified', 'one inbox', 'internal process', 'internal processes', 'repetitive tasks', 'process automation', 'automate our', 'follow-ups', 'follow ups', 'admin', 'productivity'] },
  { id: 'exploring', label: 'Exploring and early-stage curiosity', short: 'Exploring', functional: false, priority: 9,
    kw: ['exploring', 'explore', 'experimenting', 'experiment', 'startup', 'start up', 'start-up', 'new to', 'curious', 'learn more', 'learning', 'just looking', 'looking around', 'interested', 'general', 'student', 'research', 'thesis', 'personal project', 'hobby', 'plan', 'pricing', 'price'] },
  { id: 'vertical', label: 'Vertical-specific agent builds', short: 'Vertical builds', functional: false, priority: 7,
    kw: ['automotive', 'regulatory', 'm&a', 'developer tools', 'video generation', 'video', 'healthcare', 'health', 'legal', 'real estate', 'pharma', 'education', 'retail', 'security', 'cybersecurity', 'energy', 'telecom', 'hospitality', 'travel', 'agriculture', 'construction', 'mining', 'medical', 'clinical'] },
];
const CLUSTER_BY_ID = Object.fromEntries(CLUSTERS.map(c => [c.id, c]));
export const clusterLabel = id => (CLUSTER_BY_ID[id] || {}).label || 'No message';
export const clusterShort = id => (CLUSTER_BY_ID[id] || {}).short || 'No message';

const wordRe = kw => new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?=$|[^a-z0-9])', 'i');
const KW_RES = CLUSTERS.map(c => ({ id: c.id, res: c.kw.map(wordRe) }));

/** Which intent cluster a form message belongs to. Returns a cluster id, or null when there is no message. */
export function clusterOf(message) {
  const m = String(message || '').trim().toLowerCase();
  if (!m) return null;
  const hits = {};
  for (const c of KW_RES) { let n = 0; for (const re of c.res) if (re.test(m)) n++; if (n) hits[c.id] = n; }
  const functionalHit = CLUSTERS.filter(c => c.functional && hits[c.id]).length;
  if (functionalHit >= 3) return 'workflow';
  const ids = Object.keys(hits);
  if (!ids.length) return 'exploring';
  ids.sort((a, b) => (hits[b] - hits[a]) || (CLUSTER_BY_ID[a].priority - CLUSTER_BY_ID[b].priority));
  return ids[0];
}

// ---- data quality -------------------------------------------------------------------------
const INTERNAL_DOMAINS = ['lyzr.ai', 'lyzr.com', 'lyzrteam.com', 'lyzr.team'];
const PERSONAL_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'rediffmail.com', 'protonmail.com', 'aol.com', 'ymail.com'];
const NO_COMPANY = new Set(['', 'na', 'n/a', 'none', 'nil', 'null', '-', '.', 'self', 'individual', 'student', 'personal', 'freelancer', 'freelance', 'test', 'abc', 'xyz', 'company', 'my company']);
const VENDOR_RE = /(staff augmentation|link exchange|guest post|backlink|call cent(er|re) services|we (provide|offer)|our services|outsourcing services|hire (our|dedicated) developers|business proposal|seo services|web development services|partnership proposal for)/i;
const KEYBOARD_RE = /(asdf|qwer|zxcv|hjkl|qwerty|asdfgh|zxcvb|jkl;|uiop)/i;
export function looksGibberish(s) {
  const t = String(s || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return false;
  if (KEYBOARD_RE.test(t)) return true;
  if (/(.)\1{3,}/.test(t)) return true;
  if (t.length >= 5 && !/[aeiouy]/.test(t)) return true;
  // long runs of consonants are rare in real words
  if (t.length >= 6 && /[bcdfghjklmnpqrstvwxz]{6,}/.test(t)) return true;
  return false;
}
export const emailDomain = email => { const e = String(email || '').toLowerCase(); const i = e.lastIndexOf('@'); return i < 0 ? '' : e.slice(i + 1).trim(); };
/**
 * Test / spam heuristic from the Message Intelligence report. Returns a reason string or null.
 * Reasons: 'internal test' (Lyzr domains, dummy accounts), 'gibberish', 'personal email, no company', 'vendor pitch'.
 */
export function spamReason(c) {
  const dom = emailDomain(c.email);
  const company = String(c.company_raw || '').trim().toLowerCase();
  const msg = String(c.lsa_message || '').trim();
  const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  if (INTERNAL_DOMAINS.some(d => dom === d || dom.endsWith('.' + d))) return 'internal test';
  if (/wow precision|precision health|\btest\b|dummy/.test(company) || /\btest\b|dummy/i.test(name)) return 'internal test';
  if (/^\s*(test|testing|test message|hello|hi|hey)\s*[.!]*\s*$/i.test(msg) && INTERNAL_DOMAINS.concat(PERSONAL_DOMAINS).some(d => dom === d)) return 'internal test';
  if (looksGibberish(c.first_name) || looksGibberish(c.last_name) || (msg && msg.replace(/\s/g, '').length <= 40 && looksGibberish(msg))) return 'gibberish';
  if (VENDOR_RE.test(msg)) return 'vendor pitch';
  if (PERSONAL_DOMAINS.includes(dom) && NO_COMPANY.has(company) && !c.account) return 'personal email, no company';
  return null;
}

// ---- classification helpers ----------------------------------------------------------------
/** Company type from seed/accounts.json category. Unmatched companies are "Not a target account". */
export function companyType(c, accounts) {
  if (!c.account) return 'Not a target account';
  const a = (accounts || []).find(x => x.name === c.account);
  const cat = a && a.category;
  if (!cat) return 'Other';
  return COMPANY_TYPES.includes(cat) ? cat : 'Other';
}
export const hasMessage = c => !!String(c.lsa_message || '').trim();
export const hasActivity = c => (Number(c.notes_count) || 0) > 0 || !!c.last_activity_at;
export const isTarget = c => !!c.account;
export const fullName = c => `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || c.hs_id;
export const ownerKey = c => c.owner_name || c.owner_id || '';
export const isoDayIST = ts => { if (!ts) return ''; const d = new Date(ts); if (isNaN(d)) return ''; return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10); };
export const daysSince = (ts, now = Date.now()) => { if (!ts) return null; const d = new Date(ts); if (isNaN(d)) return null; return Math.max(0, Math.floor((now - d.getTime()) / 864e5)); };

/** Adds derived fields used by the views: cluster (+ clusterBy), company_type, spam, name, day. Does not mutate input rows. */
export function enrich(contacts, notesByContact = {}, accounts = []) {
  return (contacts || []).map(c => {
    const notes = notesByContact[c.hs_id] || [];
    const notes_count = Math.max(Number(c.notes_count) || 0, notes.length);
    // Claude's reading (hubspot/classify.js, ai_* columns) wins; keyword rules cover messages not read yet.
    const aiCluster = c.ai_cluster && CLUSTER_BY_ID[c.ai_cluster] ? c.ai_cluster : null;
    const x = { ...c, notes_count, notes, cluster: hasMessage(c) ? (aiCluster || clusterOf(c.lsa_message)) : null, clusterBy: aiCluster ? 'claude' : (hasMessage(c) ? 'keywords' : null), company_type: companyType(c, accounts), spam: c.ai_spam ? 'spam or test (Claude)' : spamReason(c), name: fullName(c), day: isoDayIST(c.created_at) };
    x.active = hasActivity(x);
    return x;
  });
}

// ---- aggregations --------------------------------------------------------------------------
export function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k === undefined || k === null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
export const sortedEntries = m => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

/** rows -> Map(rowKey -> Map(colKey -> count)). Keys are produced by rowFn / colFn. */
export function crossTab(rows, rowFn, colFn) {
  const m = new Map();
  for (const r of rows) {
    const rk = rowFn(r), ck = colFn(r);
    if (rk == null || ck == null) continue;
    if (!m.has(rk)) m.set(rk, new Map());
    const row = m.get(rk); row.set(ck, (row.get(ck) || 0) + 1);
  }
  return m;
}
export const rowTotal = row => [...row.values()].reduce((a, b) => a + b, 0);

/** Band counts per time bucket. Returns [{key, MD, 'MD-1', 'MD-2', Other, Unknown, total}] sorted by key. */
export function bucketCounts(rows, gran = 'week', bucketKey = defaultBucketKey) {
  const m = new Map();
  for (const r of rows) {
    const day = r.day || isoDayIST(r.created_at); if (!day) continue;
    const k = bucketKey(day, gran);
    if (!m.has(k)) m.set(k, { key: k, MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0, Unknown: 0, total: 0 });
    const b = m.get(k); const band = BANDS.includes(r.band) ? r.band : 'Unknown';
    b[band]++; b.total++;
  }
  return [...m.values()].sort((a, b) => a.key < b.key ? -1 : 1);
}
/** Growth of `total` against the previous bucket, as a fraction (0.5 = +50%). null when there is no prior bucket or it was 0. */
export function withGrowth(buckets, field = 'total') {
  return buckets.map((b, i) => { const prev = i ? buckets[i - 1][field] : null; return { ...b, growth: prev ? (b[field] - prev) / prev : null }; });
}
export function bandCounts(rows) { const o = { MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0, Unknown: 0, total: 0 }; for (const r of rows) { const b = BANDS.includes(r.band) ? r.band : 'Unknown'; o[b]++; o.total++; } return o; }
export const share = (n, d) => d ? n / d : null;

/** Source breakdown: lead_source (falls back to source) with band mix and target-account share. */
export function sourceBreakdown(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.lead_source || r.source || 'Unknown';
    if (!by.has(k)) by.set(k, { source: k, leads: 0, MD: 0, 'MD-1': 0, 'MD-2': 0, Other: 0, Unknown: 0, target: 0, withMessage: 0, active: 0 });
    const s = by.get(k); s.leads++; s[BANDS.includes(r.band) ? r.band : 'Unknown']++;
    if (r.account) s.target++; if (hasMessage(r)) s.withMessage++; if (hasActivity(r)) s.active++;
  }
  return [...by.values()].sort((a, b) => b.leads - a.leads);
}

/** Follow-up health per owner. Unowned leads are grouped under "Unassigned". */
export function ownerHealth(rows, now = Date.now()) {
  const by = new Map();
  for (const r of rows) {
    const k = ownerKey(r) || 'Unassigned';
    if (!by.has(k)) by.set(k, { owner: k, leads: 0, active: 0, md: 0, target: 0, lastActivity: null, idleDays: [], });
    const o = by.get(k); o.leads++;
    if (r.band === 'MD' || r.band === 'MD-1') o.md++; if (r.account) o.target++;
    if (hasActivity(r)) { o.active++; if (r.last_activity_at && (!o.lastActivity || r.last_activity_at > o.lastActivity)) o.lastActivity = r.last_activity_at; }
    else { const d = daysSince(r.created_at, now); if (d != null) o.idleDays.push(d); }
  }
  return [...by.values()].map(o => ({ ...o, activeShare: share(o.active, o.leads), avgIdleDays: o.idleDays.length ? o.idleDays.reduce((a, b) => a + b, 0) / o.idleDays.length : null })).sort((a, b) => b.leads - a.leads);
}

/** Action list: MD / MD-1 leads at target accounts with no activity in the last `days` days (never touched counts from created_at). */
export function actionList(rows, now = Date.now(), days = 7) {
  return rows.filter(r => r.account && (r.band === 'MD' || r.band === 'MD-1')).map(r => {
    const ref = r.last_activity_at || r.created_at; const idle = daysSince(ref, now);
    return { ...r, idleDays: idle, touched: !!r.last_activity_at };
  }).filter(r => r.idleDays != null && r.idleDays >= days).sort((a, b) => b.idleDays - a.idleDays);
}

/** Simple generic sort; `dir` is 1 or -1. Numbers sort numerically, strings case-insensitively, blanks last. */
export function sortRows(rows, key, dir = 1, getter) {
  const g = getter || (r => r[key]);
  return [...rows].sort((a, b) => {
    const x = g(a), y = g(b);
    const xe = x == null || x === '', ye = y == null || y === '';
    if (xe && ye) return 0; if (xe) return 1; if (ye) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true }) * dir;
  });
}

/** Client-side CSV. cols: [{k, h, f?}] -> f(row) gives the cell value. Values are quoted when needed. */
export function toCsv(rows, cols) {
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(c => cell(c.h)).join(',')];
  for (const r of rows) lines.push(cols.map(c => cell(c.f ? c.f(r) : r[c.k])).join(','));
  return lines.join('\r\n');
}

/** Filters used by both views. f = {region, account, companyType, band, owner, cluster, hasMessage, hasActivity, excludeSpam}. */
export function applyFilters(rows, f = {}) {
  return rows.filter(r => {
    if (f.excludeSpam && r.spam) return false;
    if (f.region && r.region !== f.region) return false;
    if (f.account && (r.account || 'Not a target account') !== f.account) return false;
    if (f.companyType && r.company_type !== f.companyType) return false;
    if (f.band && (r.band || 'Unknown') !== f.band) return false;
    if (f.owner && (ownerKey(r) || 'Unassigned') !== f.owner) return false;
    if (f.cluster && r.cluster !== f.cluster) return false;
    if (f.hasMessage === 'yes' && !hasMessage(r)) return false;
    if (f.hasMessage === 'no' && hasMessage(r)) return false;
    if (f.hasActivity === 'yes' && !hasActivity(r)) return false;
    if (f.hasActivity === 'no' && hasActivity(r)) return false;
    if (f.q) { const q = f.q.toLowerCase(); const hay = [r.name, r.email, r.company_raw, r.account, r.jobtitle, r.lsa_message, r.owner_name, r.country].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
}

/** Summary counts for a set of rows (used by tiles and the AI input). */
export function summary(rows) {
  const bands = bandCounts(rows);
  return {
    leads: rows.length, withMessage: rows.filter(hasMessage).length, withActivity: rows.filter(hasActivity).length,
    target: rows.filter(isTarget).length, md: bands.MD, md1: bands['MD-1'], md2: bands['MD-2'], other: bands.Other, unknown: bands.Unknown,
    unowned: rows.filter(r => !ownerKey(r)).length, spam: rows.filter(r => r.spam).length,
  };
}

// ---- source channel, recent activity, GSI flag ---------------------------------------------
// hs_analytics_source values -> readable channel. A lead whose source fields mention GSI (the GSI
// form, a GSI campaign) is "GSI form" whatever the analytics source says.
export const SOURCE_LABEL = {
  ORGANIC_SEARCH: 'Organic search', PAID_SEARCH: 'Paid search', PAID_SOCIAL: 'Paid social', SOCIAL_MEDIA: 'Organic social',
  EMAIL_MARKETING: 'Email marketing', DIRECT_TRAFFIC: 'Direct', REFERRALS: 'Referral', OTHER_CAMPAIGNS: 'Other campaigns',
  OFFLINE: 'Offline (import, CRM, integration)', AI_REFERRALS: 'AI referral',
};
export function sourceChannel(c) {
  const p = c.props || {};
  const text = [c.lead_source, c.source_detail, p.recent_conversion_event_name, p.first_conversion_event_name, p.lsa_lead_source, p.hs_latest_source_data_1].filter(Boolean).join(' ');
  if (/\bgsi\b/i.test(text)) return 'GSI form';
  if (/linkedin/i.test(text) && /lead ?gen|form/i.test(text)) return 'LinkedIn lead form';
  const s = String(c.source || '').toUpperCase();
  return SOURCE_LABEL[s] || (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, x => x.toUpperCase()) : (c.lead_source ? String(c.lead_source) : 'Unknown'));
}
export function sourceDetail(c) {
  const p = c.props || {};
  return p.recent_conversion_event_name || p.first_conversion_event_name || c.source_detail || c.lead_source || '';
}

const tsOf = v => { if (v == null || v === '') return null; const n = Number(v); const d = Number.isFinite(n) && String(v).trim() === String(n) ? new Date(n) : new Date(v); return isNaN(d) ? null : d.toISOString(); };
const ACT_TYPE = { CALL: 'Call logged', MEETING: 'Meeting logged', EMAIL: 'Sales email', NOTE: 'Note', TASK: 'Task', INCOMING_EMAIL: 'Email reply received', FORWARDED_EMAIL: 'Email forwarded' };
/** The most recent thing that happened with a lead: { ts, label, detail } or null. */
export function recentActivity(c) {
  const p = c.props || {};
  const out = [];
  const push = (ts, label, detail = '') => { const t = tsOf(ts); if (t) out.push({ ts: t, label, detail }); };
  if (c.last_activity_at) push(c.last_activity_at, ACT_TYPE[String(c.last_activity_type || '').toUpperCase()] || (c.last_activity_type ? String(c.last_activity_type).toLowerCase().replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) : 'Sales activity'));
  const notes = (c.notes || []).filter(n => n.created_at).sort((a, b) => a.created_at < b.created_at ? 1 : -1);
  if (notes[0]) push(notes[0].created_at, 'Note', String(notes[0].body || '').replace(/\s+/g, ' ').slice(0, 160));
  push(p.hs_sales_email_last_replied, 'Replied to a sales email');
  push(p.hs_last_booked_meeting_date, 'Meeting booked');
  push(p.hs_email_last_click_date, 'Clicked a marketing email', p.hs_email_last_email_name || '');
  push(p.hs_email_last_open_date, 'Opened a marketing email', p.hs_email_last_email_name || '');
  push(p.recent_conversion_date, 'Form submitted', p.recent_conversion_event_name || '');
  push(p.notes_last_contacted, 'Contacted');
  if (!out.length) return null;
  out.sort((a, b) => a.ts < b.ts ? 1 : -1);
  // prefer the richer label when two land on the same moment
  return out[0];
}

const toks = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/** Build a matcher for the GSI company list: whole-token match on company, or the email domain name. */
export function gsiMatcher(list) {
  const entries = (list || []).map(n => { const base = String(n).replace(/\s*\([^)]*\)\s*$/, ''); return { name: String(n), t: toks(base), flat: toks(base).join('') }; }).filter(e => e.t.length);
  return c => {
    const ct = toks(c.company_raw || '');
    const dom = String(c.email || '').toLowerCase().split('@')[1] || '';
    const root = dom.split('.').slice(-2)[0] || '';
    for (const e of entries) {
      if (ct.length >= e.t.length) for (let i = 0; i + e.t.length <= ct.length; i++) { let ok = true; for (let j = 0; j < e.t.length; j++) if (ct[i + j] !== e.t[j]) { ok = false; break; } if (ok) return e.name; }
      if (root && e.flat.length >= 3 && root === e.flat) return e.name;
    }
    return null;
  };
}
