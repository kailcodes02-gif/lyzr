# Google Sheets Live Data Sync: Setup + Design

> **Purpose.** Design and setup doc for graduating the pipeline dashboard from the
> manual `tracker.xlsx -> generate_data.py -> data.json` flow to a **live Google
> Sheets mirror** that regenerates `pipeline/data.json` on a schedule. This is
> "Section D / Live data sync" from the deferred-upgrades list in
> `pipeline/README.md`.
>
> **Scope of THIS doc.** The setup steps, the two architecture options, the exact
> column-to-field contract, the env vars, and the run model. **The actual sync code
> (`functions/api/sync-sheet.js` or equivalent) is owned by the pipeline agent and
> will be added separately.** This doc is the contract that code must satisfy.
>
> **Convention.** No em dashes anywhere (Lyzr style).

| | |
|---|---|
| **Target file** | `pipeline/data.json` (read by `/pipeline/` and `/demo_pipeline/`) |
| **Current source** | local `tracker.xlsx` run through `generate_data.py` (build-time, not in repo) |
| **Goal** | a Google Sheet becomes the source of truth; sync regenerates `data.json` |
| **Chosen approach** | **Option B: Sheets API + service account** (team decision; the sheet stays private). Implemented and ready, pending secrets. See section 6. |

---

## 1. The two options

### Option A: Published-CSV (recommended for v1)

The sheet owner uses **File > Share > Publish to web**, picks the relevant tab, and
chooses **Comma-separated values (.csv)**. Google returns a stable public URL that
serves the live CSV with no authentication. A sync job fetches that URL, parses the
CSV, normalises rows, and writes `pipeline/data.json`.

**Pros:** no service account, no API keys, no OAuth, no Google Cloud project. The
sync code is a single `fetch()` plus a CSV parse. Lowest moving parts.

**Cons:** the published CSV is **publicly readable by anyone with the URL** (the URL
is unguessable but not secret). Acceptable because the pipeline data is already
non-confidential internal data served as a static `data.json`. If the data ever
becomes confidential, move to Option B and gate everything behind Cloudflare Access
(see `docs/cloudflare-access-setup.md`).

> **Not chosen.** Option A was the original v1 suggestion, but the team chose
> Option B (below) so the sheet stays private. Option A stays documented as a
> fallback if credential handling ever needs to be dropped.

### Option B: Google Sheets API + service account (more robust)

Create a Google Cloud project, enable the **Google Sheets API**, create a **service
account**, download its JSON key, and **share the sheet with the service account's
email** (read-only). The sync job authenticates as the service account and reads
the sheet via the Sheets API (`spreadsheets.values.get`).

**Pros:** the sheet stays private (not published to the web). Cleaner permissions,
revocable per service account. Handles larger/structured ranges well.

**Cons:** needs a Google Cloud project, a service account, a downloaded key stored
as a secret, and the sheet explicitly shared with the service account. More setup
and more secret handling.

**CHOSEN.** This is the approach the team picked, because the sheet must stay
private. It is implemented and ready (section 6), pending the secrets.

---

## 2. Exact column-to-field mapping (the contract)

The sync must produce rows that match the existing `pipeline/data.json` row schema.
Confirmed against the live `data.json` (346 rows). The sheet must have a header row;
map each **sheet column header** to the **data.json field** as follows.

| Sheet column (header) | data.json field | Type / normalisation rule |
|---|---|---|
| Segment | `segment` | One of: `Internal`, `Accenture`, `GSI-SI`, `Enterprises` (exact strings; these drive the segment tabs and the id prefix) |
| Company | `company` | String. `"a"` -> blank |
| Industry | `industry` | String. `"a"` -> blank |
| Project | `project` | String. `"a"` -> blank |
| Use Case | `use_case` | String. `"a"` -> blank |
| Category | `category` | String. `"a"` -> blank |
| Stage | `stage` | One of: `Demo`, `in-conversation`, `win`, `customer`, `lost` (lowercase except `Demo`; normalise variants to these) |
| Owners | `prototype_owners` + `opportunity_owners` | Split on `,` and `/` into discrete people; canonicalise names (e.g. `Bharath` -> `Bharath Bhat`, `Joel/Mark` -> `Joel Kandy`, `Mark Leibowitz`). See note below on one-owner-column vs two |
| Prototype Link | `prototype_link` + `prototype_link_text` | Only treat as clickable if a valid URL. `prototype_link_text` auto-syncs from the link |
| ACV | `acv` + `acv_raw` | Parse `"$500,000"` -> numeric `500000` into `acv`; preserve the raw string in `acv_raw`. Blank -> `null` |
| Time Period | `time_period` | String or `null` |
| Close Date | `close_date_raw` + `close_quarter` | Preserve raw text in `close_date_raw`; derive `close_quarter` where parseable, else `null` |

**Fields the sync GENERATES (not from the sheet):**

