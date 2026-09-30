// Pure helpers for the Email (Instantly) view. No DOM, no fetch: runs under node --test
// (tests/frontend/email-agg.test.mjs).
//
// Event shape (after expand()): { campaign, contact, step, event, ts, sender, link, lag }
// event: sent | opened | clicked | bounced | auto_reply | replied | unsubscribed | other
// enrich() adds: day (IST), company, cat, label, demo ('direct' | 'via' | null), fast, human.
import { isoDayIST } from './leads-agg.mjs';

export const CATEGORY_ORDER = ['Book a Demo', 'Webinar & Events', 'Case Studies', 'Playbooks', 'Blogs', 'Product Pages', 'Assessments & Tools', 'Analyst & Recognition', 'Press & News', 'GSI/SI Partner Page', 'Website', 'Other'];
export const DEFAULT_RULES = { fast_click_seconds: 180, gsi_page_counts_as_demo: true, link_rules: [], domains: {} };
export const SEGMENTS = ['demo', 'engaged', 'opened', 'sent'];
export const SEGMENT_LABEL = { demo: 'Book a Demo', engaged: 'Other clicks, no Book a Demo', opened: 'Opened, no click', sent: 'Sent only' };

// Email domain -> company. Settings › Email rules › domains overrides these.
export const KNOWN_DOMAINS = {
  'tcs.com': 'TCS', 'infosys.com': 'Infosys', 'wipro.com': 'Wipro', 'hcltech.com': 'HCLTech', 'hcl.com': 'HCLTech', 'techmahindra.com': 'Tech Mahindra',
  'ltimindtree.com': 'LTIMindtree', 'lntinfotech.com': 'LTIMindtree', 'mindtree.com': 'LTIMindtree', 'cognizant.com': 'Cognizant', 'genpact.com': 'Genpact',
  'capgemini.com': 'Capgemini', 'epam.com': 'EPAM', 'nttdata.com': 'NTT Data', 'global.ntt': 'NTT Data', 'fujitsu.com': 'Fujitsu', 'thoughtworks.com': 'Thoughtworks',
  'accenture.com': 'Accenture', 'deloitte.com': 'Deloitte', 'deloitte.co.uk': 'Deloitte', 'ey.com': 'EY', 'in.ey.com': 'EY', 'uk.ey.com': 'EY', 'kpmg.com': 'KPMG', 'kpmg.co.uk': 'KPMG',
  'pwc.com': 'PwC', 'in.pwc.com': 'PwC', 'mckinsey.com': 'McKinsey', 'bcg.com': 'BCG', 'bain.com': 'Bain', 'atkearney.com': 'Kearney', 'kearney.com': 'Kearney',
  'oliverwyman.com': 'Oliver Wyman', 'bah.com': 'Booz Allen', 'boozallen.com': 'Booz Allen', 'simon-kucher.com': 'Simon-Kucher', 'rolandberger.com': 'Roland Berger',
  'lek.com': 'L.E.K. Consulting', 'occstrategy.com': 'OC&C', 'adlittle.com': 'Arthur D. Little', 'firstsource.com': 'Firstsource', 'cgi.com': 'CGI', 'dxc.com': 'DXC',
  'atos.net': 'Atos', 'ust.com': 'UST', 'virtusa.com': 'Virtusa', 'mphasis.com': 'Mphasis', 'persistent.com': 'Persistent', 'coforge.com': 'Coforge', 'hexaware.com': 'Hexaware',
  'zensar.com': 'Zensar', 'birlasoft.com': 'Birlasoft', 'cyient.com': 'Cyient', 'happiestminds.com': 'Happiest Minds', 'sonata-software.com': 'Sonata Software',
  'exlservice.com': 'EXL', 'publicissapient.com': 'Publicis Sapient', 'avanade.com': 'Avanade', 'bearingpoint.com': 'BearingPoint', 'protiviti.com': 'Protiviti',
  'paconsulting.com': 'PA Consulting', 'capco.com': 'Capco', 'alixpartners.com': 'AlixPartners', 'zs.com': 'ZS Associates', 'ltts.com': 'L&T Technology Services',
  'nagarro.com': 'Nagarro', 'globant.com': 'Globant', 'endava.com': 'Endava', 'grid-dynamics.com': 'Grid Dynamics', 'griddynamics.com': 'Grid Dynamics', 'ibm.com': 'IBM', 'in.ibm.com': 'IBM',
};
const PERSONAL = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'rediffmail.com', 'protonmail.com', 'aol.com']);

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
export const domainOf = email => { const e = String(email || '').toLowerCase(); const i = e.lastIndexOf('@'); return i < 0 ? '' : e.slice(i + 1).trim(); };
const titleCase = s => s.replace(/[-_.]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());

