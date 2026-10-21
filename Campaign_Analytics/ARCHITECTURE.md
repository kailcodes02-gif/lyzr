# Campaign Analytics: architecture and contracts

Live URL (once pushed): `https://lyzr.kailash-gm.com/Campaign_Analytics/`
Folder: `Campaign_Analytics/` (static, no build step, served by the root Cloudflare Pages site
`lyzr-work-os`, same as `GSIEvents/`). Backend: Pages Functions in `functions/api/ca/`.

## Stack (all reused from existing projects)
| Concern | Choice | Copied from |
|---|---|---|
| Hosting | Root Pages site, every push to `main` deploys | KNOWLEDGE_BASE §2 |
| Sign-in | MSAL.js v5 popup, Entra app "Lyzr MS UI" (client `cd569c2f-9121-4a99-8ba0-691c6df81cbd`, tenant `4b1018eb-9480-4542-89d0-4e6233aba226`), scope `User.Read`, page is its own redirect bridge | `GSIEvents/index.html` |
| Server auth | Bearer token verified with Graph `/me`; only `@lyzr.com` / `@lyzr.ai` | `functions/api/events.js` |
| Storage | Supabase Postgres, tables `ca_*` (`supabase/001_campaign_analytics.sql`), RLS on + no policies, Functions use the service key | GSI Tracker |
| HubSpot | Read-only, `HUBSPOT_ACCESS_TOKEN` Pages secret, GSI pull rules + target list | `functions/api/hubspot-leads.js`, `_lib/target-companies.js` |
| Claude | `ANTHROPIC_API_KEY` Pages secret, Messages API with tool-use for structured JSON | `functions/api/assistant.js`, comms-tracker `lib/ai` |
| Charts | Chart.js 4 (cdnjs), CSV parsing PapaParse 5 (cdnjs) | the GTM Review report |
| Brand | Lyzr tokens: navy `#043E77`, orange `#FE4B1E`, forest `#063B28`, oxblood `#593D3D`, stone greys, DM Sans + Playfair Display | GTM Review report, tracker `globals.css` |

## Pages Function env vars (secrets on `lyzr-work-os`)
| Var | Purpose | Status |
|---|---|---|
| `CA_SUPABASE_URL` | `https://<ref>.supabase.co` for the ca_* tables | to set |
| `CA_SUPABASE_KEY` | service-role key of that project (server only) | to set |
| `HUBSPOT_ACCESS_TOKEN` | HubSpot private app token | already set |
| `ANTHROPIC_API_KEY` | Claude | to set (also unblocks the tracker assistant) |
| `INSTANTLY_API_KEY` | Instantly V2 API, read-only daily pull | already set (GSI Tracker weekly report) |
| `CA_CRON_SECRET` | shared secret for the scheduled sync (`X-CA-Cron` header), same value as the GitHub Actions secret | set |
| `CA_LOCAL_USERS` | `email:password, email:password` for the named outside accounts that sign in with email + password (POST login) | to set |
| `PHANTOMBUSTER_API_KEY` | PhantomBuster org API key, read-only daily pull of the LinkedIn outreach phantoms (`X-Phantombuster-Key`) | to set |
| `LINKEDIN_CLIENT_ID` | LinkedIn app client id for the Marketing API connection (public; the code falls back to `774euwn4y0mlz5`) | to set |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn app client secret: token exchange, refresh, and the HMAC key that signs the OAuth `state` | to set |
| `LINKEDIN_API_VERSION` | optional `LinkedIn-Version` header (YYYYMM), default `202609` in `_lib/linkedin-api.js` | optional |
| `LINKEDIN_REDIRECT_URI` | optional override of the OAuth redirect, default `<origin>/api/ca/linkedin-api/callback` | optional |

## Frontend module contract
`js/app.mjs` owns the shell: gate, nav, global date range, toast, and calls
`view.render(container, ctx)` for the active route. Every view in `js/views/*.mjs` exports:

```js
export const route = 'linkedin';          // hash route  #/linkedin
export const title = 'Ads · LinkedIn';
export async function render(el, ctx) {}  // ctx = { api, state, user, toast, fmt, heat, charts, nav }
export function destroy() {}              // optional: dispose charts
```
`ctx.state` = `{ from:'YYYY-MM-DD', to:'YYYY-MM-DD', tz:'Asia/Kolkata' }` (global date range, persisted
in localStorage `ca.range`). Views re-render when `ca:range` event fires on `window`.

