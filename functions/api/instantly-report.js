// GSI Tracker: READ-ONLY Instantly.ai campaign-analytics pull for the
// Weekly Report's "Total emails sent" metric. Nothing is ever written to
// Instantly. Callers must hold a valid Supabase session.
//
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults to the current ISO week)
// -> { totalSent, campaigns: [{ name, sent, status }], count }
//   campaigns is the full list sorted by emails sent, descending — the
//   caller decides how many rows to show in a report table.

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const INSTANTLY_URL = 'https://api.instantly.ai/api/v2/campaigns/analytics'

async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || '' },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.email ? user : null
}

function isoWeekBounds(now = new Date()) {
  const d = new Date(now)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day)
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6)
  const iso = x => x.toISOString().slice(0, 10)
  return { start: iso(monday), end: iso(sunday) }
}

export async function onRequestGet({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://lyzr.kailash-gm.com',
    'Cache-Control': 'no-store',
  }
  try {
    const user = await requireUser(request, env)
    if (!user) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers })

    const token = env.INSTANTLY_API_KEY
    if (!token) return new Response(JSON.stringify({ error: 'INSTANTLY_API_KEY not configured on Pages project' }), { status: 503, headers })

    const url = new URL(request.url)
    const defaults = isoWeekBounds()
    const start = url.searchParams.get('start') || defaults.start
    const end = url.searchParams.get('end') || defaults.end

    const res = await fetch(`${INSTANTLY_URL}?start_date=${start}&end_date=${end}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Instantly ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    const list = Array.isArray(data) ? data : []

    const campaigns = list
      .map(c => ({
        name: c.campaign_name || 'Untitled campaign',
        sent: c.emails_sent_count || 0,
        opens: c.open_count_unique || 0,
        replies: c.reply_count_unique || 0,
        status: c.campaign_status,
      }))
      .filter(c => c.sent > 0)
      .sort((a, b) => b.sent - a.sent)

    const totalSent = campaigns.reduce((s, c) => s + c.sent, 0)

    return new Response(JSON.stringify({ totalSent, campaigns, count: campaigns.length, start, end }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
