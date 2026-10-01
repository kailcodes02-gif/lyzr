// Demo HubSpot data: ~220 contacts from April to September 2026, generated deterministically
// (seeded PRNG) and modelled on the GSI Lead Message Intelligence report (Sep 2026):
// 148 real leads in 10 intent clusters (26/22/18/17/14/12/10/10/12/7), 58 tests / spam / vendor
// pitches, 14 extra real leads without a form message, the 11 named GSI leads with their exact
// messages, and the country mix of the report. Account, band and region are computed here
// with the same rules ARCHITECTURE.md describes (accounts.json aliases, per-account band
// titles then the global title buckets, regions.json).
import accounts from '../../seed/accounts.json' with { type: 'json' };
import bandTitles from '../../seed/band_titles.json' with { type: 'json' };
import regionsSeed from '../../seed/regions.json' with { type: 'json' };

// ---- seeded PRNG ---------------------------------------------------------------------------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260924);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const weighted = pairs => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; };
const chance = p => rnd() < p;

// ---- classification rules (same as the server side) ----------------------------------------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9&+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const DOMAIN_ACCOUNT = { 'ey.com': 'EY', 'accenture.com': 'Accenture', 'deloitte.com': 'Deloitte', 'pwc.com': 'PwC', 'hcltech.com': 'HCLTech', 'hcl.com': 'HCLTech', 'genpact.com': 'Genpact', 'mckinsey.com': 'McKinsey & Company', 'wipro.com': 'Wipro', 'bcg.com': 'Boston Consulting Group (BCG)', 'tcs.com': 'Tata Consultancy Services', 'kpmg.com': 'KPMG', 'infosys.com': 'Infosys', 'bain.com': 'Bain & Company', 'ltimindtree.com': 'LTIMindtree', 'techmahindra.com': 'Tech Mahindra', 'thoughtworks.com': 'Thoughtworks', 'protiviti.com': 'Protiviti', 'epam.com': 'EPAM Systems', 'fujitsu.com': 'Fujitsu', 'oliverwyman.com': 'Oliver Wyman', 'cognizant.com': 'Cognizant' };
export function matchAccount(companyRaw, email) {
  const dom = String(email || '').toLowerCase().split('@')[1] || '';
  for (const [d, name] of Object.entries(DOMAIN_ACCOUNT)) if (dom === d || dom.endsWith('.' + d)) return name;
  const c = norm(companyRaw); if (!c) return null;
  for (const a of accounts) {
    for (const alias of [a.name, ...(a.aliases || [])]) {
      const al = norm(alias); if (!al) continue;
      if (c === al || c.startsWith(al + ' ') || c.endsWith(' ' + al) || c.includes(' ' + al + ' ')) return a.name;
    }
    if (a.name === 'Boston Consulting Group (BCG)' && (c === 'bcg' || c.startsWith('bcg '))) return a.name;
    if (a.name === 'Tata Consultancy Services' && (c === 'tcs' || c.startsWith('tcs '))) return a.name;
    if (a.name === 'McKinsey & Company' && c.startsWith('mckinsey')) return a.name;
  }
  return null;
}
const tokens = s => String(s || '').split('/').flatMap(t => { const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m ? [m[1], m[2]] : [t]; }).map(t => t.trim()).filter(t => t && t.length > 1);
const wordHit = (title, tok) => new RegExp('(^|[^a-z])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z])', 'i').test(title);
const G = bandTitles.global || {};
export function bandOf(title, account, hsId) {
  const t = String(title || '').trim(); if (!t) return 'Unknown';
  const a = account && accounts.find(x => x.name === account);
  if (a && a.bands) {
    for (const [k, band] of [['md', 'MD'], ['md1', 'MD-1'], ['md2', 'MD-2']]) for (const tok of tokens(a.bands[k])) if (wordHit(t, tok)) return band;
  }
  for (const tok of G.MD || []) if (wordHit(t, tok)) return 'MD';
  if (/\bC[A-Z]O\b|chief .* officer|\bpresident\b|\bowner\b|co-founder|cofounder/i.test(t) && !/vice president/i.test(t)) return 'MD';
  for (const tok of G.MD1 || []) if (wordHit(t, tok)) return 'MD-1';
  for (const tok of G.MD2 || []) if (wordHit(t, tok)) return 'MD-2';
  if (/\bdirector\b/i.test(t)) return (parseInt(String(hsId).slice(-1), 10) || 0) % 2 === 0 ? 'MD-1' : 'MD-2'; // "Director split 50/50"
  return 'Other';
}
const REGION_MAP = regionsSeed.regions || regionsSeed;
export function regionOf(country) {
  const c = norm(country); if (!c) return 'Other';
  for (const [region, list] of Object.entries(REGION_MAP)) if (list.some(x => norm(x) === c)) return region;
  return 'Other';
}