`ctx.api` (js/api.mjs) wraps `fetch('/api/ca/...')` with the MSAL bearer token and JSON errors.
In demo mode (`?demo=1` or localStorage `ca.demo=1`) `api` is replaced by `js/mock.mjs` which serves
data derived from the September 2026 reports so the UI can be exercised with no backend.

## API (all under `/api/ca/`, JSON, bearer = Microsoft access token)
| Method + path | Body / query | Returns |
|---|---|---|
| `POST login` | `{ email, password }` | `{ token, email, name, expires_at, isEditor }`; token used as `Bearer` like a Microsoft token (12 h) |
| `GET health` | | `{ ok, db, hubspot, claude, instantly, phantom, cron, linkedin_api:{configured, connected}, user }` (booleans = env var present; `linkedin_api.connected` = a LinkedIn sign-in is stored) |
| `GET settings` | | `{ bands, icp_pool, accounts, regions, targets, editors, updated_at }` (defaults from `seed/` when a key is unset) |
| `PUT settings` | `{ key, value }` (editors only) | `{ ok }` |
| `GET uploads` | `?channel=linkedin&platform=google` | `{ uploads:[{id, channel, kind, file_name, uploaded_by, uploaded_at, period_start, period_end, row_count}] }` |
| `POST uploads` | `{ channel, kind, file_name, period_start, period_end, columns, rows:[...] }` rows already normalised by `js/csv.mjs` (perf rows keyed `day,campaign_id,ad_id,...`; demo rows `segment,value,campaign,...`). Max 2,000 rows per call; client chunks and sends `upload_id` on continuation | `{ upload_id, inserted }` |
| `DELETE uploads?id=` | | `{ ok }` (cascades rows) |
| `GET linkedin` | `?from&to&platform=` | `{ platform, perf:[daily rows in range], demo:[{upload:{...}, rows:[...]}] for uploads overlapping the range], uploads:[...] }`. `platform` = `linkedin` (default), `google`, `meta`, `taboola`, `chatgpt`, `x`, `bing` or `all`; rows carry `platform` (`007_ad_platforms.sql`) |
| `POST icp-estimate` | `{ accounts:[names], countries?, force? }` editors | Claude headcount estimates per account x country x band -> saved in the `icp_estimates` setting; `{ estimates, model, skipped }` |
| `GET coverage` | | what the store holds per source: ad platform day coverage and gaps (from uploads + table edges), demographics windows, Instantly/HubSpot/deals/PhantomBuster edges and last sync, action counts. Admin › Data coverage |
| `GET hubspot/deals` | `?from&to` | GSI/SI pipeline: deals with bucket/substage/amount/owner, weekly snapshots and what changed since last week (`004_deals.sql`) |
| `POST hubspot/deals-sync` | `{ cursor? }` editors or `X-CA-Cron` | resumable, read-only: deals with the `gsi` property or a company on the GSI list |
| `GET phantom` | `?from&to` | `{ agents, runs (launched in range), daily (all), last_sync, configured }` (`006_phantom.sql`) |
| `POST phantom/sync` | `{ cursor? }` editors or `X-CA-Cron` | resumable, read-only, 20 PhantomBuster calls per call; outreach phantoms only are counted |
| `GET hubspot` | `?from&to` | `{ contacts:[...], notes_by_contact:{id:[...]}, last_sync:{...} }` |
| `POST hubspot/refresh` | `{ cursor? }` | `{ done:boolean, cursor?, contacts, notes, warnings:[] }` resumable, same pattern as hubspot-leads.js |
| `POST insights` | `{ scope, kind:'messaging'|'ads'|'leads'|'overview', input:{...}, force?:boolean }` | `{ scope, content, cached:boolean, created_at, model }` |
| `GET insights` | `?scope=` | `{ content, created_at }` or 404 |

