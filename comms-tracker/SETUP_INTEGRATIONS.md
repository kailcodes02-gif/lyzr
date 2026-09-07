# Integration setup — Slack, Google Drive, Microsoft mail

Two of the three (`lib/knowledge/slack.ts`, `drive.ts`) are fully implemented
in code now — they no-op with a clear "skipping" log in `/admin/sync` until
the accounts/apps below exist, but no further code changes are needed once
they do, just the secrets/OAuth setup this doc walks through.
`lib/knowledge/mail.ts` is still a plumbing-only scaffold (sync-run
bookkeeping is real, the actual Microsoft Graph calls are a `TODO`).

## Slack

1. Create a new Slack app at https://api.slack.com/apps → **Blank app** (the
   minimal-setup option — no slash commands/event listeners needed, this
   only ever does plain REST polling, never Socket Mode/Events).
2. Under **OAuth & Permissions**, add Bot Token Scopes: `channels:history`,
   `channels:read` (add `groups:history`/`groups:read` too if private channels
   should be included).
3. Install the app to the Lyzr workspace, invite the bot into whichever
   channels should feed the knowledge base.
4. Copy the **Bot User OAuth Token** (`xoxb-...`).
5. `wrangler secret put SLACK_BOT_TOKEN` and paste it.

## Google Drive (read-only, per-user consent)

> Status 2026-09-07: `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are
> set in `.env.local` (verified to be the same client Supabase's Google SSO
> uses for this project, id `156143725737-...`). Steps 2 and 3 below (enable
> the Drive API, add the `drive.readonly` scope) are Google Cloud Console
> actions still to do, then migration `008_user_oauth_tokens.sql` must be run
> before the first "Connect Google Drive" click will succeed.

Decided: **per-user consent**, not domain-wide delegation. Each signed-in
user connects their own Drive from `/admin/sync`'s "Connect Google Drive"
button; the knowledge base only ever sees what whichever users have
connected can themselves see — not literally every file in the workspace's
Drive, just a simpler flow that doesn't need a Workspace super-admin.

This **reuses the same Google Cloud OAuth client already configured for
Supabase's Google SSO provider** — no second Google Cloud project or OAuth
client needed, just one additional scope added to it:

1. Find that existing OAuth client: Google Cloud Console → **APIs & Services
   → Credentials** → the OAuth 2.0 Client ID used for Google sign-in (its
   Client ID/Secret are also visible in the Supabase Dashboard → Authentication
   → Providers → Google, where they were originally entered).
2. **APIs & Services → Library** → enable the **Google Drive API** for that
   project, if it isn't already.
3. **APIs & Services → OAuth consent screen → Data Access** → add the scope
   `.../auth/drive.readonly`. If the consent screen's **User Type** is
   **Internal** (tied to the `lyzr.ai` Google Workspace), this needs no
   Google verification regardless of the scope's sensitivity. If it's
   **External**, Google may require verification before this scope works for
   anyone outside a short test-user list — Internal is the expected setup
   here since sign-in is already restricted to `@lyzr.ai`.
4. Copy that OAuth client's **Client ID** (not secret) and **Client Secret**
   from Google Cloud Console.
5. `wrangler secret put GOOGLE_OAUTH_CLIENT_ID` and
   `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET` (for local dev, put both
   in `.env.local` instead — see `.env.local.example`).

Once those two are set, any signed-in user can click **Connect Google
Drive** on `/admin/sync` — this redirects through Google's consent screen
for just the added scope (`prompt=consent` forces a reissued refresh token
without disturbing anyone's existing login) and back to
`/auth/callback/?connect=drive`, which hands the refresh token to the
Worker's `/api/oauth/google-drive/connect` route for storage
(`user_oauth_tokens`, migration `008_user_oauth_tokens.sql`). No further
manual step is needed per user beyond that one click.

## Microsoft mail (Outlook/Graph — for the mailbox-read detection feature)

1. https://portal.azure.com → **Azure Active Directory → App registrations →
   New registration**.
2. API permissions → Microsoft Graph → Application permissions → add
   `Mail.Read` (and `Files.Read.All` if Drive-equivalent OneDrive/SharePoint
   reads are wanted later) → grant admin consent.
3. Certificates & secrets → new client secret → copy the value immediately
   (it's only shown once).
4. `wrangler secret put MS_GRAPH_CLIENT_SECRET` and paste it (the tenant ID
   and application/client ID aren't secret — those can go in `wrangler.jsonc`'s
   `vars` once the mail adapter is actually implemented).

## What's already wired vs. what's still a stub

- `lib/knowledge/lyzr-scrape.ts` — fully working today, no external app
  needed. Runs on the weekly cron and via `/admin/sync`'s "Refresh" for
  `lyzr_blog`.
- `lib/knowledge/slack.ts` — fully implemented (channel history via
  `conversations.list`/`conversations.history`, incremental per-channel
  cursor in `source_sync_state.last_cursor`). Needs `SLACK_BOT_TOKEN` set and
  the bot invited into channels (`/invite @<bot-name>` in Slack) before it
  finds anything.
- `lib/knowledge/drive.ts` — fully implemented (per-user OAuth via
  `user_oauth_tokens`, incremental sync via Drive's `changes.list` +
  `startPageToken`, text export of native Google Docs/Sheets/Slides only —
  PDFs/uploaded files aren't handled in v1). Needs `GOOGLE_OAUTH_CLIENT_ID`/
  `GOOGLE_OAUTH_CLIENT_SECRET` set and at least one user to click "Connect
  Google Drive" on `/admin/sync` before it finds anything.
- `lib/knowledge/mail.ts` — still plumbing-only; the actual Microsoft Graph
  calls are a `TODO` to fill in once `MS_GRAPH_CLIENT_SECRET` and the mail
  adapter's design (OAuth flow, similar to Drive's, still needs deciding)
  exist.
