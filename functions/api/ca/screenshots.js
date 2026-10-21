// /api/ca/screenshots: Claude Sonnet 5 reads an uploaded screenshot (LinkedIn Campaign Manager, a lead-gen form
// export, HubSpot, a lead spreadsheet, a campaign report) and the result is kept as a `screen:<uuid>` document.
//   POST (signed in) { file_name, media_type:'image/png'|'image/jpeg'|'image/webp'|'image/gif', data:<base64, no prefix>, hint? }
//        5 MB decoded at most (the page shrinks images to 1600 px first). One forced `extract` tool call.
//        -> 201 { id, file_name, uploaded_by, uploaded_at, kind, title, summary, period, leads, metrics, tables, notes, model }
//   GET  (signed in) -> { screens:[...] } the same list GET li-leads returns (one source of truth: li-leads.js load()).
//   DELETE goes through DELETE /api/ca/li-leads?id=screen:<uuid>.
// The leads Claude transcribed show up in GET li-leads with source 'screenshot'.

import { json, handle, readJson, HttpError } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { putDoc } from './_lib/docs.js'
import { cachedGet, bumpCacheVersion } from './_lib/cache.js'
import { load } from './li-leads.js'
import { normaliseLead, leadDay, LEAD_FIELDS } from '../../../Campaign_Analytics/js/lib/li-leads.mjs'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const MODEL = 'claude-sonnet-5'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const KINDS = ['leads', 'campaign_metrics', 'lead_form_metrics', 'demographics', 'other']

const S = { type: 'string' }
export const EXTRACT_TOOL = {
  name: 'extract',
  description: 'Record everything readable in the screenshot: every lead row, every metric, every table.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: KINDS, description: 'leads = a list of people; campaign_metrics = campaign or ad performance numbers; lead_form_metrics = form opens, submissions, completion; demographics = audience breakdowns; other = anything else' },
      title: { type: 'string', description: 'Short name for what the screenshot shows, e.g. "Lead gen form leads, Playbooks ad set"' },
      summary: { type: 'string', description: 'Two or three plain sentences on what it shows and the headline numbers. No em dashes.' },
      period: { type: ['object', 'null'], properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, description: 'The date range shown, or null when none is visible' },
      leads: { type: 'array', description: 'Every visible lead row, exactly as written. Empty string for anything not visible.', items: { type: 'object', properties: Object.fromEntries([...LEAD_FIELDS.filter((f) => f !== 'lead_type').map((f) => [f, S])]) } },
      metrics: { type: 'array', description: 'Every visible number with what it measures', items: { type: 'object', properties: { campaign: { type: 'string', description: 'Campaign, ad set, ad or form it belongs to; empty for an account total' }, metric: S, value: { type: ['number', 'string'] }, unit: { type: 'string', description: 'USD, %, count...' }, period: S }, required: ['metric', 'value'] } },
      tables: { type: 'array', description: 'Every visible table, verbatim', items: { type: 'object', properties: { title: S, columns: { type: 'array', items: S }, rows: { type: 'array', items: { type: 'array', items: S } } } } },
      notes: { type: 'string', description: 'Anything cut off, unreadable or uncertain' },
    },
    required: ['kind', 'title', 'summary', 'leads', 'metrics', 'tables'],
  },
}

export const SCREEN_PROMPT = `You read screenshots for Lyzr's GSI and SI marketing programme (global system integrators, Big Four, consulting firms). The image is a screenshot from LinkedIn Campaign Manager, a LinkedIn lead-gen form export, HubSpot, a spreadsheet of leads, or a campaign report.
Call the extract tool once.
- Transcribe every visible lead row exactly as written: name, email, company, job title, country, campaign, form, date. Never invent or guess a value. Use an empty string for anything not visible. Dates as YYYY-MM-DD when the year is visible.
- Record every visible metric (spend, impressions, clicks, leads, lead form opens, completion rate, CPL, CTR...) with the campaign, ad set, ad or form it belongs to and the period shown. Numbers without thousands separators or currency signs; put the unit in unit.
- Copy any table verbatim: its column headers and every visible row, cell by cell.
- Classify the screenshot with kind.
- Write a short plain-language summary of two or three sentences. Do not use em dashes.
- Put anything cut off, blurred or uncertain in notes.`

const str = (v, n = 300) => (v === null || v === undefined ? '' : String(v).trim()).slice(0, n)
const plain = (v, n) => str(v, n).replace(/\s*—\s*/g, ', ')

