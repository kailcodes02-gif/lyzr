# Operations Runbook

The things you will actually do once this is running.

## Trigger a data refresh

**From the app**: sign in, go to Data & Sync, click "Refresh all" (every
source, mailbox, and knowledge feed) or the "Refresh" button on any
individual card. A toast confirms it was queued; results appear in
"Recent runs" within about a minute and take a few minutes to finish
(HubSpot's full pull is the slow one).

**From the command line**, without touching the app:
```bash
gh workflow run comms-tracker-refresh.yml -R <org>/<repo> -f target=all
gh run watch -R <org>/<repo>
```
Valid `target` values: `all`, `sources`, `mail`, `knowledge`, or any one
specific source key (`cortex`, `hubspot`, `instantly`, `gmail`, `outlook`,
`lyzr_blog`, `slack`, `drive`, `onedrive`, `internal_email`).

**Locally**, against production data, without deploying or using GitHub
Actions at all:
```bash
npx tsx scripts/run-sync.ts all              # Cortex, HubSpot, Instantly
npx tsx scripts/run-mail-sync.ts all         # Gmail, Outlook
npx tsx scripts/run-knowledge-sync.ts all    # lyzr.ai, Slack, Drive, OneDrive, internal email
```
These read `.env.local` directly. Useful for testing a sync-code change
before deploying it, or for immediately re-running one source after
fixing an error without waiting for GitHub Actions.

## Something failed — where to look

1. **Data & Sync page → Recent runs.** Every run (scheduled or manual)
   logs its status, fetched/stored counts, and the first ~2000 characters
   of any error, per source.
2. **GitHub Actions** (`Actions` tab in the repo, or
   `gh run list -R <org>/<repo>`): the full log of a scheduled or
   dispatched run, including anything that happened before the sync
   itself even started (a bad secret, `npm ci` failing, etc.).
3. A source failing does **not** stop the others — `scripts/run-sync.ts`,
   `run-mail-sync.ts`, and `run-knowledge-sync.ts` all log a per-source
   failure and continue, then exit non-zero at the end so GitHub Actions
   still shows the run as failed overall.

## Add or remove an admin

Edit `supabase/migrations/015_add_admins.sql`'s email list is the
*documented* way (keeps the schema self-describing), but for a quick
change you don't need a new migration file:

- **Promote someone who has already signed in at least once**: Users page
  → find them → "Make admin" (any existing admin can do this from the
  UI).
- **Demote**: same page, "Remove admin".
- **Grant admin automatically on someone's very first sign-in** (before
  they have a `users` row yet): update the email list inside the
  `handle_new_user()` function (see migration 005 or 015 for the exact
  SQL) via the SQL Editor, or just have them sign in once as a normal
  member and promote them from the Users page afterward — simpler for a
  one-off.

## Reassign a project's owner role

From a project's page, click "Reassign" next to any Lyzr POC row (or
"Assign" next to an unfilled role), search the Lyzr-internal people list,
and confirm. This is admin-only in the UI and marks the new holder as a
manual override — the next Cortex/HubSpot sync will not silently revert
it back to whoever it originally auto-assigned.

## Connect a mailbox (as any user)

Data & Sync → Mailboxes → "Connect Gmail" or "Connect Outlook". Gmail
works immediately for anyone with `@lyzr.ai`. Outlook only works once the
tenant admin consent (see
[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)) has been
granted — before that, the button will fail with a "not configured"-style
error, which is expected, not a bug.

## Change what counts as "going dark"

`lib/going-dark.ts`: `GOING_DARK_THRESHOLD_DAYS` (currently 15) and the
per-shade step size. A code change + redeploy, not a database setting.

## Change the Instantly product-update tag

`INSTANTLY_PRODUCT_UPDATE_TAG` — set in `wrangler.jsonc`'s `vars` (Worker)
and the GitHub Actions workflow's `env` block (both currently `"ABM"`).
Change both if the tagging convention in Instantly changes.

## Rotate a leaked or expired secret

1. Get the new value from the relevant provider (see
   [03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md) for
   where each one comes from).
2. Update `.env.local` (local dev).
3. `npx wrangler secret put <NAME>` (the deployed Worker).
4. Update the matching `CT_<NAME>` GitHub Actions secret (the scheduled
   refresh).
5. No redeploy is needed for secret rotation alone — Worker secrets take
   effect immediately, and GitHub Actions secrets are read fresh on the
   next workflow run.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
```
Needs a `.env.local` with at least the Supabase URL/anon key to sign in;
the rest of the secrets are only needed if you're testing sync code
locally (see "Trigger a data refresh" above).

To preview the actual Worker (routes included, not just the Next.js dev
server):
```bash
npm run cf:preview   # next build && wrangler dev
```
