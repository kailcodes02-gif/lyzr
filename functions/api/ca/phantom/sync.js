// POST /api/ca/phantom/sync { cursor? }   editors, or the daily job (X-CA-Cron)
// -> { done, cursor?, agents, runs, warnings:[], progress:{ phase, done, total } }
//
// READ-ONLY against PhantomBuster: nothing is launched, saved or deleted there.
// Step 1 lists every phantom (agent) in the workspace. Later steps walk the
// outreach phantoms (Auto Connect, Outreach, Message Sender, ...) and, for
// each run (container) not stored yet, read its result file and count rows:
// profiles processed, invites sent, accepted, messages, replies. Runs roll up
// into ca_pb_daily by launch day (IST) when the sync finishes.
// Resumable like instantly/sync.js: keep calling with `cursor` until done.
// Each invocation makes at most CALL_BUDGET calls to PhantomBuster.
//
// API shapes seen on 2026-10-01 (v2, header X-Phantombuster-Key):
//   GET /agents/fetch-all                      -> [ { id, name, script, scriptId, lastEndType, lastEndedAt(ms), createdAt(ms), launchType, nbContainersRunning, manifest } ]
//   GET /containers/fetch-all?agentId=&limit=  -> { containers:[ { id, status, createdAt(ms), endedAt(ms), endType, exitCode, launchType } ], maxLimitReached }
//   GET /containers/fetch-result-object?id=    -> { resultObject: "<JSON string>" }  where the JSON is either
//        an array of profile rows (Auto Connect: one row per invite sent) or { csvURL, jsonUrl } (Outreach:
//        the rows live in the S3 JSON file, with `status` text and `invitationSent` YES/NO).
// Anything else is handled defensively (plain arrays, { data:[] }, { agents:[] }).

