# Handover Setup Guide — Standing This Up in a New Place

This is the concrete checklist for taking the `comms-tracker/` folder you
were handed and turning it into your own independently-hosted app: new
Supabase project, new git repository, new Cloudflare hosting, and updated
OAuth redirect URIs (the OAuth *credentials* stay the same — see
[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)).

Do these roughly in order — later steps assume earlier ones are done.

## 0. Before you start

- Confirm you have the whole `comms-tracker/` folder, including the
  gitignored `.env.local` (it will not show up in `git status` — check for
  it with `ls -la`, not `git ls-files`).
- Confirm you have `node` (22+), `npm`, and the `wrangler` and `gh` CLIs
  available (`npx wrangler --version`, `gh --version` — both are already
  dev dependencies of this project or installable via `npm i -g`).

## 1. New git repository

The folder you have was one subfolder of a larger personal monorepo. Make
it its own repo:

```bash
cd comms-tracker
git init
git add -A
git commit -m "Initial commit: Comms Tracker handover"
```

Create an empty repository on GitHub (or wherever your team hosts git),
then:

```bash
git remote add origin <your-new-repo-url>
git branch -M main
git push -u origin main
```

The self-contained GitHub Actions workflow is already at
`.github/workflows/comms-tracker-refresh.yml` inside this folder (a copy
adapted so it works as the root of its own repo, distinct from the
original which lived in the monorepo's own `.github/workflows/` at the
repo root above this folder) — it moved with you, no extra step needed
beyond the secrets in step 5.

## 2. New Supabase project

1. Create a new project at supabase.com (any region; note the project
   reference and its URL, e.g. `https://<ref>.supabase.co`).
2. Open the SQL Editor and run every file in `supabase/migrations/` **in
   numeric order, one at a time** (there is no migration-runner CLI in use
   — this has always been a manual, paste-and-run workflow). See
   [05-DATABASE-SCHEMA-AND-MIGRATIONS.md](05-DATABASE-SCHEMA-AND-MIGRATIONS.md)
   for what each one does and any that need special attention.
3. Project Settings → API: copy the **Project URL**, the **anon public**
   key, and the **service_role** key. These go into `.env.local`,
   Cloudflare Worker secrets, and GitHub Actions secrets respectively (see
   [03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)).
4. Authentication → Providers → Google: enable it, and paste in the
   **same** `GOOGLE_OAUTH_CLIENT_ID` / secret from the old setup (they
   still work — you are not creating a new Google OAuth client).
5. Authentication → URL Configuration:
   - **Site URL**: set to your new app's full URL (must include
     `https://`, e.g. `https://comms-tracker.yourcompany.workers.dev` or
     your custom domain — get this wrong and OAuth redirects will
     silently fail, sending users to a broken Supabase-internal URL).
   - **Redirect URLs**: add `<your-new-url>/**` (a wildcard covering
     sign-in and the Drive/Gmail connect round trip) and, if you do local
     development, `http://localhost:3000/**` too.