/** Company for a contact email: Settings domains, then known domains, then the target accounts list, then the domain name. */
export function companyOf(email, rules = DEFAULT_RULES, accounts = []) {
  const d = domainOf(email);
  if (!d) return 'Unknown';
  const overrides = (rules && rules.domains) || {};
  const walk = host => { const parts = host.split('.'); const out = []; for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.')); return out; };
  for (const h of walk(d)) { if (overrides[h]) return overrides[h]; if (KNOWN_DOMAINS[h]) return KNOWN_DOMAINS[h]; }
  if (PERSONAL.has(d)) return 'Personal email';
  const root = d.split('.').slice(-2)[0] === 'co' ? d.split('.').slice(-3)[0] : d.split('.').slice(-2)[0];
  for (const a of accounts || []) {
    for (const n of [a.name, ...(a.aliases || [])]) if (n && norm(n) === norm(root)) return a.name;
  }
  return titleCase(root);
}

const ACRONYMS = { ai: 'AI', hfs: 'HFS', gsi: 'GSI', gsis: 'GSIs', si: 'SI', sis: 'SIs', cx: 'CX', hr: 'HR', llm: 'LLM', llms: 'LLMs', roi: 'ROI', sdr: 'SDR', rag: 'RAG', aws: 'AWS', ibm: 'IBM', tcs: 'TCS', ey: 'EY', kpmg: 'KPMG', pwc: 'PwC', bcg: 'BCG', cio: 'CIO', cto: 'CTO', ceo: 'CEO', bfsi: 'BFSI', saas: 'SaaS', api: 'API' };
const slugTitle = s => { let x = ''; try { x = decodeURIComponent(String(s || '')); } catch { x = String(s || ''); } return titleCase(x.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '').split(' ').map(w => ACRONYMS[w.toLowerCase()] || (/^\d+[a-z]$/i.test(w) ? w.toUpperCase() : w)).join(' '); };
function matches(rule, url) {
  const m = String(rule.match || '');
  if (m.length > 2 && m.startsWith('/') && m.lastIndexOf('/') > 0) { try { const last = m.lastIndexOf('/'); return new RegExp(m.slice(1, last), m.slice(last + 1) || 'i').test(url); } catch { return false; } }
  return url.toLowerCase().includes(m.toLowerCase());
}

/** Link type, readable label and Book a Demo flag for a clicked URL. */
export function linkInfo(url, rules = DEFAULT_RULES) {
  const raw = String(url || '').trim();
  if (!raw) return { cat: 'Other', label: '(no link)', demo: null };
  for (const r of (rules && rules.link_rules) || []) if (r && r.match && matches(r, raw)) return { cat: r.category, label: r.label || r.category, demo: r.category === 'Book a Demo' ? 'direct' : null };
  let host = '', path = '';
  try { const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw); host = u.hostname.replace(/^www\./, '').toLowerCase(); path = u.pathname.toLowerCase(); } catch { path = raw.toLowerCase(); }
  const lyzr = /(^|\.)lyzr\.(ai|com|app)$/.test(host);
  if (/calendly\.com|(^|\.)cal\.com|meetings\.hubspot\.com|zcal\.co|savvycal\.com/.test(host) || /\/(book-?a?-?demo|demo|request-demo|schedule)(\/|$)/.test(path)) return { cat: 'Book a Demo', label: 'Book a Demo', demo: 'direct' };
  if (/\/gsi(-si)?(\/|$)|\/partners?\/gsi/.test(path)) return (rules && rules.gsi_page_counts_as_demo === false) ? { cat: 'GSI/SI Partner Page', label: 'GSI/SI page', demo: null } : { cat: 'Book a Demo', label: 'Book a Demo (via GSI/SI page)', demo: 'via' };
  if (/\/case-?stud/.test(path)) return { cat: 'Case Studies', label: 'Case Study: ' + slugTitle(path), demo: null };
  if (/playbook/.test(path)) return { cat: 'Playbooks', label: 'Playbook: ' + slugTitle(path), demo: null };
  if (/\/blog/.test(path)) return { cat: 'Blogs', label: 'Blog: ' + slugTitle(path), demo: null };
  if (/webinar|\/events?(\/|$)/.test(path) || /lu\.ma|luma\.com|zoom\.us|eventbrite/.test(host)) return { cat: 'Webinar & Events', label: 'Event: ' + (slugTitle(path) || host), demo: null };
  if (/assessment|\/tools?(\/|$)|calculator|roadmap|quiz|readiness/.test(path)) return { cat: 'Assessments & Tools', label: 'Assessment: ' + slugTitle(path), demo: null };
  if (/cbinsights|gartner|forrester|hfsresearch|everestgrp|idc\.com|isg-one/.test(host) || /analyst|recognition|award|ai-100|tracker/.test(path)) return { cat: 'Analyst & Recognition', label: (host && !lyzr ? titleCase(host.split('.')[0]) + ': ' : '') + (slugTitle(path) || 'Analyst'), demo: null };
  if (/\/(press|news|newsroom)/.test(path) || /prnewswire|businesswire|globenewswire/.test(host)) return { cat: 'Press & News', label: 'News: ' + slugTitle(path), demo: null };
  if (lyzr && /\/(agent-studio|products?|platform|solutions?|pricing|features|agents?|studio|architect|enterprise|lyzr-)/.test(path)) return { cat: 'Product Pages', label: 'Product: ' + slugTitle(path), demo: null };
  if (lyzr) return { cat: 'Website', label: path === '/' || !path ? 'Lyzr.ai Homepage' : 'Lyzr.ai ' + path.replace(/\/+$/, ''), demo: null };
  return { cat: 'Other', label: host || raw.slice(0, 60), demo: null };
}

