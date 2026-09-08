# Integration setup — Slack, Google (Drive + Gmail), Microsoft (Outlook)

All four sources are fully implemented in code. Each one no-ops with a
clear "skipping" log in `/admin/sync` until the account/app below exists;
no further code changes are needed once it does, just the secrets and
consent-screen setup this doc walks through.

| Source | Code | Needs |
|---|---|---|
| Slack channels | `lib/knowledge/slack.ts` | `SLACK_BOT_TOKEN` (done) |
| Google Drive + Gmail | `lib/knowledge/drive.ts`, `lib/mail/google.ts` | Google OAuth client ID/secret (done) + Drive API, `drive.readonly` and `gmail.readonly` scopes on the consent screen + each user clicking **Connect Gmail** |
| Outlook + OneDrive/SharePoint | `lib/mail/microsoft.ts`, `lib/knowledge/onedrive.ts` | Azure app registration (`MS_GRAPH_CLIENT_ID`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_SECRET`) + each user clicking **Connect Outlook** (one consent covers mail and files) |
| Internal email (siva@) | `lib/mail/run.ts` | Nothing extra: filled from whichever mailboxes are connected |

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

## Google Drive + Gmail (read-only, per-user consent)

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
3. **APIs & Services → Library** → also enable the **Gmail API**.
4. **APIs & Services → OAuth consent screen → Data Access** → add both scopes
   `.../auth/drive.readonly` and `.../auth/gmail.readonly` (one consent
   screen grants both; Gmail reading and Drive ingestion share the token). If the consent screen's **User Type** is
   **Internal** (tied to the `lyzr.ai` Google Workspace), this needs no
   Google verification regardless of the scope's sensitivity. If it's
   **External**, Google may require verification before this scope works for
   anyone outside a short test-user list — Internal is the expected setup
   here since sign-in is already restricted to `@lyzr.ai`.
5. Copy that OAuth client's **Client ID** (not secret) and **Client Secret**
   from Google Cloud Console.
6. `wrangler secret put GOOGLE_OAUTH_CLIENT_ID` and
   `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET` (for local dev, put both
   in `.env.local` instead — see `.env.local.example`).

Once those two are set, any signed-in user can click **Connect Gmail** on
`/admin/sync` (the same click grants Drive) — this redirects through Google's consent screen
for just the added scope (`prompt=consent` forces a reissued refresh token
without disturbing anyone's existing login) and back to
`/auth/callback/?connect=google`, which hands the refresh token to the
Worker's `/api/oauth/google/connect` route for storage
(`user_oauth_tokens`, migration `008_user_oauth_tokens.sql`). No further
manual step is needed per user beyond that one click.

## Microsoft Outlook (read-only, per-user consent via Microsoft Graph)

Same shape as Google: each user connects their own `@lyzr.com` mailbox
from `/admin/sync` ("Connect Outlook"). Sign-in to the app stays Google
only; the Worker runs a standard OAuth authorization-code flow against
Microsoft Entra with **delegated** `Mail.Read`, stores the refresh token in
`user_oauth_tokens` (provider `microsoft`), and reads Sent Items + Inbox
through Graph on each run. Nothing here needs admin consent for the whole
tenant, and no application-level (tenant-wide) mail permission is used.

1. https://portal.azure.com → **Microsoft Entra ID → App registrations →
   New registration**.
   - Name: `Lyzr Comms Tracker` (anything).
   - Supported account types: **Accounts in this organizational directory
     only (lyzr.com, single tenant)**.
   - Redirect URI: platform **Web**,
     `https://lyzr.kailash-gm.com/abm-tracker/api/oauth/microsoft/callback`
     (for local dev add `http://localhost:8799/abm-tracker/api/oauth/microsoft/callback`
     too, that's what `wrangler dev` serves).
2. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**: `Mail.Read`, `Files.Read.All`, `Sites.Read.All`,
   `User.Read`, `offline_access`. `Files.Read.All` covers the user's
   OneDrive plus files shared with them; `Sites.Read.All` covers the
   SharePoint sites they can open. Each user consents on connect; if your
   tenant policy requires admin consent for `Sites.Read.All`, click **Grant
   admin consent for lyzr.com** on this page once.
3. **Certificates & secrets → New client secret** → copy the **Value**
   immediately (only shown once).
4. From the **Overview** page copy the **Application (client) ID** and the
   **Directory (tenant) ID**.
5. Put the two IDs in `wrangler.jsonc` `vars` (`MS_GRAPH_CLIENT_ID`,
   `MS_GRAPH_TENANT_ID`) and in `.env.local`, then
   `wrangler secret put MS_GRAPH_CLIENT_SECRET` (and `.env.local` for local
   runs). Deploy.

After that, **Connect Outlook** on `/admin/sync` opens Microsoft's consent
page pre-filled with your lyzr.com address (the app derives it from your
lyzr.ai sign-in), and the callback lands you back on `/admin/sync` with
"Outlook connected". Run **Read mailboxes** or wait for the Sunday cron.

The same connection feeds the **onedrive** knowledge source
(`lib/knowledge/onedrive.ts`): personal OneDrive plus every SharePoint
document library the user can reach, walked incrementally with Graph delta
links, text extracted from .docx/.pptx/.xlsx/.txt/.md/.csv/.json/.html (PDFs
and images are skipped, same as Google Drive v1). Migration
`010_onedrive_sharepoint.sql` adds the enum value and the per-drive delta
cursor column.

## What each mailbox read does

`lib/mail/run.ts`, for every connected mailbox (first run looks back 90
days, then only since the last run):

- Reads **Sent Items** and **Inbox** (capped per run; Gmail skips
  promotions/social). Any message to or from an address that belongs to a
  tracked account (by domain) or a known contact (by email) becomes a
  `communication_events` row (`source_system` `gmail` / `outlook`), tied to
  the contact's project, so going-dark and the project timeline include
  emails sent from personal inboxes. Mail that touches no tracked customer
  is not stored.
- **Confirms "sent via app" rows**: when the real sent message (same
  recipient + subject) appears in the sender's mailbox, `confirmed_at` is
  stamped on the optimistic row the compose handoff logged.
- Collects emails **from siva@lyzr.ai / siva@lyzr.com** into the
  `internal_email` knowledge store (full text) and rebuilds
  `internal-emails-siva.md`.
- Runs weekly from the Worker cron, or on demand from `/admin/sync`
  ("Read mailboxes"), or locally with
  `npx tsx scripts/run-mail-sync.ts gmail|outlook|all`.
