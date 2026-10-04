// GET /api/ca/hubspot?from=YYYY-MM-DD&to=YYYY-MM-DD[&all=1]
// -> { contacts:[...], notes_by_contact:{ hs_id:[...] }, last_sync:{...}|null, all, warnings:[] }
// Reads the read-only mirror in ca_hs_contacts / ca_hs_notes. With no range
// every contact is returned. Range boundaries are IST calendar days.
//
// Only contacts still in scope (in_scope true or null) are returned: the last
// full HubSpot sync marks the ones it no longer matches as out of scope.
// ?all=1 returns those too. Each contact carries `instantly`: the Instantly
// campaigns its email is in (from ca_em_leads, matched on the lowercased email),
// an empty array when none or when ca_em_leads is not there yet.

import { json, handle, isoDay } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'
import { db, inChunks } from '../_lib/db.js'

export { corsPreflight as onRequestOptions } from '../_lib/http.js'

export const EM_FIELDS = ['campaign_id', 'campaign_name', 'gsi', 'status', 'interest_status', 'reply_count', 'last_reply_at']
// ca_em_leads lookups per request (150 emails each). Keeps the Pages Function
// well under its subrequest limit; contacts past the cap get no `instantly` data.
export const EM_MAX_CHUNKS = 25

// email (lowercased) -> [{ campaign_id, campaign_name, gsi, status, interest_status, reply_count, last_reply_at }]
export async function instantlyByEmail(d, emails, warnings = []) {
  const byEmail = new Map()
  const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (!list.length) return byEmail
  const chunks = inChunks(list)
  if (chunks.length > EM_MAX_CHUNKS) warnings.push(`Instantly campaigns were matched for the first ${EM_MAX_CHUNKS * 150} emails only.`)
  try {
    for (const filter of chunks.slice(0, EM_MAX_CHUNKS)) {
      const rows = await d.select('ca_em_leads', { params: { email: filter }, select: ['email', ...EM_FIELDS].join(','), order: 'campaign_id.asc' })
      for (const r of rows) {
        const key = String(r.email || '').toLowerCase()
        const item = {}
        for (const f of EM_FIELDS) item[f] = r[f] ?? null
        ;(byEmail.get(key) || byEmail.set(key, []).get(key)).push(item)
      }
    }
  } catch (e) {
    // ca_em_leads not created yet (009_em_leads.sql) or unreadable: the page still works, and says why.
    byEmail.clear()
    warnings.push(/ca_em_leads|relation|does not exist|Could not find/i.test(String(e && e.message)) ? 'Instantly campaign membership is not available yet: run Campaign_Analytics/supabase/009_em_leads.sql and Pull Instantly now.' : `Instantly campaign membership could not be read (${String(e && e.message || e).slice(0, 120)}).`)
  }
  return byEmail
}

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env)
  if (!user) return json({ error: 'Sign in required' }, 401)
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const all = ['1', 'true', 'yes'].includes(String(url.searchParams.get('all') || '').toLowerCase())
  if (from && !isoDay(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400)
  if (to && !isoDay(to)) return json({ error: 'to must be YYYY-MM-DD' }, 400)

  const d = db(env)
  const warnings = []
  const created = []
  if (from) created.push(`gte.${from}T00:00:00+05:30`)
  if (to) created.push(`lte.${to}T23:59:59.999+05:30`)
  const base = created.length ? { created_at: created } : {}
  const order = 'created_at.desc,hs_id.asc'

  async function loadContacts() {
    if (all) return d.selectAll('ca_hs_contacts', { params: base, order })
    try {
      // not.is.false keeps true and null (rows written before 008_funnel.sql).
      return await d.selectAll('ca_hs_contacts', { params: { ...base, in_scope: 'not.is.false' }, order })
    } catch (e) {
      if (!/in_scope|column/i.test(String(e.message || e))) throw e
      warnings.push('Out-of-scope contacts are not hidden yet: run Campaign_Analytics/supabase/008_funnel.sql in Supabase.')
      return d.selectAll('ca_hs_contacts', { params: base, order })
    }
  }

  const [contacts, notes, syncs] = await Promise.all([
    loadContacts(),
    d.selectAll('ca_hs_notes', { order: 'created_at.desc,id.asc' }),
    d.select('ca_hs_sync', { order: 'started_at.desc', limit: 1 }),
  ])
  const ids = new Set(contacts.map((c) => c.hs_id))
  const notes_by_contact = {}
  for (const n of notes) {
    if (!ids.has(n.contact_id)) continue
    ;(notes_by_contact[n.contact_id] = notes_by_contact[n.contact_id] || []).push(n)
  }
  // Only form leads count on the Leads page, so only their emails are looked up (a few hundred, not the whole store).
  const em = await instantlyByEmail(d, contacts.filter((c) => c.props && c.props.first_conversion_date).map((c) => c.email), warnings)
  for (const c of contacts) c.instantly = em.get(String(c.email || '').trim().toLowerCase()) || []
  return json({ from: from || null, to: to || null, all, contacts, notes_by_contact, last_sync: syncs[0] || null, warnings })
})
