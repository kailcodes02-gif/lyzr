# Weekly GSI Report Runbook

> **Purpose.** End-to-end cadence for producing a weekly GSI / Partner Marketing
> report: where reports live, the `weeks.json` registry contract, how the reports
> index consumes it, the exact steps to add a new week, the report HTML section
> structure, and the current template-hygiene status.
>
> **Convention.** No em dashes anywhere (Lyzr style).

| | |
|---|---|
| **Reports live in** | `reports/` (repo root) |
| **Registry** | `data/weeks.json` |
| **Public index** | `reports/index.html` (reads `weeks.json`) |
| **Latest report** | Week 6, `reports/gsi-report-may25-31.html` (May 25 to May 31) |
| **Today** | 2026-06-01. Week 7 (June 1 to June 7) is not over yet, so **no new report is due** |

> **Do not fabricate a report.** As of 2026-06-01 the current week (June 1 to 7) is
> still in progress. A new report is produced only after a week completes. Do not
> create a week-7 report now.

---

## 1. Where reports live

All reports sit under `reports/` at the repo root and deploy as static files to
Cloudflare Pages (every push to `main` redeploys the whole repo). Each report is a
single self-contained HTML file (inline CSS, inline data, minimal JS for charts and
animation only). No build step.

Current contents of `reports/`:

- `gsi-report-apr22-30.html`, `gsi-report-may10-17.html`, `gsi-report-may25-31.html`:
  flat report files at `reports/` root.
- `week_April_18to22/`, `week_April_22to29/`, `week_May_4to10/`,
  `week_May_17to24/`: older subdirectory-style reports (each holds an `index.html`
  or a nested report file).
- `index.html`: the dynamic reports index (section 3).
- `week-template/`: the reference template (`Week 18-22.html`) + a loading
  placeholder `index.html` (section 5).

---

## 2. The `weeks.json` registry contract

`data/weeks.json` is the single source of truth for which reports exist and where
they live. Both `reports/index.html` and `tasks/index.html` read it.

Shape:

```jsonc
{
  "current_week": 6,            // the latest week number
  "start_date": "2026-04-18",   // week-1 start
  "timezone": "Asia/Kolkata",
  "weeks": [                     // ordered oldest -> newest
    {
      "number": 6,
      "date_range": "May 25 to May 31",
      "path": "gsi-report-may25-31.html",   // see path styles below
      "status": "complete",                  // "complete" | anything else -> "In Progress"
      "meetings_processed": 0
    }
    // ...
  ],
  "last_updated": "2026-06-01"
}
```

### The three inconsistent path styles (and which to standardize on)

`path` is currently written three different ways across the six weeks, which is why
`KNOWLEDGE_BASE.md` warns to always check `weeks.json` for the real path:

| Style | Example | Weeks using it |
|---|---|---|
| Subdirectory (no filename) | `week_April_18to22` | 1, 2, 3 |
| Flat file at `reports/` root | `gsi-report-may25-31.html` | 4, 6 |
| Nested file in a subdirectory | `week_May_17to24/gsi-report-may17-24.html` | 5 |

`reports/index.html` handles all three (section 3), so nothing is broken today.

**Standardize going forward on the flat style: `gsi-report-<range>.html` at the
`reports/` root** (e.g. `gsi-report-jun01-07.html`). Reasons: one file per week, no
nested `index.html` to maintain, the path in `weeks.json` ends in `.html` so the
index links to it directly, and it matches weeks 4 and 6 (the most recent). Do not
retroactively move the old subdirectory reports (their URLs may be linked
externally); just use the flat style for every new week.

Range-string convention for the filename: `gsi-report-<startMon><dd>-<dd>.html` when
the week is within one month (e.g. `gsi-report-may25-31.html`), or
`gsi-report-<startMon><dd>-<endMon><dd>.html` across a month boundary (e.g.
`gsi-report-may25-jun02.html`). Lowercase month abbreviations.

---

## 3. How `reports/index.html` consumes `weeks.json`

On load, the index `fetch`es `/data/weeks.json?t=<timestamp>` (cache-busted),
reverses the `weeks` array (newest first), and renders one card per week. Card
linking logic (in the inline script):

