# Secrets and Credentials

**The actual current values for everything below already exist in this
folder's `comms-tracker/.env.local`**, which is part of the handover and
is gitignored on purpose. This document explains what each one is, where
it is used, and how to obtain or rotate your own — it does not repeat the
raw values.

Per the explicit instruction for this handover: the third-party API keys
(HubSpot, Anthropic/Claude, Instantly, Slack) and the Google/Microsoft
OAuth app credentials (Drive, Gmail, Outlook, OneDrive/SharePoint) **stay
the same** — you do not need to create new ones. Only Supabase, the git
host, and Cloudflare hosting change; see
[04-HANDOVER-SETUP-GUIDE.md](04-HANDOVER-SETUP-GUIDE.md).

## Where each secret has to be set, and why there are three places

| Where | Used by | How to set |
|---|---|---|
| `comms-tracker/.env.local` | Local `next dev`, and the local `npx tsx scripts/run-*.ts` scripts | Edit the file directly |
| Cloudflare Worker secrets | The deployed Worker's `/api/*` routes | `npx wrangler secret put <NAME>` from inside `comms-tracker/` |
| GitHub Actions repo secrets (prefixed `CT_`) | The scheduled/dispatched refresh workflow | Repo Settings → Secrets and variables → Actions, or `gh secret set CT_<NAME> -f <file>` |

The `CT_` prefix on the GitHub secrets exists only to avoid colliding with
this repo's other secrets (`CLOUDFLARE_API_TOKEN`, etc., if this ever
lives in a shared repo again) — on a fresh dedicated repo you could drop
the prefix, but the workflow file as handed over expects it, so it is
simplest to keep it.

## Full list

### Supabase

| Variable | What it is | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project's REST URL | Supabase Dashboard → Project Settings → API → Project URL. **Changes** when you create the new project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/browser Supabase key (safe to expose — RLS is what actually protects data) | Same page, "anon public" key. **Changes** with the new project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Full-access key, server-side only, bypasses RLS | Same page, "service_role" key — **never expose this to the browser or commit it.** **Changes** with the new project. |

### Third-party APIs (stay the same)

| Variable | What it is | Where to get / rotate it |
|---|---|---|
| `HUBSPOT_ACCESS_TOKEN` | HubSpot private-app access token | HubSpot → Settings → Integrations → Private Apps. Needs read scopes on companies, contacts, deals, and email/engagement objects. |
| `INSTANTLY_API_KEY` | Instantly.ai API key | Instantly → Settings → Integrations → API. Read-only usage only — this app never sends through Instantly. |
| `INSTANTLY_PRODUCT_UPDATE_TAG` | Not a secret — the Instantly campaign tag (currently `"ABM"`) whose emails count as product updates | Set by whoever tags Instantly campaigns; matches whatever tag convention the team uses |
| `CORTEX_API_KEY` | Cortex/Helix (Lyzr's internal PSA) workspace gateway key | Internal — ask whoever administers `applied-ai.lyzr.app` |
| `CORTEX_BASE_URL` | Not a secret — `https://applied-ai.lyzr.app` | Fixed |
| `ANTHROPIC_API_KEY` | Claude API key, used exclusively with `claude-sonnet-5` | console.anthropic.com → API Keys |
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) for the Slack app that reads channel history | Slack app "ABM" (App ID `A0BUMUA521L`) in the Lyzr workspace → OAuth & Permissions. If you ever need to recreate this app: **Blank app**, scopes `channels:history` + `channels:read` (add `groups:history`/`groups:read` for private channels), then invite the bot into whichever channels should feed the knowledge base with `/invite @<bot-name>`. |

### Google (Drive + Gmail — stays the same)

| Variable | What it is |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | The Google Cloud OAuth 2.0 client already used for this app's Google sign-in |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Its secret |

This is the **same OAuth client Supabase's Google sign-in provider
already uses** — not a second client. One user consent grants both
`drive.readonly` and `gmail.readonly`. Find it in Google Cloud Console →
APIs & Services → Credentials (the OAuth 2.0 Client ID whose ID also
appears in Supabase Dashboard → Authentication → Providers → Google). The
Drive API and Gmail API must both be enabled on that Google Cloud project
(APIs & Services → Library).

