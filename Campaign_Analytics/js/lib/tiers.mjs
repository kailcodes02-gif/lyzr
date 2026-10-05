// Account tier classification: GSI / SI / Big Four / MBB / Other, grouped as Tier 1 (GSI, Big Four, MBB)
// and Tier 2 (SI, Other). Pure, no imports. CANONICAL COPY: functions/api/ca/_lib/tiers.js is a verbatim
// mirror (Cloudflare bundles Functions from functions/ only); tests/backend/account-tiers.test.mjs asserts
// the two agree. Change this file first, then copy it over.
//
//   ruleTier(account)                     -> { tier, conf:'Rule', basis } | null (null = the rules cannot say; Claude decides)
//   tierOf(name, accountTiers, accounts)  -> tier string ('Other' when nothing is known)
//   tierGroupOf(name, accountTiers, accounts) -> 'Tier 1' | 'Tier 2'
// `accountTiers` is the `account_tiers` setting: { [account name]: { tier, conf, basis, source, model?, at } }.

export const TIERS = ['GSI', 'SI', 'Big Four', 'MBB', 'Other'];
export const TIER_LABEL = { GSI: 'Global SI', SI: 'SI (mid-size)', 'Big Four': 'Big Four', MBB: 'MBB / strategy', Other: 'Other' };
export const TIER_GROUP = { GSI: 'Tier 1', 'Big Four': 'Tier 1', MBB: 'Tier 1', SI: 'Tier 2', Other: 'Tier 2' };

// (a) Explicit firm lists. `re` runs on "name aliases" with word boundaries (a bare "ey" substring would hit
// Keyrus or Leyton); `dom` is the first label of the website domain, matched exactly.
const NAMED = [
  ['Big Four', 'Deloitte', /\bdeloitte\b/, ['deloitte', 'deloittedigital']],
  ['Big Four', 'EY', /\bey\b|\bernst\s*&\s*young\b/, ['ey']],
  ['Big Four', 'PwC', /\bpwc\b|\bpricewaterhousecoopers\b/, ['pwc']],
  ['Big Four', 'KPMG', /\bkpmg\b/, ['kpmg']],
  ['MBB', 'McKinsey', /\bmckinsey\b/, ['mckinsey']],
  ['MBB', 'BCG', /\bbcg\b|\bboston consulting group\b/, ['bcg']],
  ['MBB', 'Bain', /\bbain\b/, ['bain']],
  ['GSI', 'Accenture', /\baccenture\b/, ['accenture']],
  ['GSI', 'IBM', /\bibm\b/, ['ibm']],
  ['GSI', 'Capgemini', /\bcapgemini\b/, ['capgemini']],
  ['GSI', 'Cognizant', /\bcognizant\b/, ['cognizant']],
  ['GSI', 'Infosys', /\binfosys\b/, ['infosys']],
  ['GSI', 'TCS', /\btcs\b|\btata consultancy\b/, ['tcs']],
  ['GSI', 'Wipro', /\bwipro\b/, ['wipro']],
  ['GSI', 'HCLTech', /\bhcl(tech)?\b/, ['hcltech', 'hcl', 'hclinfosystems']],
  ['GSI', 'Tech Mahindra', /\btech mahindra\b|\btechmahindra\b/, ['techmahindra']],
  ['GSI', 'DXC', /\bdxc\b/, ['dxc']],
  ['GSI', 'NTT Data', /\bntt data\b|\bnttdata\b/, ['nttdata']],
  ['GSI', 'Atos', /\batos\b/, ['atos']],
  ['GSI', 'Fujitsu', /\bfujitsu\b/, ['fujitsu']],
  ['GSI', 'Kyndryl', /\bkyndryl\b/, ['kyndryl']],
  ['GSI', 'LTIMindtree', /\blti\s?mindtree\b|\blarsen & toubro infotech\b/, ['ltimindtree']],
  ['GSI', 'Genpact', /\bgenpact\b/, ['genpact']],
  ['GSI', 'EPAM', /\bepam\b/, ['epam']],
  ['GSI', 'Globant', /\bglobant\b/, ['globant']],
  ['GSI', 'Mphasis', /\bmphasis\b/, ['mphasis']],
  ['GSI', 'Hexaware', /\bhexaware\b/, ['hexaware']],
  ['GSI', 'Virtusa', /\bvirtusa\b/, ['virtusa']],
  ['GSI', 'Coforge', /\bcoforge\b/, ['coforge']],
  ['GSI', 'Persistent Systems', /\bpersistent systems\b/, ['persistent']],
  ['GSI', 'Sopra Steria', /\bsopra steria\b|\bsoprasteria\b/, ['soprasteria']],
  ['GSI', 'CGI', /\bcgi\b/, ['cgi']],
  ['GSI', 'Hitachi Digital / Vantara', /\bhitachi (digital|vantara)\b/, ['hitachivantara', 'hitachi-digital']],
  ['GSI', 'Eviden', /\beviden\b/, ['eviden']],
  ['SI', 'Publicis Sapient', /\bpublicis sapient\b|\bsapient\b/, ['publicissapient']],
  ['SI', 'Firstsource', /\bfirstsource\b/, ['firstsource']],
  ['SI', 'Movate', /\bmovate\b/, ['movate']],
  ['SI', 'Oliver Wyman', /\boliver wyman\b/, ['oliverwyman']],
  ['SI', 'Zensar', /\bzensar\b/, ['zensar']],
  ['SI', 'Cyient', /\bcyient\b/, ['cyient']],
  ['SI', 'Mastek', /\bmastek\b/, ['mastek']],
  ['SI', 'Happiest Minds', /\bhappiest minds\b/, ['happiestminds']],
  ['SI', 'Birlasoft', /\bbirlasoft\b/, ['birlasoft']],
  ['SI', 'Sonata Software', /\bsonata software\b/, ['sonata-software']],
  ['SI', 'Ness Digital', /\bness digital\b/, ['ness']],
  ['SI', 'UST', /\bust\b/, ['ust']],
  ['SI', 'Nagarro', /\bnagarro\b/, ['nagarro']],
  ['SI', 'Endava', /\bendava\b/, ['endava']],
  ['SI', 'Thoughtworks', /\bthoughtworks\b/, ['thoughtworks']],
  ['SI', 'Slalom', /\bslalom\b/, ['slalom']],
  ['SI', 'West Monroe', /\bwest monroe\b/, ['westmonroe']],
  ['SI', 'Kearney', /\bkearney\b/, ['kearney', 'atkearney']],
  ['SI', 'Roland Berger', /\broland berger\b/, ['rolandberger']],
  ['SI', 'L.E.K.', /\bl\.?e\.?k\.?(\s|$)/, ['lek']],
  ['SI', 'Alvarez & Marsal', /\balvarez\s*&\s*marsal\b/, ['alvarezandmarsal']],
  ['SI', 'FTI Consulting', /\bfti consulting\b|\bfti\b/, ['fticonsulting']],
  ['SI', 'Protiviti', /\bprotiviti\b/, ['protiviti']],
  ['SI', 'Grant Thornton', /\bgrant thornton\b/, ['grantthornton']],
  ['SI', 'BDO', /\bbdo\b/, ['bdo']],
  ['SI', 'RSM', /\brsm\b/, ['rsm']],
  ['SI', 'Mazars', /\bmazars\b/, ['mazars', 'forvismazars']],
];