| Field | How it is produced |
|---|---|
| `id` | Segment prefix + 4-digit sequence: `INT-`/`ACC-`/`GSI-`/`ENT-` (Internal/Accenture/GSI-SI/Enterprises). Keep stable across syncs where possible (key on a stable sheet column if one exists, else regenerate deterministically by segment order) |
| `sn` | Global sequential number across all rows |
| `created_by`, `created_at` | Set on first appearance; preserve across syncs if the row already exists |
| `edit_history` | Preserve existing history from the current `data.json`; do not wipe it on a sync. Capped at last 3 edits (existing behavior) |

**Top-level objects the sync must (re)build, matching the current file:**

- `generated_at`: ISO timestamp of the sync run.
- `source_file`: set to a sheet identifier (e.g. the sheet name or `google-sheet`).
- `rows`: the array above.
- `aggregates`: **recompute** from rows (total ACV, by_segment counts, leaderboard,
  top companies). Never hardcode; the dashboard expects these recomputed.
- `facets`: `{ segments, stages, categories, industries }` derived from the rows.
  Current values: `segments` = `[Accenture, Enterprises, GSI-SI, Internal]`,
  `stages` = `[Demo, in-conversation, win, customer, lost]`.

> **Owners column shape (flag to confirm).** The current `data.json` has TWO owner
> arrays: `prototype_owners` and `opportunity_owners`. The mapping above assumes the
> sheet may have a single "Owners" column or two separate columns. **Confirm with
> the user which the sheet uses.** If one column, the sync must decide how to split
> into the two arrays (e.g. all into `opportunity_owners`, or a convention).
> Recommended: have two sheet columns, `Prototype Owners` and `Opportunity Owners`,
> to map cleanly. This is the single most important thing to pin down with the user.

> The normalisation rules above are the **same** ones `generate_data.py` already
> implements (see `pipeline/README.md`): `"a"` -> blank, owner split on `,`/`/`,
> name canonicalisation, ACV string -> number, close-date raw preserved + derived
> quarter, prototype-link URL validation. The Sheets sync should reuse that exact
> logic so output is byte-comparable to the xlsx path.

---

## 3. Env vars / secrets needed

These belong wherever the sync runs (Cloudflare Pages secrets or GitHub Actions
secrets), **never** committed to the repo (`.env*` is gitignored).

**Option A (Published CSV):**

| Var | Value | Notes |
|---|---|---|
| `SHEET_CSV_URL` | the published-to-web CSV URL | The only required input. From File > Share > Publish to web |
| `GITHUB_TOKEN` (reuse) | existing PAT | Only if the sync commits `data.json` back to GitHub itself (same PAT the write API already uses) |

**Option B (Sheets API + service account):**

| Var | Value | Notes |
|---|---|---|
| `SHEET_ID` | the spreadsheet ID (from its URL) | |
| `SHEET_RANGE` | e.g. `Pipeline!A1:L` | The tab + range to read |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the service account key JSON | Stored as a secret; the sheet must be shared with this account's email |
| `GITHUB_TOKEN` (reuse) | existing PAT | If the sync commits `data.json` back |

If the sync runs as a Pages Function and writes `data.json` via the GitHub Contents
API (same mechanism as `functions/api/rows.js`), it also needs the existing
`GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_PATH` / `GITHUB_BRANCH` values, which the
deploy workflow already sets on the Pages project (see `.github/workflows/deploy.yml`).

---

## 4. How the sync runs (two run models)

The sync needs a trigger and a place to run. Pick one.

### Model 1: Cloudflare Cron Trigger -> sync function (preferred if it stays in Pages)

> Note: Pages Functions do not natively support cron. Cron Triggers belong to a
> Cloudflare **Worker**. Two ways to do this:
> - (a) Add a small scheduled Worker (separate from Pages) whose `scheduled()`
>   handler does the fetch + normalise + commit. The repo already has a Worker
>   project under `cloudflare/` (`wos-auth`) as precedent for a sibling Worker.
> - (b) Keep the logic in a Pages Function `functions/api/sync-sheet.js` exposed as
>   an HTTP endpoint, and trigger it on a schedule from an external cron (a tiny
>   scheduled Worker, or GitHub Actions `schedule`, hitting the endpoint).

Flow:
1. Cron fires (e.g. hourly, or daily at a set IST time).
2. Handler fetches `SHEET_CSV_URL` (Option A) or reads via Sheets API (Option B).
3. Parses + normalises per section 2.
4. Loads the current `pipeline/data.json` (to preserve `id`, `created_*`,
   `edit_history`), merges, recomputes `aggregates` + `facets`.
5. Commits the new `data.json` back to GitHub via the Contents API (reusing the
   existing PAT + `GITHUB_*` config). The push triggers the normal Pages redeploy,
   and the dashboard reflects it within ~30s (`data.json` cached 60s by
   `pipeline/_headers`).

### Model 2: GitHub Action on a schedule (simplest to reason about)

