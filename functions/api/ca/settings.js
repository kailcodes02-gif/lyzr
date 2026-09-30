// GET /api/ca/settings -> { bands, icp_pool, accounts, regions, targets, editors, updated_at, db, source }
//   ca_settings rows merged over the seed files (Campaign_Analytics/seed/*.json).
//   Works without a database (seed defaults, db:false) so the shell can boot.
// PUT /api/ca/settings { key, value }  editors only -> { ok }

import { json, handle, readJson } from './_lib/http.js'
import { requireUser, parseEmails } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { loadSettings, SETTING_KEYS } from './_lib/settings.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const s = await loadSettings(env, request)
  return json(s)
})

function validate(key, value) {
  switch (key) {
    case 'editors': {
      const list = parseEmails(value)
      if (!list.length) throw Object.assign(new Error('editors must be a non-empty list of emails'), { status: 400 })
      return list
    }
    case 'targets': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('targets must be an object'), { status: 400 })
      const out = {}
      for (const [k, v] of Object.entries(value)) {
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`targets.${k} must be a number`), { status: 400 })
        out[k] = n
      }
      return out
    }
    case 'email_rules': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('email_rules must be an object'), { status: 400 })
      const out = {}
      if (value.fast_click_seconds !== undefined) {
        const n = Number(value.fast_click_seconds)
        if (!Number.isFinite(n) || n < 0 || n > 86400) throw Object.assign(new Error('fast_click_seconds must be 0 to 86400'), { status: 400 })
        out.fast_click_seconds = n
      }
      if (value.gsi_page_counts_as_demo !== undefined) out.gsi_page_counts_as_demo = Boolean(value.gsi_page_counts_as_demo)
      if (value.link_rules !== undefined) {
        if (!Array.isArray(value.link_rules)) throw Object.assign(new Error('link_rules must be an array'), { status: 400 })
        out.link_rules = value.link_rules.filter((r) => r && r.match && r.category).map((r) => ({ match: String(r.match), category: String(r.category), ...(r.label ? { label: String(r.label) } : {}) }))
      }
      if (value.domains !== undefined) {
        if (!value.domains || typeof value.domains !== 'object' || Array.isArray(value.domains)) throw Object.assign(new Error('domains must be an object'), { status: 400 })
        out.domains = Object.fromEntries(Object.entries(value.domains).map(([k, v]) => [String(k).toLowerCase().trim(), String(v).trim()]).filter(([k, v]) => k && v))
      }
      return out
    }
    case 'gsi_companies': {
      const list = Array.isArray(value) ? value : String(value || '').split(/\n/)
      const clean = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))]
      return clean
    }
    case 'contact_lists': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('contact_lists must be an object of account name to number'), { status: 400 })
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [String(k).trim(), Number(v)]).filter(([k, v]) => k && Number.isFinite(v) && v >= 0))
    }
    case 'accounts':
    case 'icp_pool': {
      if (!Array.isArray(value)) throw Object.assign(new Error(`${key} must be an array`), { status: 400 })
      return value
    }
    case 'bands':
    case 'regions': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`${key} must be an object`), { status: 400 })
      // regions may be posted as the whole seed file or just the map
      if (key === 'regions' && value.regions && typeof value.regions === 'object') return value.regions
      return value
    }
    default:
      throw Object.assign(new Error(`Unknown settings key. Allowed: ${SETTING_KEYS.join(', ')}`), { status: 400 })
  }
}

export const onRequestPut = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can change settings' }, 403)
  const body = await readJson(request)
  const key = String(body.key || '').trim()
  if (!SETTING_KEYS.includes(key)) return json({ error: `Unknown settings key. Allowed: ${SETTING_KEYS.join(', ')}` }, 400)
  const value = validate(key, body.value)
  const d = db(env)
  await d.upsert('ca_settings', [{ key, value, updated_at: new Date().toISOString(), updated_by: user.email }], 'key')
  return json({ ok: true, key })
})
