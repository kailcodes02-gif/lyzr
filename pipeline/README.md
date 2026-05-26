# Lyzr Pipeline · Use Case Tracker Dashboard

Internal pipeline dashboard. Static site, no build step. Reads from
`data.json` (regenerated from the consolidated xlsx tracker).

```
lyzr.kailash-gm.com/pipeline/
└── Home
    ├── Internal      (9 deals)
    ├── Accenture     (96 deals)
    ├── GSI/SI        (68 deals)
    └── Enterprises   (172 deals)
```

---

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The whole dashboard. Inline app CSS and JS. |
| `styles.css` | Precompiled Tailwind. **Do not edit by hand** — regenerate with `rebuild-styles.sh` if you change classes in the HTML. |
| `data.json` | The clean, normalised pipeline data the dashboard reads. |
| `generate_data.py` | Regenerates `data.json` from the source xlsx tracker. |
| `tracker.xlsx` | Source of truth (working copy — replace when the tracker updates). |
| `tailwind.config.js` | Tailwind config (colors, fonts). Used only by the rebuild script. |
| `tailwind.input.css` | Tailwind input file (just the three `@tailwind` directives). |
| `rebuild-styles.sh` | Run this if you've added new Tailwind utility classes to the HTML. |
| `_headers` | Cloudflare Pages security headers + cache rules. |
| `.gitignore` | Excludes `node_modules/` from the repo. |
| `README.md` | This file. |

> **Why precompiled Tailwind instead of CDN?** The Play CDN (`cdn.tailwindcss.com`) compiles classes at runtime in the browser. If it ever 503s, rate-limits, or blocks the user's network, the dashboard renders unstyled. Shipping a precompiled `styles.css` removes that single point of failure entirely. Alpine.js and Chart.js are still on CDN, but a brief outage there only disables interactivity — the dashboard still loads.

---

## Updating the data

When the consolidated tracker changes:

```bash
# 1. Drop the new xlsx into this folder, named tracker.xlsx
# 2. Regenerate
python3 generate_data.py tracker.xlsx data.json

# 3. Commit + push
git add data.json tracker.xlsx
git commit -m "Refresh pipeline data"
git push
```

Cloudflare Pages auto-deploys on push (typically ~30 seconds).

The generator handles all normalisation:
- `"a"` in any field → blank in the dashboard
- Owner cells split on `,` and `/` into discrete people
- `Bharath` → canonicalised to `Bharath Bhat`
- `Joel/Mark` → split into `Joel Kandy` and `Mark Leibowitz`
- ACV strings (`"$500,000"`) → numeric for sorting and aggregation
- Deal Close Date — raw text preserved, derived `close_quarter` where parseable
- Prototype Link — only marked clickable if it's a valid URL

Run `python3 generate_data.py --help` for options. You'll see a one-line summary
on success: row count, total ACV, unique companies, owner-leaderboard size.

---

## Updating the styles (rare)

You only need to do this if you've **added new Tailwind utility classes** to
`index.html` that weren't in the file before. Otherwise the existing
`styles.css` already contains every class the dashboard needs.

```bash
./rebuild-styles.sh
```

The script installs `tailwindcss` to a local `node_modules/` (one-time, ~30s
the first time, instant after that), then compiles `styles.css`. Commit the
updated `styles.css` and push — that's what actually deploys to the dashboard.

`node_modules/` is gitignored, so it never bloats the repo.

---

## Deploying to lyzr.kailash-gm.com/pipeline

This rides on the existing `kailcodes02-gif/lyzr` repo that already serves the
Work OS at `lyzr.kailash-gm.com`. No new Pages project, no new DNS — just a
new subfolder.

### One-time setup

1. **Add a `pipeline/` folder to the existing repo** at the repo root.
   Copy these files into it (NOT into the repo root):
   - `index.html`
   - `styles.css`
   - `data.json`

   These are the only three files Cloudflare Pages needs to serve the
   dashboard. Everything else (`generate_data.py`, `tracker.xlsx`,
   `tailwind.config.js`, `rebuild-styles.sh`, `tailwind.input.css`) are
   build/source files — keep them somewhere local or in a separate
   `pipeline-build/` folder, but don't push them to the deployed repo.

