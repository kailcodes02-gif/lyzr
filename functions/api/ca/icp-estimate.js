// POST /api/ca/icp-estimate { accounts:[names], countries?:[...] }   editors only
// -> { estimates:[{ company, country, md, md1, md2, conf, basis }], model, skipped:[names] }
//
// Headcount guesses for accounts that have no Apollo count: how many people each account
// employs per country in the MD, MD-1 and MD-2 bands (the designation ladder from Admin › GSI
// accounts when the account has one, otherwise the generic partner / director / senior-manager
// ladder). Claude Sonnet 5 answers once per batch of accounts with a confidence and a one-line
// basis; the answers are saved in the `icp_estimates` setting and shown on the LinkedIn maps as
// estimates (dashed cells) next to the Apollo counts. Accounts that already have an estimate are
// skipped unless { force:true }. At most 12 accounts per call.
import { json, handle, readJson, HttpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { loadSettings } from './_lib/settings.js'
import { MODEL_MAIN } from './insights.js'
import { bumpCacheVersion } from './_lib/cache.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const MAX_ACCOUNTS = 12
export const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Saudi Arabia', 'United Arab Emirates', 'Australia', 'Japan', 'Singapore']

const TOOL = {
  name: 'headcount_estimates',
  description: 'Headcount estimates per account, country and designation band.',
  input_schema: {
    type: 'object',
    properties: {
      estimates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string' },
            country: { type: 'string' },
            md: { type: 'integer', description: 'People in the top band (MD / Partner / SVP equivalent) based in this country.' },
            md1: { type: 'integer', description: 'People one level below (MD-1).' },
            md2: { type: 'integer', description: 'People two levels below (MD-2).' },
            conf: { type: 'string', enum: ['High', 'Medium', 'Low'] },
            basis: { type: 'string', description: 'One short sentence: what the estimate rests on (public headcount, office footprint, typical pyramid).' },
          },
          required: ['company', 'country', 'md', 'md1', 'md2', 'conf', 'basis'],
        },
      },
    },
    required: ['estimates'],
  },
}

const SYSTEM = `You estimate how many senior people a consulting, IT services or advisory firm employs in a given country, split into three designation bands. You answer only with the tool. Rules:
- Work from what you know about the firm (total headcount, country footprint, office locations, partner counts in public reports) and the usual pyramid for its kind of firm. Firms you do not know get a conservative estimate from their category and a Low confidence.
- Count people BASED in the country, not people serving it. A country with no office gets 0 and a Low confidence.
- The bands: md = the firm's top operating band in that ladder (Managing Director, Partner, Senior VP, or the firm's equivalent), md1 = one level below (Director, Associate Partner, VP), md2 = two levels below (Senior Manager, Engagement Manager, AVP). Use the ladder the input gives for the firm when it has one.
- Whole numbers. Round to sensible precision (nearest 5 under 100, nearest 10 under 1000, nearest 50 above). Never pad: a small firm in a small market has a handful of people, not hundreds.
- conf High only for firms whose partner or senior counts are public and recent; Medium when the footprint is well known but the split is inferred; Low otherwise.`

export function userMessage(accounts, countries) {
  return `Estimate headcount per country and band for these firms. Countries: ${countries.join(', ')}. One estimate row per firm per country (${accounts.length * countries.length} rows).\n\n` +
    accounts.map((a) => `- ${a.name}${a.category ? ` (${a.category})` : ''}${a.ladder ? `; ladder: md = ${a.ladder.md || 'top band'}, md1 = ${a.ladder.md1 || 'one below'}, md2 = ${a.ladder.md2 || 'two below'}` : ''}`).join('\n')
}

export async function callClaude(env, accounts, countries) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Claude is not configured (ANTHROPIC_API_KEY)')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL_MAIN,
      max_tokens: 6000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: userMessage(accounts, countries) }],
    }),
  })
  if (!res.ok) { const t = (await res.text().catch(() => '')).slice(0, 300); throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${t}`) }
  const data = await res.json()
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name)
  if (!call || !Array.isArray(call.input && call.input.estimates)) throw new HttpError(502, 'The model did not return estimates')
  return { estimates: call.input.estimates, model: data.model || MODEL_MAIN }
}

/** Keep only rows for the requested accounts and countries, whole non-negative numbers. Pure, exported for tests. */
export function cleanEstimates(rows, accounts, countries, model) {
  const names = new Map(accounts.map((a) => [a.name.toLowerCase(), a.name]))
  const cset = new Set(countries)
  const now = new Date().toISOString()
  const out = []
  for (const r of rows || []) {
    const company = names.get(String(r.company || '').trim().toLowerCase()); const country = String(r.country || '').trim()
    if (!company || !cset.has(country)) continue
    const num = (v) => Math.max(0, Math.round(Number(v) || 0))
    out.push({ company, country, md: num(r.md), md1: num(r.md1), md2: num(r.md2), conf: ['High', 'Medium', 'Low'].includes(r.conf) ? r.conf : 'Low', basis: String(r.basis || '').slice(0, 300), model, estimated_at: now })
  }
  return out
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can run estimates' }, 403)
  const b = await readJson(request)
  const wanted = [...new Set((Array.isArray(b.accounts) ? b.accounts : []).map((x) => String(x || '').trim()).filter(Boolean))]
  if (!wanted.length) return json({ error: 'accounts is required' }, 400)
  const countries = (Array.isArray(b.countries) && b.countries.length ? b.countries : COUNTRIES).map((c) => String(c).trim()).filter(Boolean).slice(0, 12)
  const S = await loadSettings(env, request, { keys: ['accounts', 'icp_pool', 'icp_estimates'] })
  const have = new Set([...(S.icp_pool || []).map((p) => String(p.company).toLowerCase()), ...(b.force ? [] : (S.icp_estimates || []).map((e) => String(e.company).toLowerCase()))])
  const todo = wanted.filter((n) => !have.has(n.toLowerCase())).slice(0, MAX_ACCOUNTS)
  const skipped = wanted.filter((n) => !todo.includes(n))
  if (!todo.length) return json({ estimates: [], model: null, skipped, note: 'Every account asked for already has a count or an estimate.' })
  const accounts = todo.map((name) => { const a = (S.accounts || []).find((x) => x.name === name) || {}; return { name, category: a.category || null, ladder: a.bands || null } })
  const { estimates: raw, model } = await callClaude(env, accounts, countries)
  const estimates = cleanEstimates(raw, accounts, countries, model)
  // Merge into the setting: new rows replace older ones for the same company + country.
  const key = (e) => `${e.company.toLowerCase()}||${e.country.toLowerCase()}`
  const fresh = new Set(estimates.map(key))
  const merged = [...(S.icp_estimates || []).filter((e) => !fresh.has(key(e))), ...estimates]
  await db(env).upsert('ca_settings', [{ key: 'icp_estimates', value: merged, updated_at: new Date().toISOString(), updated_by: user.email }], 'key')
  await bumpCacheVersion(env)
  return json({ estimates, model, skipped, total: merged.length })
})
