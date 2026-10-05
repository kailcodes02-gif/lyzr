# Campaign Analytics

Live: `https://lyzr.kailash-gm.com/Campaign_Analytics/` (once pushed). Internal Lyzr dashboard for the
GSI and SI programme: paid ads (LinkedIn), email (Instantly: CSV exports plus a daily API pull of every
GSI-tagged campaign), HubSpot messaging intelligence and lead analytics, week-on-week and month-on-month
trends on every channel, and Claude read-outs whose suggested actions are tracked (open / done) and fed back
into the next read-out.

## How it fits the existing setup
- Same Cloudflare Pages site as everything else (`lyzr-work-os`). The folder is served as-is, no build.
- Sign-in: Microsoft, same Entra app as MS UI and GSIEvents. One-time step: add the SPA redirect URI
  `https://lyzr.kailash-gm.com/Campaign_Analytics/` on the "Lyzr MS UI" app registration.
- API: Pages Functions in `functions/api/ca/`. Secrets on the Pages project (never in the repo).
- Database: Supabase, tables prefixed `ca_` (`supabase/001_campaign_analytics.sql`). The migration only
  creates `ca_*` tables; it does not read or change any other table. Row Level Security is on with no
  policies, so nothing else in that project can read Campaign Analytics data with the anon key either.

## Runbook
1. Database. Either create a dedicated Supabase project (recommended, full isolation) or reuse an
   existing one. Paste `supabase/001_campaign_analytics.sql`, `002_email_actions.sql`, `003_message_ai.sql`, then
   `004_deals.sql`, `006_phantom.sql`, `007_ad_platforms.sql`, `008_funnel.sql`, `009_em_leads.sql` and `010_cache.sql` into its SQL Editor (project `gfzimvqfmninrcyapike`).
2. Secrets on Pages (run from the repo root, wrangler is already logged in):
   ```
   npx wrangler pages secret put CA_SUPABASE_URL --project-name lyzr-work-os      # https://<ref>.supabase.co
   npx wrangler pages secret put CA_SUPABASE_KEY --project-name lyzr-work-os      # service_role key of that project
   npx wrangler pages secret put ANTHROPIC_API_KEY --project-name lyzr-work-os    # Claude (also used by the tracker assistant)
   npx wrangler pages secret put CA_CRON_SECRET --project-name lyzr-work-os      # any long random string
   npx wrangler pages secret put PHANTOMBUSTER_API_KEY --project-name lyzr-work-os # PhantomBuster › Org settings › API keys
   npx wrangler pages secret put CA_LOCAL_USERS --project-name lyzr-work-os        # "email:password, email:password" for email sign-in
   npx wrangler pages secret put CA_API_KEYS --project-name lyzr-work-os           # "label:key, label:key" read-only keys for the data API and MCP (make a key: openssl rand -hex 24)
   ```
   `HUBSPOT_ACCESS_TOKEN` and `INSTANTLY_API_KEY` are already set. Add the same `CA_CRON_SECRET` value as a
   GitHub Actions secret: `.github/workflows/ca-daily-pull.yml` runs every day at 07:00 IST: Instantly (all
   GSI-tagged campaigns, full history), HubSpot (GSI leads), HubSpot deals, PhantomBuster, then Claude Sonnet 5
   reads new lead messages.
3. Entra redirect URI (step above). Then push to `main`; Pages deploys in about a minute.
4. Open the dashboard, Settings › Connection shows which of the three pieces are live.
5. Whenever you have them: the upload box on any channel page takes any number of files at once (CSV or Excel)
   and routes each one: LinkedIn Performance and Demographics exports to Ads › LinkedIn, daily campaign exports
   from Google Ads, Meta, Bing, Taboola, X or ChatGPT to their own Ads page (recognised by their columns),
   Instantly campaign exports to Email (the campaign comes from the file name). Re-uploads never double count. HubSpot: the Refresh button on the
   HubSpot messaging page (read-only pull). Settings › GSI companies holds the list that makes a lead a GSI
   lead; Settings › Email rules holds the fast-click threshold and the Book a Demo rule.

