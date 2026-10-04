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
| `PHANTOMBUSTER_API_KEY` | PhantomBuster org API key, read-only daily pull of the LinkedIn outreach phantoms (`X-Phantombuster-Key`) | to set |

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
| `GET health` | | `{ ok, db, hubspot, claude, instantly, phantom, cron, user }` (booleans = env var present) |
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
- Penetration = estimated people reached ÷ ICP pool (Apollo headcount by account × country × band).
  People reached = impressions ÷ frequency (default 3.5, editable in Settings) unless a Reach column exists.
- Designation bands: MD, MD-1, MD-2 (Settings › Bands). Per-account title conventions in `seed/accounts.json`,
  generic LinkedIn title buckets in `seed/band_titles.json`. Everything else = Other.
- Regions: `seed/regions.json` (file wraps the map as `{note, regions:{Region:[countries]}}`; the settings API returns the flat map `{Region:[countries]}` and consumers accept either); unknown country = Other.
- Accounts: canonical names + LinkedIn page aliases in `seed/accounts.json`; the wider GSI/SI target list
  is `functions/api/_lib/target-companies.js`.
- Timezone IST for display, dates stored as calendar days.

## Layout and pages (Oct 2026 rebuild)
- Lyzr brand build reference: light only, General Sans (closest free match to Aeonik) + JetBrains Mono uppercase
  labels, 210px sidebar, hairline cards radius 8, black buttons, one orange button per view, navy chart data.
- Routes: `#/overview`, `#/ads/linkedin`, `#/ads/google|meta|taboola|chatgpt|x|bing` (one shared view
  `views/ads-platform.mjs`: uploads of daily exports parsed by `js/ads-csv.mjs`, stored in `ca_li_perf` with
  `platform`), `#/linkedin/phantom` (PhantomBuster outreach), `#/email/instantly`, `#/hubspot/leads`,
  `#/hubspot/messaging`, `#/hubspot/pipeline` (deals), `#/admin`. Old routes redirect.
- Penetration maps: people reached = company impressions x country share x band share / frequency; shares come
  from the Country / Job Title exports or, when missing, the `mix_defaults` setting (built-in Apr-Aug 2026 mix).
  Pools = Apollo `icp_pool` + ratio-derived rows (`expandPool`) + Claude `icp_estimates`; estimated cells are dashed.
- Sales funnel (Leads page): reached out / replied / demo booked / demo completed / prospect from HubSpot lead
  status, lifecycle and activity properties; rules in `js/lib/leads-agg.mjs` (`funnelCounts`, `isDemoBooked`...).
- Lead types: LinkedIn lead-form leads are MQL (book a demo, BoFu), conversation ad leads (BoFu), playbook leads
  (MoFu) or other form leads / NQL (ToFu), by keyword rules in the `lead_rules` setting (`leadTypeOf`).
- Comparison: the top bar sets `ctx.state.prev`; every comparison-bearing section also has its own selector
  (`js/compare.mjs` `sectionCompare`, memoised fetches with `memoGet`), overrides reset when the top bar changes.
- Overview: channels at a glance (one row per ad platform with data), target vs today, alerts, the programme
  board (every tracked action by status: open, in progress, blocked, done in 30 days), sections, AI read-out.
- Uploads live on the channel pages (`js/uploader.mjs`); Admin holds lists and "pull now" buttons.

## GSI leads and messages
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