```js
if (week.path && week.path.endsWith('.html')) {
  card.href = '/reports/' + week.path;          // flat or nested file
} else {
  card.href = week.path
    ? '/reports/' + week.path + '/'             // subdirectory -> append slash
    : '/reports/week-' + week.number + '/';     // fallback
}
```

So: a `path` ending in `.html` links directly; any other non-empty `path` is treated
as a directory and gets a trailing slash; an empty `path` falls back to
`/reports/week-<n>/`. The flat style (recommended) hits the first branch cleanly.

The index also has a `<noscript>` static fallback and a visually-hidden AI-scraper
summary block, both of which list the weeks for no-JS and crawler access. **These two
blocks are hand-maintained and must be updated when you add a week** (section 4 step
5), because they do not read `weeks.json`.

> Note: `reports/index.html` is the only reports file you should edit for this flow.
> The individual report HTML files are self-contained and do not read `weeks.json`.

---

## 4. Steps to add a new week (after the week completes)

Do this only once the week is over. Example assumes adding week 7, June 1 to 7.

1. **Copy the latest report as the base.**
   `cp reports/gsi-report-may25-31.html reports/gsi-report-jun01-07.html`
   The latest report carries the current format (KPI widget, charts, all channel
   blocks), so copying it is the fastest way to keep the format current. Do NOT copy
   from `week-template/` (it is stale; see section 5).

2. **Fill in the new week's data** in the copied file:
   - Update `<title>` (e.g. `GSI Marketing Report -- 1-7 June 2026`).
   - Update the topbar `.report-sub` date line and every `week-badge` / `week-title`
     / `week-dates` label (Previous / Current / Pipeline / Overview headers).
   - Replace the inline deal dataset in `<script id="wd" type="application/json">`
     with the current week's rows (this is what the KPI widget and all the charts
     read; see section 6). Keep the field keys: `p, o, s, ss, m, tr, q, a`.
   - Update each `channel-block` (LinkedIn, Email, Co-Marketing, Ads, Events,
     Automation, Social, Content, etc.): the `metrics-grid` numbers, `mini-table`
     rows, `insight-box` callouts, and any `iframe-wrap` embed URLs.

3. **Add the `weeks.json` entry.** Append to `weeks[]`:
   ```jsonc
   {
     "number": 7,
     "date_range": "June 1 to June 7",
     "path": "gsi-report-jun01-07.html",
     "status": "complete",
     "meetings_processed": 0
   }
   ```

4. **Bump the registry header:** set `"current_week": 7` and
   `"last_updated": "<today ISO date>"`.

5. **Update the index fallbacks** in `reports/index.html`: add the new week to the
   `<noscript>` card list AND to the visually-hidden AI-scraper summary block (both
   newest-first). The dynamic JS card list updates itself from `weeks.json`, but
   these two static blocks do not.

6. **Push to `main`.** Cloudflare redeploys (~30s); `/reports/` shows the new card
   automatically (the dynamic path reads `weeks.json`).

> The KNOWLEDGE_BASE.md maintenance rule also applies: add a dated entry to its Build
> Log on the same push.

---

## 5. Template hygiene: `reports/week-template/` is STALE

I compared `reports/week-template/Week 18-22.html` against the current latest report
`reports/gsi-report-may25-31.html`. They share the same core design system (CSS
variables, `topbar`, `week-header` + `week-badge`, `channel-block` + `channel-head`,
`metrics-grid`, `insight-box`, `mini-table`, `iframe-wrap`), so the template is not
wrong, but it is **missing the report's headline feature** and has minor drift.

### Gaps found

| Aspect | Template (`Week 18-22.html`) | Latest report (`gsi-report-may25-31.html`) |
|---|---|---|
| **KPI + charts widget (`gsi-w`)** | **ABSENT** (0 occurrences) | **Present** (the `gsi-w` / `whead` / `wkpis` / `wkpi` block, ~69 refs). This is the interactive widget with 6 KPI tiles (Total, Ongoing, Demos, Wins, Losses, Customers) and a tabbed SVG chart (Timeline / Companies / Motion / Stage mix / Sub-stage / ACV) driven by an inline `<script id="wd" type="application/json">` dataset and a self-contained chart script |
| **Title style** | `Marketing Report -- 15-22 April 2026` | `GSI Marketing Report -- 25-31 May 2026` (the "GSI" prefix is now standard) |
| **Font import** | DM Sans `300;400;500;600`, Playfair `0,300;0,400;0,600` | DM Sans with the `opsz` optical-size axis (`9..40`), Playfair with extra `0,500` and italic weights. The newer report uses the richer axis |
| **Channel icon classes** | has `ch-accounts`; lacks `ch-meta`, `ch-content` | has `ch-meta`, `ch-content`, `ch-social` etc.; no `ch-accounts` |
| **Channel-block count** | 10 | 12 |