// ---- vocab ----------------------------------------------------------------------------------
const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha', 'Karthik', 'Divya', 'Arjun', 'Sneha', 'Rahul', 'Meera', 'Siddharth', 'Kavya', 'Nikhil', 'Pooja', 'Aditya', 'Ritu', 'Manish', 'Shreya', 'James', 'Emily', 'Michael', 'Sarah', 'David', 'Jessica', 'Daniel', 'Laura', 'Matthew', 'Rachel', 'Chris', 'Amanda', 'Omar', 'Fatima', 'Khalid', 'Layla', 'Ahmed', 'Noor', 'Tariq', 'Hana', 'Oliver', 'Charlotte', 'Liam', 'Sophie', 'Lucas', 'Emma', 'Erik', 'Astrid', 'Wei', 'Mei'];
const LAST = ['Sharma', 'Iyer', 'Menon', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Rao', 'Kulkarni', 'Bose', 'Verma', 'Joshi', 'Smith', 'Johnson', 'Brown', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Al Farsi', 'Haddad', 'Rahman', 'Khan', 'Mansour', 'Saleh', 'Evans', 'Walker', 'Hughes', 'Clark', 'Lindqvist', 'Berg', 'Tan', 'Lim'];
const COUNTRY_MIX = [['India', 42], ['United States', 26], ['United Arab Emirates', 9], ['United Kingdom', 5], ['Australia', 5], ['Canada', 3], ['Singapore', 1], ['Sweden', 2], ['Saudi Arabia', 1.2], ['Oman', 0.8], ['Ireland', 1], ['Germany', 1.2], ['Japan', 0.8], ['Sri Lanka', 0.6], ['Netherlands', 0.7], ['Hong Kong', 0.7]];
const FIRST_BY_COUNTRY = { 'India': FIRST.slice(0, 20), 'United States': FIRST.slice(20, 32), 'Canada': FIRST.slice(20, 32), 'United Kingdom': FIRST.slice(40, 46), 'Ireland': FIRST.slice(40, 46), 'Australia': FIRST.slice(40, 46), 'United Arab Emirates': FIRST.slice(32, 40), 'Saudi Arabia': FIRST.slice(32, 40), 'Oman': FIRST.slice(32, 40), 'Sweden': FIRST.slice(46, 48), 'Germany': FIRST.slice(46, 48), 'Netherlands': FIRST.slice(46, 48), 'Singapore': FIRST.slice(48, 50), 'Hong Kong': FIRST.slice(48, 50), 'Japan': FIRST.slice(48, 50), 'Sri Lanka': FIRST.slice(0, 20) };
const LAST_BY_COUNTRY = { 'India': LAST.slice(0, 12), 'Sri Lanka': LAST.slice(0, 12), 'United States': LAST.slice(12, 22), 'Canada': LAST.slice(12, 22), 'United Kingdom': LAST.slice(28, 32), 'Ireland': LAST.slice(28, 32), 'Australia': LAST.slice(28, 32), 'United Arab Emirates': LAST.slice(22, 28), 'Saudi Arabia': LAST.slice(22, 28), 'Oman': LAST.slice(22, 28), 'Sweden': LAST.slice(32, 34), 'Germany': LAST.slice(32, 34), 'Netherlands': LAST.slice(32, 34), 'Singapore': LAST.slice(34, 36), 'Hong Kong': LAST.slice(34, 36), 'Japan': LAST.slice(34, 36) };
const GENERIC_CO = {
  'India': ['Mindsprint', 'Zeal 3D', 'Propques', 'HireSense', 'Kredily', 'Lentra', 'Navi Technologies', 'Sigmoid', 'Tredence', 'Innovaccer', 'Zepto', 'Razorpay', 'Ather Energy', 'Nykaa', 'CarDekho', 'Freshworks'],
  'United States': ['ECFX', 'Gate City Bank', 'Atlas Vantage', 'ScaleTech', 'kommit', 'Minds On Fire', 'Brightline Health', 'Ridgeline Partners', 'Northwind Logistics', 'Vertex Insurance', 'Halcyon Labs', 'Pinnacle Realty'],
  'United Arab Emirates': ['STAFF X', 'Majid Al Futtaim', 'Emaar', 'Noon', 'Dubai Holding', 'Al Tayer Group'],
  'United Kingdom': ['Outskill', 'Brightwave Digital', 'Kingsway Advisory', 'Northgate Systems', 'Hollis Partners'],
  'Australia': ['Delphi Finance', 'FUTUREPROOF', 'Blue Gum Digital', 'Southern Cross Advisory'],
  'Canada': ['RONA', 'Clarity Hosted', 'Marcus Agency', 'Maple Fintech'],
  'Singapore': ['Grab', 'Sea Group'], 'Sweden': ['Axis Communications', 'nightdrive.ai', 'Klarna'], 'Saudi Arabia': ['ZAPS Group', 'Elm Company'], 'Oman': ['Al Yusr International', 'Omantel'],
  'Ireland': ['Fexco', 'Kerry Group'], 'Germany': ['Grunexus Advisors', 'Siemens Mobility'], 'Japan': ['Headwaters', 'Rakuten'], 'Sri Lanka': ['NeuralNexus', 'Virtusa Lanka'], 'Netherlands': ['Valliance AI', 'Booking.com'], 'Hong Kong': ['HKBN', 'Cathay Pacific'],
};
const OTHER_TITLES = ['Software Engineer', 'Product Manager', 'Head of Growth', 'Marketing Manager', 'Business Analyst', 'Consultant', 'Data Scientist', 'Solutions Architect', 'HR Business Partner', 'Operations Lead', 'Sales Manager', 'Account Manager', 'Student', 'Research Analyst', 'Project Manager', 'Customer Success Manager'];
const MD_TITLES = ['Founder', 'Co-Founder & CEO', 'Managing Director', 'Managing Partner', 'Partner', 'Senior Vice President', 'CEO', 'CTO', 'COO', 'Chief Digital Officer', 'Owner'];
const MD1_TITLES = ['Vice President', 'Assistant Vice President', 'Associate Director', 'Senior Director', 'Principal', 'Associate Partner', 'Director of Operations', 'Director, Digital Transformation'];
const MD2_TITLES = ['Senior Manager', 'General Manager', 'Engagement Manager', 'Delivery Head', 'Delivery Manager', 'Technical Manager', 'Director of Marketing', 'Director, Customer Experience'];
const OWNERS = { anju: { id: '81120001', name: 'Anju' }, 'praveen.s': { id: '81120002', name: 'Praveen S' }, bharath: { id: '81120003', name: 'Bharath' }, 'kaushik.venkatesan': { id: '81120004', name: 'Kaushik Venkatesan' }, pooja: { id: '81120005', name: 'Pooja' } };
const SOURCES = [['LinkedIn Ads (GSI & SI)', 62], ['Organic', 18], ['Direct', 12], ['Instantly email', 8]];
const SOURCE_META = { 'LinkedIn Ads (GSI & SI)': ['PAID_SOCIAL', 'LinkedIn'], 'Organic': ['ORGANIC_SEARCH', 'google'], 'Direct': ['DIRECT_TRAFFIC', 'lyzr.ai/book-demo'], 'Instantly email': ['EMAIL_MARKETING', 'Instantly · Siva sender'] };
const MONTH_MIX = [['2026-04', 4], ['2026-05', 6], ['2026-06', 5], ['2026-07', 10], ['2026-08', 20], ['2026-09', 55]];
const DAYS_IN = { '2026-04': 30, '2026-05': 31, '2026-06': 30, '2026-07': 31, '2026-08': 31, '2026-09': 29 };