/** Decoded size of a base64 string, without decoding it. */
export function decodedBytes(b64) {
  const s = String(b64 || '').replace(/\s+/g, '')
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(s.length * 3 / 4) - pad)
}

/** The tool input -> the stored screen content (minus file and user fields). Caps every list. */
export function cleanExtraction(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const p = c.period && typeof c.period === 'object' ? { from: leadDay(c.period.from) || null, to: leadDay(c.period.to) || null } : null
  const leads = (Array.isArray(c.leads) ? c.leads : []).slice(0, 1000).map((l) => normaliseLead(l, 'screenshot')).filter((l) => l.email || l.first_name || l.last_name || l.company)
    .map(({ source, ...l }) => l)
  const metrics = (Array.isArray(c.metrics) ? c.metrics : []).slice(0, 500).map((m) => {
    const raw = m && m.value
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[,$%\s]/g, ''))
    return { campaign: str(m && m.campaign), metric: str(m && m.metric, 120), value: Number.isFinite(n) && String(raw ?? '').trim() !== '' ? n : str(raw, 120), unit: str(m && m.unit, 20), period: str(m && m.period, 60) }
  }).filter((m) => m.metric)
  const tables = (Array.isArray(c.tables) ? c.tables : []).slice(0, 20).map((t) => ({
    title: str(t && t.title, 200),
    columns: (Array.isArray(t && t.columns) ? t.columns : []).slice(0, 40).map((x) => str(x, 120)),
    rows: (Array.isArray(t && t.rows) ? t.rows : []).slice(0, 1000).map((r) => (Array.isArray(r) ? r : [r]).slice(0, 40).map((x) => str(x, 300))),
  }))
  return {
    kind: KINDS.includes(c.kind) ? c.kind : 'other',
    title: plain(c.title, 200) || 'Screenshot',
    summary: plain(c.summary, 1500),
    period: p && (p.from || p.to) ? p : null,
    leads, metrics, tables,
    notes: plain(c.notes, 2000),
  }
}

export async function callVision(env, { media_type, data, file_name, hint }) {
  const text = `File name: ${file_name || 'screenshot'}${hint ? `\nWhat the uploader says it is: ${String(hint).slice(0, 500)}` : ''}\nRead this screenshot and call extract.`
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: SCREEN_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text }] }],
    }),
  })
  if (!res.ok) {
    const t = (await res.text().catch(() => '')).slice(0, 300)
    throw new HttpError(res.status === 429 ? 429 : 502, `Model error ${res.status}: ${t}`)
  }
  const out = await res.json()
  if (out.stop_reason === 'refusal') throw new HttpError(502, 'The model declined to read this image')
  if (out.stop_reason === 'max_tokens') throw new HttpError(502, 'The screenshot holds more than one read can return. Crop it into smaller parts and upload each.')
  const call = (out.content || []).find((b) => b.type === 'tool_use' && b.name === EXTRACT_TOOL.name)
  if (!call) throw new HttpError(502, 'The model did not return a reading')
  return { content: cleanExtraction(call.input), model: out.model || MODEL, usage: out.usage || null }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const b = await readJson(request)
  const media_type = str(b.media_type).toLowerCase()
  if (!MEDIA_TYPES.includes(media_type)) return json({ error: `media_type must be one of ${MEDIA_TYPES.join(', ')}` }, 400)
  const data = String(b.data || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return json({ error: 'data must be the image as base64' }, 400)
  if (decodedBytes(data) > MAX_IMAGE_BYTES) return json({ error: 'The image is over 5 MB. Shrink or crop it and try again.' }, 413)
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude is not configured (ANTHROPIC_API_KEY)' }, 503)
  const file_name = str(b.file_name) || 'screenshot'

  const out = await callVision(env, { media_type, data, file_name, hint: str(b.hint, 500) })
  const id = 'screen:' + crypto.randomUUID()
  const content = { file_name, uploaded_by: user.email, uploaded_at: new Date().toISOString(), ...out.content, model: out.model }
  await putDoc(env, id, content, { by: user.email, model: out.model })
  await bumpCacheVersion(env)
  return json({ id, ...content, usage: out.usage }, 201)
})

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const r = await cachedGet(env, request, { path: 'li-leads', params: {}, waitUntil }, () => load(env))
  return json({ screens: (r.body && r.body.screens) || [] })
})