| `GET email` | `?offset=` | `{ events:[[ci, contact, step, event, ts, si, link, lag_s]], campaigns:[], senders:[], next }`; first page adds `uploads` and `api:{campaigns, daily, last_sync, configured}`. Paged 15,000 rows per call; the view loads every page (whole history) and filters by range itself |
| `POST uploads` (email) | `channel:'email', kind:'events'`, rows from `js/email-csv.mjs` `{campaign, contact, step, event, ts, sender, link, lag_s, raw_event}` | upsert on `(campaign, contact, step, event, ts, link)` so cumulative exports never double count |
| `POST instantly/sync` | `{ cursor?, full? }` editors or `X-CA-Cron` | resumable: GSI-tagged campaigns (tag id, then tag label, then name), all-time totals, daily rows for 20 campaigns per call. Read-only against Instantly |
| `GET li-leads` | | `{ leads:[lead + doc_id, source], docs:[{id, source, file_name, uploaded_by, uploaded_at, count, kept}], screens:[{id, file_name, uploaded_at, uploaded_by, kind, title, summary, period, metrics, tables, notes, leads_count, model}], duplicates, warnings }`: every `leads:` document and the leads inside every `screen:` document, the same lead counted once (API pull, then files oldest first, then screenshots). Shared cache path `li-leads` |
| `POST li-leads` | `{ file_name, rows:[...] }` editors, at most 20,000 rows | rows normalised with `normaliseLead`; leads already held in any `leads:` document are skipped; writes `leads:<uuid>` only when something is new. `{ id \| null, inserted, skipped, duplicates, invalid }` (201 when written) |
| `DELETE li-leads?id=` | `leads:<id>` or `screen:<id>`, editors | `{ ok, id }`; `leads:li-api` (the API pull) is refused with 400 |
| `POST screenshots` | `{ file_name, media_type: image/png\|jpeg\|webp\|gif, data: base64, hint? }` signed in, 5 MB decoded at most | Claude `claude-sonnet-5`, image block + forced `extract` tool call; stored as `screen:<uuid>` `{ file_name, uploaded_by, uploaded_at, kind:'leads'\|'campaign_metrics'\|'lead_form_metrics'\|'demographics'\|'other', title, summary, period, leads, metrics:[{campaign, metric, value, unit, period}], tables:[{title, columns, rows}], notes, model }`; 201 with the document. 429 passes through, other model errors are 500 |
| `GET screenshots` | | `{ screens }`, the same list as `GET li-leads` (one source of truth: `li-leads.js` `load`) |
| `GET linkedin-api/status` | signed in | `{ configured, connected, connected_by, connected_at, expires_at, refresh_expires_at, has_refresh_token, scope, leads_enabled, ad_accounts:[{id, name, currency, status}], selected_accounts, last_sync:{at, by, from, to, perf_rows, demo_windows, leads, warnings}, redirect_uri, client_id }`. Never a token |
| `POST linkedin-api/connect` | `{ leads?:boolean }` editors | `{ url, scope, redirect_uri }`: the LinkedIn authorize URL. Scopes `r_ads r_ads_reporting`, plus `r_marketing_leadgen_automation` when `leads` (opt-in: an unapproved scope fails the whole sign-in). `state` = base64url `{email, ts, leads, nonce}` + `.` + HMAC-SHA256 (key `LINKEDIN_CLIENT_SECRET`), valid 15 minutes. 503 without the secret |
| `GET linkedin-api/callback` | `?code&state` or `?error&error_description` (LinkedIn redirects the browser; no bearer) | verifies `state`, exchanges the code at `oauth/v2/accessToken`, lists ad accounts (`adAccountUsers?q=authenticatedUser`, `adAccounts/{id}`), saves `_li_oauth`, 302 to `/Campaign_Analytics/#/admin?linkedin=connected` or `?linkedin=error&msg=` |
| `POST linkedin-api/accounts` | `{ selected_accounts:[ids] }` or `{ refresh:true }` editors | status (ids not in `ad_accounts` are dropped) |
| `POST linkedin-api/disconnect` | editors | `{ ok }`; deletes `_li_oauth`, `_li_meta`, `_li_leads_stage` (pulled rows stay) |
| `POST linkedin-api/sync` | `{ cursor?, from?, to? }` editors or `X-CA-Cron` | resumable: `{ done, cursor?, progress:{phase:'meta'\|'perf'\|'demo'\|'leads'\|'done', done, total}, from, to, perf_rows, demo_windows, leads, warnings }`; `{ done:true, skipped:'not connected' }` (200) when nobody connected; 409 when the sign-in expired and cannot renew. Read-only against LinkedIn |
| `GET/POST/PUT/DELETE actions` | `?channel` / `{channel, title, detail, owner, source, scope}` / `{id, status:open|in_progress|blocked|done|dropped, note, owner}` / `?id` | tracked suggestions; anyone signed in can add and tick off, editors delete |

Error shape: `{ error: string }` with 401 (no/invalid token), 403 (not an editor), 503 (env var missing).

