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
  'isha@whitepath.in',   // White Path (the agency running the ads) uploads the LinkedIn exports
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

// ---- email + password sign-in (a few named outside accounts) ----
// Accounts live in the Pages secret CA_LOCAL_USERS as "email:password, email:password" (never in
// the code: the repo is public). A successful login returns a token "ca1.<payload>.<hmac>" signed
// with CA_CRON_SECRET, valid for 12 hours, which /api/ca/* accepts like a Microsoft token.
export const LOCAL_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
export function localUsers(env) {
  const out = new Map()
  for (const pair of String((env && env.CA_LOCAL_USERS) || '').split(/[,;\n]+/)) { const i = pair.indexOf(':'); if (i > 0) out.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim()) }
  return out
}
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
}
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
export async function localLogin(env, email, password) {
  const e = String(email || '').trim().toLowerCase(); const users = localUsers(env)
  if (!users.has(e) || !same(users.get(e), String(password || ''))) return null
  if (!env.CA_CRON_SECRET) throw new Error('CA_CRON_SECRET is needed to sign local sessions')
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ e, x: Date.now() + LOCAL_TOKEN_TTL_MS })))
  return { token: `ca1.${payload}.${await hmac(env.CA_CRON_SECRET, payload)}`, email: e, expires_at: new Date(Date.now() + LOCAL_TOKEN_TTL_MS).toISOString() }
}
export async function verifyLocalToken(env, token) {
  try {
    const [tag, payload, sig] = String(token || '').split('.')
    if (tag !== 'ca1' || !payload || !sig || !env.CA_CRON_SECRET) return null
    if (!same(sig, await hmac(env.CA_CRON_SECRET, payload))) return null
    const { e, x } = JSON.parse(new TextDecoder().decode(fromB64u(payload)))
    if (!e || !x || Date.now() > x || !localUsers(env).has(e)) return null
    return { name: e.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email: e }
  } catch { return null }
}

// -> { name, email, isEditor } or null (no token, bad token, or a domain we
// do not serve). Pass { editors } to skip the settings lookup when the
// caller already has the list.
export async function requireUser(request, env, { editors } = {}) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const raw = auth.slice(7)
  const u = raw.startsWith('ca1.') ? await verifyLocalToken(env, raw) : await verifyMicrosoftToken(raw)
  if (!u || (!raw.startsWith('ca1.') && !allowedDomain(u.email))) return null
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