## How data is saved
Uploads are stored the moment they finish: ad exports per day per ad (overlapping days overwrite, never double
count), demographics per export window, Instantly exports as de-duplicated events. API pulls (Instantly, HubSpot
leads, deals, PhantomBuster) run every morning and on the Admin Pull now buttons into the same store. Every date
range you pick reads from the store; nothing needs re-uploading. Actions (Track / Add) are rows in `ca_actions`.
Admin › Data coverage shows exactly which dates each source covers and where the gaps are.

## Shared cache
The heavy reads (`/api/ca/linkedin`, `hubspot`, `hubspot/deals`, `email`, `phantom`, `coverage`) are computed once
and kept for 8 hours in the `ca_cache` table, so the same answer is served to every user, across logins and
date ranges (one entry per path + parameters). Every write that changes the data (uploads and their deletion,
settings, the HubSpot, deals, Instantly and PhantomBuster pulls, message reading, ICP estimates) bumps a
`_version` row, and entries older than it are recomputed on the next read. The top-bar **Refresh data** button
sends `x-ca-refresh: 1` with the GETs of the next 90 seconds, which bypasses the cache and rewrites it for
everyone. Responses carry `x-ca-cache: hit|miss|bypass` and `x-ca-cached-at`, which the "Data as of" label
shows. Claude read-outs are not part of this layer (they keep their own cache in `insights.js`).
Run `supabase/010_cache.sql` once in the Supabase SQL editor; until then the API works as before and adds
the warning `cache: run Campaign_Analytics/supabase/010_cache.sql` where a response has a `warnings` array.

## Penetration, tiers and designations (LinkedIn page)
Penetration can never read above 100%: people reached come from a reach curve (negative-binomial model, see
ARCHITECTURE.md › Data conventions) calibrated to the frequency in Admin › Targets, so one window equals
impressions ÷ frequency and further windows add fewer new people. The cube shows penetration, people reached,
pool, exposure (impressions per person in the pool) and frequency (impressions per person reached).
**Penetration by tier** rolls the same cube up by GSI / SI / Big Four / MBB and Tier 1 (GSI + Big Four + MBB) vs
Tier 2 (SI + Other). Tiers come from rules; the "Classify with Claude" button (editors) sends the rest to Claude
Sonnet once, 80 accounts per call, and saves the answer in Admin › GSI accounts › Account tiers, where any tier can
be edited by hand. **What to do next** lists fixed-rule items (extend reach, rotate creative, open a region, reach
the MD band) with a Track button. **Designations reached** shows the exact titles LinkedIn exported (top 25 per
export) and their cohorts; **Designation cohorts by company** lists the exact titles of the HubSpot leads per account.

