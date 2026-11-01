// POST /api/ocdemo/track { lead_id, events: [{ kind: 'view'|'action'|'cta', screen, detail }] }
// Screens a signed-in visitor opened and what they tried, sent in small batches by the demo.
// Best effort: always answers 200 so the demo never waits on it.
import { json, handle, readJson } from '../ca/_lib/http.js'
import { db, dbConfigured } from '../ca/_lib/db.js'
import { UUID_RE, clean } from './_lib.js'

export { corsPreflight as onRequestOptions } from '../ca/_lib/http.js'

const KINDS = new Set(['view', 'action', 'cta'])

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await readJson(request)
  const id = String(b.lead_id || '')
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 40)
    .filter((e) => e && KINDS.has(e.kind))
    .map((e) => ({ lead_id: id, kind: e.kind, screen: clean(e.screen, 120), detail: clean(e.detail, 200) }))
  if (!UUID_RE.test(id) || !events.length || !dbConfigured(env)) return json({ ok: false })
  try {
    const d = db(env)
    const found = await d.select('ocdemo_leads', { params: { id: `eq.${id}` }, select: 'id,screens_viewed', limit: 1 })
    if (!found[0]) return json({ ok: false })
    await d.insert('ocdemo_events', events)
    const views = events.filter((e) => e.kind === 'view').length
    await d.update('ocdemo_leads', { id: `eq.${id}` }, { screens_viewed: (found[0].screens_viewed || 0) + views, last_seen: new Date().toISOString() })
    return json({ ok: true })
  } catch (e) {
    console.error(`[ocdemo] track failed: ${String((e && e.message) || e).slice(0, 300)}`)
    return json({ ok: false })
  }
})