Implementation notes (backend, `functions/api/ca/`), where the built code adds to or differs from the table above:
- `GET health` also returns `db_error` (string or null) when the cheap select failed; `ok` is true only when db, hubspot and claude are all present.
- `GET settings` never fails on a missing database: it returns seed defaults with `db:false` and a `source:{key:'db'|'seed'}` map so the shell can boot before secrets are set. `bands` is `{ global:{MD,MD1,MD2,split}, accounts:{ <account>:{md,md1,md2} }, note }`; `regions` is the plain map (`{ 'India':[...] }`), not the seed wrapper; `targets` is merged over `{leads_per_month:200, demo_mqls_per_month:30, frequency:3.5}`.
- `PUT settings` answers `{ ok, key }`; `regions` may be sent as the seed file or the map (stored as the map); `editors` is normalised to lower-case emails.
- `POST uploads` answers `{ upload_id, inserted, skipped, created, final }` with 201 on the call that created the upload. Rows with a bad `day` (performance) or a missing `segment`/`value` (demographics) are skipped and counted. A demographics upload with the same channel, kind, period_start and period_end as an existing one deletes that older upload first (re-upload replaces). Max 2,000 rows per call (413 above that).
- `GET linkedin` also echoes `from` and `to`. Demographics uploads with no window are treated as overlapping.
- `GET hubspot` also echoes `from` and `to`; the range is applied to `created_at` as IST calendar days.
- `POST hubspot/refresh` also accepts `from` and `to` (YYYY-MM-DD, IST) on the first call to limit the pull by `createdate`; they travel inside the cursor. It answers `{ done, cursor, contacts, notes, warnings, progress:{phase:'search'|'notes'|'done', done, total} }`; keep calling with `cursor` until `done:true`. Each invocation stays under about 40 subrequests (20 HubSpot searches, or one chunk of 200 contacts' notes).
- `POST insights` also returns `truncated` (input was cut to about 60 KB) and `usage` (model token counts). Anyone signed in can generate when nothing is cached; `force:true` needs an editor. `GET insights` also returns `model`, `created_by` and `cached:true`.
- Editors: `env.CA_EDITORS` (comma list) if set, else the `editors` settings row, else the built-in default list in `_lib/auth.js`.
- Tests: `node --test 'Campaign_Analytics/tests/backend/*.test.mjs'` (Node 24 needs the file glob, a bare directory argument is not accepted).

## Data conventions
- LinkedIn Performance = per ad per day. Date range filters on `day`.
- LinkedIn Demographics = aggregates over the export window. The range picker selects uploads whose
  window overlaps `[from,to]`; the UI states which windows are included and that people can be
  counted in more than one window.
- Reach in LinkedIn exports is a daily figure; summing days over-counts people. Label it "reach (sum of daily)".
- Penetration = people reached ÷ ICP pool (Apollo headcount by account × country × band), never above 100%.
  People reached comes from the negative-binomial reach model (`reachModel` in `js/lib/linkedin-agg.mjs`): with
  λ = impressions ÷ pool exposures per person, share reached = 1 − (1 + λ/k)^−k, k calibrated so one window
  averages `targets.frequency` (default 3.5) impressions per person reached. One window therefore equals
  impressions ÷ frequency; more windows flatten towards the pool. Cells with no pool fall back to impressions ÷
  frequency and show no percentage. Roll-ups (company, region, tier) divide only the reach inside pooled cells
  (`reached_pooled`) by the summed pool. Also reported: exposure (impressions per person in the pool) and
  frequency (impressions per person reached).
- Designation bands: MD, MD-1, MD-2 (Settings › Bands). Per-account title conventions in `seed/accounts.json`,
  generic LinkedIn title buckets in `seed/band_titles.json`. Everything else = Other.
- Regions: `seed/regions.json` (file wraps the map as `{note, regions:{Region:[countries]}}`; the settings API returns the flat map `{Region:[countries]}` and consumers accept either); unknown country = Other.
- Accounts: canonical names + LinkedIn page aliases in `seed/accounts.json`; the wider GSI/SI target list
  is `functions/api/_lib/target-companies.js`.
- Timezone IST for display, dates stored as calendar days.

## LinkedIn Marketing API rows (`_lib/linkedin-api.js`, `linkedin-api/[[path]].js`)
- Sign-in is 3-legged OAuth only (client_credentials is refused for this app). The token lives in the private
  document `_li_oauth` (`ca_insights`, scope starting with `_`, so `GET insights` refuses it and the data API never
  reads `ca_insights`): `{ access_token, refresh_token, expires_at, refresh_expires_at, scope, connected_by,
  connected_at, ad_accounts, selected_accounts, last_sync }`. No endpoint returns a token. The access token is
  refreshed (`grant_type=refresh_token`) when it ends within 7 days.
- Private helper documents: `_li_meta` (campaign groups, campaigns, creatives of the selected accounts: names,
  objective, format), `_li_names` (cache of resolved demographic names), `_li_leads_stage` (leads collected
  across sync calls, deleted at the end).
- Sync phases: meta, perf, demo, leads, finish. Each call stays under 40 subrequests (Cloudflare allows 50) and
  about 22 s and returns a cursor. Default range: first run 2026-04-01 to today; later runs from 14 days before
  the newest day the API wrote (LinkedIn revises recent days). `bumpCacheVersion` at the end.
- **Performance keys (checked against `js/csv.mjs` and the 2026 "Ad Performance Report" export):** the export's
  "Campaign ID" is the campaign GROUP id (Campaign Name = the group, Ad Set Name = the campaign) and csv.mjs maps
  it to `campaign_id`, with "Ad Set ID" in `extra`. API rows (`adAnalytics` pivot CREATIVE, DAILY, 31-day chunks)
  therefore use `platform 'linkedin'`, `campaign_id` = campaign group id, `ad_id` = creative id, `campaign` = campaign
  (ad set) name, `campaign_group` = group name, `ad_name` = creative name (else the name already stored for that ad
  from a CSV), `objective`/`format` in the CSV wording ("Brand awareness", "Sponsored Update"), `spend` =
  `costInLocalCurrency`, `leads` = `oneClickLeads`, `lead_forms_opened` = `oneClickLeadFormOpens`, `engagements` =
  `totalEngagements`, `conversions` = `externalWebsiteConversions`, `reach` = `approximateMemberReach` (0 if LinkedIn
  refuses it daily), `extra` = `{ 'Ad Set ID', 'Clicks to Landing Page', source:'api' }`. Same primary key as a CSV
  row, so the two overwrite each other. Ad-level API rows also delete campaign-level rows (`ad_id ''`) of the same
  days and campaign, like `uploads.js`. A creative that cannot be tied to its campaign is left out with a warning
  rather than written under another key. All API perf rows belong to one `ca_uploads` row (`file_name 'LinkedIn
  API'`, `notes 'api'`, `kind 'performance'`) whose period grows to cover every pull; CSV uploads whose days were
  re-pulled keep their original `row_count`.
- **Demographics, no double counting:** one window per calendar month (the current one to today), `adAnalytics`
  `timeGranularity=ALL` with pivots MEMBER_COMPANY, MEMBER_COUNTRY_V2, MEMBER_SENIORITY, MEMBER_JOB_TITLE,
  MEMBER_JOB_FUNCTION, MEMBER_INDUSTRY, MEMBER_COMPANY_SIZE, stored as segments `Company`, `Country`, `Job
  Seniority`, `Job Title`, `Job Function`, `Industry`, `Company Size` (the names csv.mjs gives the CSV tables;
  seniorities, functions and company sizes in the CSV wording) with `campaign ''`. Each window is a `ca_uploads` row
  `kind 'demographics'`, `file_name 'LinkedIn API'`, `notes` = the seven segments sorted. Rule: **a CSV window always
  wins.** (1) The sync subtracts every untagged CSV demographics window from each month and pulls only what is
  left (a fully covered month is skipped, and the notes say so); partial months older than 180 days are skipped
  because LinkedIn rounds them to whole months. (2) `activeWindows` (`_lib/windows.js` and the mirror in
  `js/lib/linkedin-agg.mjs`) drops an API window that overlaps any untagged CSV window of the same platform,
  whatever the upload times, so a CSV uploaded after the pull wins at once; the next pull deletes the API windows
  of the months it covers and re-pulls only the uncovered days. Tagged CSV windows ("(Anju)") are subsets and do
  not hide an API window. Coverage marks each window `source:'csv'|'api'` and `counted`.
- Demographic names: Ad Targeting API `adTargetingEntities?q=urns` first (any Marketing API token), then the
  batch-get endpoints (`organizationsLookup`, `geo`, `titles`, `industries`); cached in `_li_names`. Values LinkedIn
  will not name are stored as the URN text (e.g. `urn:li:organization:123`) with a warning.
- Lead-form leads (scope `r_marketing_leadgen_automation` only): `leadForms?q=owner` for form names and questions,
  `leadFormResponses?q=owner&leadType=(leadType:SPONSORED)`, test leads skipped. Written to `leads:li-api` (replaced
  each sync) as `{ source:'api', file_name:'LinkedIn API', uploaded_by:'linkedin-api', uploaded_at, rows:[{ submitted_at,
  first_name, last_name, email, company, title, seniority, country, city, industry, company_size, campaign,
  campaign_group, ad, form, lead_type:'', phone, linkedin_url, source:'api', extra:{ <other answers>, lead_id,
  campaign_id, ad_id } }] }`.
- Health: `linkedin_api:{ configured, connected }`. Daily job: the first step of `ca-daily-pull.yml` (`only=linkedin`).

## Layout and pages (Oct 2026 rebuild)
- Lyzr brand build reference: light only, General Sans (closest free match to Aeonik) + JetBrains Mono uppercase
  labels, 210px sidebar, hairline cards radius 8, black buttons, one orange button per view, navy chart data.
- Routes: `#/overview`, `#/uploads` (every CSV, export checklist, month grid, screenshots), `#/lead-analytics` (every lead: files, API, screenshots, HubSpot), `#/ads/linkedin`, `#/ads/google|meta|taboola|chatgpt|x|bing` (one shared view
  `views/ads-platform.mjs`: uploads of daily exports parsed by `js/ads-csv.mjs`, stored in `ca_li_perf` with
  `platform`), `#/linkedin/phantom` (PhantomBuster outreach), `#/email/instantly`, `#/hubspot/leads`,
  `#/hubspot/messaging`, `#/hubspot/pipeline` (deals), `#/admin`. Old routes redirect.
- Penetration maps: people reached = company impressions x country share x band share / frequency; shares come
  from the Country / Job Title exports or, when missing, the `mix_defaults` setting (built-in Apr-Aug 2026 mix).
  Pools = Apollo `icp_pool` + ratio-derived rows (`expandPool`) + Claude `icp_estimates`; estimated cells are dashed.
- Account tiers (`js/lib/tiers.mjs`, mirrored in `functions/api/ca/_lib/tiers.js`): GSI / SI / Big Four / MBB /
  Other, Tier 1 = GSI + Big Four + MBB, Tier 2 = SI + Other. Rules first (named firms, category, industry +
  headcount), then `POST account-tiers` asks Claude Sonnet (low effort, one call per 80 accounts, saved in the
  `account_tiers` setting, editable in Admin › GSI accounts). LinkedIn page part `views/parts/tiers.mjs`: tier
  summary, Tier 1 vs Tier 2 and GSI vs SI vs Big Four vs MBB region × band maps, and "What to do next"
  (`penetrationActions`: extend / rotate / open a region / reach the MD band, fixed thresholds, Track button).
- Exact designations (`views/parts/designations.mjs`, `js/lib/designations-agg.mjs`): titles exactly as LinkedIn
  exported them (top 25 per export) with cohorts, and per-company designation cohorts from HubSpot leads; the reach
  heat maps also have an "Exact designations" dimension. LinkedIn has no title × company cross-tab.
- Page parts: `views/linkedin.mjs` mounts `views/parts/<name>.mjs` into empty slots after the cube; a part that fails
  to load never breaks the page.
- Chart colours: `js/palette.mjs` (SERIES, BAND_COLORS, TIER_COLORS, BUCKET_COLORS, LEAD_TYPE_COLORS, personColor).
- Sales funnel (Leads page): reached out / replied / demo booked / demo completed / prospect from HubSpot lead
  status, lifecycle and activity properties; rules in `js/lib/leads-agg.mjs` (`funnelCounts`, `isDemoBooked`...).
- Lead types: LinkedIn lead-form leads are MQL (book a demo, BoFu), conversation ad leads (BoFu), playbook leads
  (MoFu) or other form leads / NQL (ToFu), by keyword rules in the `lead_rules` setting (`leadTypeOf`).
- Comparison: the top bar sets `ctx.state.prev`; every comparison-bearing section also has its own selector
  (`js/compare.mjs` `sectionCompare`, memoised fetches with `memoGet`), overrides reset when the top bar changes.
- Overview: channels at a glance (one row per ad platform with data), target vs today, alerts, the programme
  board (every tracked action by status: open, in progress, blocked, done in 30 days), sections, AI read-out.
- Uploads live on the channel pages (`js/uploader.mjs`); Admin holds lists and "pull now" buttons.

## Data API and MCP (read-only, keyed)
- `functions/api/ca/v1/[[path]].js` serves `GET /api/ca/v1/<source>`; `_lib/query.js` holds `SOURCES` (name, params,
  description) and `runSource(env, request, name, params)`; `v1/_openapi.js` builds the OpenAPI document from
  `SOURCES`; `functions/api/ca/mcp/[[key]].js` exposes the same sources as MCP tools (JSON-RPC 2.0 over POST,
  stateless streamable HTTP, protocol versions 2024-11-05 to 2025-11-25, key accepted in the path). Auth in
  `_lib/apikeys.js`: Pages secret `CA_API_KEYS` ("label:key, label:key"), or a dashboard session. The Function
  imports `Campaign_Analytics/js/lib/*.mjs` directly (wrangler bundles across the repo), so penetration and lead
  maths are the dashboard's. `table` is a guarded PostgREST passthrough (table whitelist, filter / select / order
  syntax checks, limit ≤ 5000). `leads/linkedin` returns the merged lead-form leads (`li-leads.js` `load`) with `from`/`to` on `submitted_at`. Add a source by appending to `SOURCES` and a `case` in `runSource`.