// Messages per cluster: the report's sample quotes first, then plausible variants.
const CLUSTER_MSGS = {
  sales: ['how can we relieve volume from BDRs for inbound leads and move to AI agents', "Looking for AI agent to help with prospecting in certain rev bands that we don't have SDR coverage", 'lead-scoring apparatus for SMS conversations that scores leads and hands off to a human', 'AI SDR doing account-level thinking replacing the traditional SDR', 'automate part of our SDR operation on inbound leads from webforms', 'We want an outbound SDR agent that researches accounts and drafts first emails', 'Inbound lead qualification and routing to the right AE', 'Can your agents book meetings for our sales team from inbound leads?', 'Pipeline hygiene agent for HubSpot, follow-ups and lead scoring', 'Looking at AI for lead gen and appointment setting'],
  demo: ['Capability Overview and Demo', 'Request for a solution overview and technical demo', 'Discovery Call', 'Interested to understand the capabilities', 'I want to see how it works', 'Would like a demo of the agent studio', 'Can we get a walkthrough of the platform?', 'Want to know what it is exactly and how does it work', 'Interested in a product tour for my team', 'Would like to see the product before we discuss use cases'],
  hr: ['Run my entire HR Organisation from Hire to retire on AI', 'AI demo for HR processes - recruitment, onboarding, L&D', 'HR and Recruitment related AI agents', 'Exploring use cases for HR operations and automating repetitive tasks', 'A useful agent for our HR and Recruitment operations', 'Screening candidates and scheduling interviews with AI', 'Employee onboarding and HR helpdesk agent', 'Payroll queries and HR policy assistant for 4,000 employees', 'Recruitment automation for our staffing business'],
  marketing: ['Use of agentic AI in Marketing and content creation', 'automate posts for LinkedIn', 'AI agent that can help our CMO', 'AI agents for Google Ads, Facebook Ads, SEO, and GA4', 'SEO, social media, and paid ads agent for my daily tasks', 'Content repurposing agent for our blog and newsletter', 'Campaign reporting agent across ads platforms', 'Marketing automation for a small agency'],
  cs: ['RFI on Agentic AI Orchestration for Customer Service department', 'Customer Service and Collections', 'how you can support in the AI for customer service', 'interested from a customer support management aspect', 'provide great experience to the customer through its support', 'Customer support agent for our clients in insurance', 'Contact center automation, tier 1 tickets', 'Helpdesk agent for a BPO with 2,000 seats'],
  finance: ['AI agents built secure and compliant to automate complex enterprise workflows in Banking', 'Claim Processing and Credit underwriting agents', 'agentic flows for finance use-cases', 'Work flow management in banking', 'AI Agents for financial forecasting', 'KYC and AML checks with agents', 'Invoice processing and accounts payable automation', 'Compliance monitoring for a lending business'],
  platform: ['Enterprise agentic framework to replace AI Foundry', 'exploring Agentic AI platforms to build agents for clients in the region', 'developing AI agents for our customers - evaluating potential platform partnerships', 'Team workspace for AI Agents', 'Evaluating agent platforms for a client delivery practice', 'Partner program for a consulting firm building agents for clients', 'Looking for a platform to white label for our customers'],
  workflow: ['Looking at Sales, marketing and customer support automation', 'help me with logistics operations, inside sales, ops support and reconciliation', 'pre-sales, sales, post-sales, follow-ups, cancellations unified into one inbox', 'supplier discovery agent for manufacturing', 'Back office automation for a logistics company', 'Procurement and supplier onboarding workflows', 'Internal process automation across ops and admin'],
  exploring: ['New to this, Exploring', 'Experimenting - we are a startup based in Sydney & Hong Kong', 'Want to explore for my SaaS start up - really new to agents', 'exploring how AI agents can enhance productivity', 'Just exploring what agents can do', 'Curious about the pricing and plans', 'Interested', 'Want to learn more', 'Exploring for a personal project', 'General interest'],
  vertical: ['build an AI agent for the automotive space', 'M&A', 'Demo on Regulatory Monitoring Agent', 'agent for developer tools', 'Video generation AI', 'Clinical documentation agent for healthcare', 'Legal contract review agent', 'Real estate lead follow-up agent'],
};
const CLUSTER_MIX = [['sales', 26], ['demo', 22], ['hr', 18], ['marketing', 17], ['cs', 14], ['finance', 12], ['platform', 10], ['workflow', 10], ['exploring', 12], ['vertical', 7]];
// Companies tagged in the report per cluster (name, country). Used before the generic pool.
const CLUSTER_CO = {
  sales: [['RingCentral', 'United States'], ['Gartner', 'United States'], ['Sectigo', 'United States'], ['cj Advertising', 'United States'], ['Animaker', 'India'], ['DSP Mutual Fund', 'India'], ['Recotap', 'India'], ['Leedly', 'United States'], ['Moldtek', 'India'], ['Cognizant', 'United States']],
  demo: [['EJADA', 'United Arab Emirates'], ['Eco Systems Group', 'United Kingdom'], ['KPMG', 'United States'], ['LTIMindtree', 'India']],
  hr: [['Weavings Manpower', 'India'], ['SNS Global', 'United Arab Emirates'], ['Al Yusr International', 'Oman'], ['Subaru of America', 'United States'], ['L&T Realty', 'India']],
  marketing: [['Youtech Agency', 'United States'], ['ZAPS Group', 'Saudi Arabia'], ['Dreamdays.ae', 'United Arab Emirates'], ['Assemble.FYI', 'United States']],
  cs: [['Chalhoub Group', 'United Arab Emirates'], ['ContactPoint 360', 'India'], ['Butter Insurance', 'Australia'], ['Smith+Nephew', 'India'], ['Wipro', 'India'], ['Genpact', 'India']],
  finance: [['ICICI Bank', 'India'], ['First Abu Dhabi Bank', 'United Arab Emirates'], ['Thomson Reuters', 'Canada'], ['Spotify', 'Sweden'], ['HealthCRED', 'India'], ['PwC', 'India']],
  platform: [['Arcadis', 'United States'], ['NeuralNexus', 'Sri Lanka'], ['Clarity Hosted', 'Canada'], ['Valliance AI', 'Netherlands'], ['HCLTech', 'India'], ['McKinsey & Company', 'United Kingdom']],
  workflow: [['Moldtek Technologies', 'India'], ['Hexalog', 'India'], ['RONA', 'Canada'], ['Zeal 3D', 'India'], ['Tata Consultancy Services', 'India']],
  exploring: [['FUTUREPROOF', 'Australia'], ['REPLACI', 'India'], ['Delphi Finance', 'Australia'], ['Headwaters', 'Japan'], ['Boston Consulting Group (BCG)', 'Singapore']],
  vertical: [['nightdrive.ai', 'Sweden'], ['Grunexus Advisors', 'Germany'], ['NaBFID', 'India'], ['Propques', 'India']],
};
// The 11 named GSI / SI leads from the report, with their exact messages.
const NAMED = [
  { first: 'Soubhik', last: 'Dasgupta', company: 'Infosys', domain: 'infosys.com', title: 'Senior Delivery Manager', country: 'India', msg: 'Capability Overview and Demo', month: '2026-09', owner: 'kaushik.venkatesan', via: ['company', 'gsi_text'] },
  { first: 'Naveen', last: 'Rajasekharan', company: 'Accenture', domain: 'accenture.com', title: 'Associate Director', country: 'Ireland', msg: 'Explore a potential use case and opportunity', month: '2026-09', owner: 'praveen.s', via: ['company'] },
  { first: 'Abhishek', last: 'Goswami', company: 'Accenture', domain: 'accenture.com', title: 'Senior Manager', country: 'India', msg: 'Security', month: '2026-08', owner: 'bharath', via: ['company'] },
  { first: 'Abhishek', last: 'Batra', company: 'Deloitte', domain: 'deloitte.com', title: 'Senior Manager', country: 'United States', msg: 'Use of agentic AI in Marketing and content creation', month: '2026-09', owner: 'pooja', via: ['company', 'owner'] },
  { first: 'Prateek', last: 'Dubey', company: 'EY', domain: 'sg.ey.com', title: 'Partner, Head of AI Practice', country: 'Singapore', msg: 'Exploring Agentic AI platforms to build Chat, V2V agents for clients in the region', month: '2026-09', owner: 'pooja', via: ['company', 'owner', 'gsi_text'] },
  { first: 'Kathleen', last: 'Nantes', company: 'Trace3', domain: 'trace3.com', title: 'Director, Innovation', country: 'United States', msg: 'Request for a solution overview and technical demo with Innovation team', month: '2026-09', owner: 'anju', via: ['company'] },
  { first: 'Sandeep', last: 'Warrier', company: 'ITC Infotech', domain: 'itcinfotech.com', title: 'Vice President', country: 'India', msg: 'Great experience to the customer through its support', month: '2026-08', owner: 'kaushik.venkatesan', via: ['company'] },
  { first: 'Umesh', last: 'Kumar', company: 'Firstsource', domain: 'firstsource.com', title: 'Assistant Vice President', country: 'India', msg: 'Want to know what it is exactly and how does it work', month: '2026-09', owner: 'bharath', via: ['company'] },
  { first: 'Chiranjeevi', last: 'Ch', company: 'Datamatics', domain: 'datamatics.com', title: 'Senior Manager', country: 'India', msg: 'Interested', month: '2026-09', owner: null, via: ['company'] },
  { first: 'Suresh', last: 'Thiagarajan', company: 'Team Computers', domain: 'teamcomputers.com', title: 'Founder', country: 'India', msg: 'Create them', month: '2026-07', owner: 'praveen.s', via: ['company'] },
  { first: 'Ayush', last: 'Grack', company: 'Shorthills AI', domain: 'shorthills.ai', title: 'Co-Founder', country: 'India', msg: 'Discovery Call', month: '2026-09', owner: 'anju', via: ['company'] },
];
const NOTE_TEMPLATES = {
  call: ['Called, no answer. Left a voicemail and sent the deck.', 'Spoke for 10 min. Wants a demo next week, sending slots.', 'Connected. Asked for pricing for 50 seats, said they will circle back after budget review.', 'Called twice, no pick up. Will try WhatsApp.'],
  email: ['Sent the Agentic AI Roadmap playbook and a calendar link.', 'Followed up on the form fill with three use cases relevant to their team.', 'Shared the security and deployment one-pager as requested.', 'Sent a summary after the intro call with next steps.'],
  meeting: ['Demo held. Interested in the HR agent pack; wants a POC scoped for October.', 'Discovery call done. They are evaluating three platforms, decision by end of Q4.', 'Intro call with their innovation team. Next: technical deep dive with their architects.', 'Demo booked for next Tuesday with their practice head.'],
  note: ['Form fill from the heatmap native ad. Title looks senior, prioritise.', 'Likely student or personal project, parking for now.', 'Same company as an open deal, routed to the AE.', 'Asked to be contacted after their fiscal year close.', 'LinkedIn connection accepted, DM sent from Anju.'],
  task: ['Task: send POC proposal by Friday.', 'Task: chase for the NDA.', 'Task: add to the October webinar invite list.'],
};

