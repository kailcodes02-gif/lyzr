// The data layer behind the data API (/api/ca/v1/<source>) and the MCP server (/api/ca/mcp).
// One resolver per source; the REST router and the MCP tools both call runSource(env, request, name, params).
// Every resolver reads the same store the dashboard reads and, where maths is involved (penetration, lead
// funnel), the same code the dashboard runs (Campaign_Analytics/js/lib/*), so an answer pulled here equals
// the number on the page.
import { db } from './db.js'
import { loadSettings } from './settings.js'
import { load as loadLinkedin } from '../linkedin.js'
import { load as loadDeals, kpisOf } from '../hubspot/deals.js'
import { load as loadCoverage } from '../coverage.js'
import { TIER_LABEL, TIER_GROUP, tierOf } from './tiers.js'
import * as A from '../../../../Campaign_Analytics/js/lib/linkedin-agg.mjs'
import { enrich, funnelCounts, isFormLead } from '../../../../Campaign_Analytics/js/lib/leads-agg.mjs'

export class QueryError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code } }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const day = (v, name) => { if (!v) return ''; if (!ISO.test(String(v))) throw new QueryError(400, 'bad_param', `${name} must be YYYY-MM-DD`); return String(v) }
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const clamp = (v, d, max) => Math.max(1, Math.min(max, Math.round(num(v, d))))
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
const div = (a, b) => (b ? a / b : null)
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)
const lower = (v) => String(v || '').trim().toLowerCase()
const like = (hay, needle) => !needle || lower(hay).includes(lower(needle))

const PERF_METRICS = ['impressions', 'clicks', 'spend', 'reach', 'leads', 'lead_forms_opened', 'video_views', 'sends', 'opens', 'engagements', 'reactions', 'comments', 'shares', 'follows', 'viral_impressions', 'conversions']
const derived = (t) => ({ ctr: round(div(t.clicks, t.impressions) * 100, 3), cpc: round(div(t.spend, t.clicks)), cpm: round(div(t.spend, t.impressions) * 1000), cpl: round(div(t.spend, t.leads)), lead_rate: round(div(t.leads, t.clicks) * 100, 2), engagement_rate: round(div(t.engagements, t.impressions) * 100, 3) })
const totalsOf = (rows) => { const t = {}; for (const k of PERF_METRICS) t[k] = round(sum(rows, k)); return { ...t, ...derived(t) } }
const weekKey = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const n = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

// Read-only table passthrough: the ca_* tables anyone with a key may read, with their columns.
export const TABLES = {
  ca_li_perf: 'LinkedIn and other ad platforms, one row per ad per day (platform, day, campaign_group, campaign, ad_name, impressions, clicks, spend, reach, leads, engagements...)',
  ca_li_demo: 'LinkedIn demographics rows per export window (upload_id, segment, value, campaign tag, impressions, clicks)',
  ca_uploads: 'Every uploaded file: channel, kind, platform, period_start, period_end, row_count, notes (breakdowns and tag)',
  ca_hs_contacts: 'HubSpot GSI leads mirror (account, jobtitle, band, country, region, lead_source, lifecycle, lead_status, owner, created_at...)',
  ca_hs_notes: 'HubSpot engagements per contact (kind, body, created_at)',
  ca_hs_deals: 'HubSpot deals (pipeline, stage, bucket, amount, close_date, partner)',
  ca_hs_deal_history: 'Deal stage and amount changes',
  ca_em_campaigns: 'Instantly campaigns (name, status, gsi, leads_count, contacted, sent, ...)',
  ca_em_daily: 'Instantly daily campaign analytics',
  ca_em_events: 'Instantly per-contact events from CSV exports (campaign, contact, step, event, ts, link)',
  ca_em_leads: 'Instantly leads per campaign (status, interest_status, reply_count, last_reply_at)',
  ca_pb_agents: 'PhantomBuster agents', ca_pb_runs: 'PhantomBuster runs', ca_pb_daily: 'PhantomBuster daily counts per agent',
  ca_actions: 'The action tracker (channel, title, detail, owner, status, source, due, note)',
  ca_settings: 'Lists and rules (accounts, icp_pool, regions, bands, targets, account_tiers, lead_rules...)',
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'key', 'format'])