import { json, handle, readJson, HttpError } from '../_lib/http.js'
import { requireUser, cronUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'
import { bumpCacheVersion } from '../_lib/cache.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const API = 'https://api.phantombuster.com/api/v2'
export const CALL_BUDGET = 20
export const RUN_LIMIT = 25
export const OUTREACH_SCRIPTS = /auto ?connect|outreach|message sender|network booster|auto ?follow/i
const ASSUME_INVITE = /auto ?connect|network booster/i

async function pbFetch(url, headers, label) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new HttpError(502, `PhantomBuster ${res.status} on ${label}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.json()
}
const pb = (key, path) => pbFetch(API + path, { 'X-Phantombuster-Key': key, Accept: 'application/json' }, path.split('?')[0])

// ---- shapes ------------------------------------------------------------------
export function listOf(data, ...keys) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') for (const k of [...keys, 'data', 'items', 'results']) if (Array.isArray(data[k])) return data[k]
  return []
}

// -> { rows } | { jsonUrl } | { rows: [] }
export function parseResult(data) {
  let obj = data && typeof data === 'object' && 'resultObject' in data ? data.resultObject : data
  if (typeof obj === 'string') { try { obj = JSON.parse(obj) } catch { return { rows: [] } } }
  if (Array.isArray(obj)) return { rows: obj }
  if (obj && typeof obj === 'object') {
    const url = obj.jsonUrl || obj.jsonURL || obj.resultJsonUrl
    if (typeof url === 'string' && /^https:\/\//.test(url)) return { jsonUrl: url }
    const rows = listOf(obj, 'rows', 'profiles', 'result')
    if (rows.length) return { rows }
  }
  return { rows: [] }
}

// ---- counting (same rules as Campaign_Analytics/js/lib/phantom-agg.mjs) -------
const truthy = v => v === true || v === 1 || (typeof v === 'string' && /^(true|yes|y|success|sent|done|ok|1)$/i.test(v.trim()))
const flag = (r, keys) => keys.some(k => truthy(r[k]))
const statusOf = r => String(r.status ?? r.outreachStatus ?? r.inviteStatus ?? r.step ?? '').toLowerCase()
const INVITE_FLAGS = ['inviteSent', 'invitationSent', 'connectionRequestSent', 'invited', 'requestSent']
const ACCEPT_FLAGS = ['accepted', 'invitationAccepted', 'connectionAccepted', 'requestAccepted', 'connected']
const MESSAGE_FLAGS = ['messageSent', 'messagesSent', 'followUpSent', 'sentMessage']
const REPLY_FLAGS = ['replied', 'hasReplied', 'responded', 'answered']

export function rowInvited(r, assumeInvite = false) {
  if (flag(r, INVITE_FLAGS)) return true
  if (INVITE_FLAGS.some(k => k in r && String(r[k]).trim() !== '')) return false
  const s = statusOf(r)
  if (/invitation sent|invite sent|request sent|follow-up sent|follow up sent|request accepted|accepted|responded \(connection/.test(s)) return true
  if (/not invited|couldn't invite|could not invite|error|failed|skipped/.test(s)) return false
  return assumeInvite && !r.error
}
export function rowAccepted(r, assumeInvite = false) {
  if (!rowInvited(r, assumeInvite)) return false
  if (flag(r, ACCEPT_FLAGS)) return true
  if (/accepted|responded \(connection|follow-up sent|follow up sent/.test(statusOf(r))) return true
  return String(r.connectionDegree || r.degree || '').trim().toLowerCase() === '1st'
}
export const rowMessaged = r => flag(r, MESSAGE_FLAGS) || /message sent|follow-up sent|follow up sent|messaged/.test(statusOf(r))
export const rowReplied = r => flag(r, REPLY_FLAGS) || /replied|responded|answered/.test(statusOf(r))

export function countRows(rows, { assumeInvite = false } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : []
  const c = { profiles: list.length, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 }
  for (const r of list) {
    if (rowInvited(r, assumeInvite)) c.invites_sent++
    if (rowAccepted(r, assumeInvite)) c.accepted++
    if (rowMessaged(r)) c.messages_sent++
    if (rowReplied(r)) c.replies++
  }
  return c
}

// ---- mapping -------------------------------------------------------------------
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
export function isoTs(v) {
  if (v == null || v === '') return null
  let ms = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v)
  if (!Number.isFinite(ms)) return null
  if (ms < 1e11) ms *= 1000
  return new Date(ms).toISOString()
}
export const dayIST = (v) => { const t = isoTs(v); return t ? new Date(Date.parse(t) + 330 * 60000).toISOString().slice(0, 10) : '' }

export function mapAgent(a, syncedAt) {
  const { manifest, ...rest } = a || {}
  const running = n(a.nbContainersRunning) > 0
  return {
    id: String(a.id),
    name: a.name || a.script || 'Untitled phantom',
    script: a.script || (a.scriptId ? String(a.scriptId) : null),
    last_run_at: isoTs(a.lastEndedAt ?? a.lastEndAt ?? a.lastLaunchAt ?? null),
    status: running ? 'running' : (a.lastEndType || a.status || null),
    raw: rest,
    synced_at: syncedAt,
  }
}

export function mapRun(agentId, c, counts, syncedAt, note) {
  return {
    id: String(c.id),
    agent_id: String(agentId),
    launched_at: isoTs(c.createdAt ?? c.launchedAt ?? c.startedAt ?? null),
    ended_at: isoTs(c.endedAt ?? c.finishedAt ?? null),
    status: c.endType || c.status || null,
    profiles: n(counts.profiles),
    invites_sent: n(counts.invites_sent),
    accepted: n(counts.accepted),
    messages_sent: n(counts.messages_sent),
    replies: n(counts.replies),
    raw: { container: c, counted: note || null },
    synced_at: syncedAt,
  }
}

export function rollupDaily(runs, syncedAt) {
  const m = new Map()
  for (const r of runs || []) {
    const day = dayIST(r.launched_at)
    if (!day || !r.agent_id) continue
    const k = r.agent_id + '|' + day
    if (!m.has(k)) m.set(k, { agent_id: r.agent_id, day, profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0, synced_at: syncedAt })
    const d = m.get(k)
    for (const key of ['profiles', 'invites_sent', 'accepted', 'messages_sent', 'replies']) d[key] += n(r[key])
  }
  return [...m.values()]
}

const isFinal = (c) => { const s = String(c.status || c.endType || '').toLowerCase(); return s && !/running|starting|queued|pending/.test(s) }

async function mark(d, id, patch) {
  if (!id) return
  try { await d.update('ca_pb_sync', { id: `eq.${id}` }, patch) } catch { /* best effort */ }
}

export const onRequestPost = handle(async ({ request, env }) => {
  const user = cronUser(request, env) || (await requireUser(request, env))
  if (!user) return json({ error: 'Sign in required' }, 401)
  if (!user.isEditor) return json({ error: 'Only editors can sync PhantomBuster' }, 403)
  const key = env.PHANTOMBUSTER_API_KEY
  if (!key) return json({ error: 'PhantomBuster not configured (PHANTOMBUSTER_API_KEY)' }, 503)
  const d = db(env)
  const body = await readJson(request)
  const warnings = []
  let cursor = body.cursor && typeof body.cursor === 'object' ? { ...body.cursor } : null
  let syncId = cursor ? cursor.sync_id : null

  try {
    if (!cursor) {
      const started_at = new Date().toISOString()
      const rows = await d.insert('ca_pb_sync', { started_by: user.email, started_at, status: 'running' }, { returning: true })
      syncId = rows[0] && rows[0].id
      const agents = listOf(await pb(key, '/agents/fetch-all'), 'agents')
      const syncedAt = new Date().toISOString()
      const mapped = agents.filter((a) => a && a.id != null).map((a) => mapAgent(a, syncedAt))
      for (let i = 0; i < mapped.length; i += 200) await d.upsert('ca_pb_agents', mapped.slice(i, i + 200), 'id')
      const queue = mapped.filter((a) => OUTREACH_SCRIPTS.test(a.script || '') || OUTREACH_SCRIPTS.test(a.name || '')).map((a) => ({ id: a.id, assume: ASSUME_INVITE.test(a.script || a.name || '') }))
      if (mapped.length && !queue.length) warnings.push('No phantom in the workspace looks like an outreach phantom (Auto Connect, Outreach, Message Sender); only the agent list was stored.')
      cursor = { sync_id: syncId, queue, index: 0, pending: [], agents: mapped.length, runs: 0 }
      await mark(d, syncId, { agents: mapped.length })
      if (!queue.length) { await mark(d, syncId, { status: 'done', finished_at: new Date().toISOString() }); await bumpCacheVersion(d); return json({ done: true, agents: mapped.length, runs: 0, warnings, progress: { phase: 'done', done: 0, total: 0 } }) }
      return json({ done: false, cursor, agents: mapped.length, runs: 0, warnings, progress: { phase: 'runs', done: 0, total: queue.length } })
    }

    const queue = Array.isArray(cursor.queue) ? cursor.queue : []
    const pending = Array.isArray(cursor.pending) ? cursor.pending : []
    let index = Number(cursor.index) || 0
    let calls = 0
    const syncedAt = new Date().toISOString()
    const out = []
    while (calls < CALL_BUDGET) {
      if (pending.length) {
        const p = pending[0]
        // a run whose rows live in a file needs two calls; when the budget ends between them the
        // file URL is kept on the pending entry and the next invocation makes the second call
        let counts = { profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0 }
        let note = 'no result'
        try {
          let rows
          if (p.jsonUrl) { rows = listOf(await pbFetch(p.jsonUrl, { Accept: 'application/json' }, 'result file')); calls++; note = 'rows from the result file' }
          else {
            const parsed = parseResult(await pb(key, `/containers/fetch-result-object?id=${encodeURIComponent(p.id)}`)); calls++
            if (parsed.jsonUrl) { p.jsonUrl = parsed.jsonUrl; if (calls >= CALL_BUDGET) break; rows = listOf(await pbFetch(p.jsonUrl, { Accept: 'application/json' }, 'result file')); calls++; note = 'rows from the result file' }
            else { rows = parsed.rows; note = 'rows from the result object' }
          }
          counts = countRows(rows, { assumeInvite: p.assume })
          note += p.assume ? '; every clean row counted as an invite (Auto Connect)' : '; invite, accepted, message and reply flags or status text'
        } catch (e) {
          note = 'result unavailable: ' + String(e.message || e).slice(0, 160)
          warnings.push(`Run ${p.id} of phantom ${p.agent_id}: ${note}`)
        }
        out.push(mapRun(p.agent_id, p.container, counts, syncedAt, note))
        pending.shift()
        continue
      }
      if (index >= queue.length) break
      const q = queue[index]
      const containers = listOf(await pb(key, `/containers/fetch-all?agentId=${encodeURIComponent(q.id)}&limit=${RUN_LIMIT}&mode=finalized`), 'containers'); calls++
      const ids = containers.filter((c) => c && c.id != null).map((c) => String(c.id))
      const known = ids.length ? new Set((await d.select('ca_pb_runs', { params: { agent_id: `eq.${q.id}` }, select: 'id,status', limit: 1000 })).filter((r) => r.status && !/running|starting/i.test(r.status)).map((r) => String(r.id))) : new Set()
      for (const c of containers) if (c && c.id != null && isFinal(c) && !known.has(String(c.id))) pending.push({ id: String(c.id), agent_id: q.id, assume: !!q.assume, container: c })
      index++
    }
    if (out.length) await d.upsert('ca_pb_runs', out, 'id')
    cursor.index = index
    cursor.pending = pending
    cursor.runs = (Number(cursor.runs) || 0) + out.length
    const done = index >= queue.length && !pending.length
    if (done) {
      const all = await d.selectAll('ca_pb_runs', { select: 'agent_id,launched_at,profiles,invites_sent,accepted,messages_sent,replies', order: 'launched_at.asc,id.asc', max: 20000 })
      const daily = rollupDaily(all, syncedAt)
      for (let i = 0; i < daily.length; i += 500) await d.upsert('ca_pb_daily', daily.slice(i, i + 500), 'agent_id,day')
      await mark(d, cursor.sync_id, { status: 'done', finished_at: new Date().toISOString(), runs: cursor.runs })
      await bumpCacheVersion(d) // agents, runs and daily rows changed: the shared GET cache must recompute
    } else await mark(d, cursor.sync_id, { runs: cursor.runs })
    return json({ done, cursor: done ? undefined : cursor, agents: cursor.agents, runs: cursor.runs, warnings, progress: { phase: done ? 'done' : 'runs', done: index, total: queue.length } })
  } catch (e) {
    if (syncId) await mark(d, syncId, { status: 'error', finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) })
    throw e
  }
})