## Lead-form leads, screenshots (Lead analytics page)
- Lead shape (`js/lib/li-leads.mjs`, imported by `li-leads.js`, `screenshots.js` and `_lib/query.js`, so server and
  page agree): `{ submitted_at:'YYYY-MM-DD', first_name, last_name, email, company, title, seniority, country, city,
  industry, company_size, campaign, campaign_group, ad, form, lead_type, phone, linkedin_url, source, extra:{} }`,
  unknown = ''. `source` = `csv` (a file), `api` (the LinkedIn API pull), `screenshot`, or `hubspot` (HubSpot GSI
  leads converted on the page with `fromHubspot`, never stored). Custom form questions go to `extra`.
- Same lead = same email + submitted day + form, or name + company when there is no email (`leadKey`). POST keeps
  only new leads (a cumulative re-export adds nothing twice); GET counts a lead held in two documents once.
- Header mapping follows `js/csv.mjs`: "Ad Set Name" is the ad set (`campaign`) and "Campaign Name" then becomes the
  group; without an ad set column "Campaign Name" is the ad set. `parseLeadCsv` finds the header in the first 20 lines,
  `isLeadCsv` needs a person (email or names) plus company, title, form, date or campaign, and no ad metrics.
  `js/upload-detect.mjs` checks lead files after Instantly and before the ad platforms (channel `leads`).