// ---- generation -----------------------------------------------------------------------------
const slug = s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'company';
const pad = n => String(n).padStart(2, '0');
let seq = 0;
function tsInMonth(month, hourMin = 8, hourMax = 21) { const d = 1 + Math.floor(rnd() * DAYS_IN[month]); const h = hourMin + Math.floor(rnd() * (hourMax - hourMin)); const m = Math.floor(rnd() * 60); return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, d, h, m) - 330 * 60000).toISOString(); }
function laterTs(fromIso, maxDays) { const t = new Date(fromIso).getTime() + (1 + Math.floor(rnd() * maxDays)) * 864e5 + Math.floor(rnd() * 8) * 3600e3; return new Date(Math.min(t, Date.parse('2026-09-30T05:00:00Z'))).toISOString(); }
function titleFor(account, bandWish) {
  const a = account && accounts.find(x => x.name === account);
  if (a && a.bands) { const k = bandWish === 'MD' ? 'md' : bandWish === 'MD-1' ? 'md1' : bandWish === 'MD-2' ? 'md2' : null; if (k && a.bands[k]) { const t = tokens(a.bands[k]).filter(x => x.length > 3); if (t.length) return pick(t); } }
  return pick(bandWish === 'MD' ? MD_TITLES : bandWish === 'MD-1' ? MD1_TITLES : bandWish === 'MD-2' ? MD2_TITLES : OTHER_TITLES);
}
function ownerFor(account) {
  const a = account && accounts.find(x => x.name === account);
  if (a && a.owner) { const o = a.owner.toLowerCase(); if (o.includes('praveen')) return chance(0.5) ? 'praveen.s' : 'bharath'; if (o.includes('kaushik')) return 'kaushik.venkatesan'; if (o.includes('bharath')) return 'bharath'; if (o.includes('pooja')) return 'pooja'; }
  if (chance(0.22)) return null;
  return weighted([['anju', 40], ['praveen.s', 30], ['bharath', 30]]);
}
function makeContact({ first, last, company, domain, title, country, msg, month, owner, via, band, source, personal }) {
  const id = String(20260000 + (++seq));
  const created_at = tsInMonth(month);
  const account = matchAccount(company, `x@${domain}`);
  const b = band || bandOf(title, account, id);
  const src = source || weighted(SOURCES);
  const [hsSource, detail] = SOURCE_META[src];
  const o = owner === undefined ? ownerFor(account) : owner;
  const own = o ? OWNERS[o] : null;
  const email = personal ? `${first}.${last}${Math.floor(rnd() * 900 + 10)}@${domain}`.toLowerCase().replace(/[^a-z0-9.@]/g, '') : `${first}.${last}@${domain}`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const c = { hs_id: id, email, first_name: first, last_name: last, company_raw: company, account, jobtitle: title, band: b, country, region: regionOf(country), source: hsSource, source_detail: detail, lead_source: src, lsa_message: msg || '', lsa_score: msg ? Math.round(40 + rnd() * 55) : null, lsa_category: msg ? null : null, lifecycle: 'lead', lead_status: 'OPEN', owner_id: own ? own.id : null, owner_name: own ? own.name : null, created_at, last_modified: created_at, last_activity_at: null, last_activity_type: null, notes_count: 0, via: via || (account ? ['company'] : msg && /agent/i.test(msg) ? ['gsi_text'] : []), props: { hs_analytics_source: hsSource, hs_analytics_source_data_1: detail, lead_source: src } };
  return c;
}
// A logged call, email or meeting is what HubSpot counts in "Number of times contacted" and
// "Last contacted" (num_contacted_notes, notes_last_contacted); the Sales funnel reads those.
function touch(c, ts) { c.props.num_contacted_notes = (c.props.num_contacted_notes || 0) + 1; c.props.notes_last_contacted = ts; }
function addNotes(c, notes) {
  const n = 1 + Math.floor(rnd() * 3);
  let last = c.created_at;
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? weighted([['note', 3], ['email', 4], ['call', 3]]) : weighted([['call', 3], ['email', 3], ['meeting', 2], ['note', 2], ['task', 1]]);
    last = laterTs(last, 6);
    notes.push({ id: `n${c.hs_id}-${i}`, contact_id: c.hs_id, kind, body: pick(NOTE_TEMPLATES[kind]), owner_id: c.owner_id || OWNERS.anju.id, created_at: last });
    if (kind === 'call' || kind === 'email' || kind === 'meeting') touch(c, last);
    if (kind === 'meeting') { c.lifecycle = 'marketingqualifiedlead'; c.lead_status = 'Demo Booked'; c.props.hs_last_booked_meeting_date = last; }
    else if (c.lead_status === 'OPEN') c.lead_status = 'Working';
    if (kind === 'email' && chance(0.35)) c.props.hs_sales_email_last_replied = laterTs(last, 4);
    c.last_activity_at = last; c.last_activity_type = kind;
  }
  c.notes_count = n; c.last_modified = last;
}

