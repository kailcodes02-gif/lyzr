// Pure classification helpers (no I/O) for Campaign Analytics:
//   toAccount(companyRaw, accounts, targetList) -> canonical account name or null
//   toBand(jobtitle, account, bands)             -> 'MD' | 'MD-1' | 'MD-2' | 'Other' | 'Unknown'
//   toRegion(country, regions)                   -> region name or 'Other'
// `accounts` is seed/accounts.json (or the Settings override), `bands` is the
// settings.bands object ({ global:{MD,MD1,MD2,split}, accounts:{name:{md,md1,md2}} }),
// `regions` is seed/regions.json's `regions` map (or the whole file).

import { DEFAULT_COMPANIES } from '../../_lib/target-companies.js'

export const BANDS = ['MD', 'MD-1', 'MD-2']

// Groups of names that mean the same company. The first entry is the
// preferred canonical spelling when the accounts list has none of them.
const SYNONYM_GROUPS = [
  ['Tata Consultancy Services', 'TCS'],
  ['Boston Consulting Group (BCG)', 'BCG', 'Boston Consulting Group', 'BCG X'],
  ['EY', 'Ernst & Young', 'Ernst & Young (EY)', 'Ernst and Young'],
  ['PwC', 'PricewaterhouseCoopers', 'PricewaterhouseCoopers (PwC)', 'Pricewaterhouse Coopers'],
  ['HCLTech', 'HCL', 'HCL Technologies', 'HCL Tech'],
  // LTI is its own account in the GSI list (owner Anju), so it is not a synonym here.
  ['LTIMindtree', 'LTI Mindtree', 'Mindtree'],
  ['Cognizant', 'CTS', 'Cognizant Technology Solutions'],
  ['McKinsey & Company', 'McKinsey', 'McKinsey and Company'],
  ['Bain & Company', 'Bain', 'Bain Digital'],
  ['EPAM Systems', 'EPAM'],
  ['Deloitte', 'Deloitte Consulting', 'Deloitte Digital'],
  ['KPMG', 'KPMG US', 'KPMG India'],
  ['Accenture', 'Accenture Strategy & Consulting', 'Accenture in India'],
  ['NTT Data', 'NTT DATA'],
  ['Oliver Wyman', 'Oliver Wyman (Digital)'],
  ['Kearney', 'Kearney (Digital)', 'A.T. Kearney'],
  ['Roland Berger', 'Roland Berger (IT)'],
  ['AlixPartners', 'AlixPartners (Digital)'],
]

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(s) {
  const n = norm(s)
  return n ? n.split(' ') : []
}

// True when `needle` appears in `hay` as a contiguous run of whole tokens.
function containsTokens(hayTokens, needleTokens) {
  if (!needleTokens.length || needleTokens.length > hayTokens.length) return false
  outer: for (let i = 0; i + needleTokens.length <= hayTokens.length; i++) {
    for (let j = 0; j < needleTokens.length; j++) if (hayTokens[i + j] !== needleTokens[j]) continue outer
    return true
  }
  return false
}

// Names for one list entry: the entry itself and, for 'Name (Alias)', the
// part before the bracket and the bracketed alias.
function variants(name) {
  const out = [String(name)]
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(String(name))
  if (m) {
    out.push(m[1])
    // only an acronym in brackets is an alias ('(BCG)', '(PwC)', '(GDT)');
    // '(Services)' or '(Healthcare IT)' is a description, not a name
    const inner = m[2].trim()
    if (/^[A-Za-z&]{2,6}$/.test(inner) && (inner.match(/[A-Z]/g) || []).length >= 2) out.push(inner)
  }
  return out.map((s) => s.trim()).filter(Boolean)
}

function synonymsOf(name) {
  const n = norm(name)
  for (const g of SYNONYM_GROUPS) if (g.some((x) => norm(x) === n)) return g
  return [name]
}

// Canonical name for a matched list entry: prefer an accounts.json name in
// the same synonym group, else the group's first entry, else the entry.
function canonicalFor(name, accountNames) {
  const group = synonymsOf(name)
  for (const g of group) {
    const hit = accountNames.find((a) => norm(a) === norm(g))
    if (hit) return hit
  }
  return group[0]
}

// Candidate phrases are built once per (accounts, targetList) pair and cached,
// because the HubSpot refresh classifies up to 2,000 contacts per invocation.
const INDEX_CACHE = new WeakMap()
const DEFAULT_KEY = {}