export const SOURCES = [
  { name: 'linkedin/performance', title: 'Ad performance totals', description: 'Spend, impressions, clicks, leads, engagement and the derived rates (CTR, CPC, CPM, CPL) from the daily ad exports, grouped how you ask. Covers LinkedIn by default; platform=all adds Google, Meta, Bing, Taboola, X and ChatGPT with a platform column.', params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', platform: 'linkedin (default) | all | google | meta | bing | taboola | x | chatgpt', group: 'total (default) | day | week | month | campaign | campaign_group | ad | platform | person | stage | format', campaign: 'substring filter on the campaign (ad set) name', person: 'Ani | Anju | Siva: only ad sets carrying that name', limit: 'rows (default 500, max 5000)' } },
  { name: 'linkedin/demographics', title: 'Who the ads reached', description: 'Demographics export rows summed over the export windows in range, newest window wins where two overlap, tagged (per-person) exports left out unless tag is given. segment picks the breakdown: Company, Job Title, Country, Job Seniority, Job Function, Location, Company Size, Industry.', params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', segment: 'Company (default) | Job Title | Country | Job Seniority | Job Function | Location | Company Size | Industry | all', tag: 'a person or ad set tag typed at upload (e.g. Anju)', q: 'substring filter on the value', limit: 'rows (default 200, max 5000)' } },
  { name: 'linkedin/penetration', title: 'Penetration by company, region and band', description: 'The cumulative penetration cube: per target account, people reached against the MD / MD-1 / MD-2 pool per region, with exposure and frequency, from the same reach model as the dashboard (negative binomial, never above 100%). Includes the account tier and the "what to do next" items.', params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', account: 'substring filter on the account name', tier: 'GSI | SI | Big Four | MBB | Other | Tier 1 | Tier 2', region: 'one region name (India, United States, Middle East, Europe, APAC...)', band: 'MD | MD-1 | MD-2 | All (default)', limit: 'accounts (default 100, max 2000)' } },
  { name: 'linkedin/windows', title: 'Uploads on file', description: 'Every upload on file: channel, platform, kind, dates it covers, rows, breakdowns and tag. Use it to see which dates have data before asking for them.', params: { channel: 'linkedin | email | all (default)' } },
  { name: 'hubspot/leads', title: 'GSI leads', description: 'HubSpot form leads at target accounts (the Leads page): one row per lead with account, exact job title, band, country, region, lead source, lifecycle, lead status, owner and dates, plus counts by band, account and region and the sales funnel for the same rows.', params: { from: 'YYYY-MM-DD (created_at)', to: 'YYYY-MM-DD', account: 'substring filter', band: 'MD | MD-1 | MD-2 | Other | Unknown', region: 'region name', q: 'substring over name, title, company, email', fields: 'comma list of columns to return (default a useful subset; "all" for everything)', limit: 'rows (default 500, max 5000)', offset: 'skip rows' } },
  { name: 'hubspot/deals', title: 'Deals pipeline', description: 'HubSpot deals with the dashboard buckets (conversation, demo, won, lost) and the KPIs the Pipeline page shows.', params: { from: 'YYYY-MM-DD (created)', to: 'YYYY-MM-DD', bucket: 'conversation | demo | won | lost', partner: 'substring filter', limit: 'rows (default 500, max 5000)' } },
  { name: 'email/summary', title: 'Instantly email campaigns', description: 'Per campaign: sent, contacted, opens, replies and leads with the daily totals in range, GSI-tagged campaigns by default.', params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', campaign: 'substring filter', all: '1 to include campaigns not tagged GSI' } },
  { name: 'phantom/summary', title: 'PhantomBuster outreach', description: 'Per agent: profiles, invites, accepted, messages and replies summed over the days in range.', params: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } },
  { name: 'actions', title: 'Action tracker', description: 'Tracked actions from every page, newest first.', params: { status: 'open | in_progress | blocked | done | dropped', channel: 'linkedin | email | leads | messaging | overview | pipeline | phantom', limit: 'rows (default 200, max 2000)' } },
  { name: 'settings', title: 'Lists and rules', description: 'One setting by key: accounts (1,441 target accounts with aliases), icp_pool (Apollo headcounts), icp_estimates, account_tiers, regions, bands, targets, lead_rules, mix_defaults, contact_lists, gsi_companies, email_rules.', params: { name: 'setting name (required): accounts | icp_pool | icp_estimates | account_tiers | regions | bands | targets | lead_rules | mix_defaults | contact_lists | gsi_companies | email_rules' } },
  { name: 'coverage', title: 'Data coverage', description: 'What the store holds per source and which dates it covers.', params: {} },
  { name: 'table', title: 'Raw table read', description: 'Read-only PostgREST passthrough on any ca_* table: pass the table in `name` and filters as column=op.value (eq., gte., lte., like.*x*, in.(a,b), is.null), plus select, order (col.desc), limit, offset. Tables and what they hold are listed under `tables` in the index.', params: { name: 'table name (required)', select: 'comma list of columns', order: 'col.asc | col.desc', limit: 'rows (default 500, max 5000)', offset: 'skip rows', '<column>': 'PostgREST filter, e.g. day=gte.2026-09-01' } },
]
export const sourceNames = () => SOURCES.map((s) => s.name)

export async function runSource(env, request, name, q = {}) {
  const d = db(env)
  const from = day(q.from, 'from'), to = day(q.to, 'to')
  switch (name) {
    case 'linkedin/performance': {
      const platform = lower(q.platform) || 'linkedin'
      const data = await loadLinkedin(env, { from, to, platform })
      let rows = data.perf || []
      if (q.campaign) rows = rows.filter((r) => like(r.campaign, q.campaign) || like(r.campaign_group, q.campaign))
      if (q.person) rows = rows.filter((r) => A.peopleIn(r.campaign, r.campaign_group, r.ad_name).map(lower).includes(lower(q.person)))
      const group = lower(q.group) || 'total'
      const keyOf = { total: () => 'total', day: (r) => r.day, week: (r) => weekKey(r.day), month: (r) => String(r.day).slice(0, 7), campaign: (r) => r.campaign || '', campaign_group: (r) => r.campaign_group || '', ad: (r) => [r.campaign, r.ad_name || r.ad_id].filter(Boolean).join(' · '), platform: (r) => r.platform || 'linkedin', person: (r) => A.peopleIn(r.campaign, r.campaign_group, r.ad_name)[0] || 'No name', stage: (r) => A.stageOf(r), format: (r) => r.format || '' }[group]
      if (!keyOf) throw new QueryError(400, 'bad_param', `group must be one of total, day, week, month, campaign, campaign_group, ad, platform, person, stage, format`)
      const by = new Map()
      for (const r of rows) { const k = keyOf(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
      const out = [...by.entries()].map(([k, rs]) => ({ [group === 'total' ? 'scope' : group]: k, days: new Set(rs.map((r) => r.day)).size, ...totalsOf(rs) }))
      out.sort((a, b) => (group === 'day' || group === 'week' || group === 'month') ? String(a[group]).localeCompare(String(b[group])) : b.spend - a.spend || b.impressions - a.impressions)
      return { source: name, from: from || null, to: to || null, platform, group, total: totalsOf(rows), rows: out.slice(0, clamp(q.limit, 500, 5000)), row_count: out.length, note: 'reach is a sum of daily figures (people can repeat across days); use linkedin/penetration for unique people against a pool.' }
    }
    case 'linkedin/demographics': {
      const data = await loadLinkedin(env, { from, to, platform: 'linkedin' })
      let windows = (data.demo || []).map((w) => ({ ...w, period_start: w.upload.period_start, period_end: w.upload.period_end, notes: w.upload.notes }))
      const tag = String(q.tag || '').trim()
      if (tag) windows = windows.filter((w) => new RegExp(`\\(${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`, 'i').test(w.notes || ''))
      else windows = A.mainWindows(windows)
      const segment = String(q.segment || 'Company').trim()
      const by = new Map()
      for (const w of windows) for (const r of w.rows || []) {
        if (lower(segment) !== 'all' && lower(r.segment) !== lower(segment)) continue
        if (!like(r.value, q.q)) continue
        const k = r.segment + '\u0000' + r.value
        if (!by.has(k)) by.set(k, { segment: r.segment, value: r.value, impressions: 0, clicks: 0, spend: 0, leads: 0, engagements: 0, windows: 0 })
        const o = by.get(k); for (const m of ['impressions', 'clicks', 'spend', 'leads', 'engagements']) o[m] += Number(r[m]) || 0; o.windows++
      }
      const rows = [...by.values()].map((o) => ({ ...o, ctr: round(div(o.clicks, o.impressions) * 100, 3) })).sort((a, b) => b.impressions - a.impressions)
      return { source: name, from: from || null, to: to || null, segment, tag: tag || null, windows: windows.map((w) => ({ period_start: w.period_start, period_end: w.period_end, notes: w.notes, rows: (w.rows || []).length })), segments_present: [...new Set(windows.flatMap((w) => (w.rows || []).map((r) => r.segment)).filter(Boolean))].sort(), total_impressions: round(sum(rows, 'impressions')), rows: rows.slice(0, clamp(q.limit, 200, 5000)), row_count: rows.length, note: 'LinkedIn exports the top 25 values per breakdown per window and no cross-tab between breakdowns.' }
    }
    case 'linkedin/penetration': {
      const [data, S] = await Promise.all([loadLinkedin(env, { from, to, platform: 'linkedin' }), loadSettings(env, request, { keys: ['accounts', 'icp_pool', 'icp_estimates', 'bands', 'regions', 'targets', 'mix_defaults', 'account_tiers'] })])
      const accounts = Array.isArray(S.accounts) ? S.accounts : []
      const frequency = Number((S.targets || {}).frequency) || 3.5
      const pool = A.expandPool(Array.isArray(S.icp_pool) ? S.icp_pool : [], accounts, { estimates: Array.isArray(S.icp_estimates) ? S.icp_estimates : [] })
      const windows = A.mainWindows((data.demo || []).map((w) => ({ rows: w.rows, upload: w.upload })))
      const cube = A.penetrationCube({ windows, accounts, icp_pool: pool, bands: S.bands || {}, frequency, regions: S.regions || {}, mix: S.mix_defaults || null })
      const tiers = S.account_tiers && typeof S.account_tiers === 'object' ? S.account_tiers : {}
      const tier = (n) => tierOf(n, tiers, accounts)
      const band = String(q.band || 'All').trim()
      if (![...A.PEN_BANDS, 'All'].includes(band)) throw new QueryError(400, 'bad_param', 'band must be MD, MD-1, MD-2 or All')
      const cell = (x) => x ? { reached: round(x.reached, 1), reached_in_pool: round(x.reached_pooled, 1), impressions: round(x.imp), pool: x.has_pool ? round(x.pool) : null, pool_estimated: !!x.est_pool, penetration_pct: round(x.pct, 2), exposure: round(x.exposure, 3), frequency: round(x.freq, 2) } : null
      const want = String(q.tier || '').trim()
      let list = cube.accounts.filter((a) => like(a.account, q.account)).filter((a) => !want || tier(a.account) === want || TIER_GROUP[tier(a.account)] === want)
      if (q.region) list = list.filter((a) => a.regions[q.region])
      const rows = list.map((a) => ({ account: a.account, category: a.category || null, tier: tier(a.account), tier_label: TIER_LABEL[tier(a.account)], tier_group: TIER_GROUP[tier(a.account)], total: band === 'All' ? Object.fromEntries([...A.PEN_BANDS, 'All'].map((b) => [b, cell(a.total[b])])) : cell(a.total[band]), regions: Object.fromEntries(Object.entries(a.regions).filter(([r]) => !q.region || r === q.region).map(([r, t]) => [r, band === 'All' ? Object.fromEntries([...A.PEN_BANDS, 'All'].map((b) => [b, cell(t[b])])) : cell(t[band])])) }))
      const actions = A.penetrationActions(cube, { tiers: (n) => TIER_LABEL[tier(n)] || tier(n) }).filter((x) => like(x.account, q.account))
      return { source: name, from: from || null, to: to || null, windows: windows.map((w) => ({ period_start: w.upload.period_start, period_end: w.upload.period_end, notes: w.upload.notes })), frequency, regions: cube.regions, bands: A.PEN_BANDS, estimated_mix: cube.estimated, rows: rows.slice(0, clamp(q.limit, 100, 2000)), row_count: rows.length, actions, method: 'Impressions land in a company x country x band cell through the window country share and job-title mix. People reached = pool x (1 - (1 + λ/k)^-k) with λ = impressions / pool, k calibrated so one window averages the frequency; one window equals impressions / frequency, more windows flatten towards the pool. Percentages count only reach inside pooled cells.' }
    }
    case 'linkedin/windows': {
      const channel = lower(q.channel) || 'all'
      const uploads = await d.select('ca_uploads', { params: channel === 'all' ? {} : { channel: `eq.${channel}` }, select: 'id,channel,kind,platform,file_name,uploaded_by,uploaded_at,period_start,period_end,row_count,notes', order: 'period_start.desc,uploaded_at.desc', limit: 1000 })
      return { source: name, rows: uploads, row_count: uploads.length }
    }
    case 'hubspot/leads': {
      const S = await loadSettings(env, request, { keys: ['accounts'] })
      const params = {}
      const range = []; if (from) range.push(`gte.${from}`); if (to) range.push(`lte.${to}T23:59:59`); if (range.length) params.created_at = range
      let contacts
      try { contacts = await d.selectAll('ca_hs_contacts', { params: { ...params, in_scope: 'not.is.false' }, order: 'created_at.desc' }) }
      catch (e) { if (!/in_scope|column/i.test(String(e.message || e))) throw e; contacts = await d.selectAll('ca_hs_contacts', { params, order: 'created_at.desc' }) }
      let rows = enrich(contacts.filter(isFormLead), {}, Array.isArray(S.accounts) ? S.accounts : [])
      if (q.account) rows = rows.filter((r) => like(r.account, q.account) || like(r.company_raw, q.account))
      if (q.band) rows = rows.filter((r) => (r.band || 'Unknown') === q.band)
      if (q.region) rows = rows.filter((r) => lower(r.region) === lower(q.region))
      if (q.q) rows = rows.filter((r) => like([r.name, r.jobtitle, r.company_raw, r.account, r.email].join(' '), q.q))
      const count = (k) => { const o = {}; for (const r of rows) { const v = r[k] || 'Unknown'; o[v] = (o[v] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])) }
      const DEFAULT_FIELDS = ['hs_id', 'name', 'email', 'company_raw', 'account', 'jobtitle', 'band', 'country', 'region', 'lead_source', 'source', 'lifecycle', 'lead_status', 'owner_name', 'created_at', 'last_activity_at', 'last_activity_type', 'notes_count', 'replied', 'demo_booked', 'stage']
      const fields = String(q.fields || '').trim() === 'all' ? null : String(q.fields || '').split(',').map((s) => s.trim()).filter(Boolean)
      const pick = (r) => { const keys = fields && fields.length ? fields : DEFAULT_FIELDS; const o = {}; for (const k of keys) if (k in r) o[k] = r[k]; return o }
      const limit = clamp(q.limit, 500, 5000), offset = Math.max(0, num(q.offset, 0))
      return { source: name, from: from || null, to: to || null, total: rows.length, by_band: count('band'), by_account: count('account'), by_region: count('region'), by_lead_source: count('lead_source'), funnel: funnelCounts(rows), rows: rows.slice(offset, offset + limit).map(fields ? pick : pick), row_count: rows.length, offset, note: 'Only form leads at target accounts (the dashboard definition of a GSI lead). fields=all returns every column.' }
    }
    case 'hubspot/deals': {
      const data = await loadDeals(env, { from, to })
      let rows = data.deals || data.rows || []
      if (q.bucket) rows = rows.filter((r) => lower(r.bucket) === lower(q.bucket))
      if (q.partner) rows = rows.filter((r) => like(r.partner, q.partner) || like(r.company_raw, q.partner) || like(r.name, q.partner))
      return { source: name, from: from || null, to: to || null, kpis: kpisOf(rows), rows: rows.slice(0, clamp(q.limit, 500, 5000)), row_count: rows.length, last_sync: data.last_sync || null }
    }
    case 'email/summary': {
      const all = ['1', 'true', 'yes'].includes(lower(q.all))
      const [campaigns, daily] = await Promise.all([
        d.select('ca_em_campaigns', { params: all ? {} : { gsi: 'eq.true' }, order: 'name.asc', limit: 1000 }),
        d.selectAll('ca_em_daily', { params: { ...(from ? { day: [`gte.${from}`, ...(to ? [`lte.${to}`] : [])] } : to ? { day: `lte.${to}` } : {}) }, order: 'day.asc' }),
      ])
      const byC = new Map(); for (const r of daily) { if (!byC.has(r.campaign_id)) byC.set(r.campaign_id, []); byC.get(r.campaign_id).push(r) }
      const metrics = (rs) => { const o = {}; for (const r of rs) for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && !['status'].includes(k)) o[k] = (o[k] || 0) + v; delete o.id; return o }
      const rows = campaigns.filter((c) => like(c.name, q.campaign)).map((c) => ({ id: c.id, name: c.name, status: c.status, gsi: c.gsi, lifetime: { leads: c.leads_count, contacted: c.contacted, sent: c.sent, opens: c.opens, replies: c.replies, clicks: c.clicks, bounced: c.bounced, unsubscribed: c.unsubscribed }, in_range: metrics(byC.get(c.id) || []), days_in_range: (byC.get(c.id) || []).length }))
      return { source: name, from: from || null, to: to || null, rows, row_count: rows.length, in_range_total: metrics(daily.filter((r) => rows.some((c) => c.id === r.campaign_id))) }
    }
    case 'phantom/summary': {
      const [agents, daily] = await Promise.all([
        d.select('ca_pb_agents', { select: 'id,name,script,last_run_at,status', order: 'name.asc', limit: 500 }),
        d.selectAll('ca_pb_daily', { params: { ...(from ? { day: [`gte.${from}`, ...(to ? [`lte.${to}`] : [])] } : to ? { day: `lte.${to}` } : {}) }, order: 'day.asc' }),
      ])
      const by = new Map(); for (const r of daily) { if (!by.has(r.agent_id)) by.set(r.agent_id, { profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0, days: 0 }); const o = by.get(r.agent_id); for (const k of ['profiles', 'invites_sent', 'accepted', 'messages_sent', 'replies']) o[k] += Number(r[k]) || 0; o.days++ }
      const rows = agents.map((a) => ({ ...a, ...(by.get(a.id) || { profiles: 0, invites_sent: 0, accepted: 0, messages_sent: 0, replies: 0, days: 0 }) }))
      return { source: name, from: from || null, to: to || null, rows, row_count: rows.length }
    }
    case 'actions': {
      const params = {}; if (q.status) params.status = `eq.${q.status}`; if (q.channel) params.channel = `eq.${q.channel}`
      const rows = await d.select('ca_actions', { params, order: 'created_at.desc', limit: clamp(q.limit, 200, 2000) })
      return { source: name, rows, row_count: rows.length }
    }
    case 'settings': {
      const key = String(q.name || '').trim()
      if (!key) throw new QueryError(400, 'bad_param', 'name is required, e.g. accounts, icp_pool, regions, bands, targets, account_tiers')
      const S = await loadSettings(env, request, { keys: [key] })
      if (!(key in S) || S[key] === undefined) throw new QueryError(404, 'not_found', `No setting named ${key}`)
      return { source: name, key, value: S[key], updated_at: S.updated_at || null }
    }
    case 'coverage': return { source: name, ...(await loadCoverage(env)) }
    case 'table': {
      const table = String(q.name || '').trim()
      if (!TABLES[table]) throw new QueryError(400, 'bad_param', `name must be one of: ${Object.keys(TABLES).join(', ')}`)
      const params = {}
      for (const [k, v] of Object.entries(q)) { if (RESERVED.has(k) || k === 'name' || v === undefined || v === null || v === '') continue; if (!/^[a-z_][a-z0-9_]*$/i.test(k)) throw new QueryError(400, 'bad_param', `bad column ${k}`); if (!/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|not\.[a-z]+)\./.test(String(v))) throw new QueryError(400, 'bad_param', `${k} must be a PostgREST filter such as eq.x, gte.2026-09-01, like.*x*, in.(a,b), is.null`); params[k] = v }
      const opts = { params, limit: clamp(q.limit, 500, 5000) }
      if (q.select) { if (!/^[a-z0-9_,\s]+$/i.test(String(q.select))) throw new QueryError(400, 'bad_param', 'select must be a comma list of columns'); opts.select = String(q.select).replace(/\s+/g, '') }
      if (q.order) { if (!/^[a-z_][a-z0-9_]*(\.(asc|desc))?(\.nulls(first|last))?$/i.test(String(q.order))) throw new QueryError(400, 'bad_param', 'order must be col.asc or col.desc'); opts.order = String(q.order) }
      if (q.offset) opts.offset = Math.max(0, num(q.offset, 0))
      const rows = await d.select(table, opts)
      return { source: name, table, rows, row_count: rows.length, limit: opts.limit, offset: opts.offset || 0 }
    }
    default: throw new QueryError(404, 'unknown_source', `Unknown source "${name}". Sources: ${sourceNames().join(', ')}`)
  }
}

/** rows -> CSV text (header from the union of keys; nested values as JSON). */
export function toCsv(rows) {
  const keys = []; const seen = new Set()
  for (const r of rows || []) for (const k of Object.keys(r || {})) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [keys.join(','), ...(rows || []).map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n')
}