/** Expand the API's compact pages into event objects. */
export function expand(pages) {
  const out = [];
  for (const p of pages || []) {
    const C = p.campaigns || [], S = p.senders || [];
    for (const e of p.events || []) out.push({ campaign: C[e[0]] || '', contact: e[1], step: e[2], event: e[3], ts: e[4], sender: S[e[5]] || '', link: e[6] || '', lag: e[7] == null ? null : Number(e[7]) });
  }
  return out;
}

/** Adds derived fields. Link and company lookups are memoised because exports repeat them. */
export function enrich(events, rules = DEFAULT_RULES, accounts = []) {
  const R = { ...DEFAULT_RULES, ...(rules || {}) };
  const fast = Number(R.fast_click_seconds) || 0;
  const links = new Map(), companies = new Map();
  return (events || []).map(e => {
    const x = { ...e, day: e.day || isoDayIST(e.ts) };
    if (!companies.has(e.contact)) companies.set(e.contact, companyOf(e.contact, R, accounts));
    x.company = companies.get(e.contact);
    if (e.event === 'clicked') {
      if (!links.has(e.link)) links.set(e.link, linkInfo(e.link, R));
      const li = links.get(e.link);
      x.cat = li.cat; x.label = li.label; x.demo = li.demo;
      x.fast = fast > 0 && e.lag != null && e.lag >= 0 && e.lag < fast;
      x.human = !x.fast;
    }
    return x;
  });
}

export const inRange = (e, from, to) => (!from || e.day >= from) && (!to || e.day <= to);
const add = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const uniq = (events, pred) => { const s = new Set(); for (const e of events) if (pred(e)) s.add(e.contact); return s; };

/** Funnel numbers for any set of enriched events. Contacts are unique people. */
export function funnel(events) {
  const reached = uniq(events, e => e.event === 'sent');
  const opened = uniq(events, e => e.event === 'opened');
  const clickers = uniq(events, e => e.event === 'clicked' && e.human);
  const demo = uniq(events, e => e.event === 'clicked' && e.human && e.demo);
  const direct = uniq(events, e => e.event === 'clicked' && e.human && e.demo === 'direct');
  const via = uniq(events, e => e.event === 'clicked' && e.human && e.demo === 'via');
  let sent = 0, clicks = 0, fast = 0, bounced = 0, replied = 0, unsub = 0;
  for (const e of events) {
    if (e.event === 'sent') sent++;
    else if (e.event === 'clicked') { if (e.human) clicks++; else fast++; }
    else if (e.event === 'bounced') bounced++;
    else if (e.event === 'replied') replied++;
    else if (e.event === 'unsubscribed') unsub++;
  }
  const n = reached.size;
  return {
    sent, reached: n, opened: opened.size, clickers: clickers.size, demo: demo.size, demoDirect: direct.size, demoVia: via.size,
    clicks, fastClicks: fast, bounced, replied, unsubscribed: unsub,
    openRate: n ? opened.size / n * 100 : null, clickRate: n ? clickers.size / n * 100 : null, demoRate: n ? demo.size / n * 100 : null,
  };
}

