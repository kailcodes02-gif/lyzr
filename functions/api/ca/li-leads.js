// /api/ca/li-leads: LinkedIn lead-form leads, stored as documents in ca_insights (_lib/docs.js), no table of their own.
//   GET    (signed in)  -> { leads:[lead + doc_id], docs:[{id, source, file_name, uploaded_by, uploaded_at, count, kept}],
//                           screens:[{id, file_name, uploaded_at, uploaded_by, kind, title, summary, period, metrics, tables, notes, leads_count, model}],
//                           duplicates, warnings }
//          Every lead of every `leads:` document (uploaded files, the LinkedIn API pull `leads:li-api`) and every lead
//          Claude read from a screenshot (`screen:` documents). Served from the shared 8-hour cache (ca_cache).
//          The same lead held twice (same email + day + form, or name + company when there is no email) is
//          counted once: the API pull wins, then the oldest file, then screenshots. `duplicates` says how many were left out.
//   POST   (editors) { file_name, rows:[...] } at most 20,000 rows, any lead-like keys (normalised here with
//          normaliseLead from Campaign_Analytics/js/lib/li-leads.mjs). Rows already held in any lead document are
//          skipped, so a cumulative export uploaded again only adds the new leads; a file with nothing new writes
//          nothing. -> { id: 'leads:<uuid>' | null, inserted, skipped, duplicates, invalid }
//   DELETE (editors) ?id=leads:<uuid> | screen:<uuid> -> { ok, id }. `leads:li-api` belongs to the API pull and is refused.
// Lead shape: see js/lib/li-leads.mjs. Writes bump the shared cache version.

import { json, handle, readJson } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'
import { listDocs, putDoc, delDoc, getDoc } from './_lib/docs.js'
import { cachedGet, cacheResponse, bumpCacheVersion } from './_lib/cache.js'
import { normaliseLead, leadKey } from '../../../Campaign_Analytics/js/lib/li-leads.mjs'

export { corsPreflight as onRequestOptions } from './_lib/http.js'

export const MAX_ROWS = 20000
export const API_DOC = 'leads:li-api'
const ID_RE = /^(leads|screen):[A-Za-z0-9_-]{1,80}$/
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

// A lead document has a rows array. (The HubSpot Leads read-out was once cached under leads:<from>:<to>; skip those.)
export const isLeadDoc = (d) => !!(d && d.content && typeof d.content === 'object' && Array.isArray(d.content.rows))
export const isScreenDoc = (d) => !!(d && d.content && typeof d.content === 'object' && !Array.isArray(d.content) && (Array.isArray(d.content.leads) || Array.isArray(d.content.metrics) || 'summary' in d.content))

// API pull first, then files oldest first, so the earliest copy of a lead is the one kept.
function orderDocs(docs) {
  const at = (d) => str(d.content.uploaded_at || d.created_at)
  return [...docs].sort((a, b) => (a.id === API_DOC ? -1 : b.id === API_DOC ? 1 : at(a).localeCompare(at(b))))
}

export async function load(env) {
  const [leadDocs, screenDocs] = await Promise.all([listDocs(env, 'leads:'), listDocs(env, 'screen:')])
  const docs = orderDocs(leadDocs.filter(isLeadDoc))
  const screens = screenDocs.filter(isScreenDoc)
  const seen = new Set()
  const leads = []
  let duplicates = 0
  const take = (lead) => { const k = leadKey(lead); if (k && seen.has(k)) { duplicates++; return false } if (k) seen.add(k); leads.push(lead); return true }
  const docOut = docs.map((d) => {
    const c = d.content
    const source = d.id === API_DOC || c.source === 'api' ? 'api' : 'csv'
    let kept = 0
    for (const r of c.rows) if (take({ ...normaliseLead(r, source), source, doc_id: d.id })) kept++
    return { id: d.id, source, file_name: c.file_name || (source === 'api' ? 'LinkedIn API pull' : ''), uploaded_by: c.uploaded_by || d.created_by || null, uploaded_at: c.uploaded_at || d.created_at || null, count: c.rows.length, kept }
  })
  const screenOut = screens.map((d) => {
    const c = d.content
    const list = Array.isArray(c.leads) ? c.leads : []
    for (const r of list) take({ ...normaliseLead(r, 'screenshot'), source: 'screenshot', doc_id: d.id })
    return { id: d.id, file_name: c.file_name || '', uploaded_at: c.uploaded_at || d.created_at || null, uploaded_by: c.uploaded_by || d.created_by || null, kind: c.kind || 'other', title: c.title || '', summary: c.summary || '', period: c.period || null, metrics: Array.isArray(c.metrics) ? c.metrics : [], tables: Array.isArray(c.tables) ? c.tables : [], notes: c.notes || '', leads_count: list.length, model: c.model || d.model || null }
  })
  return { leads, docs: docOut, screens: screenOut, duplicates, warnings: [] }
}

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  return cacheResponse(await cachedGet(env, request, { path: 'li-leads', params: {}, waitUntil }, () => load(env)))
})

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can upload lead files' }, 403)
  const b = await readJson(request)
  const rows = Array.isArray(b.rows) ? b.rows : null
  if (!rows || !rows.length) return json({ error: 'rows must be a non-empty array of leads' }, 400)
  if (rows.length > MAX_ROWS) return json({ error: `Send at most ${MAX_ROWS.toLocaleString('en-US')} leads per file` }, 413)
  const fileName = str(b.file_name).slice(0, 300) || 'leads.csv'

  const clean = rows.map((r) => normaliseLead(r, 'csv')).filter((l) => l.email || l.first_name || l.last_name)
  const invalid = rows.length - clean.length
  const held = new Set()
  for (const d of (await listDocs(env, 'leads:')).filter(isLeadDoc)) for (const r of d.content.rows) { const k = leadKey(normaliseLead(r)); if (k) held.add(k) }
  const fresh = []
  let duplicates = 0
  for (const l of clean) { const k = leadKey(l); if (k && held.has(k)) { duplicates++; continue } if (k) held.add(k); fresh.push(l) }
  const skipped = rows.length - fresh.length
  if (!fresh.length) return json({ id: null, inserted: 0, skipped, duplicates, invalid })

  const id = 'leads:' + crypto.randomUUID()
  const uploaded_at = new Date().toISOString()
  await putDoc(env, id, { source: 'csv', file_name: fileName, uploaded_by: user.email, uploaded_at, rows: fresh.map(({ source, ...l }) => l), stats: { received: rows.length, duplicates, invalid } }, { by: user.email, model: 'lead-file' })
  await bumpCacheVersion(env)
  return json({ id, inserted: fresh.length, skipped, duplicates, invalid }, 201)
})

export const onRequestDelete = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can delete lead files and screenshots' }, 403)
  const id = str(new URL(request.url).searchParams.get('id'))
  if (!ID_RE.test(id)) return json({ error: 'Missing or invalid ?id= (leads:<id> or screen:<id>)' }, 400)
  if (id === API_DOC) return json({ error: 'The LinkedIn API pull refreshes these leads itself; they cannot be deleted here' }, 400)
  const doc = await getDoc(env, id)
  if (!doc || !(id.startsWith('screen:') ? isScreenDoc(doc) : isLeadDoc(doc))) return json({ error: 'Not found' }, 404)
  await delDoc(env, id)
  await bumpCacheVersion(env)
  return json({ ok: true, id })
})