### Recommendation

**Do not rewrite the whole template now.** Two acceptable paths:

- **Preferred (zero-maintenance):** retire the `week-template/` reference report as
  the starting point and make the documented base **"copy the latest completed
  report"** (section 4 step 1). The latest report always carries the current format,
  so a separate template inevitably drifts (as it has). Keep `week-template/index.html`
  (the loading placeholder) since it is a different, still-valid artifact.
- **If a standalone template is still wanted:** refresh it by copying the latest
  report into `week-template/` and blanking the data (replace the `wd` dataset with a
  small placeholder array, zero out `metrics-grid` numbers, empty the `mini-table`
  rows). That is a non-trivial rewrite; do it deliberately, not as a side effect.

Until then, treat `week-template/Week 18-22.html` as a historical reference only, and
use the latest report as the base for new weeks.

---

## 6. Report HTML section structure (current format)

Top to bottom, as in `gsi-report-may25-31.html`:

1. **`<head>`**: `<title>`, Google Fonts (Playfair Display + DM Sans), one large
   inline `<style>` with the full design system (`:root` CSS variables, dark theme
   `--bg #0c0a08` / `--text #f0ebe4`).
2. **`.topbar`** (sticky): `.logo-mark`, `.report-title` + `.report-sub` date,
   `.topbar-nav` anchor pills that jump to the in-page section ids
   (`#overview`, `#past`, `#current`, `#pipeline`).
3. **Overview header** (`#overview .week-header` with `week-badge overview`).
4. **`.gsi-w` widget**: `.whead` (title + filter pills `.wfilt` + chart tabs
   `.wtab`) and `.wkpis` (six `.wkpi` tiles with ids `k-total`, `k-ongoing`,
   `k-demos`, `k-wins`, `k-losses`, `k-customers`), plus an SVG chart canvas
   (`#wchart`), legend (`#wlegend`), tooltip (`#wtip`), footer (`#wfoot`).
   - **Data source:** an inline `<script id="wd" type="application/json">` array of
     deal objects (`p` partner, `o` opportunity, `s` stage, `ss` sub-stage,
     `m` motion, `tr` track, `q` quarter, `a` ACV). The following `<script>` parses
     it and renders the KPIs + the six chart tabs entirely client-side. **The report
     does NOT fetch `/pipeline/data.json`; its data is embedded.** That is why each
     week's `wd` block must be refreshed by hand (section 4 step 2).
5. **Week section headers** (`#past`, `#current`, `#pipeline`): each a
   `.week-header` with a `.week-badge` (`past` / `current` / `pipeline`),
   `.week-title`, `.week-dates`.
6. **`.channel-block`** per channel: `.channel-head` (an `.channel-icon` with a
   `ch-*` class, e.g. `ch-linkedin`, `ch-email`, `ch-co-mkt`, `ch-ads`, `ch-events`,
   `ch-auto`, `ch-meta`, `ch-social`, `ch-content`) + channel name + status `.badge`,
   then a body with `.metrics-grid` (stat tiles), `.insight-box` callouts
   (`rose` / `blue` / `amber` / `green` variants), `.mini-table` data tables, and
   `.iframe-wrap` embeds.
7. **Animation/chart scripts** at the end (the `gsi-w` chart script, plus small
   intersection-observer fade-ins). No external data fetches.

---

## 7. Quick reference: files touched when adding a week

- `reports/gsi-report-<range>.html` (new, copied from latest)
- `data/weeks.json` (append week, bump `current_week` + `last_updated`)
- `reports/index.html` (update `<noscript>` + AI-scraper static blocks)
- `KNOWLEDGE_BASE.md` (dated Build Log entry, per its maintenance rule)
