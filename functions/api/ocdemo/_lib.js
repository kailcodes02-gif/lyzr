// Shared helpers for the opencontroller demo gate (/api/ocdemo/*).
// Visitors sign in before the demo opens: Lyzr people with Microsoft, everyone else with a work
// email. Each sign-in is kept in the ocdemo_* tables of the Campaign Analytics Supabase project
// (opencontroller_demo/supabase/001_ocdemo_leads.sql), through the same service-key client.
//
// Work email checks: a valid address, not a free or throwaway mail provider, and a domain that
// receives mail (MX record, looked up over Cloudflare DNS-over-HTTPS). When a mail provider is
// configured (RESEND_API_KEY + OCDEMO_MAIL_FROM) a 6-digit code is also sent and must be typed.

import { HttpError, sha256 } from '../ca/_lib/http.js'
import { db, dbConfigured } from '../ca/_lib/db.js'

export const LYZR_DOMAINS = ['lyzr.com', 'lyzr.ai']

export const FREE_DOMAINS = new Set(`gmail.com googlemail.com yahoo.com yahoo.co.in yahoo.co.uk yahoo.in yahoo.fr yahoo.de ymail.com
rocketmail.com hotmail.com hotmail.co.uk hotmail.fr hotmail.de hotmail.it outlook.com outlook.in outlook.fr outlook.de live.com
live.in live.co.uk msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com protonmail.ch pm.me gmx.com gmx.de gmx.net
mail.com email.com zoho.com zohomail.com zohomail.in yandex.com yandex.ru ya.ru mail.ru inbox.ru list.ru bk.ru rediffmail.com
rediff.com qq.com 163.com 126.com sina.com sohu.com aliyun.com naver.com daum.net hanmail.net tutanota.com tutanota.de tuta.io
tutamail.com hey.com fastmail.com fastmail.fm inbox.com web.de t-online.de freenet.de libero.it virgilio.it tiscali.it orange.fr
wanadoo.fr free.fr laposte.net sfr.fr sbcglobal.net comcast.net verizon.net att.net bellsouth.net cox.net charter.net earthlink.net
optonline.net juno.com btinternet.com sky.com talktalk.net virginmedia.com ntlworld.com shaw.ca rogers.com sympatico.ca bigpond.com
optusnet.com.au xtra.co.nz seznam.cz wp.pl o2.pl interia.pl onet.pl rambler.ru ukr.net bol.com.br uol.com.br terra.com.br
hushmail.com mailfence.com posteo.de posteo.net runbox.com startmail.com duck.com skiff.com`.split(/\s+/).filter(Boolean))

// Throwaway inbox services. Not exhaustive; the MX check and the code catch most of the rest.
export const DISPOSABLE_DOMAINS = new Set(`mailinator.com guerrillamail.com guerrillamail.net sharklasers.com 10minutemail.com
10minutemail.net tempmail.com temp-mail.org tempmail.net throwawaymail.com yopmail.com yopmail.fr yopmail.net getnada.com nada.email
dispostable.com maildrop.cc mailnesia.com trashmail.com trashmail.de fakeinbox.com mintemail.com mohmal.com emailondeck.com
tempail.com tempr.email discard.email spamgourmet.com mailcatch.com moakt.com burnermail.io mytemp.email tmpmail.org tmpmail.net
inboxkitten.com emailfake.com fakemail.net getairmail.com mail.tm mail.gw linshiyouxiang.net 33mail.com anonaddy.me simplelogin.io
spam4.me grr.la guerrillamailblock.com pokemail.net example.com example.org example.net test.com`.split(/\s+/).filter(Boolean))

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/

export function normEmail(v) {
  return String(v || '').trim().toLowerCase()
}

export function domainOf(email) {
  return normEmail(email).split('@')[1] || ''
}

// Format and provider checks, no network. Returns an error message for the visitor, or ''.
export function workEmailProblem(email) {
  const e = normEmail(email)
  if (!e) return 'Enter your work email.'
  if (e.length > 254 || !EMAIL_RE.test(e)) return 'That does not look like an email address.'
  const d = domainOf(e)
  if (LYZR_DOMAINS.includes(d)) return 'Lyzr emails sign in with Microsoft: choose "I work at Lyzr".'
  if (FREE_DOMAINS.has(d)) return `Use your work email: ${d} is a personal mail provider.`
  if (DISPOSABLE_DOMAINS.has(d)) return 'Use your work email: throwaway inboxes are not accepted.'
  return ''
}

// true: the domain has MX records. false: it surely has none. null: DNS could not be asked.
export async function domainReceivesMail(domain, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
    })
    if (!res.ok) return null
    const j = await res.json()
    if (j.Status === 3) return false // NXDOMAIN: the domain does not exist
    if (j.Status !== 0) return null
    return Array.isArray(j.Answer) && j.Answer.some((a) => a.type === 15 && !/^0\s+\.$/.test(String(a.data || '').trim()))
  } catch {
    return null
  }
}

