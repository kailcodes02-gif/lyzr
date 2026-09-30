// /api/ca/insights: Claude read-outs cached per scope.
//   GET  ?scope=<scope>  -> { scope, content, created_at, model, cached:true } or 404
//   POST { scope, kind:'messaging'|'ads'|'leads'|'overview'|'email', input, force? }
//        -> { scope, content, cached, created_at, model }
//   A cached row with the same sha256(input) is returned unless force is set
//   (force needs an editor). Anyone signed in can generate when nothing is cached.
//
// Claude: Messages API (raw HTTP like functions/api/assistant.js), one forced
// `report` tool call, prompt caching on the system blocks. claude-sonnet-5 for
// messaging / ads / overview; claude-haiku-4-5-20251001 when the input is small.

import { json, handle, readJson, sha256, HttpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { db } from './_lib/db.js'
import { SYSTEM_PROMPT, KIND_PROMPTS, REPORT_TOOL, userMessage } from './_lib/prompts.js'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const KINDS = ['messaging', 'ads', 'leads', 'overview', 'email']
export const MODEL_MAIN = 'claude-sonnet-5'
export const MODEL_SMALL = 'claude-haiku-4-5-20251001'
export const SMALL_INPUT_BYTES = 4 * 1024
export const MAX_INPUT_BYTES = 60 * 1024
const SEVERITIES = ['win', 'watch', 'risk', 'info']

export function pickModel(kind, inputJson) {
  const bytes = new TextEncoder().encode(inputJson).length
  if (bytes < SMALL_INPUT_BYTES) return MODEL_SMALL
  return MODEL_MAIN
}

// Shrink the input to about MAX_INPUT_BYTES by trimming the largest arrays,
// keeping scalar totals intact. Marks trimmed arrays with `_truncated`.
export function capInput(input, cap = MAX_INPUT_BYTES) {
  let x = input === undefined ? null : JSON.parse(JSON.stringify(input))
  const size = () => JSON.stringify(x).length
  if (size() <= cap) return { input: x, truncated: false }
  let truncated = false
  for (let round = 0; round < 60 && size() > cap; round++) {
    // find the largest array anywhere in the structure
    let best = null
    const walk = (node, parent, key) => {
      if (Array.isArray(node)) {
        const len = JSON.stringify(node).length
        if (node.length > 3 && (!best || len > best.len)) best = { node, parent, key, len }
        for (const v of node) if (v && typeof v === 'object') walk(v, node, null)
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, node, k)
      }
    }
    walk(x, null, null)
    if (!best) break
    const keep = Math.max(3, Math.floor(best.node.length * 0.6))
    const cut = best.node.slice(0, keep)
    if (best.parent && best.key !== null && !Array.isArray(best.parent)) {
      best.parent[best.key] = cut
      best.parent[best.key + '_truncated'] = { kept: keep, of: best.node.length }
    } else if (best.parent && Array.isArray(best.parent)) {
      best.parent[best.parent.indexOf(best.node)] = cut
    } else {
      x = cut
    }
    truncated = true
  }
  // last resort: hard cut the JSON text
  if (size() > cap) {
    x = { _note: 'input was too large and was cut', text: JSON.stringify(x).slice(0, cap) }
    truncated = true
  }
  return { input: x, truncated }
}

function cleanContent(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const findings = (Array.isArray(c.findings) ? c.findings : []).slice(0, 6).map((f) => ({
    title: String((f && f.title) || '').trim(),
    evidence: String((f && f.evidence) || '').trim(),
    so_what: String((f && f.so_what) || '').trim(),
    action: String((f && f.action) || '').trim(),
    owner: String((f && f.owner) || '').trim(),
    severity: SEVERITIES.includes(f && f.severity) ? f.severity : 'info',
  })).filter((f) => f.title)
  if (findings.length < 1) throw new HttpError(502, 'The model returned no findings')
  const progress = (Array.isArray(c.progress) ? c.progress : []).slice(0, 12).map((p) => ({
    action: String((p && p.action) || '').trim(),
    status: ['done', 'open', 'dropped'].includes(p && p.status) ? p.status : 'open',
    verdict: String((p && p.verdict) || '').trim(),
  })).filter((p) => p.action)
  return { headline: String(c.headline || '').trim(), findings, summary: String(c.summary || '').trim(), progress }
}

export async function callClaude(env, { kind, inputJson, model }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: KIND_PROMPTS[kind], cache_control: { type: 'ephemeral' } },
      ],
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: REPORT_TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: userMessage(kind, inputJson) }],
    }),
  })
  if (!res.ok) {
    const t = (await res.text().catch(() => '')).slice(0, 300)
    throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${t}`)
  }
  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new HttpError(502, 'The model declined this request')
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL.name)
  if (!call) throw new HttpError(502, 'The model did not return a report')
  return { content: cleanContent(call.input), usage: data.usage || null, model: data.model || model }
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const scope = String(new URL(request.url).searchParams.get('scope') || '').trim()
  if (!scope) return json({ error: 'Missing ?scope=' }, 400)
  const rows = await db(env).select('ca_insights', { params: { scope: `eq.${scope}` }, limit: 1 })
  if (!rows.length) return json({ error: 'No insights cached for this scope' }, 404)
  const r = rows[0]
  return json({ scope: r.scope, content: r.content, created_at: r.created_at, model: r.model, created_by: r.created_by, cached: true })
})

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const b = await readJson(request)
  const scope = String(b.scope || '').trim().slice(0, 200)
  const kind = String(b.kind || '').trim()
  const force = Boolean(b.force)
  if (!scope) return json({ error: 'scope is required' }, 400)
  if (!KINDS.includes(kind)) return json({ error: `kind must be one of ${KINDS.join(', ')}` }, 400)
  if (b.input === undefined || b.input === null) return json({ error: 'input is required' }, 400)
  if (force && !user.isEditor) return json({ error: 'Only editors can force a regeneration' }, 403)

  const d = db(env)
  const { input, truncated } = capInput(b.input)
  const inputJson = JSON.stringify(input)
  const hash = await sha256(inputJson)

  const cached = await d.select('ca_insights', { params: { scope: `eq.${scope}` }, limit: 1 })
  if (cached.length && cached[0].input_hash === hash && !force) {
    const r = cached[0]
    return json({ scope, content: r.content, cached: true, created_at: r.created_at, model: r.model })
  }
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude is not configured (ANTHROPIC_API_KEY)' }, 503)

  const model = pickModel(kind, inputJson)
  const out = await callClaude(env, { kind, inputJson, model })
  const created_at = new Date().toISOString()
  await d.upsert('ca_insights', [{
    scope,
    input_hash: hash,
    model: out.model,
    content: out.content,
    created_at,
    created_by: user.email,
  }], 'scope')
  return json({ scope, content: out.content, cached: false, created_at, model: out.model, truncated, usage: out.usage })
})
