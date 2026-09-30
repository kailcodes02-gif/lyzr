// Sign-in check for /api/ca/*: a Microsoft access token verified with Graph
// /me (same trust model as functions/api/events.js). Only @lyzr.com and
// @lyzr.ai accounts are accepted. Everyone signed in can read; editors can
// write. Editors come from env.CA_EDITORS, else the ca_settings key
// `editors`, else DEFAULT_EDITORS.

import { db, dbConfigured } from './db.js'

export const ALLOWED_DOMAINS = ['lyzr.com', 'lyzr.ai']

export const DEFAULT_EDITORS = [
  'subs@lyzr.com',
  'kailash.gm@lyzr.com',
  'ani@lyzr.com',
  'ankita@lyzr.com',
  'anju@lyzr.com',
  'subs@lyzr.ai',
  'kailash.gm@lyzr.ai',
]

export function parseEmails(v) {
  if (!v) return []
  if (Array.isArray(v)) return [...new Set(v.map((s) => String(s).trim().toLowerCase()).filter(Boolean))]
  return [...new Set(String(v).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))]
}

export function allowedDomain(email) {
  const d = String(email || '').toLowerCase().split('@')[1] || ''
  return ALLOWED_DOMAINS.includes(d)
}

// Resolve the editor list. Never throws: a missing database means defaults.
export async function resolveEditors(env) {
  const fromEnv = parseEmails(env && env.CA_EDITORS)
  if (fromEnv.length) return fromEnv
  if (dbConfigured(env)) {
    try {
      const rows = await db(env).select('ca_settings', { params: { key: 'eq.editors' }, select: 'value', limit: 1 })
      const list = parseEmails(rows[0] && rows[0].value)
      if (list.length) return list
    } catch { /* fall through to defaults */ }
  }
  return DEFAULT_EDITORS
}

async function verifyMicrosoftToken(accessToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const p = await res.json()
    const email = (p.mail || p.userPrincipalName || '').toLowerCase()
    if (!email) return null
    return { name: p.displayName || email, email }
  } catch {
    return null
  }
}

// -> { name, email, isEditor } or null (no token, bad token, or a domain we
// do not serve). Pass { editors } to skip the settings lookup when the
// caller already has the list.
export async function requireUser(request, env, { editors } = {}) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const u = await verifyMicrosoftToken(auth.slice(7))
  if (!u || !allowedDomain(u.email)) return null
  const list = editors || (await resolveEditors(env))
  return { name: u.name, email: u.email, isEditor: list.includes(u.email) }
}

// Scheduled jobs (GitHub Actions) call write endpoints with the shared secret
// in `X-CA-Cron`. Returns a synthetic editor user, or null.
export function cronUser(request, env) {
  const secret = env && env.CA_CRON_SECRET
  const got = request.headers.get('X-CA-Cron') || ''
  if (!secret || got.length !== String(secret).length) return null
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ String(secret).charCodeAt(i)
  return diff === 0 ? { name: 'Scheduled sync', email: 'cron@campaign-analytics', isEditor: true, cron: true } : null
}
