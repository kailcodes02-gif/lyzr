// POST /api/ca/hubspot/classify {}   editors, or the daily job (X-CA-Cron)
// -> { done, classified, remaining, model }
//
// Claude (claude-sonnet-5) reads the form message of GSI leads that have not been
// read yet and files each one: message category, use case, intent, one-line summary,
// spam flag. Stored on ca_hs_contacts (ai_* columns, supabase/003_message_ai.sql).
// Each message is read once. One Claude call of BATCH leads per invocation; call
// again until done:true. Nothing is written to HubSpot.

import { json, handle, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'
import { bumpCacheVersion } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const MODEL = 'claude-sonnet-5'
export const BATCH = 25
const MAX_MESSAGE = 1500

// Same ten categories as the Lead Message Intelligence report (js/lib/leads-agg.mjs CLUSTERS).
export const CLUSTERS = [
  ['sales', 'Sales, SDR and lead gen automation', 'AI SDRs, prospecting, lead scoring, outbound, pipeline and revenue work'],
  ['demo', 'Demo and capability discovery', 'wants a demo, a walkthrough or to understand what the product does, no specific use case'],
  ['hr', 'HR and people operations', 'recruiting, onboarding, payroll, employee service, workforce'],
  ['marketing', 'Marketing, content and social automation', 'content, social, SEO, ads, campaigns'],
  ['cs', 'Customer service and support', 'support desks, contact centres, tickets, chatbots, collections'],
  ['finance', 'Finance, banking and compliance', 'banking, insurance, claims, underwriting, KYC, audit, invoices'],
  ['platform', 'Enterprise platform evaluation', 'evaluating an agent platform, partnership, reselling or building for their clients, RFPs, POCs'],
  ['workflow', 'Internal and workflow automation', 'operations, supply chain, back office, process automation across several functions'],
  ['exploring', 'Exploring and early-stage curiosity', 'students, general interest, pricing questions, just looking'],
  ['vertical', 'Vertical-specific agent builds', 'a build for one industry: healthcare, legal, automotive, telecom, retail and so on'],
]
const IDS = CLUSTERS.map((c) => c[0])

export const SYSTEM = `You read the messages that people typed into Lyzr's website forms. Lyzr is an agentic AI platform sold to enterprises through Global System Integrators (Accenture, the Big Four, MBB, Indian IT firms and others). Every lead you see works at one of those GSI or SI firms.

For each lead, file the message:
- cluster: exactly one of these categories:
${CLUSTERS.map(([id, label, what]) => `  ${id}: ${label} (${what})`).join('\n')}
  When a message names three or more business functions, use workflow. When it names none, use demo if they ask to see the product and exploring otherwise.
- use_case: what they want to build or solve, in at most eight words, in their terms. Empty when the message names nothing.
- intent: high (a concrete use case, a timeline, a client or a buying signal), medium (a clear area of interest), low (vague, curious, or not a buyer).
- summary: one plain sentence, at most 25 words, no em dashes.
- spam: true for tests, gibberish, vendor or agency pitches, job seekers; false otherwise.
Use only what the message and fields say. Call the file_leads tool once with one result per lead id.`

export const TOOL = {
  name: 'file_leads',
  description: 'Return one filed result per lead id.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            cluster: { type: 'string', enum: IDS },
            use_case: { type: 'string' },
            intent: { type: 'string', enum: ['high', 'medium', 'low'] },
            summary: { type: 'string' },
            spam: { type: 'boolean' },
          },
          required: ['id', 'cluster', 'use_case', 'intent', 'summary', 'spam'],
        },
      },
    },
    required: ['results'],
  },
}

export function leadInput(c) {
  return {
    id: String(c.hs_id),
    company: c.account || c.company_raw || null,
    title: c.jobtitle || null,
    country: c.country || null,
    message: String(c.lsa_message || '').slice(0, MAX_MESSAGE),
  }
}

async function callClaude(env, leads) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: `File these ${leads.length} leads and call file_leads once.\n\n<leads>\n${JSON.stringify(leads)}\n</leads>` }],
    }),
  })
  if (!res.ok) throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new HttpError(502, 'The model declined this batch')
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name)
  if (!call) throw new HttpError(502, 'The model did not return results')
  return { results: Array.isArray(call.input && call.input.results) ? call.input.results : [], model: data.model || MODEL }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can run message reading' }, 403)
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude is not configured (ANTHROPIC_API_KEY)' }, 503)
  const d = db(env)
  const todo = { ai_at: 'is.null', lsa_message: 'not.is.null' }
  const batch = await d.select('ca_hs_contacts', { params: todo, select: 'hs_id,account,company_raw,jobtitle,country,lsa_message', order: 'created_at.desc', limit: BATCH })
  const leads = batch.filter((c) => String(c.lsa_message || '').trim())
  const now = new Date().toISOString()
  let classified = 0
  let model = MODEL
  if (leads.length) {
    const out = await callClaude(env, leads.map(leadInput))
    model = out.model
    const byId = new Map(out.results.filter((r) => r && r.id).map((r) => [String(r.id), r]))
    const rows = batch.map((c) => {
      const r = byId.get(String(c.hs_id))
      // A lead the model skipped (or an empty message) is still marked read, so the loop ends.
      return r ? {
        hs_id: c.hs_id,
        ai_cluster: IDS.includes(r.cluster) ? r.cluster : null,
        ai_use_case: String(r.use_case || '').slice(0, 200) || null,
        ai_intent: ['high', 'medium', 'low'].includes(r.intent) ? r.intent : null,
        ai_summary: String(r.summary || '').slice(0, 400) || null,
        ai_spam: Boolean(r.spam),
        ai_model: model,
        ai_at: now,
      } : { hs_id: c.hs_id, ai_model: model, ai_at: now }
    })
    for (const r of rows) { await d.update('ca_hs_contacts', { hs_id: `eq.${r.hs_id}` }, r) }
    classified = rows.filter((r) => r.ai_cluster).length
  } else if (batch.length) {
    for (const c of batch) await d.update('ca_hs_contacts', { hs_id: `eq.${c.hs_id}` }, { ai_at: now, ai_model: model })
  }
  const left = await d.select('ca_hs_contacts', { params: todo, select: 'hs_id', limit: 1 })
  if (batch.length) await bumpCacheVersion(d) // ai_* columns changed on contacts
  return json({ done: !left.length, classified, remaining: left.length ? 'more' : 0, model })
})