function buildIndex(accounts, targetList) {
  const list = Array.isArray(accounts) ? accounts : []
  const accountNames = list.map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean)
  const cands = []
  for (const a of list) {
    const name = typeof a === 'string' ? a : a && a.name
    if (!name) continue
    const phrases = new Set()
    for (const v of [name, ...((a && a.aliases) || [])]) {
      for (const s of synonymsOf(v)) for (const vv of variants(s)) phrases.add(vv)
    }
    for (const p of phrases) cands.push([p, name])
  }
  for (const t of targetList || []) {
    const canon = canonicalFor(t, accountNames)
    for (const s of synonymsOf(t)) for (const vv of variants(s)) cands.push([vv, canon])
  }
  const exact = new Map()
  for (const [p, canon] of cands) if (!exact.has(norm(p))) exact.set(norm(p), canon)
  // contains: longest phrase first so 'Accenture Strategy' beats 'Accenture';
  // single very short tokens ('it', 'us') are too ambiguous to match on; 'ey' is the exception
  const scored = cands
    .map(([p, canon]) => [tokens(p), canon])
    .filter(([tk]) => tk.length && (tk.length > 1 || tk[0].length >= 3 || tk[0] === 'ey'))
    .sort((a, b) => b[0].join(' ').length - a[0].join(' ').length)
  return { exact, scored }
}

function indexFor(accounts, targetList) {
  const aKey = accounts && typeof accounts === 'object' ? accounts : DEFAULT_KEY
  const tKey = targetList && typeof targetList === 'object' ? targetList : DEFAULT_COMPANIES
  let byTarget = INDEX_CACHE.get(aKey)
  if (!byTarget) { byTarget = new WeakMap(); INDEX_CACHE.set(aKey, byTarget) }
  let idx = byTarget.get(tKey)
  if (!idx) { idx = buildIndex(accounts, targetList); byTarget.set(tKey, idx) }
  return idx
}

export function toAccount(companyRaw, accounts = [], targetList = DEFAULT_COMPANIES) {
  const hay = tokens(companyRaw)
  if (!hay.length) return null
  const { exact, scored } = indexFor(accounts, targetList)
  // 1. exact match (whole string)
  const hit = exact.get(norm(companyRaw))
  if (hit) return hit
  // 2. contains as whole tokens, longest phrase first
  for (const [tk, canon] of scored) if (containsTokens(hay, tk)) return canon
  return null
}

// ---- bands -----------------------------------------------------------------

const ABBREV = {
  md: 'managing director',
  mdp: 'managing director and partner',
  svp: 'senior vice president',
  evp: 'executive vice president',
  vp: 'vice president',
  avp: 'assistant vice president',
  gm: 'general manager',
  dgm: 'deputy general manager',
  agm: 'assistant general manager',
}

// Expand abbreviations so 'SVP' in a convention matches 'Senior Vice President'
// in a title and the other way round. Returns the list of token arrays to try.
function phraseForms(phrase) {
  const base = tokens(phrase.replace(/\([^)]*\)/g, ' '))
  if (!base.length) return []
  const forms = new Set([base.join(' ')])
  const expanded = base.flatMap((t) => (ABBREV[t] ? ABBREV[t].split(' ') : [t]))
  forms.add(expanded.join(' '))
  // and the reverse: collapse multi-word forms to their abbreviation
  let collapsed = ' ' + expanded.join(' ') + ' '
  for (const [ab, full] of Object.entries(ABBREV)) collapsed = collapsed.replace(' ' + full + ' ', ' ' + ab + ' ')
  forms.add(collapsed.trim())
  return [...forms].map((f) => f.split(' ')).filter((f) => f.length)
}

function titleForms(jobtitle) {
  const t = tokens(jobtitle)
  const expanded = t.flatMap((x) => (ABBREV[x] ? ABBREV[x].split(' ') : [x]))
  return [t, expanded]
}

// Longest phrase wins; on a tie the higher band wins.
function bestBand(titleTk, bandPhrases) {
  let best = null
  for (const [band, phrases] of bandPhrases) {
    for (const phrase of phrases) {
      for (const form of phraseForms(phrase)) {
        for (const tt of titleTk) {
          if (containsTokens(tt, form)) {
            const len = form.join(' ').length
            if (!best || len > best.len) best = { band, len }
          }
        }
      }
    }
  }
  return best ? best.band : null
}

function splitConvention(s) {
  return String(s || '').split(/\s*\/\s*|\s*,\s*|\s*;\s*/).map((x) => x.trim()).filter(Boolean)
}

// Deterministic 50/50 split for a bare 'Director' title (band_titles note).
function hashParity(s) {
  let h = 0
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 2
}

const KEYWORD_RULES = [
  ['MD', ['svp', 'senior vice president', 'partner', 'managing director', 'managing partner', 'senior partner', 'founder', 'board member', 'chief executive officer', 'ceo', 'chief technology officer', 'cto', 'chief operating officer', 'coo', 'chief information officer', 'cio', 'chief digital officer', 'chief ai officer', 'president']],
  ['MD-1', ['vp', 'vice president', 'avp', 'assistant vice president', 'associate director', 'senior director', 'principal', 'associate partner', 'executive director', 'head of']],
  ['MD-2', ['senior manager', 'engagement manager', 'delivery manager', 'general manager', 'manager', 'delivery head', 'project leader', 'lead consultant', 'principal consultant']],
]

