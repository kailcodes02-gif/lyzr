// GET /api/ca/hubspot?from=YYYY-MM-DD&to=YYYY-MM-DD
// -> { contacts:[...], notes_by_contact:{ hs_id:[...] }, last_sync:{...}|null }
// Reads the read-only mirror in ca_hs_contacts / ca_hs_notes. With no range
// every contact is returned. Range boundaries are IST calendar days.

import { json, handle, isoDay } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'
import { db } from '../_lib/db.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (from && !isoDay(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400)
  if (to && !isoDay(to)) return json({ error: 'to must be YYYY-MM-DD' }, 400)

  const d = db(env)
  const created = []
  if (from) created.push(`gte.${from}T00:00:00+05:30`)
  if (to) created.push(`lte.${to}T23:59:59.999+05:30`)
  const [contacts, notes, syncs] = await Promise.all([
    d.selectAll('ca_hs_contacts', { params: created.length ? { created_at: created } : {}, order: 'created_at.desc,hs_id.asc' }),
    d.selectAll('ca_hs_notes', { order: 'created_at.desc,id.asc' }),
    d.select('ca_hs_sync', { order: 'started_at.desc', limit: 1 }),
  ])
  const ids = new Set(contacts.map((c) => c.hs_id))
  const notes_by_contact = {}
  for (const n of notes) {
    if (!ids.has(n.contact_id)) continue
    ;(notes_by_contact[n.contact_id] = notes_by_contact[n.contact_id] || []).push(n)
  }
  return json({ from: from || null, to: to || null, contacts, notes_by_contact, last_sync: syncs[0] || null })
})
