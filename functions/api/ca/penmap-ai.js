// /api/ca/penmap-ai: Claude Sonnet writes the parts of the Penetration map page that need judgement:
// headline callouts, why each ad set worked or did not, what to do and what not to do, the spend plan
// (ad sets with targeting, the benchmark ad set from this account and CPL / CPM ranges), the set-up steps,
// the day-3 rules and the accounts to target from the anti heat map. The numbers stay the page's own:
// the plan maths (leads = spend ÷ CPL, people = 1000 × spend ÷ CPM ÷ 3) runs in js/lib/penmap-agg.mjs.
//
//   GET  ?scope=penmap:main          -> { scope, content, created_at, model, cached:true } or 404
//   POST { scope?, input, force? }   -> { scope, content, cached, created_at, model }
// Cached in ca_insights by scope + sha256(input), like /api/ca/insights; force needs an editor.

import { json, handle, readJson, sha256, HttpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { capInput } from './insights.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const MODEL = 'claude-sonnet-5'
const MAX_INPUT = 90 * 1024

export const SYSTEM = `You are the paid-media analyst inside Lyzr's Campaign Analytics dashboard, writing the judgement parts of the "GSI LinkedIn Penetration Map" page.

About Lyzr: an agentic AI platform sold to enterprises through Global System Integrators and SIs (Accenture, Deloitte, EY, KPMG, PwC, McKinsey, BCG, Bain, TCS, Infosys, Wipro, HCLTech, Tech Mahindra, LTIMindtree, Cognizant, Genpact, Capgemini, EPAM, Fujitsu, NTT DATA...). The LinkedIn programme's job: reach MD, MD-1 and MD-2 people at those firms in every region, turn them into lead-form leads (playbooks) and demos.

The input is computed by the page from the uploaded LinkedIn exports:
- monthly: spend, lead-gen spend, impressions, clicks, form leads, form opens, region share of impressions.
- ad_sets: every ad set with objective, months active, geography read from its name, spend, impressions, leads, CPL, CPM, video views, and its latest-month figures.
- kpis: lead-gen CPL in the recent months vs before, the home region's share of impressions, the non-home regional ad sets in the latest month.
- non_home_gaps and anti_heat_map: accounts and regions with Apollo MD to MD-2 headcount the ads have not reached recently (gap = headcount − people reached; people = impressions ÷ 3).
- rule_worked: which ad sets the page's rules put in worked / did not work.
- budget: the amount and days the plan must spend. screenshots: notes read from uploaded screenshots (lead forms, campaign numbers), use them as extra evidence. action_log: what the team already tracked.

Rules:
- Use only numbers from the input and quote them. Never invent a figure. Every CPL or CPM range in the plan must come from a named ad set in the input (its own results), written in "benchmark".
- Plain, short sentences. No em dashes anywhere. No hype.
- Ad set names must be copied exactly from the input when you refer to one.
- The plan must spend the given budget over the given days. Give each row a share of the budget (shares sum to 1). Lead-gen rows carry cpl_low and cpl_high; reach rows (video views, brand awareness, thought-leader posts) carry cpm_low and cpm_high. 3 to 6 rows. Keys L1, L2... for lead gen and T1, T2... for reach.
- Prefer what the data shows works (heat-map or company-list native targeting, combined-region ad sets, retargeting) and say what to stop (single-country clones with tiny audiences, demo-form asks to cold audiences, single-account awareness) only when the input shows it.
- The home region is given; if it is saturated (high impressions share, penetration at or over the headcount) steer new reach to the regions with the biggest gaps.
Answer by calling the penmap_plan tool exactly once.`

export const TOOL = {
  name: 'penmap_plan',
  description: 'Return the written parts of the penetration map page.',
  input_schema: {
    type: 'object',
    properties: {
      headlines: { type: 'array', maxItems: 4, items: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string', description: 'Two or three sentences with the numbers.' }, tone: { type: 'string', enum: ['good', 'bad', 'info'] } }, required: ['title', 'body', 'tone'] } },
      worked: { type: 'array', maxItems: 10, items: { type: 'object', properties: { label: { type: 'string', description: 'Short readable name, e.g. "Heat-map native · playbooks (Sep 2)"' }, adsets: { type: 'array', items: { type: 'string' }, description: 'Exact ad set names from the input this row sums.' }, mode: { type: 'string', enum: ['lead_gen', 'awareness'] }, why: { type: 'string' } }, required: ['label', 'adsets', 'mode', 'why'] } },
      did_not_work: { type: 'array', maxItems: 10, items: { type: 'object', properties: { label: { type: 'string' }, adsets: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['lead_gen', 'awareness'] }, why: { type: 'string' } }, required: ['label', 'adsets', 'mode', 'why'] } },
      do: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'What to do next, each with the evidence.' },
      dont: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'What to stop or avoid, each with the evidence.' },
      plan: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'e.g. "Non-India only, half leads, half reach"' },
          rows: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: {
            key: { type: 'string' }, objective: { type: 'string', description: 'Lead gen, Video views, Brand awareness...' }, name: { type: 'string' },
            targeting: { type: 'string', description: 'Exact set-up: duplicate which ad set, locations, seniority, form, exclusions.' },
            benchmark: { type: 'string', description: 'Which ad set of this account the range comes from, with its number.' },
            share: { type: 'number', description: 'Share of the budget, 0 to 1.' },
            cpl_low: { type: 'number' }, cpl_high: { type: 'number' }, cpm_low: { type: 'number' }, cpm_high: { type: 'number' },
          }, required: ['key', 'objective', 'name', 'targeting', 'benchmark', 'share'] } },
        },
        required: ['rows'],
      },
      setup_steps: { type: 'array', maxItems: 8, items: { type: 'string' } },
      day3_rules: { type: 'array', maxItems: 8, items: { type: 'string' } },
      target_accounts: { type: 'array', maxItems: 15, items: { type: 'object', properties: { account: { type: 'string' }, region: { type: 'string' }, why: { type: 'string' } }, required: ['account', 'region', 'why'] }, description: 'From the anti heat map: who to load into top-of-funnel first.' },
      summary: { type: 'string' },
    },
    required: ['headlines', 'worked', 'did_not_work', 'do', 'dont', 'plan', 'setup_steps', 'day3_rules', 'summary'],
  },
}

