# Lyzr Prototypes — External Showcase Dashboard

A **public, shareable** dashboard displaying Lyzr AI prototypes for external partners. It reads from the same `data.json` used by the internal Pipeline tracker — one source of truth, two interfaces.

## What this is

- **External-facing only** — no auth wall, designed to be shared with clients and agencies
- Shows only rows that have a `prototype_link` set
- Grouped by **company**, sub-grouped by **category**
- Each card shows: use case description + live demo link button
- Search + company filter tabs

## Structure

```
prototypes/
├── index.html          # Main dashboard UI
├── styles.css          # Dark glassmorphism theme
├── vercel.json         # Vercel deployment config
├── api/
│   └── data.js         # Vercel serverless function (reads GitHub)
└── functions/
    └── api/
        └── data.js     # Cloudflare Pages function (alternative host)
```

## Deployment (Vercel)

1. Push this folder to the same GitHub repo (`kailcodes02-gif/lyzr`)
2. Create a **new Vercel project** pointing to `prototypes/` as the root directory
3. Set these environment variables in the Vercel project settings:

| Variable | Value |
|---|---|
| `GITHUB_OWNER` | `kailcodes02-gif` |
| `GITHUB_REPO` | `lyzr` |
| `GITHUB_TOKEN` | _(same PAT used by the pipeline)_ |
| `GITHUB_PATH` | `pipeline/data.json` |

That's it. The dashboard will always reflect the latest committed `data.json`.

## Data flow

```
Pipeline dashboard (Vercel/CF)
  → adds row via POST /api/rows
    → commits to GitHub (pipeline/data.json)
      → Prototypes dashboard reads via GET /api/data
        → shows live data
```

## How entries show up here

A row from `data.json` appears in the Prototypes dashboard **only if** it has a non-empty `prototype_link`. All other fields are optional — the card gracefully degrades if `use_case` is missing.