- Join to ad spend: by normalised ad set name (lower case, punctuation and quote styles ignored) against `ca_li_perf`
  `campaign`. CPL = spend ÷ LinkedIn-reported leads (÷ leads in the files when LinkedIn reports none); completion =
  LinkedIn leads ÷ lead form opens. Ad sets with LinkedIn leads but none in the files are listed with the gap.
- Companies: `matchAccount` on the company name, then the email domain against the accounts' websites; tiers from
  `js/lib/tiers.mjs`; bands from the title with `bandWeights` (a plain Director is half MD-1, half MD-2 in the mix and
  MD-1 for a single lead). Lead type from `leadTypeOf` over campaign, campaign group + form and ad.
- Documents in `ca_insights` (`_lib/docs.js`): `leads:<uuid>` files, `leads:li-api` (written only by the LinkedIn
  API sync), `screen:<uuid>` readings, `_<name>` private. Insight scopes must not start with `leads:`, `screen:` or
  `_` (`insights.js` refuses them); the HubSpot Leads read-out uses `hs-leads:<from>:<to>` and the Lead analytics
  read-out `lead-analytics:<from>:<to>:<source>`. GET li-leads ignores `leads:` rows without a `rows` array.
- Screenshots: the browser shrinks to 1600 px on the long edge, JPEG 0.85 (`js/screenshots.mjs`), so requests stay
  well under the 5 MB limit; paste works anywhere on the page while the box is visible.

