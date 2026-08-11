// GSI Tracker: READ-ONLY Instantly.ai campaign-analytics pull for the
// Weekly Report's email metrics — scoped to campaigns tagged "GSI" in
// Instantly (verified live 2026-08-11: tag id 95da42d3-db60-4b3e-a1a9-
// 6e85cda4e35d, 50 campaigns). Nothing is ever written to Instantly.
//
// The analytics endpoint does NOT return each campaign's tags, so the tag
// membership is fetched separately (GET /campaigns?tag_ids=...) and joined
// to the per-range analytics by campaign_id.
//
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults to the current ISO week)
// -> { totalSent, totalOpens, totalReplies, totalCampaigns, totalUniqueSends,
//      campaigns: [{ name, sent, uniqueSent, opens, replies, status }] }

const SUPABASE_URL = 'https://xyefbslbihjdczlzjatu.supabase.co'
const INSTANTLY_ANALYTICS_URL = 'https://api.instantly.ai/api/v2/campaigns/analytics'
const INSTANTLY_CAMPAIGNS_URL = 'https://api.instantly.ai/api/v2/campaigns'
const GSI_TAG_ID = '95da42d3-db60-4b3e-a1a9-6e85cda4e35d'

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

// The tag can be renamed/deleted in Instantly; resolve it by id first and
// fall back to a case-insensitive label match so this doesn't silently
// return zero campaigns if only the id ever goes stale.
async function resolveGsiCampaignIds(token) {
  const byId = await fetch(`${INSTANTLY_CAMPAIGNS_URL}?tag_ids=${GSI_TAG_ID}&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (byId.ok) {
    const data = await byId.json()
    const items = data.items || []
    if (items.length) return new Set(items.map(c => c.id))
  }
  const tagsRes = await fetch('https://api.instantly.ai/api/v2/custom-tags?limit=200', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!tagsRes.ok) return new Set()
  const tags = (await tagsRes.json()).items || []
  const gsiTag = tags.find(t => (t.label || '').trim().toLowerCase() === 'gsi')
  if (!gsiTag) return new Set()
  const res = await fetch(`${INSTANTLY_CAMPAIGNS_URL}?tag_ids=${gsiTag.id}&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return new Set()
  const data = await res.json()
  return new Set((data.items || []).map(c => c.id))
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

    const [gsiIds, analyticsRes] = await Promise.all([
      resolveGsiCampaignIds(token),
      fetch(`${INSTANTLY_ANALYTICS_URL}?start_date=${start}&end_date=${end}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
    if (!analyticsRes.ok) throw new Error(`Instantly ${analyticsRes.status}: ${(await analyticsRes.text()).slice(0, 200)}`)
    const data = await analyticsRes.json()
    const list = Array.isArray(data) ? data : []

    const campaigns = list
      .filter(c => gsiIds.has(c.campaign_id))
      .map(c => ({
        name: c.campaign_name || 'Untitled campaign',
        sent: c.emails_sent_count || 0,
        uniqueSent: c.contacted_count || 0,
        opens: c.open_count_unique || 0,
        replies: c.reply_count_unique || 0,
        status: c.campaign_status,
      }))
      .filter(c => c.sent > 0 || c.uniqueSent > 0)
      .sort((a, b) => b.sent - a.sent)

    const totalSent = campaigns.reduce((s, c) => s + c.sent, 0)
    const totalOpens = campaigns.reduce((s, c) => s + c.opens, 0)
    const totalReplies = campaigns.reduce((s, c) => s + c.replies, 0)
    const totalUniqueSends = campaigns.reduce((s, c) => s + c.uniqueSent, 0)

    return new Response(JSON.stringify({
      totalSent, totalOpens, totalReplies, totalUniqueSends,
      totalCampaigns: campaigns.length,
      gsiCampaignsInAccount: gsiIds.size,
      campaigns, start, end,
    }), { status: 200, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err).slice(0, 300) }), { status: 502, headers })
  }
}