**When you move hosting**, this client's **Authorized redirect URIs**
need the new domain added (Google Cloud Console → Credentials → that
client → Authorized redirect URIs) — specifically
`<your-new-domain>/auth/callback/`. The client ID/secret themselves do
not change.

### Microsoft / Azure (Outlook mail + OneDrive/SharePoint — stays the same)

| Variable | What it is |
|---|---|
| `MS_GRAPH_CLIENT_ID` | Application (client) ID of the Azure app registration "Lyzr Comms Tracker" |
| `MS_GRAPH_TENANT_ID` | Directory (tenant) ID of the Lyzr Microsoft 365 tenant this app registration lives in |
| `MS_GRAPH_CLIENT_SECRET` | Its client secret |

Registered as: single tenant, five delegated Microsoft Graph permissions
(`Mail.Read`, `Files.Read.All`, `Sites.Read.All`, `User.Read`,
`offline_access`). Find/manage it at portal.azure.com → Microsoft Entra ID
→ App registrations → "Lyzr Comms Tracker". `MS_GRAPH_CLIENT_ID` and
`MS_GRAPH_TENANT_ID` are not secret and live in `wrangler.jsonc`'s `vars`
(committed, unlike the actual secret) — only `MS_GRAPH_CLIENT_SECRET`
needs `wrangler secret put`.

**Outstanding action, not a credential problem**: this tenant is
configured so ordinary users cannot self-consent to a new app's
permissions (`Sites.Read.All` triggers this). A Lyzr Microsoft 365 Global
Administrator (or Privileged Role Administrator / Cloud Application
Administrator) needs to open this link once, signed in with an admin
account, and click **Accept**:

```
https://login.microsoftonline.com/<MS_GRAPH_TENANT_ID>/adminconsent?client_id=<MS_GRAPH_CLIENT_ID>&redirect_uri=<NEXT_PUBLIC_SITE_URL>/api/oauth/microsoft/callback
```

(fill in the two IDs and the site URL from your own `.env.local` /
`wrangler.jsonc`). This approves the app for the entire tenant in one
action; after that, every `@lyzr.com` user can click "Connect Outlook"
with no further prompts. This has not been done yet as of this handover
— see [07-KNOWN-ISSUES-AND-ROADMAP.md](07-KNOWN-ISSUES-AND-ROADMAP.md).

**When you move hosting**, add a second **Redirect URI** (platform Web) on
this app registration for `<your-new-domain>/api/oauth/microsoft/callback`
— Azure lets an app registration hold multiple redirect URIs, so you do
not have to remove the old one immediately.

### Cloudflare / GitHub (change with the new hosting)

| Variable / secret | What it is |
|---|---|
| `GH_DISPATCH_TOKEN` (Worker secret only) | A GitHub personal access token with `repo` + `workflow` scope, used by the Worker to trigger the refresh workflow via GitHub's API. **Must be regenerated for the new repo** — a fine-grained PAT scoped to just that one repository is the safer choice; a classic PAT with the two scopes above also works. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub Actions secrets, only relevant if you later also automate the Cloudflare deploy from CI — not required for the refresh workflow itself) | Cloudflare → My Profile → API Tokens |

## A note on the domain restriction

Sign-in is gated to `@lyzr.ai` only by a **client-side hint**
(`hd: "lyzr.ai"` passed to Google's OAuth authorize call in
`app/login/page.tsx` and `lib/hooks/use-drive-connect.ts`), not a
server-enforced rule. Nothing in Supabase Auth or the database currently
blocks a non-`lyzr.ai` Google account from completing sign-in and getting
a `member` row created for them. If stricter enforcement is wanted, that
would need either a Supabase Auth hook checking the email domain at
sign-up, or a Google Workspace-side restriction on who can even see the
OAuth consent screen. This was true before this handover and is not
something introduced by it — flagged here so it is a deliberate choice
going forward, not a surprise.