export function clean(v, max = 160) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

export function cleanUtm(v) {
  if (!v || typeof v !== 'object') return null
  const out = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) if (v[k]) out[k] = clean(v[k], 120)
  return Object.keys(out).length ? out : null
}

// ---- one-time codes (only when a mail provider is configured) ----

export function mailConfigured(env) {
  return Boolean(env && env.RESEND_API_KEY && env.OCDEMO_MAIL_FROM)
}

const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return b64u(String.fromCharCode(...new Uint8Array(sig)))
}

function same(a, b) {
  a = String(a); b = String(b)
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export const CODE_TTL_MS = 10 * 60 * 1000

export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return String(n).padStart(6, '0')
}

// A signed, stateless challenge: the code itself is never in it, only a hash bound to the email.
export async function makeChallenge(env, email, code, now = Date.now()) {
  const payload = b64u(JSON.stringify({ e: normEmail(email), h: await sha256(`${normEmail(email)}:${code}`), x: now + CODE_TTL_MS }))
  return `${payload}.${await hmac(env.RESEND_API_KEY, payload)}`
}

// -> email when the code matches an unexpired challenge, else throws a 400 for the visitor.
export async function checkChallenge(env, challenge, code, now = Date.now()) {
  const [payload, sig] = String(challenge || '').split('.')
  if (!payload || !sig || !same(sig, await hmac(env.RESEND_API_KEY, payload))) throw new HttpError(400, 'That code has expired. Ask for a new one.')
  let p
  try { p = JSON.parse(unb64u(payload)) } catch { throw new HttpError(400, 'That code has expired. Ask for a new one.') }
  if (!p.x || now > p.x) throw new HttpError(400, 'That code has expired. Ask for a new one.')
  if (!same(p.h, await sha256(`${p.e}:${String(code || '').trim()}`))) throw new HttpError(400, 'That code is not right. Check the email and try again.')
  return p.e
}

export async function sendCode(env, email, code, name) {
  const hello = name ? `Hi ${String(name).split(' ')[0]},` : 'Hi,'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.OCDEMO_MAIL_FROM,
      to: [email],
      subject: `${code} is your opencontroller demo code`,
      text: `${hello}\n\nYour code for the opencontroller demo is ${code}. It works for 10 minutes.\n\nIf you did not ask for it, ignore this email.\n\nLyzr`,
      html: `<p>${hello}</p><p>Your code for the opencontroller demo is</p><p style="font:600 28px/1 monospace;letter-spacing:6px">${code}</p><p>It works for 10 minutes. If you did not ask for it, ignore this email.</p><p>Lyzr</p>`,
    }),
  })
  if (!res.ok) throw new HttpError(500, `Could not send the code (mail ${res.status}). Try again in a minute.`)
}

// ---- storage ----

// Upsert the visitor by email and log the sign-in. Never blocks the visitor: when the database
// is not configured or the table is missing, the demo still opens and the miss is logged.
// -> { id, stored }
export async function captureLead(env, lead, request) {
  const row = {
    email: normEmail(lead.email),
    name: clean(lead.name, 120),
    company: clean(lead.company, 160),
    title: clean(lead.title, 120),
    audience: lead.audience === 'lyzr' ? 'lyzr' : 'external',
    auth_method: lead.auth_method,
    domain: domainOf(lead.email),
    country: clean(request && request.headers.get('cf-ipcountry'), 8),
    user_agent: clean(request && request.headers.get('user-agent'), 400),
    referrer: clean(lead.referrer, 400),
    utm: cleanUtm(lead.utm),
  }
  if (!dbConfigured(env)) {
    console.error('[ocdemo] lead not stored: CA_SUPABASE_URL / CA_SUPABASE_KEY missing')
    return { id: null, stored: false }
  }
  try {
    const d = db(env)
    const now = new Date().toISOString()
    const found = await d.select('ocdemo_leads', { params: { email: `eq.${row.email}` }, select: 'id,visits,name,company,title', limit: 1 })
    let id
    if (found[0]) {
      id = found[0].id
      await d.update('ocdemo_leads', { id: `eq.${id}` }, {
        name: row.name || found[0].name, company: row.company || found[0].company, title: row.title || found[0].title,
        auth_method: row.auth_method, country: row.country, user_agent: row.user_agent,
        visits: (found[0].visits || 0) + 1, last_seen: now,
      })
    } else {
      const made = await d.insert('ocdemo_leads', row, { returning: true })
      id = made[0] && made[0].id
    }
    if (id) await d.insert('ocdemo_events', { lead_id: id, kind: 'signin', detail: row.auth_method })
    return { id: id || null, stored: Boolean(id) }
  } catch (e) {
    console.error(`[ocdemo] lead not stored: ${String((e && e.message) || e).slice(0, 300)}`)
    return { id: null, stored: false }
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