/** One record per person across the given events (all campaigns). */
export function people(events) {
  const by = new Map();
  for (const e of events) {
    let p = by.get(e.contact);
    if (!p) { p = { email: e.contact, company: e.company, campaigns: new Set(), sent: 0, opens: 0, clicks: 0, fastClicks: 0, demoDirect: 0, demoVia: 0, bounced: false, replied: false, cats: {}, links: new Map(), timeline: [], firstTs: e.ts, lastTs: e.ts, lastClick: null, demoDates: [] }; by.set(e.contact, p); }
    p.campaigns.add(e.campaign); p.timeline.push(e);
    if (e.ts < p.firstTs) p.firstTs = e.ts; if (e.ts > p.lastTs) p.lastTs = e.ts;
    if (e.event === 'sent') p.sent++;
    else if (e.event === 'opened') p.opens++;
    else if (e.event === 'bounced') p.bounced = true;
    else if (e.event === 'replied') p.replied = true;
    else if (e.event === 'clicked') {
      const l = p.links.get(e.label) || { label: e.label, cat: e.cat, url: e.link, demo: e.demo, count: 0, fast: 0, dates: [] };
      l.dates.push(e.ts);
      if (e.human) {
        l.count++; p.clicks++; p.cats[e.cat] = (p.cats[e.cat] || 0) + 1;
        if (e.demo === 'direct') p.demoDirect++; if (e.demo === 'via') p.demoVia++;
        if (e.demo) p.demoDates.push(e.ts);
        if (!p.lastClick || e.ts > p.lastClick) p.lastClick = e.ts;
      } else { l.fast++; p.fastClicks++; }
      p.links.set(e.label, l);
    }
  }
  for (const p of by.values()) {
    p.demo = p.demoDirect + p.demoVia;
    p.segment = p.demo ? 'demo' : p.clicks ? 'engaged' : p.opens ? 'opened' : 'sent';
    p.timeline.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
    p.campaignList = [...p.campaigns];
  }
  return [...by.values()].sort((a, b) => (b.demo - a.demo) || (b.clicks - a.clicks) || (b.opens - a.opens) || (a.email < b.email ? -1 : 1));
}

/** Per campaign: funnel, companies, link popularity, clicks by step, engagement by type, span. */
export function campaigns(events) {
  const by = new Map();
  for (const e of events) { if (!by.has(e.campaign)) by.set(e.campaign, []); by.get(e.campaign).push(e); }
  return [...by.entries()].map(([name, ev]) => {
    const f = funnel(ev);
    const companies = new Map(), linkPop = new Map(), stepClicks = new Map(), stepSent = new Map(), senders = new Set();
    const reachedCo = new Map();
    for (const e of ev) {
      if (e.sender) senders.add(e.sender);
      if (e.event === 'sent') { add(stepSent, e.step || 0); reachedCo.set(e.contact, e.company); }
      if (e.event === 'clicked' && e.human) { add(linkPop, e.label); add(stepClicks, e.step || 0); }
    }
    for (const co of reachedCo.values()) add(companies, co);
    const days = ev.map(e => e.day).sort();
    return { name, ...f, companies, linkPop, stepClicks, stepSent, catStats: catStats(ev), senders: [...senders], first: days[0], last: days[days.length - 1], events: ev };
  }).sort((a, b) => (b.demo - a.demo) || (b.clickers - a.clickers) || (b.sent - a.sent));
}

/** Unique people per link type; how many of them also clicked Book a Demo. */
export function catStats(events) {
  const demoPeople = uniq(events, e => e.event === 'clicked' && e.human && e.demo);
  const out = {};
  for (const cat of CATEGORY_ORDER) {
    const ev = events.filter(e => e.event === 'clicked' && e.human && e.cat === cat);
    if (!ev.length) continue;
    const ppl = new Set(ev.map(e => e.contact));
    const withDemo = [...ppl].filter(c => demoPeople.has(c)).length;
    out[cat] = { people: ppl.size, clicks: ev.length, demoPeople: withDemo, otherPeople: ppl.size - withDemo, contacts: [...ppl] };
  }
  return out;
}

