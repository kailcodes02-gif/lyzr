# Sample LinkedIn exports

Drop sample files from LinkedIn Campaign Manager in this folder so the parser (`js/csv.mjs`) can be checked against the real format. Nothing in this folder is read by the app at runtime; uploads happen in Settings > Uploads.

Files here may contain account data. Do not commit real exports unless the folder is covered by `.gitignore`; use the synthetic strings in `tests/frontend/csv.test.mjs` for anything that goes into git.

## What to export (upload whenever you like, many files at once)

### 1. Ad performance (daily, ad level)
Campaign Manager > select the account > **Ads** tab (the ad level, not campaigns or campaign groups) > **Export** (top right).

- Report: Ad performance
- Time range: the two weeks since the last upload (overlaps are fine, the app de-duplicates by upload window only, so avoid uploading the same days twice)
- **Time breakdown: Daily**. Without this the file has no date column and the trend and range filters cannot work.
- Columns: all. The parser needs at least Start Date (in UTC), Campaign Group Name, Campaign Name, Ad ID or Creative ID, Ad Name (or Creative Name / Ad Headline / Introductory Text), Impressions, Clicks, Total Spent. Reach, Leads, Lead Form Opens, Video Views, Sends, Opens, Total Engagements, Reactions, Comments, Shares, Follows, Viral Impressions and Conversions are used when present. Any other numeric column is kept under `extra`.
- File name suggestion: `ads_performance_YYYY-MM-DD_YYYY-MM-DD.csv`

### 2. Demographics (all segments)
Campaign Manager > **Demographics** (left nav, or the Demographics tab on the campaign group) > set the same two-week time range > **Export**.

- Segments: all of Company, Job Seniority, Job Title, Job Function, Country, Location (Region), Company Size, Industry. If Campaign Manager exports one file per segment, upload them all; each file is detected from its first column (Company, Job Title and so on).
- The export has no per-day rows. The parser reads the window from the "Report period" or "Date range" line in the file header. If it is missing, type the window in the upload preview before uploading.
- Demographics are aggregates over the export window, so a person can be counted in more than one window. The app states which windows are included in every heat map.
- File name suggestion: `demographics_YYYY-MM-DD_YYYY-MM-DD.csv`

## Format details the parser handles
- A preamble before the real header (report title, account, report period, time zone, blank line). The header is the first row that contains "Impressions" (or "Sends").
- Comma, tab or semicolon delimiters; quoted values with commas inside; UTF-8 or UTF-16 (LinkedIn often exports UTF-16 with a byte order mark).
- Numbers with `$`, `,`, `%` and quotes. Blank cells are 0.
- Dates as `M/D/YYYY`, `YYYY-MM-DD`, `Jul 3, 2026` or `Jul 3 2026`.
- A trailing "Total" row is ignored.

## Checking a new sample
```
cd Campaign_Analytics
node --test tests/frontend/*.test.mjs
node --input-type=module -e "import {parseLinkedInCsv, decodeCsvBuffer} from './js/csv.mjs'; import fs from 'node:fs'; const r = parseLinkedInCsv(decodeCsvBuffer(fs.readFileSync('samples/YOUR_FILE.csv')), 'YOUR_FILE.csv'); console.log(r.kind, r.period_start, r.period_end, r.rows.length, r.columns, r.warnings);"
```
If a column is not mapped, add its header to the synonym lists at the top of `js/csv.mjs` and add a test.