function build() {
  const contacts = [], notes = [];
  const usedCo = new Set();
  // 1. named GSI leads
  for (const n of NAMED) contacts.push(makeContact({ ...n, band: null }));
  // 2. cluster leads (148 minus the 11 named, which already sit in demo/platform/marketing/cs/exploring/vertical)
  const namedInCluster = { demo: 5, platform: 1, marketing: 1, cs: 1, exploring: 2, vertical: 1 };
  for (const [cl, total] of CLUSTER_MIX) {
    const need = total - (namedInCluster[cl] || 0);
    const msgs = CLUSTER_MSGS[cl];
    const cos = (CLUSTER_CO[cl] || []).slice();
    for (let i = 0; i < need; i++) {
      let company, country;
      if (cos.length) { [company, country] = cos.shift(); usedCo.add(company); }
      else { country = weighted(COUNTRY_MIX); const pool = (GENERIC_CO[country] || GENERIC_CO['United States']).filter(x => !usedCo.has(x)); company = pool.length ? pick(pool) : pick(GENERIC_CO[country] || GENERIC_CO['United States']); if (pool.length) usedCo.add(company); }
      const first = pick(FIRST_BY_COUNTRY[country] || FIRST), last = pick(LAST_BY_COUNTRY[country] || LAST);
      const acc = matchAccount(company, '');
      const bandWish = weighted([['MD', 14], ['MD-1', 24], ['MD-2', 26], ['Other', 36]]);
      const domain = acc ? Object.keys(DOMAIN_ACCOUNT).find(d => DOMAIN_ACCOUNT[d] === acc) : slug(company) + '.com';
      contacts.push(makeContact({ first, last, company, domain, title: titleFor(acc, bandWish), country, msg: msgs[i % msgs.length], month: weighted(MONTH_MIX) }));
    }
  }
  // 3. 14 real leads with no form message (Instantly / direct / organic)
  const quiet = [['Capgemini', 'United States'], ['NTT DATA', 'Japan'], ['Cognizant', 'India'], ['Tech Mahindra', 'India'], ['EY', 'India'], ['KPMG', 'India'], ['Deloitte', 'United Kingdom'], ['Bain & Company', 'United States'], ['Virtusa', 'India'], ['Publicis Sapient', 'India'], ['Persistent Systems', 'India'], ['Mphasis', 'India'], ['Kyndryl', 'United States'], ['DXC Technology', 'Australia']];
  for (const [company, country] of quiet) {
    const acc = matchAccount(company, '');
    const bandWish = weighted([['MD', 20], ['MD-1', 35], ['MD-2', 30], ['Other', 15]]);
    const domain = acc ? Object.keys(DOMAIN_ACCOUNT).find(d => DOMAIN_ACCOUNT[d] === acc) : slug(company) + '.com';
    contacts.push(makeContact({ first: pick(FIRST_BY_COUNTRY[country] || FIRST), last: pick(LAST_BY_COUNTRY[country] || LAST), company, domain, title: titleFor(acc, bandWish), country, msg: '', month: weighted(MONTH_MIX), source: weighted([['Instantly email', 6], ['Direct', 3], ['Organic', 3]]), via: acc ? ['company'] : ['owner'] }));
  }
  // 4. 40 internal tests, 12 spam, 6 vendor pitches
  for (let i = 0; i < 40; i++) {
    const internal = chance(0.6);
    contacts.push(makeContact({ first: internal ? 'Test' : pick(FIRST), last: internal ? `User ${i + 1}` : 'Tester', company: internal ? 'wOw Precision Health' : 'Lyzr', domain: internal ? 'lyzr.ai' : 'lyzrteam.com', title: chance(0.5) ? 'QA' : '', country: 'India', msg: pick(['test', 'testing form', 'test message', 'hello', 'Test lead form', 'checking form']), month: weighted(MONTH_MIX), owner: null, via: ['gsi_text'], source: 'Direct' }));
  }
  const gib = ['asdfgh', 'qwerty', 'xkjhq', 'zxcvbn', 'hjklhjkl', 'mnbvcx', 'aaaaaa', 'qwqwqw', 'tttttt', 'jkljkl', 'dfghjk', 'sdfgsdfg'];
  for (let i = 0; i < 12; i++) {
    const g = gib[i];
    const personal = chance(0.5);
    contacts.push(makeContact({ first: personal ? pick(FIRST) : g, last: personal ? pick(LAST) : g.slice(0, 3), company: personal ? pick(['', 'na', 'self', 'student', 'none']) : g, domain: 'gmail.com', title: personal ? 'Student' : '', country: pick(['India', 'India', 'India', 'United States']), msg: personal ? pick(['i want job', 'need internship please', 'hi', 'give me free access', 'want to learn AI']) : g, month: weighted(MONTH_MIX), owner: null, via: [], source: 'Organic', personal: true }));
  }
  const pitches = ['We provide staff augmentation services for AI and data teams at competitive rates.', 'Call center services at low cost, 24x7 support in 12 languages. We offer a free pilot.', 'Link exchange proposal for your blog, we have DA 50+ sites.', 'Our services include web development services and SEO services, let us know if interested.', 'Hire our dedicated developers for your agent projects, starting at $12 per hour.', 'Business proposal: we offer outsourcing services for annotation and QA.'];
  pitches.forEach((msg, i) => contacts.push(makeContact({ first: pick(FIRST), last: pick(LAST), company: pick(['TechServe Global', 'BPO Prime', 'LinkBoost Media', 'DevHire Solutions', 'Annotate Labs', 'WebCraft Studio']), domain: pick(['gmail.com', 'outlook.com', 'techserveglobal.com']), title: 'Business Development', country: pick(['India', 'India', 'Pakistan']), msg, month: weighted(MONTH_MIX), owner: null, via: [], source: 'Organic' })));
  // 5. notes on ~30% of real contacts, a logged activity without notes on some more, a few MQLs,
  //    then what became of the demos. Statuses and lifecycle ids are the live portal's values:
  //    OPEN (New), Working, Stalled, Junk Lead, UNQUALIFIED, Demo Booked, Demo Completed (+ PLG,
  //    Ghosting, no show, Cancelled by Client), Associated with a deal; lifecycle lead, MQL,
  //    opportunity (SQL), 249550600 (Opportunity), customer.
  for (const c of contacts) {
    const isJunk = /lyzr|gmail|outlook/.test(c.email) && !c.account;
    if (isJunk) { if (chance(0.15)) { c.lifecycle = 'subscriber'; c.lead_status = 'UNQUALIFIED'; } else if (chance(0.3)) c.lead_status = 'Junk Lead'; continue; }
    if (chance(0.3) || c.account && chance(0.35)) addNotes(c, notes);
    else if (chance(0.15)) { c.last_activity_at = laterTs(c.created_at, 5); c.last_activity_type = 'email'; c.lead_status = 'Working'; touch(c, c.last_activity_at); }
    if (c.lifecycle === 'lead' && chance(0.06)) { c.lifecycle = 'marketingqualifiedlead'; if (c.lead_status === 'OPEN' || c.lead_status === 'Working') c.lead_status = 'Demo Booked'; }
    if (c.lead_status === 'Demo Booked') c.lead_status = weighted([['Demo Completed', 46], ['Demo Completed - PLG', 8], ['Demo Completed - Ghosting', 8], ['Demo no show', 12], ['Demo Cancelled by Client', 6], ['Demo Booked', 20]]);
    if (/^Demo Completed/.test(c.lead_status) && chance(0.35)) { c.lifecycle = chance(0.7) ? 'opportunity' : chance(0.6) ? '249550600' : 'customer'; if (chance(0.5)) c.lead_status = 'Associated with a deal'; }
    else if (c.lead_status === 'Working' && chance(0.12)) c.lead_status = 'Stalled';
    // Someone who booked a demo was almost always written to and wrote back first.
    if (/^(Demo|Intro|Associated)/.test(c.lead_status)) {
      if (!c.props.num_contacted_notes && chance(0.85)) touch(c, laterTs(c.created_at, 3));
      if (!c.props.hs_sales_email_last_replied && chance(0.7)) c.props.hs_sales_email_last_replied = laterTs(c.props.notes_last_contacted || c.created_at, 4);
    }
  }
  contacts.sort((a, b) => a.created_at < b.created_at ? 1 : -1);
  const notes_by_contact = {};
  for (const n of notes) (notes_by_contact[n.contact_id] ||= []).push(n);
  return { contacts, notes_by_contact, last_sync: { id: 'sync-demo-1', started_by: 'kailash@lyzr.ai', started_at: '2026-09-28T04:10:00.000Z', finished_at: '2026-09-28T04:13:42.000Z', status: 'done', contacts: contacts.length, notes: notes.length, error: null } };
}

export const hubspotMock = build();