6. **Storage**: a `knowledge` bucket is created automatically on first
   knowledge-sync run (`lib/knowledge/util.ts`'s `ensureKnowledgeBucket`)
   — nothing to do here manually.

## 3. New Cloudflare hosting

1. `npx wrangler login` (from inside `comms-tracker/`) — authenticates to
   your own Cloudflare account.
2. Decide your domain situation:
   - **Simplest**: no custom domain — Cloudflare gives you a free
     `<worker-name>.<your-subdomain>.workers.dev` URL automatically.
   - **Custom domain**: you'll need that domain's DNS on Cloudflare and a
     `routes` entry pointing at it.
3. Edit `wrangler.jsonc` using `wrangler.new-deployment.example.jsonc` in
   this same folder as a reference. At minimum:
   - Update `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     in `vars` to your new Supabase project's values.
   - Decide whether you want the app at a URL sub-path like the original
     (`/abm-tracker`) or at the root of its own domain/subdomain — if the
     latter, change `next.config.ts`'s `BASE_PATH` to `""` and remove
     `NEXT_PUBLIC_BASE_PATH` from `vars` (or set it to `""`).
   - Set `NEXT_PUBLIC_SITE_URL` to wherever the app will actually be
     reachable — this value is used to build the Microsoft OAuth
     `redirect_uri`, so it must be exact.
   - Adjust or remove `routes` depending on the domain decision above.
4. Set every Worker secret (see the full list in
   [03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)):
   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put HUBSPOT_ACCESS_TOKEN
   npx wrangler secret put INSTANTLY_API_KEY
   npx wrangler secret put CORTEX_API_KEY
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put SLACK_BOT_TOKEN
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   npx wrangler secret put MS_GRAPH_CLIENT_SECRET
   npx wrangler secret put GH_DISPATCH_TOKEN
   ```
   Each prompts interactively for the value — paste from `.env.local` (or
   generate a fresh `GH_DISPATCH_TOKEN` per step 5 below).
5. Build and deploy:
   ```bash
   npm install
   npm run cf:deploy
   ```
6. Smoke-test: open the deployed URL, confirm the login page loads and
   sign-in works, then check `/admin/sync/` loads (it will show "never
   synced" everywhere until step 6 below).

## 4. OAuth redirect URIs — the credentials stay the same, the URLs don't

Neither the Google OAuth client nor the Azure app registration needs to be
recreated. Both need your **new** URL added as an additional allowed
redirect:

- **Google Cloud Console** → APIs & Services → Credentials → the existing
  OAuth 2.0 Client ID → Authorized redirect URIs → add
  `<your-new-url>/auth/callback/`.
- **Azure Portal** → Microsoft Entra ID → App registrations → "Lyzr Comms
  Tracker" → Authentication → add a **Web** platform redirect URI:
  `<your-new-url>/api/oauth/microsoft/callback`.

You can add these alongside the old ones rather than replacing them, so
nothing breaks mid-migration.

## 5. GitHub Actions secrets (for the daily/on-demand refresh)

In your new repo: Settings → Secrets and variables → Actions → New
repository secret, one at a time (or in bulk with `gh secret set -f
<file>` from a local `KEY=value` file, then delete that file — never
commit it):

```
CT_NEXT_PUBLIC_SUPABASE_ANON_KEY
CT_SUPABASE_SERVICE_ROLE_KEY
CT_HUBSPOT_ACCESS_TOKEN
CT_INSTANTLY_API_KEY
CT_CORTEX_API_KEY
CT_ANTHROPIC_API_KEY
CT_SLACK_BOT_TOKEN
CT_GOOGLE_OAUTH_CLIENT_ID
CT_GOOGLE_OAUTH_CLIENT_SECRET
CT_MS_GRAPH_CLIENT_SECRET
```

Then open `.github/workflows/comms-tracker-refresh.yml` and update the one
hardcoded line flagged with a `CHANGE THIS` comment
(`NEXT_PUBLIC_SUPABASE_URL`) to your new Supabase project's URL. Everything
else in that file (Cortex base URL, the Instantly tag, the Microsoft
client/tenant IDs) is Lyzr-side configuration that does not change with
hosting, so it is left hardcoded on purpose.

**`GH_DISPATCH_TOKEN`** (the Worker secret from step 3.4) needs to be a
token scoped to *this new repo* specifically — generate a fine-grained
personal access token (GitHub → Settings → Developer settings → Fine-
grained tokens) scoped to just this repository with **Actions: read and
write** permission, or a classic PAT with `repo` + `workflow` scopes if
your org doesn't support fine-grained tokens yet.

## 6. First real data run

Trigger a full refresh once everything above is in place, either from the
app's Data & Sync page ("Refresh all") once you're signed in, or directly:

```bash
gh workflow run comms-tracker-refresh.yml -R <your-org>/<your-repo> -f target=all
gh run watch -R <your-org>/<your-repo>
```

The first HubSpot run pulls tens of thousands of records and can take
several minutes — that is expected, not a hang. Check the Data & Sync
page's "Recent runs" section afterward for each source's fetched/stored
counts and any error text.

## 7. Google Drive / Gmail and Outlook, per user

These are per-signed-in-user consents, not one-time admin setup (beyond
the Outlook tenant admin consent covered in
[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)):

- Each user who wants their sent/received mail and Drive content included
  clicks **Connect Gmail** on Data & Sync.
- Each user who wants their Outlook mail and OneDrive/SharePoint content
  included clicks **Connect Outlook** — but this only works at all once
  the tenant admin consent link has been approved once, tenant-wide.

## 8. Decommissioning the old hosting (once you've verified the new one works)

Not urgent, but worth doing once you trust the new deployment:

- Cloudflare (old account): `wrangler delete` the `abm-tracker` Worker, or
  simply let its DNS route lapse if the domain itself is being retired.
- Ask the old Supabase project owner to pause or delete the old project
  once you've confirmed the new one has all the data you need (the
  historical `sync_runs` log and any manually-created tasks or role
  overrides do **not** automatically carry over to a fresh Supabase
  project — only the schema does, via the migration files. If you need
  the actual historical data, ask for a Supabase database export/backup
  from the old project before it's decommissioned).