const S = (v, max = 1200) => String(v == null ? '' : v).replace(/—/g, ', ').trim().slice(0, max)
const arr = (v, max) => (Array.isArray(v) ? v : []).slice(0, max)
const num = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
export function cleanPlan(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const rowSet = (list) => arr(list, 10).map((r) => ({ label: S(r && r.label, 200), adsets: arr(r && r.adsets, 20).map((x) => S(x, 300)).filter(Boolean), mode: r && r.mode === 'awareness' ? 'awareness' : 'lead_gen', why: S(r && r.why, 600) })).filter((r) => r.label)
  const rows = arr(c.plan && c.plan.rows, 6).map((r, i) => ({
    key: S(r && r.key, 8) || `P${i + 1}`, objective: S(r && r.objective, 60), name: S(r && r.name, 200), targeting: S(r && r.targeting, 900), benchmark: S(r && r.benchmark, 300),
    share: Math.max(0, Number(r && r.share) || 0), cpl_low: num(r && r.cpl_low), cpl_high: num(r && r.cpl_high), cpm_low: num(r && r.cpm_low), cpm_high: num(r && r.cpm_high),
  })).filter((r) => r.name && ((r.cpl_low && r.cpl_high) || (r.cpm_low && r.cpm_high)))
  if (!rows.length) throw new HttpError(502, 'The model returned no usable plan rows')
  return {
    headlines: arr(c.headlines, 4).map((h) => ({ title: S(h && h.title, 160), body: S(h && h.body, 700), tone: ['good', 'bad', 'info'].includes(h && h.tone) ? h.tone : 'info' })).filter((h) => h.title),
    worked: rowSet(c.worked), did_not_work: rowSet(c.did_not_work),
    do: arr(c.do, 8).map((x) => S(x, 500)).filter(Boolean), dont: arr(c.dont, 8).map((x) => S(x, 500)).filter(Boolean),
    plan: { title: S(c.plan && c.plan.title, 160), rows },
    setup_steps: arr(c.setup_steps, 8).map((x) => S(x, 600)).filter(Boolean), day3_rules: arr(c.day3_rules, 8).map((x) => S(x, 400)).filter(Boolean),
    target_accounts: arr(c.target_accounts, 15).map((t) => ({ account: S(t && t.account, 120), region: S(t && t.region, 40), why: S(t && t.why, 400) })).filter((t) => t.account),
    summary: S(c.summary, 800),
  }
}

export async function callClaude(env, inputJson) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 6000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: `Penetration map input (JSON):\n${inputJson}` }],
    }),
  })
  if (!res.ok) { const t = (await res.text().catch(() => '')).slice(0, 300); throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${t}`) }
  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new HttpError(502, 'The model declined this request')
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name)
  if (!call) throw new HttpError(502, 'The model did not return a plan')
  return { content: cleanPlan(call.input), usage: data.usage || null, model: data.model || MODEL }
}

const scopeOf = (v) => { const s = String(v || 'penmap:main').trim().slice(0, 120); if (!/^penmap:[\w:.-]+$/.test(s)) throw new HttpError(400, 'scope must start with penmap:'); return s }

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const scope = scopeOf(new URL(request.url).searchParams.get('scope'))
  const rows = await db(env).select('ca_insights', { params: { scope: `eq.${scope}` }, limit: 1 })
  if (!rows.length) return json({ error: 'No plan yet' }, 404)
  const r = rows[0]
  return json({ scope, content: r.content, created_at: r.created_at, model: r.model, created_by: r.created_by, cached: true })
})

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const b = await readJson(request)
  const scope = scopeOf(b.scope)
  if (b.input == null) return json({ error: 'input is required' }, 400)
  const force = Boolean(b.force)
  if (force && !user.isEditor) return json({ error: 'Only editors can force a regeneration' }, 403)
  const d = db(env)
  const { input, truncated } = capInput(b.input, MAX_INPUT)
  const inputJson = JSON.stringify(input)
  const hash = await sha256(inputJson)
  const cached = await d.select('ca_insights', { params: { scope: `eq.${scope}` }, limit: 1 })
  if (cached.length && cached[0].input_hash === hash && !force) { const r = cached[0]; return json({ scope, content: r.content, cached: true, created_at: r.created_at, model: r.model }) }
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude is not configured (ANTHROPIC_API_KEY)' }, 503)
  const out = await callClaude(env, inputJson)
  const created_at = new Date().toISOString()
  await d.upsert('ca_insights', [{ scope, input_hash: hash, model: out.model, content: out.content, created_at, created_by: user.email }], 'scope')
  return json({ scope, content: out.content, cached: false, created_at, model: out.model, truncated, usage: out.usage })
})