A scheduled workflow (`on: schedule: cron`) that:
1. Checks out the repo.
2. Runs a script (Node or Python) that fetches the CSV / Sheet, normalises,
   regenerates `pipeline/data.json` (ideally by reusing `generate_data.py` adapted
   to read CSV instead of xlsx).
3. Commits `pipeline/data.json` if it changed and pushes to `main`.
4. The push triggers the existing `deploy.yml` -> Cloudflare redeploy.

**Recommendation:** Model 2 (GitHub Action) is the simplest and most transparent
(every sync is a visible commit + diff, easy to audit and revert), and it can reuse
`generate_data.py`. Use Model 1 only if you specifically want edge-side scheduling.

> **Interaction with the live write API.** The pipeline dashboard ALSO writes
> `data.json` directly (the `data: add` / `data: edit` self-commits). If the Sheets
> sync overwrites `data.json` wholesale, it can clobber edits made in the dashboard
> since the last sync, and vice versa. Decide the source-of-truth direction with the
> user and the pipeline agent:
> - **Sheet is source of truth:** the sync overwrites; the dashboard becomes
>   read-mostly (or its edits must be pushed back into the sheet). Simplest.
> - **Two-way:** out of scope for v1; needs conflict handling. Do not attempt yet.
> Recommendation: declare the **sheet the source of truth** for the synced columns,
> and have the sync preserve `edit_history` / `created_*` so dashboard-side metadata
> survives.

> **Interaction with Cloudflare Access.** If `/api/*` is gated by Access and the
> sync writes via a Pages Function endpoint, the sync caller needs a Cloudflare
> Access **service token** (see `docs/cloudflare-access-setup.md` section 6). If the
> sync instead commits straight to GitHub (Model 2, or Model 1 going direct to the
> Contents API), it bypasses `/api/*` entirely and no service token is needed.

---

## 5. What input is needed from the user

To build and turn on the sync, the user must provide:

- [ ] **The Google Sheet URL** (and which **tab/range** holds the pipeline rows).
- [ ] **Which option:** A (Published CSV, recommended) or B (Sheets API + service
      account).
- [ ] If Option A: perform **File > Share > Publish to web > [tab] > CSV** and hand
      over the resulting `SHEET_CSV_URL`.
- [ ] If Option B: create the service account, share the sheet with its email
      (read-only), and provide `SHEET_ID`, `SHEET_RANGE`, and the service account
      key JSON.
- [ ] **The owners column shape:** single `Owners` column, or two columns
      (`Prototype Owners` + `Opportunity Owners`)? Two is strongly recommended so it
      maps cleanly to the two arrays in `data.json` (section 2 note).
- [ ] **Source-of-truth direction:** confirm the sheet is the source of truth and the
      dashboard becomes read-mostly for synced columns (section 4 note).
- [ ] **Run model + cadence:** GitHub Action (recommended) vs Cloudflare cron, and how
      often to sync (hourly / daily / on demand).

For the **chosen Option B**, what is still needed from the user is only:

- [ ] **`GOOGLE_SHEET_ID`** (the long id in the sheet URL) and the **tab/range**
      (`SHEET_RANGE`, e.g. `Pipeline!A1:L`).
- [ ] A **Google Cloud service account** with the **Sheets API** enabled, its key
      JSON, and the **sheet shared (read-only) with the service account email**.
- [ ] Confirm the **owners column shape** (two columns recommended: `Prototype
      Owners` + `Opportunity Owners`) and that the **sheet is the source of truth**.

---

## 6. Implementation (Option B, ready, pending secrets)

The Option B sync is built and syntax-verified. It reuses the verified
`pipeline/generate_data.py` normaliser, so sheet output is identical to the xlsx
path. It runs as a **manual GitHub Action** (cron commented out, so it never runs
unattended until secrets exist and a manual run succeeds).

| File | Purpose |
|---|---|
| `scripts/sheet-sync/sync_from_sheets.py` | Authenticates with the service account, reads the sheet via the Sheets API, writes a temp xlsx, runs `generate_data.py`, then merges `created_by` / `created_at` / `edit_history` from the previous `data.json` (matched by segment+company+project) so dashboard metadata survives. |
| `scripts/sheet-sync/requirements.txt` | `google-api-python-client`, `google-auth`, `openpyxl`. |
| `.github/workflows/sheet-sync.yml` | `workflow_dispatch` only (schedule commented). Installs deps, runs the script, commits `pipeline/data.json` if it changed. The push triggers the normal `deploy.yml` redeploy. |

**To activate:**
1. Add repo secrets `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEET_ID` (and
   optionally repo variable `SHEET_RANGE`) under Settings > Secrets and variables > Actions.
2. Run the workflow manually (Actions > "Sync pipeline from Google Sheet" > Run).
3. Once a manual run is clean, uncomment the `schedule:` block in the workflow to
   automate it.

**Source-of-truth note (unchanged):** the sheet is the source of truth for synced
columns; the dashboard's own `data: edit` self-commits to the same columns will be
overwritten on the next sync. `created_*` and `edit_history` are preserved. A true
two-way sync is out of scope for v1.