export function toBand(jobtitle, account, bands = {}) {
  const title = String(jobtitle || '').trim()
  if (!title) return 'Unknown'
  const titleTk = titleForms(title)
  if (!titleTk[0].length) return 'Unknown'

  // 1. per-account conventions
  const conv = account && bands && bands.accounts && bands.accounts[account]
  if (conv) {
    const b = bestBand(titleTk, [
      ['MD', splitConvention(conv.md)],
      ['MD-1', splitConvention(conv.md1)],
      ['MD-2', splitConvention(conv.md2)],
    ])
    if (b) return b
  }

  // 2. global LinkedIn title buckets
  const g = (bands && bands.global) || {}
  const b2 = bestBand(titleTk, [
    ['MD', g.MD || []],
    ['MD-1', g.MD1 || g['MD-1'] || []],
    ['MD-2', g.MD2 || g['MD-2'] || []],
  ])
  if (b2) return b2
  // bare Director: split 50/50 between MD-1 and MD-2 (deterministic per title)
  if (containsTokens(titleTk[0], ['director']) && !containsTokens(titleTk[1], ['managing', 'director'])) {
    return hashParity(norm(title)) === 0 ? 'MD-1' : 'MD-2'
  }

  // 3. keyword rules
  const b3 = bestBand(titleTk, KEYWORD_RULES)
  return b3 || 'Other'
}

// ---- regions ---------------------------------------------------------------

export const COUNTRY_CODES = {
  IN: 'India', US: 'United States', USA: 'United States', CA: 'Canada', GB: 'United Kingdom', UK: 'United Kingdom', IE: 'Ireland',
  AE: 'United Arab Emirates', UAE: 'United Arab Emirates', SA: 'Saudi Arabia', KSA: 'Saudi Arabia', QA: 'Qatar', OM: 'Oman', KW: 'Kuwait', BH: 'Bahrain',
  EG: 'Egypt', JO: 'Jordan', IL: 'Israel', LB: 'Lebanon', IQ: 'Iraq', TR: 'Turkey', CY: 'Cyprus',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', PT: 'Portugal', PL: 'Poland', BE: 'Belgium', CH: 'Switzerland',
  DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland', AT: 'Austria', GR: 'Greece', LU: 'Luxembourg', CZ: 'Czechia', RO: 'Romania', HU: 'Hungary',
  AU: 'Australia', NZ: 'New Zealand', SG: 'Singapore', JP: 'Japan', MY: 'Malaysia', PH: 'Philippines', ID: 'Indonesia', VN: 'Vietnam', TH: 'Thailand',
  HK: 'Hong Kong', KR: 'South Korea', TW: 'Taiwan', CN: 'China', LK: 'Sri Lanka',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Peru',
  ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya',
}

const COUNTRY_ALIASES = {
  'united states of america': 'United States', 'u s': 'United States', 'u s a': 'United States', 'america': 'United States',
  'great britain': 'United Kingdom', 'england': 'United Kingdom', 'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'u k': 'United Kingdom',
  'uae': 'United Arab Emirates', 'emirates': 'United Arab Emirates', 'dubai': 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates',
  'ksa': 'Saudi Arabia', 'kingdom of saudi arabia': 'Saudi Arabia', 'riyadh': 'Saudi Arabia',
  'turkiye': 'Turkey', 'czech republic': 'Czechia', 'republic of korea': 'South Korea', 'korea': 'South Korea',
  'viet nam': 'Vietnam', 'holland': 'Netherlands', 'the netherlands': 'Netherlands', 'bharat': 'India',
}

export function toRegion(country, regions = {}) {
  const map = regions && regions.regions && typeof regions.regions === 'object' ? regions.regions : regions
  if (!map || typeof map !== 'object') return 'Other'
  const raw = String(country || '').trim()
  if (!raw) return 'Other'
  let name = raw
  const code = raw.toUpperCase()
  if (/^[A-Z]{2,3}$/.test(code) && COUNTRY_CODES[code]) name = COUNTRY_CODES[code]
  const n = norm(name)
  const aliased = COUNTRY_ALIASES[n]
  const wanted = new Set([n, aliased ? norm(aliased) : null].filter(Boolean))
  for (const [region, list] of Object.entries(map)) {
    if (!Array.isArray(list)) continue
    if (region && wanted.has(norm(region))) return region
    for (const c of list) if (wanted.has(norm(c))) return region
  }
  return 'Other'
}

// Build the settings.bands shape from the two seeds.
export function bandsFromSeeds(bandTitles = {}, accounts = []) {
  const perAccount = {}
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a && a.name && a.bands) perAccount[a.name] = { md: a.bands.md || '', md1: a.bands.md1 || '', md2: a.bands.md2 || '' }
  }
  return {
    global: bandTitles.global || { MD: [], MD1: [], MD2: [], split: '' },
    accounts: perAccount,
    note: bandTitles.note || '',
  }
}
