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
   `004_deals.sql`, `006_phantom.sql` and `007_ad_platforms.sql` into its SQL Editor (project `gfzimvqfmninrcyapike`).
2. Secrets on Pages (run from the repo root, wrangler is already logged in):
   ```
   npx wrangler pages secret put CA_SUPABASE_URL --project-name lyzr-work-os      # https://<ref>.supabase.co
   npx wrangler pages secret put CA_SUPABASE_KEY --project-name lyzr-work-os      # service_role key of that project
   npx wrangler pages secret put ANTHROPIC_API_KEY --project-name lyzr-work-os    # Claude (also used by the tracker assistant)
   npx wrangler pages secret put CA_CRON_SECRET --project-name lyzr-work-os      # any long random string
   npx wrangler pages secret put PHANTOMBUSTER_API_KEY --project-name lyzr-work-os # PhantomBuster › Org settings › API keys
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
