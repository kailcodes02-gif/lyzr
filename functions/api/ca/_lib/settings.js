// Settings = ca_settings rows merged over the seed files in
// Campaign_Analytics/seed/. Seeds are read from the deployed static assets
// through env.ASSETS so the Function never bundles them.

import { db, dbConfigured } from './db.js'
import { bandsFromSeeds } from './classify.js'
import { DEFAULT_EDITORS, parseEmails } from './auth.js'

export const DEFAULT_LEAD_RULES = {
  conversation: ['conversation', 'message ad', 'sponsored messaging', 'inmail', 'conversation ad'],
  mql: ['book a demo', 'book-a-demo', 'bookademo', 'book demo', 'demo', 'meeting', 'consultation'],
  playbook: ['playbook', 'roadmap', 'guide', 'ebook', 'e-book', 'whitepaper', 'report', 'workshop', 'webinar'],
}
export const SETTING_KEYS = ['bands', 'icp_pool', 'accounts', 'regions', 'targets', 'editors', 'email_rules', 'gsi_companies', 'contact_lists', 'lead_rules']

export const DEFAULT_TARGETS = { leads_per_month: 200, demo_mqls_per_month: 30, frequency: 3.5, reach_frequency: 3 }

// Email rules. Link rules and domain map are optional overrides; the view has
// built-in defaults (js/lib/email-agg.mjs) and applies these on top.
export const DEFAULT_EMAIL_RULES = {
  fast_click_seconds: 180,        // a click this soon after the send is flagged as a likely scanner
  gsi_page_counts_as_demo: true,  // a click on the GSI/SI page counts as Book a Demo ("via GSI/SI page")
  link_rules: [],                 // [{ match:'substring or /regex/', category, label? }] checked before the defaults
  domains: {},                    // { 'atkearney.com': 'Kearney' } email domain -> company
}

const SEED_FILES = {
  accounts: 'accounts.json',
  band_titles: 'band_titles.json',
  icp_pool: 'icp_pool.json',
  regions: 'regions.json',
}

async function readSeed(env, request, file) {
  try {
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null
    const res = await env.ASSETS.fetch(new URL('/Campaign_Analytics/seed/' + file, request.url))
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Load only the seeds that are needed (each is one subrequest).
export async function loadSeeds(env, request, names = Object.keys(SEED_FILES)) {
  const out = {}
  await Promise.all(names.map(async (n) => { out[n] = await readSeed(env, request, SEED_FILES[n]) }))
  return out
}

// -> { bands, icp_pool, accounts, regions, targets, editors, updated_at, source:{key:'db'|'seed'} }
// Never throws on a missing database: seed defaults are returned and
// `db:false` says so.
export async function loadSettings(env, request, { keys = SETTING_KEYS } = {}) {
  let rows = []
  let dbOk = false
  if (dbConfigured(env)) {
    try {
      rows = await db(env).select('ca_settings', { select: 'key,value,updated_at,updated_by' })
      dbOk = true
    } catch { rows = [] }
  }
  const byKey = {}
  for (const r of rows) byKey[r.key] = r
  const need = (k) => keys.includes(k) && !byKey[k]
  const seedNames = []
  if (need('accounts') || need('bands')) seedNames.push('accounts')
  if (need('bands')) seedNames.push('band_titles')
  if (need('icp_pool')) seedNames.push('icp_pool')
  if (need('regions')) seedNames.push('regions')
  const seeds = seedNames.length ? await loadSeeds(env, request, seedNames) : {}

  const out = { db: dbOk, source: {}, updated_at: null }
  const pick = (k, fallback) => {
    if (byKey[k]) { out[k] = byKey[k].value; out.source[k] = 'db' } else { out[k] = fallback; out.source[k] = 'seed' }
  }
  if (keys.includes('accounts')) pick('accounts', seeds.accounts || [])
  if (keys.includes('bands')) pick('bands', bandsFromSeeds(seeds.band_titles || {}, byKey.accounts ? byKey.accounts.value : seeds.accounts || []))
  if (keys.includes('icp_pool')) pick('icp_pool', seeds.icp_pool || [])
  if (keys.includes('regions')) pick('regions', (seeds.regions && seeds.regions.regions) || {})
  if (keys.includes('targets')) pick('targets', DEFAULT_TARGETS)
  if (keys.includes('email_rules')) { pick('email_rules', DEFAULT_EMAIL_RULES); out.email_rules = { ...DEFAULT_EMAIL_RULES, ...(out.email_rules || {}) } }
  // Extra company names on top of the account list (seed/accounts.json), which is the GSI list.
  if (keys.includes('gsi_companies')) pick('gsi_companies', [])
  // Contact list sizes per account ({ 'Account name': number }) for LinkedIn "Reach vs contacts by company".
  if (keys.includes('contact_lists')) pick('contact_lists', {})
  // Keywords that sort LinkedIn lead-form leads into MQL / conversation / playbook (else other).
  if (keys.includes('lead_rules')) pick('lead_rules', DEFAULT_LEAD_RULES)
  if (keys.includes('editors')) {
    pick('editors', parseEmails(env && env.CA_EDITORS).length ? parseEmails(env.CA_EDITORS) : DEFAULT_EDITORS)
    if (byKey.editors) out.editors = parseEmails(byKey.editors.value)
  }
  if (keys.includes('targets') && out.targets && typeof out.targets === 'object') out.targets = { ...DEFAULT_TARGETS, ...out.targets }
  for (const r of rows) if (r.updated_at && (!out.updated_at || r.updated_at > out.updated_at)) out.updated_at = r.updated_at
  return out
}
