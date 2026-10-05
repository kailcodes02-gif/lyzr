// POST /api/ca/account-tiers { accounts?:[names], force?:bool, limit?:n }   editors only
// -> { tiers:[{ name, tier, conf, basis, source, model?, at }], rule, claude, remaining, model }
//
// Sorts accounts into GSI / SI / Big Four / MBB / Other (see _lib/tiers.js). Candidates are the names
// asked for (every account when omitted) minus those already in the `account_tiers` setting unless
// { force:true }. The rules in _lib/tiers.js classify what they can for free; the remainder, up to
// `limit` (default 80, max 100) per call, goes to Claude Sonnet in ONE forced-tool request with low
// effort. Results are merged into `account_tiers` ({ [name]: { tier, conf, basis, source, model, at } })
// and `remaining` says how many candidates are still unclassified so the client can call again.
import { json, handle, readJson, HttpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { loadSettings } from './_lib/settings.js'
import { TIERS, ruleTier } from './_lib/tiers.js'
import { MODEL_MAIN } from './insights.js'
import { bumpCacheVersion } from './_lib/cache.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const DEFAULT_LIMIT = 80
export const MAX_LIMIT = 100

const TOOL = {
  name: 'account_tiers',
  description: 'One tier per account.',
  input_schema: {
    type: 'object',
    properties: {
      tiers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The account name exactly as given.' },
            tier: { type: 'string', enum: TIERS },
            conf: { type: 'string', enum: ['High', 'Medium', 'Low'] },
            basis: { type: 'string', description: 'One short sentence: why this tier.' },
          },
          required: ['name', 'tier', 'conf', 'basis'],
        },
      },
    },
    required: ['tiers'],
  },
}

const SYSTEM = `You sort companies into one of five tiers for a B2B marketing programme that targets system integrators and consultancies. Answer only with the tool, one row per company, name copied exactly. The tiers:
- GSI: global system integrators and large IT services firms with 50,000+ staff and multi-region delivery (Accenture, Capgemini, Cognizant, Infosys, TCS, Wipro, HCLTech, DXC, NTT Data, Kyndryl and their peers).
- SI: smaller or regional system integrators, digital engineering or IT services firms, digital consultancies and advisory firms that implement technology for clients (under 50,000 staff, or regional reach). This includes mid-size Indian IT, BPM and engineering services firms and mid-tier consultancies.
- Big Four: Deloitte, EY, PwC, KPMG and their member firms or digital arms.
- MBB: McKinsey, BCG, Bain and other pure strategy houses of that tier.
- Other: not a system integrator or consultancy at all (software vendors, product companies, banks, telcos, manufacturers, staffing agencies, end customers).
Decide from what you know about the firm; the industry, country and headcount given are hints, not proof. A company you do not know with an IT services or consulting industry and 1,000+ staff is SI with Low confidence; an unknown company in any other industry is Other with Low confidence. conf High only when the firm is well known.`

/** The one user message: name, domain, industry, country, employees per account. Pure, exported for tests. */
export function userMessage(accounts) {
  return `Tier these ${accounts.length} companies (one row each, names exactly as written):\n\n` +
    accounts.map((a) => `- ${a.name}` + [a.domain && `domain ${a.domain}`, a.industry && `industry ${a.industry}`, a.country && `country ${a.country}`, a.employees && `${a.employees} employees`].filter(Boolean).map((s) => `; ${s}`).join('')).join('\n')
}

async function post(env, body) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
}

export async function callClaude(env, accounts) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Claude is not configured (ANTHROPIC_API_KEY)')
  const body = {
    model: MODEL_MAIN,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: userMessage(accounts) }],
  }
  let res = await post(env, body)
  if (res.status === 400) {
    // An older API shape may not know output_config / effort: retry once without it.
    const t = await res.text().catch(() => '')
    if (/output_config|effort/i.test(t)) { const { output_config, ...rest } = body; res = await post(env, rest) }
    else throw new HttpError(502, `Model error 400: ${t.slice(0, 300)}`)
  }
  if (!res.ok) { const t = (await res.text().catch(() => '')).slice(0, 300); throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${t}`) }
  const data = await res.json()
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name)
  if (!call || !Array.isArray(call.input && call.input.tiers)) throw new HttpError(502, 'The model did not return tiers')
  return { tiers: call.input.tiers, model: data.model || MODEL_MAIN }
}

/** Keep only rows for the asked names with a known tier; one row per name. Pure, exported for tests. */
export function cleanTiers(rows, names, model) {
  const want = new Map((names || []).map((n) => [String(n).trim().toLowerCase(), String(n).trim()]))
  const now = new Date().toISOString()
  const out = {}
  for (const r of rows || []) {
    const name = want.get(String((r && r.name) || '').trim().toLowerCase())
    if (!name || !r || !TIERS.includes(r.tier) || out[name]) continue
    out[name] = { name, tier: r.tier, conf: ['High', 'Medium', 'Low'].includes(r.conf) ? r.conf : 'Low', basis: String(r.basis || '').slice(0, 300), source: 'claude', model, at: now }
  }
  return Object.values(out)
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can classify accounts' }, 403)
  const b = await readJson(request)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(b.limit) || DEFAULT_LIMIT)))
  const S = await loadSettings(env, request, { keys: ['accounts', 'account_tiers'] })
  const all = (S.accounts || []).filter((a) => a && a.name)
  const byName = new Map(all.map((a) => [a.name, a]))
  const asked = Array.isArray(b.accounts) ? [...new Set(b.accounts.map((x) => String(x || '').trim()).filter(Boolean))] : all.map((a) => a.name)
  const have = S.account_tiers && typeof S.account_tiers === 'object' ? S.account_tiers : {}
  const todo = asked.filter((n) => b.force || !have[n])
  const now = new Date().toISOString()
  const rows = []
  const forClaude = []
  for (const n of todo) {
    const a = byName.get(n) || { name: n }
    const r = ruleTier(a)
    if (r) rows.push({ name: n, tier: r.tier, conf: r.conf, basis: r.basis, source: 'rule', at: now })
    else forClaude.push({ name: n, domain: a.domain || null, industry: a.industry || null, country: a.country || null, employees: a.employees || null })
  }
  const batch = forClaude.slice(0, limit)
  let model = null
  let claude = []
  if (batch.length) { const r = await callClaude(env, batch); model = r.model; claude = cleanTiers(r.tiers, batch.map((a) => a.name), model) }
  const fresh = [...rows, ...claude]
  const remaining = todo.length - fresh.length
  if (fresh.length) {
    const merged = { ...have }
    for (const r of fresh) { const { name, ...v } = r; merged[name] = v }
    await db(env).upsert('ca_settings', [{ key: 'account_tiers', value: merged, updated_at: now, updated_by: user.email }], 'key')
    await bumpCacheVersion(env)
  }
  return json({ tiers: fresh, rule: rows.length, claude: claude.length, remaining, model })
})