## Leads page: origin, drill-down and the activity checklist
The HubSpot Leads page reads the portal's own properties, so every lead says which form it came through
(First conversion, Lead Form Type), which Lead Source the picklist holds (Book a Demo, LinkedIn, a playbook,
an event...), which campaign (Lead Campaign Name, else the UTM campaign, else HubSpot's converting campaign) and
which traffic source the first visit had. "Where the leads came from" shows one table per view (form, lead
source, campaign, traffic source), each with band mix, reached-out, never-contacted and demo-booked counts; the
Origin dropdown filters the whole page to one of them. **Every number on the page is a link**: it opens the leads
behind it in a side panel (copy emails, export CSV), and each lead opens with its origin properties, an activity
checklist (form, owner, status, contacted, sales email, call, sequence, LinkedIn via HeyReach, reply, meeting,
demo, next activity, marketing email, note: each with the date it happened or "none"), and a timeline of every
dated event HubSpot holds. Instantly campaign membership is no longer a page-level split; it appears only as a
line on the lead when the lead sits in a GSI-tagged campaign. The extra properties arrive with the next
**Pull HubSpot now** (Admin), so until then older leads show fewer origin fields.

## Data API and MCP server (pull anything from outside)
Everything the dashboard holds can be pulled read-only, by Claude or by anyone with a key, as JSON or CSV.
- **Index, no key:** `GET https://lyzr.kailash-gm.com/api/ca/v1` lists every source with its parameters and
  example, plus the raw tables; `GET /api/ca/v1/openapi.json` is the OpenAPI 3.1 description (import it into
  Postman, a GPT action or an agent builder).
- **Sources:** `linkedin/performance` (totals grouped by day, week, month, campaign, ad, platform, person,
  stage, format; `platform=all` adds Google, Meta, Bing, Taboola, X, ChatGPT), `linkedin/demographics` (who the
  ads reached, any breakdown, tagged exports via `tag=`), `linkedin/penetration` (the cube with tiers, exposure,
  frequency and the what-to-do-next items, same reach model as the page), `linkedin/windows` (which dates have
  data), `hubspot/leads` (GSI leads with exact titles, counts, funnel), `hubspot/deals`, `email/summary`,
  `phantom/summary`, `actions`, `settings?name=accounts`, `coverage`, and `table?name=ca_li_perf&day=gte.2026-09-01`
  (read-only PostgREST filters on any `ca_*` table).
- **Key:** `Authorization: Bearer <key>`, `x-api-key: <key>` or `?key=<key>`; `format=csv` returns the rows as a
  file. Keys live only in the Pages secret `CA_API_KEYS` ("label:key, label:key", one key per consumer, 16+
  characters; `openssl rand -hex 24` makes one). Redeploy after setting it. Remove a key by setting the secret
  again without it. A signed-in dashboard session works too. Admin › Connection shows how many keys are set.
- **MCP (Claude):** the same sources are tools on `https://lyzr.kailash-gm.com/api/ca/mcp` (streamable HTTP,
  stateless JSON-RPC). claude.ai › Settings › Connectors › Add custom connector with the URL
  `https://lyzr.kailash-gm.com/api/ca/mcp/<key>` (no OAuth). Claude Code:
  `claude mcp add --transport http lyzr-ca https://lyzr.kailash-gm.com/api/ca/mcp --header "Authorization: Bearer <key>"`.
  Tool results above about 400k characters are cut to the rows that fit, with a note to narrow the scope.
- The numbers equal the dashboard's: the API runs the same aggregation code (`js/lib/linkedin-agg.mjs`,
  `js/lib/leads-agg.mjs`) inside the Pages Function.

## Demo mode
`?demo=1` (or the "Explore in demo mode" button) runs the whole UI on generated data shaped like the
September 2026 reports, with no backend. Useful for reviewing layout and copy.

## Folder map
- `index.html`, `css/app.css`: shell and brand styles.
- `js/app.mjs`: gate, nav, global date range, view loader. `js/auth.mjs`: MSAL. `js/api.mjs`: API client.
- `js/views/*.mjs`: overview, linkedin, email, messaging, leads, settings.
- `js/csv.mjs`: LinkedIn CSV parsing. `js/email-csv.mjs`: Instantly CSV parsing. `js/upload-detect.mjs`: bulk
  upload detection (CSV and Excel). `js/trend.mjs`: the week/month trend explorer. `js/actions.mjs`: action tracker.
- `js/lib/email-agg.mjs`: email aggregation (links, Book a Demo, fast clicks, people, campaigns, accounts). `js/heatmap.mjs`, `js/ui.mjs`, `js/fmt.mjs`, `js/insights.mjs`: shared pieces.
- `js/mock.mjs`, `js/mock/*`: demo data. `seed/*.json`: default accounts, bands, regions, ICP pools.
- `supabase/`: schema. `tests/`: node tests (`node --test tests/`).
- `ARCHITECTURE.md`: the contract every part follows.