## GSI leads and messages
- Lead origin and activity: `js/lib/lead-origin.mjs` (`originOf`, `originForm/Source/Campaign/Traffic`, `groupRows`,
  `activityChecklist`, `missingWork`, `workSummary`, `timeline`, `leadFacts`) reads the props `hubspot/refresh.js`
  PROPS keeps (lead_form_type, lead_campaign_name, utm_*, first_touch_utm_*, converting campaigns,
  hs_object_source_label, last_outreach_activity, sequences, HeyReach, notes_next_activity_date, meetings tool...).
  The Leads page registers every count with `pick(label, list)` and a delegated click opens the drawer
  (`openList` → `openLead`); the data API `hubspot/leads` spreads `leadFacts` into each row and groups by
  form, lead source and campaign.
- GSI account list = `seed/accounts.json` (279 accounts: "GSI_SI Accounts – Over All" with owners and
  MD/MD-1/MD-2 titles, merged with the ABM list export's websites; sub-brands folded into parents).
- HubSpot pull (`hubspot/refresh.js`): contacts with `first_conversion_date` (submitted a form) whose company
  matches an account name/alias (CONTAINS_TOKEN) or whose `hs_email_domain` is an account website. No owner or
  "GSI"-text rules. Settings `gsi_companies` adds extra names.
- `POST hubspot/classify` (editors or cron): Claude `claude-sonnet-5` files each unread `lsa_message` once into
  one of the ten Message Intelligence categories with use case, intent, summary and a spam flag (`ai_*` columns,
  `supabase/003_message_ai.sql`). All Claude calls in the app use Sonnet 5.

## Email conventions
- Campaign name = the export file name minus `_analytics_DD_MM_YYYY, HH_MM_SS.csv`, Instantly spelling kept, so it
  matches the API campaign name. Company = email domain (Settings › Email rules › domains, then a built-in list,
  then the accounts list, then the domain name).
- Human click = a click more than `fast_click_seconds` (default 180) after the Sent of the same contact and step.
  Faster clicks are kept, shown and flagged, and left out of clicks, Book a Demo, rates and segments.
- Book a Demo = direct calendar links (book-demo, calendly, HubSpot meetings) and, when `gsi_page_counts_as_demo`,
  the GSI/SI page ("via"). Direct and via are always shown separately.
- Segments per person (highest wins): Book a Demo, other clicks, opened, sent. Opens are a weak signal.
- Trends (`js/trend.mjs`) run over the whole history, not the range: week or month buckets, comparison with the
  previous bucket or the average of all earlier ones, same-days comparison and straight-line projection for the
  bucket in progress. Used on Ads, Email and Leads.

## Claude usage
- Model: `claude-sonnet-5` for messaging clusters and action suggestions, `claude-haiku-4-5-20251001` for short
  per-card summaries. Structured output via a single forced tool call. Cached in `ca_insights` by scope +
  sha256 of the input; `force:true` regenerates.
- Every read-out receives `action_log` (the tracked actions for its channel, from `ca_actions`) and returns
  `progress` (per action: done / open / dropped and what the numbers say). Findings have a Track button.
- Prompts live in `functions/api/ca/_lib/prompts.js` and always ask for: 3 to 6 findings, each with the
  evidence numbers, a plain-language "so what", and one concrete action with an owner suggestion.

## Penetration map (Ads › Penetration map)
- View `js/views/penmap.mjs` (route `ads/penetration`, own stylesheet `css/penmap.css` loaded by the view), model
  `js/lib/penmap-agg.mjs` (pure: `buildModel`, `ipf`, `cellVal`, `cellDetail`, `kpis`, `workedSplit`, `gaps`, `antiHeat`,
  `planNumbers`, `rulePlan`, `aiInput`). It reads `GET linkedin` (whole history by default), keeps `mainWindows(activeWindows())`
  and folds per-campaign demographics rows like `aggregateRows`.
- Regions on this page are fixed to the report's six columns: India, US, UK, Middle East (Admin › Regions minus Türkiye and
  Cyprus), APAC, Europe & other. Pools come from `expandPool` rolled up by region; estimated pools are dashed.
- People = impressions ÷ `targets.reach_frequency` (default 3), penetration uncapped (SAT at 100%+). The LinkedIn page's
  penetration cube keeps the negative-binomial reach curve; the two are labelled differently on purpose.
- `POST/GET /api/ca/penmap-ai` (`functions/api/ca/penmap-ai.js`): scope `penmap:<name>`, Sonnet 5 with a forced
  `penmap_plan` tool, cached by sha256(input); `force` needs an editor. `cleanPlan` drops plan rows without a CPL or CPM
  range and strips em dashes. All plan arithmetic stays in the browser.
- `ca_insights` is also a small document store (`functions/api/ca/_lib/docs.js`): `leads:<id>`, `screen:<id>`, and private
  `_<name>` rows (LinkedIn token) that `GET insights` never serves and `POST insights` refuses, along with `leads:` and `screen:`.