2. **The `_headers` file** at the repo root already exists for the Work OS.
   Append the rules from this project's `_headers` file to the existing one
   (paths are scoped, so they won't conflict with the root site).

3. **Push to GitHub**:
   ```bash
   git add pipeline/
   git commit -m "Add pipeline dashboard"
   git push
   ```

4. **Cloudflare Pages auto-deploys** in ~30 seconds. The dashboard is
   live at `https://lyzr.kailash-gm.com/pipeline/`.

No DNS work, no new Pages project, no Cloudflare admin needed beyond what's
already set up for the Work OS.

### Refreshing data later

```bash
# In your local working copy:
python3 generate_data.py tracker.xlsx pipeline/data.json
git add pipeline/data.json
git commit -m "Refresh pipeline data"
git push
```

Live in 30 seconds.

### One gotcha — relative paths

The dashboard uses relative paths (`styles.css`, `data.json`) which resolve
correctly under `/pipeline/` because they sit in the same folder. **Don't**
move them to a different subfolder unless you also update the references
in `index.html`.

---

## Google OAuth — what was set up

The auth gate uses Google Identity Services. The Client ID is wired into
`index.html` at `LYZR_OAUTH_CLIENT_ID` (top of the `<script>` block).

> **How the @lyzr.ai restriction works**
>
> Two layers, defense-in-depth:
>
> 1. **Google's consent screen** rejects non-`@lyzr.ai` accounts before the
>    request reaches our code, because the OAuth project was set up with
>    User Type: Internal under the Lyzr Workspace.
> 2. **The `hd` claim check** in `googleSignIn()` independently verifies
>    that the returned ID token has `hd === 'lyzr.ai'` and `email_verified`.
>    Personal Gmails (no `hd`) and other Workspace domains (different `hd`)
>    both fail.
>
> Either layer alone would do; together they're robust.

### What was actually set up

The OAuth project lives under a `@lyzr.ai` Google Workspace account, which
makes **User Type: Internal** available — and that's what we picked. Internal
is strictly better than External when you have it:

- Only `@lyzr.ai` users can sign in (Google enforces this at its consent
  screen, before the request even reaches our code).
- No 100-user testing cap, no "unverified app" warnings, no Google
  verification process to go through.
- New @lyzr.ai hires get access automatically the day their Workspace
  account is provisioned. No per-user allowlist to maintain.

The `hd === 'lyzr.ai'` check in `googleSignIn()` is now defense-in-depth
rather than the only gate — but we keep it because cheap belt-and-braces
is good belt-and-braces.

### How it was created (for future reference)

1. https://console.cloud.google.com/ — signed in with `@lyzr.ai`.
2. New Project → name `lyzr-pipeline`.
3. APIs & Services → OAuth consent screen → User Type: **Internal**.
   - App name: `Lyzr Pipeline`
   - User support email + developer contact: a `@lyzr.ai` email
   - Authorized domains: `lyzr.ai`
   - Scopes: defaults (`openid`, `email`, `profile`) — added automatically.
4. APIs & Services → Credentials → Create OAuth Client ID.
   - Application type: Web application
   - Authorized JavaScript origins:
     - `https://lyzr.kailash-gm.com`
     - `http://localhost:8765` (for local dev)
   - Authorized redirect URIs: blank (Identity Services uses popup flow).
5. Copy the Client ID into `index.html`'s `LYZR_OAUTH_CLIENT_ID` constant
   at the top of the `<script>` block.

### What's already wired in `index.html`

- Google Identity Services script tag in `<head>`.
- `LYZR_OAUTH_CLIENT_ID` constant near the top of the app script
  (one-line edit if it ever needs swapping).
- Real GIS flow in `googleSignIn()` — JWT decode, `hd === 'lyzr.ai'`
  check, `email_verified` check, sessionStorage persist, two failure-mode
  guards (script not loaded, popup throttled).


### Adding more team members

Nothing to do. Anyone with a verified `@lyzr.ai` Workspace account gets
access automatically. New hires inherit access when their account is
provisioned; departures lose access when their Workspace account is
suspended. No per-user allowlist.

### One caveat worth knowing

**Client-side verification is bypassable.** A determined developer with
DevTools could fake the auth state and read `data.json` directly, since
it's served as a static file. This is fine for non-confidential internal
data. If the data ever becomes confidential, move to Cloudflare Access —
that gates the static files at the Cloudflare edge before they ever reach
the browser.
     admin console won't see this app — it'll look like a third-party app.

   Both are fine for v1. Worth migrating to a Lyzr-Workspace-owned project
   later (whenever someone with Workspace admin access has 10 minutes), but
   not blocking.

---

## Local dev

```bash
cd this-folder
python3 -m http.server 8765
# Open http://localhost:8765/
```



---

## Wiring "My pipeline"

Once OAuth is live, the "My pipeline" quick-view chip needs an
`email → display name` mapping so it can match the logged-in user against
the owner names in the data.

Open `index.html`, find the `lyzrApp()` Alpine component, and add this
mapping near the top of the `return { ... }` object:

```javascript
ownerEmailMap: {
  'praveen@lyzr.ai': 'Praveen Sukumar',
  'vedant@lyzr.ai':  'Vedant Gaur',
  'anju@lyzr.ai':    'Anju Chaudhary',
  // … fill in the rest from the table you got from the architecture session
},
```

Then enable the chip and add the predicate. (When you're ready, ping me — it's
a 10-line change.)

---

## Future upgrades (deferred from v1)

- **Live data sync** — graduate from manual xlsx → `data.json` regen to a
  Google Sheets mirror with a published JSON URL.
- **Edit-back** — let owners update their own deals from the dashboard
  (requires a backend; HubSpot two-way sync is the canonical path).
- **Trend** — track stage transitions over time. Needs a snapshot history,
  which we don't have yet. Cron the data generator and store dated snapshots.
- **Cloudflare Access** — graduate from client-side OAuth to edge-level
  protection. Required if any confidential data is added.

---

## Data fidelity notes

The generator output reconciles to the source on every run:

```
Rows: 345
Total ACV: $35,784,000
Unique companies: 196
Owners on leaderboard: 18
```

If those numbers ever drift unexpectedly, the source xlsx changed. Re-run the
generator and visually diff against the previous `data.json` in git.

<!-- trigger redeploy -->