// (b) The seed `category` field. (c) Industry keywords, split by headcount.
const CATEGORY = { 'Global SI': 'GSI', 'Big Four': 'Big Four', 'MBB / Strategy': 'MBB', Advisory: 'SI' };
const IT_WORDS = ['information technology', 'it services', 'outsourcing', 'consulting', 'computer software'];
const BIG = 50000, MID = 1000;

const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const people = (n) => `${n.toLocaleString('en-US')} staff`;

export function ruleTier(account) {
  if (!account || typeof account !== 'object') return null;
  const text = [account.name, ...(Array.isArray(account.aliases) ? account.aliases : [])].filter(Boolean).join(' ').toLowerCase();
  const label = String(account.domain || '').toLowerCase().split('.')[0];
  for (const [tier, firm, re, doms] of NAMED) {
    if ((text && re.test(text)) || (label && doms.includes(label))) return { tier, conf: 'Rule', basis: `Named ${TIER_LABEL[tier]} firm: ${firm}` };
  }
  const emp = num(account.employees);
  const cat = String(account.category || '').trim();
  if (cat === 'Indian IT / BPM') return { tier: emp >= BIG ? 'GSI' : 'SI', conf: 'Rule', basis: `Category ${cat}, ${emp ? people(emp) : 'headcount unknown'}` };
  if (CATEGORY[cat]) return { tier: CATEGORY[cat], conf: 'Rule', basis: `Category ${cat}` };
  const ind = String(account.industry || '').toLowerCase();
  if (IT_WORDS.some((w) => ind.includes(w))) {
    if (emp >= BIG) return { tier: 'GSI', conf: 'Rule', basis: `Industry ${account.industry}, ${people(emp)}` };
    if (emp >= MID) return { tier: 'SI', conf: 'Rule', basis: `Industry ${account.industry}, ${people(emp)}` };
  }
  return null;
}

function findAccount(name, accounts) {
  if (!Array.isArray(accounts) || !name) return null;
  const n = String(name).toLowerCase();
  return accounts.find((a) => a && String(a.name || '').toLowerCase() === n)
    || accounts.find((a) => a && Array.isArray(a.aliases) && a.aliases.some((x) => String(x).toLowerCase() === n))
    || null;
}

export function tierOf(name, accountTiers, accounts) {
  const saved = accountTiers && typeof accountTiers === 'object' ? accountTiers[name] : null;
  if (saved && TIERS.includes(saved.tier)) return saved.tier;
  const r = ruleTier(findAccount(name, accounts) || { name });
  return r ? r.tier : 'Other';
}

export function tierGroupOf(name, accountTiers, accounts) {
  return TIER_GROUP[tierOf(name, accountTiers, accounts)] || 'Tier 2';
}