/** Per company (account): funnel plus campaigns touched and last human click. */
export function accounts(events) {
  const by = new Map();
  for (const e of events) { if (!by.has(e.company)) by.set(e.company, []); by.get(e.company).push(e); }
  return [...by.entries()].map(([company, ev]) => {
    const lastClick = ev.filter(e => e.event === 'clicked' && e.human).reduce((m, e) => !m || e.ts > m ? e.ts : m, null);
    return { company, ...funnel(ev), campaigns: new Set(ev.map(e => e.campaign)).size, lastClick, cats: catStats(ev) };
  }).sort((a, b) => (b.demo - a.demo) || (b.clickers - a.clickers) || (b.reached - a.reached));
}

/** Per sending mailbox: deliverability read (opens and clicks of the people it sent to). */
export function senders(events) {
  const by = new Map();
  for (const e of events) { const k = e.sender || '(unknown)'; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return [...by.entries()].map(([sender, ev]) => ({ sender, ...funnel(ev), campaigns: new Set(ev.map(e => e.campaign)).size })).sort((a, b) => b.sent - a.sent);
}

/** Heat-map cross tab of unique people: rowFn(e) x colFn(e) for events passing pred. */
export function peopleCross(events, pred, rowFn, colFn) {
  const m = new Map();
  for (const e of events) {
    if (!pred(e)) continue;
    const r = rowFn(e), c = colFn(e);
    if (!m.has(r)) m.set(r, new Map());
    const row = m.get(r); if (!row.has(c)) row.set(c, new Set()); row.get(c).add(e.contact);
  }
  const out = new Map();
  for (const [r, row] of m) out.set(r, new Map([...row].map(([c, s]) => [c, s.size])));
  return out;
}

// ---- trend metrics (used by js/trend.mjs over any bucket of events + API daily rows) ----------
const ev = items => items.filter(i => !i._api);
const api = items => items.filter(i => i._api);
const sumApi = (items, k) => api(items).reduce((a, r) => a + (Number(r[k]) || 0), 0);
export const TREND_METRICS = [
  { key: 'sent', label: 'Emails sent', fn: it => ev(it).filter(e => e.event === 'sent').length, additive: true },
  { key: 'reached', label: 'Contacts reached', fn: it => uniq(ev(it), e => e.event === 'sent').size, additive: true },
  { key: 'opened', label: 'Contacts opened', fn: it => uniq(ev(it), e => e.event === 'opened').size, additive: true },
  { key: 'clickers', label: 'Human clickers', fn: it => uniq(ev(it), e => e.event === 'clicked' && e.human).size, additive: true },
  { key: 'demo', label: 'Book a Demo clickers', fn: it => uniq(ev(it), e => e.event === 'clicked' && e.human && e.demo).size, additive: true },
  { key: 'fast', label: 'Fast clicks (flagged)', fn: it => ev(it).filter(e => e.event === 'clicked' && !e.human).length, additive: true },
  { key: 'openRate', label: 'Open rate', fmt: 'pct', axis: 'right', fn: it => { const r = uniq(ev(it), e => e.event === 'sent').size; return r ? uniq(ev(it), e => e.event === 'opened').size / r * 100 : null; } },
  { key: 'clickRate', label: 'Click rate', fmt: 'pct', axis: 'right', fn: it => { const r = uniq(ev(it), e => e.event === 'sent').size; return r ? uniq(ev(it), e => e.event === 'clicked' && e.human).size / r * 100 : null; } },
  { key: 'apiSent', label: 'Sent (Instantly API)', fn: it => sumApi(it, 'sent'), additive: true, api: true },
  { key: 'apiReplies', label: 'Replies (Instantly API)', fn: it => sumApi(it, 'unique_replies'), additive: true, api: true },
  { key: 'apiClicks', label: 'Unique clicks (Instantly API)', fn: it => sumApi(it, 'unique_clicks'), additive: true, api: true },
  { key: 'apiOpps', label: 'Opportunities (Instantly API)', fn: it => sumApi(it, 'opportunities'), additive: true, api: true },
];

// ---- copy helpers -----------------------------------------------------------------------------
export const tsvCell = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
export function peopleTsv(list) {
  const head = ['Email', 'Company', 'Segment', 'Book a Demo clicks', 'Direct calendar', 'Via GSI/SI page', 'Human clicks', 'Fast clicks', 'Opens', 'Emails sent', 'Link types', 'Campaigns', 'Last human click (UTC)'];
  const rows = list.map(p => [p.email, p.company, SEGMENT_LABEL[p.segment], p.demo, p.demoDirect, p.demoVia, p.clicks, p.fastClicks, p.opens, p.sent, Object.keys(p.cats).join('; '), p.campaignList.join('; '), p.lastClick || '']);
  return [head, ...rows].map(r => r.map(tsvCell).join('\t')).join('\n');
}
