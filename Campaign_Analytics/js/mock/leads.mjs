// Demo data for Lead analytics: LinkedIn lead gen form leads in two uploaded files and the LinkedIn API pull,
// plus two screenshots Claude "read". Built deterministically (seeded PRNG) at import time; campaign names
// match the ad sets in js/mock/linkedin.mjs so spend and CPL join. Also answers POST li-leads, POST
// screenshots and DELETE li-leads with in-memory success (nothing is saved).
import { normaliseLead, leadKey } from '../lib/li-leads.mjs';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261021);
const pickW = list => { const tot = list.reduce((a, x) => a + (x.w || 1), 0); let r = rnd() * tot; for (const x of list) { r -= x.w || 1; if (r <= 0) return x; } return list[list.length - 1]; };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

const CAMPAIGNS = [
  { name: "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26", group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', start: '2026-09-02', w: 40, form: 'Agentic AI Roadmap playbook', ad: 'Agentic AI Roadmap: the 90-day plan for GSI practice leads' },
  { name: "Playbooks|GSI&SI|Seniorities|Lead Gen- 14 Aug'26", group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', start: '2026-08-14', w: 24, form: 'Enterprise AI Playbook', ad: 'Enterprise AI Playbook: from pilots to production' },
  { name: "Retargeting Aud|GSI&SI|Playbooks - 21 July'26", group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', start: '2026-08-14', w: 16, form: 'Agentic AI Roadmap playbook', ad: 'Agents to Production: what breaks and how to fix it' },
  { name: "Combined Native + Custom|SI|Playbooks-16 Sept'26", group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', start: '2026-09-16', w: 14, form: 'Enterprise AI Playbook', ad: 'Enterprise AI Playbook: from pilots to production' },
  { name: 'Custom Aud|GSI&SI|Playbooks|Lead Gen- 1/09/26', group: 'LinkedIn Ads-GSI & SI|Playbook Lead Gen', start: '2026-09-01', w: 5, form: 'Agentic AI Roadmap playbook', ad: 'Agentic AI Roadmap: the 90-day plan for GSI practice leads' },
  { name: 'GSI&SI|Book a demo|Lead generation - Sep 18, 2026', group: 'GSI & SI Lead Gen|Book a Demo', start: '2026-09-18', w: 6, form: 'Book a demo of Lyzr Agent Studio', ad: 'Book a 30 minute demo of Lyzr Agent Studio' },
  { name: "GSI&SI|ANI|Conversation Ads|Lead Gen- 26 Aug'26", group: 'GSI & SI Lead Gen|Conversion', start: '2026-09-01', w: 5, form: 'Conversation ad: talk to Ani', ad: 'Ani: Quick question about your agentic AI practice' },
  { name: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", group: 'Middle East Awareness - Brand Awareness - 12/06/2026', start: '2026-10-05', w: 18, form: 'Agentic AI Roadmap playbook (Arabic and English)', ad: 'Sovereign AI agents for Gulf enterprises', me: true },
];
const COMPANIES = [
  { name: 'EY', dom: 'ey.example', w: 9 }, { name: 'Deloitte', dom: 'deloitte.example', w: 9 }, { name: 'Accenture', dom: 'accenture.example', w: 12 }, { name: 'HCLTech', dom: 'hcltech.example', w: 7 },
  { name: 'PwC', dom: 'pwc.example', w: 7 }, { name: 'Genpact', dom: 'genpact.example', w: 5 }, { name: 'Wipro', dom: 'wipro.example', w: 7 }, { name: 'Infosys', dom: 'infosys.example', w: 8 },
  { name: 'KPMG', dom: 'kpmg.example', w: 6 }, { name: 'Capgemini', dom: 'capgemini.example', w: 6 }, { name: 'TCS', dom: 'tcs.example', w: 9 }, { name: 'Northwind Analytics', dom: 'northwind.example', w: 2 }, { name: 'Freelance', dom: 'gmail.com', w: 1 },
];
const TITLES = [
  { t: 'Managing Director', s: 'Partner', w: 4 }, { t: 'Partner', s: 'Partner', w: 5 }, { t: 'Senior Vice President', s: 'VP', w: 2 }, { t: 'Associate Partner', s: 'Partner', w: 4 },
  { t: 'Vice President', s: 'VP', w: 4 }, { t: 'Senior Director', s: 'Director', w: 3 }, { t: 'Director', s: 'Director', w: 6 }, { t: 'Principal', s: 'Senior', w: 3 },
  { t: 'Senior Manager', s: 'Manager', w: 8 }, { t: 'Delivery Manager', s: 'Manager', w: 4 }, { t: 'Engagement Manager', s: 'Manager', w: 3 }, { t: 'Manager', s: 'Manager', w: 6 },
  { t: 'Senior Consultant', s: 'Senior', w: 6 }, { t: 'Consultant', s: 'Entry', w: 4 }, { t: 'Solution Architect', s: 'Senior', w: 4 }, { t: 'Analyst', s: 'Entry', w: 3 },
];
const COUNTRIES = [{ c: 'India', city: ['Bengaluru', 'Mumbai', 'Hyderabad', 'Pune', 'Gurugram'], w: 10 }, { c: 'United States', city: ['New York', 'Dallas', 'Chicago'], w: 6 }, { c: 'United Kingdom', city: ['London', 'Manchester'], w: 3 }, { c: 'United Arab Emirates', city: ['Dubai', 'Abu Dhabi'], w: 2 }, { c: 'Saudi Arabia', city: ['Riyadh', 'Jeddah'], w: 1 }];
const ME = COUNTRIES.slice(3);
const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha', 'Arjun', 'Kavya', 'Rahul', 'Sneha', 'James', 'Emily', 'Michael', 'Sarah', 'David', 'Olivia', 'Omar', 'Fatima', 'Khalid', 'Layla', 'Thomas', 'Hannah', 'Sanjay', 'Meera', 'Karthik', 'Divya'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Menon', 'Rao', 'Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Al Harbi', 'Al Mansoori', 'Haddad', 'Khan', 'Clarke', 'Bose', 'Kulkarni'];
const USE_CASE = ['Agents for audit workpapers', 'Customer service agents', 'Code migration', 'Claims processing', 'Not sure yet', 'Sales research agents', ''];

function makeLead(i) {
  const c = pickW(CAMPAIGNS), co = pickW(COMPANIES), ti = pickW(TITLES), ctry = c.me ? pickW(ME) : pickW(COUNTRIES);
  const first = FIRST[Math.floor(rnd() * FIRST.length)], last = LAST[Math.floor(rnd() * LAST.length)];
  const end = '2026-10-20', start = c.start;
  const day = addDays(start, Math.floor(Math.pow(rnd(), 0.8) * Math.max(1, span(start, end))));
  return { submitted_at: day, first_name: first, last_name: last, email: `${first}.${last}${i}`.toLowerCase().replace(/\s+/g, '') + '@' + co.dom, company: co.name === 'Freelance' ? '' : co.name, title: ti.t, seniority: ti.s, country: ctry.c, city: ctry.city[Math.floor(rnd() * ctry.city.length)], industry: co.name === 'Northwind Analytics' ? 'Software Development' : 'IT Services and IT Consulting', company_size: co.w > 4 ? '10,001+' : '1,001-5,000', campaign: c.name, campaign_group: c.group, ad: c.ad, form: c.form, phone: rnd() < 0.3 ? '+91 98' + String(10000000 + Math.floor(rnd() * 89999999)) : '', linkedin_url: rnd() < 0.6 ? `https://www.linkedin.com/in/${first}-${last}-${i}`.toLowerCase().replace(/\s+/g, '') : '', extra: { 'What would you use agents for?': USE_CASE[Math.floor(rnd() * USE_CASE.length)] } };
}

const ALL = Array.from({ length: 150 }, (_, i) => makeLead(i + 1));
const fileA = ALL.filter(l => l.submitted_at < '2026-09-20');
const fileB = ALL.filter(l => l.submitted_at >= '2026-09-20' && l.submitted_at < '2026-10-12');
// The API pull holds the last week plus a few already in the October file (counted once).
const apiRows = [...ALL.filter(l => l.submitted_at >= '2026-10-12'), ...fileB.slice(0, 4)];

const DOCS = [
  { id: 'leads:li-api', content: { source: 'api', file_name: 'LinkedIn API pull', uploaded_by: 'Scheduled sync', uploaded_at: '2026-10-21T01:35:00Z', rows: apiRows } },
  { id: 'leads:demo-file-a', content: { source: 'csv', file_name: 'Lead gen form leads 14 Aug to 19 Sep.csv', uploaded_by: 'isha@whitepath.in', uploaded_at: '2026-09-20T09:12:00Z', rows: fileA } },
  { id: 'leads:demo-file-b', content: { source: 'csv', file_name: 'Lead gen form leads 20 Sep to 11 Oct.xlsx', uploaded_by: 'kailash.gm@lyzr.ai', uploaded_at: '2026-10-12T06:40:00Z', rows: fileB } },
];
const SCREENS = [
  { id: 'screen:demo-1', content: { file_name: 'campaign-manager-lead-forms-sept.png', uploaded_by: 'anju@lyzr.ai', uploaded_at: '2026-10-02T07:20:00Z', kind: 'lead_form_metrics', title: 'Lead gen form performance, September', summary: 'Three lead gen forms in September. The Agentic AI Roadmap form had 214 opens and 96 submissions, a 45% completion rate. The Book a demo form converts best at 50% but on low volume.', period: { from: '2026-09-01', to: '2026-09-30' }, leads: [], metrics: [
    { campaign: 'Agentic AI Roadmap playbook', metric: 'Form opens', value: 214, unit: 'count', period: 'Sep 2026' }, { campaign: 'Agentic AI Roadmap playbook', metric: 'Leads', value: 96, unit: 'count', period: 'Sep 2026' }, { campaign: 'Agentic AI Roadmap playbook', metric: 'Completion rate', value: 44.9, unit: '%', period: 'Sep 2026' },
    { campaign: 'Enterprise AI Playbook', metric: 'Form opens', value: 61, unit: 'count', period: 'Sep 2026' }, { campaign: 'Enterprise AI Playbook', metric: 'Leads', value: 21, unit: 'count', period: 'Sep 2026' },
    { campaign: 'Book a demo of Lyzr Agent Studio', metric: 'Form opens', value: 8, unit: 'count', period: 'Sep 2026' }, { campaign: 'Book a demo of Lyzr Agent Studio', metric: 'Leads', value: 4, unit: 'count', period: 'Sep 2026' },
  ], tables: [{ title: 'Lead gen forms', columns: ['Form', 'Opens', 'Leads', 'Completion'], rows: [['Agentic AI Roadmap playbook', '214', '96', '44.9%'], ['Enterprise AI Playbook', '61', '21', '34.4%'], ['Book a demo of Lyzr Agent Studio', '8', '4', '50.0%']] }], notes: 'The CPL column was cut off on the right edge.', model: 'demo (no Claude call)' } },
  { id: 'screen:demo-2', content: { file_name: 'hubspot-me-leads.jpg', uploaded_by: 'siva@lyzr.ai', uploaded_at: '2026-10-18T11:05:00Z', kind: 'leads', title: 'Middle East playbook leads in HubSpot', summary: 'Five leads from the Middle East playbook ad set, mostly Director and above at Big Four firms in Dubai and Riyadh.', period: { from: '2026-10-06', to: '2026-10-17' }, leads: [
    { submitted_at: '2026-10-07', first_name: 'Yousef', last_name: 'Al Qahtani', email: '', company: 'KPMG', title: 'Partner', country: 'Saudi Arabia', city: 'Riyadh', campaign: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", form: 'Agentic AI Roadmap playbook (Arabic and English)' },
    { submitted_at: '2026-10-09', first_name: 'Reem', last_name: 'Saleh', email: '', company: 'Deloitte', title: 'Director', country: 'United Arab Emirates', city: 'Dubai', campaign: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", form: 'Agentic AI Roadmap playbook (Arabic and English)' },
    { submitted_at: '2026-10-11', first_name: 'Hassan', last_name: 'Farouk', email: '', company: 'PwC', title: 'Senior Manager', country: 'United Arab Emirates', city: 'Abu Dhabi', campaign: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", form: 'Agentic AI Roadmap playbook (Arabic and English)' },
    { submitted_at: '2026-10-14', first_name: 'Nadia', last_name: 'Karim', email: '', company: 'EY', title: 'Associate Partner', country: 'United Arab Emirates', city: 'Dubai', campaign: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", form: 'Agentic AI Roadmap playbook (Arabic and English)' },
    { submitted_at: '2026-10-16', first_name: 'Faisal', last_name: 'Otaibi', email: '', company: 'Accenture', title: 'Managing Director', country: 'Saudi Arabia', city: 'Riyadh', campaign: "Middle East|GSI&SI|Native|Playbooks-5 OCt'26", form: 'Agentic AI Roadmap playbook (Arabic and English)' },
  ], metrics: [], tables: [], notes: 'Email addresses were hidden in the screenshot.', model: 'demo (no Claude call)' } },
];

export function createLeadsMock() {
  const docs = DOCS.map(d => ({ ...d, content: { ...d.content, rows: [...d.content.rows] } }));
  const screens = SCREENS.map(s => ({ ...s, content: { ...s.content } }));
  const get = () => {
    const seen = new Set(); const leads = []; let duplicates = 0;
    const take = l => { const k = leadKey(l); if (k && seen.has(k)) { duplicates++; return false; } if (k) seen.add(k); leads.push(l); return true; };
    const ordered = [...docs].sort((a, b) => a.id === 'leads:li-api' ? -1 : b.id === 'leads:li-api' ? 1 : a.content.uploaded_at < b.content.uploaded_at ? -1 : 1);
    const docOut = ordered.map(d => { const source = d.content.source === 'api' ? 'api' : 'csv'; let kept = 0; for (const r of d.content.rows) if (take({ ...normaliseLead(r, source), source, doc_id: d.id })) kept++; return { id: d.id, source, file_name: d.content.file_name, uploaded_by: d.content.uploaded_by, uploaded_at: d.content.uploaded_at, count: d.content.rows.length, kept }; });
    const screenOut = screens.map(s => { const c = s.content; for (const r of c.leads || []) take({ ...normaliseLead(r, 'screenshot'), source: 'screenshot', doc_id: s.id }); return { id: s.id, file_name: c.file_name, uploaded_at: c.uploaded_at, uploaded_by: c.uploaded_by, kind: c.kind, title: c.title, summary: c.summary, period: c.period, metrics: c.metrics, tables: c.tables, notes: c.notes, leads_count: (c.leads || []).length, model: c.model }; });
    return { leads, docs: docOut, screens: screenOut, duplicates, warnings: [] };
  };
  const post = body => {
    const rows = (body.rows || []).map(r => normaliseLead(r, 'csv')).filter(l => l.email || l.first_name || l.last_name);
    const held = new Set(); for (const d of docs) for (const r of d.content.rows) { const k = leadKey(normaliseLead(r)); if (k) held.add(k); }
    const fresh = []; let duplicates = 0; for (const l of rows) { const k = leadKey(l); if (k && held.has(k)) { duplicates++; continue; } if (k) held.add(k); fresh.push(l); }
    if (!fresh.length) return { id: null, inserted: 0, skipped: (body.rows || []).length, duplicates, invalid: (body.rows || []).length - rows.length };
    const id = 'leads:demo-' + Math.random().toString(36).slice(2, 8);
    docs.push({ id, content: { source: 'csv', file_name: body.file_name || 'leads.csv', uploaded_by: 'demo@lyzr.com', uploaded_at: new Date().toISOString(), rows: fresh } });
    return { id, inserted: fresh.length, skipped: (body.rows || []).length - fresh.length, duplicates, invalid: (body.rows || []).length - rows.length };
  };
  const screenshot = body => {
    const id = 'screen:demo-' + Math.random().toString(36).slice(2, 8);
    const content = { file_name: body.file_name || 'screenshot', uploaded_by: 'demo@lyzr.com', uploaded_at: new Date().toISOString(), kind: 'campaign_metrics', title: 'Campaign numbers (demo reading)', summary: 'Demo mode: no image was sent to Claude. With the API key set, Claude Sonnet reads every lead, number and table in the screenshot.', period: null, leads: [], metrics: [{ campaign: "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26", metric: 'Spend', value: 638.97, unit: 'USD', period: 'Sep 2026' }, { campaign: "Native Targeting(Heatmap)|GSI|Playbooks-2 Sept'26", metric: 'Leads', value: 56, unit: 'count', period: 'Sep 2026' }], tables: [], notes: '', model: 'demo (no Claude call)' };
    screens.unshift({ id, content });
    return { id, ...content };
  };
  const del = id => {
    if (id === 'leads:li-api') { const e = new Error('The LinkedIn API pull refreshes these leads itself; they cannot be deleted here'); e.status = 400; throw e; }
    const n = docs.length + screens.length;
    for (const list of [docs, screens]) { const i = list.findIndex(d => d.id === id); if (i >= 0) list.splice(i, 1); }
    if (docs.length + screens.length === n) { const e = new Error('Not found'); e.status = 404; throw e; }
    return { ok: true, id };
  };
  return { get, post, screenshot, del };
}
