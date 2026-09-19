# MS UI

A web app for your Microsoft 365 mailbox, OneDrive and calendar, built on the Microsoft Graph API. All three live under one path on the existing domain:

| URL | What it shows | Looks like |
|---|---|---|
| `lyzr.kailash-gm.com/MS/outlook` | your Outlook mail | Gmail |
| `lyzr.kailash-gm.com/MS/onedrive` | your OneDrive, same folder names as in OneDrive | Google Drive |
| `lyzr.kailash-gm.com/MS/calendar` | your Outlook calendar | Google Calendar |

Locally the same three pages run at `http://localhost:3000/MS/outlook`, `/MS/onedrive`, `/MS/calendar`.

**Status (2026-09-20): app registration created, plan only, no code yet.** The full feasibility study and phased build plan is in [PLAN.md](PLAN.md).

| App registration (not secret) | |
|---|---|
| Name | Lyzr MS UI |
| Application (client) ID | `cd569c2f-9121-4a99-8ba0-691c6df81cbd` |
| Directory (tenant) ID | `4b1018eb-9480-4542-89d0-4e6233aba226` |
| Account types | Lyzr only (single tenant) |
| Microsoft account that signs in | kailash.gm@lyzr.com |

Still to do by hand: add the `MailboxSettings.ReadWrite` permission (step 1.8), confirm the production redirect URI (step 1.7), run the consent test (step 2).

## What you have to do by hand

Claude cannot log in to Microsoft as you. Everything below needs a human. Everything else (code, design, hosting, docs) Claude does.

### 1. Create the app registration (about 5 minutes, once)

This is the "identity" of the app inside Lyzr's Microsoft 365. Without it, no login is possible.

1. Go to https://portal.azure.com, search for **App registrations**, click **New registration**.
2. Name: `Lyzr MS UI`
3. Supported account types: **Accounts in this organizational directory only (Lyzr only - Single tenant)**
4. Redirect URI: platform **Single-page application (SPA)**, value exactly:
   `http://localhost:3000/MS/redirect/`
   Capital `MS`, trailing slash. Microsoft compares this character by character with the running app, so the case must match.
5. Click **Register**.
6. On the Overview page, copy the **Application (client) ID** and paste it to Claude. That is the only value needed from this screen.
7. Left menu **Authentication** > under "Single-page application" click **Add URI** and add the production address now, so it is not forgotten later:
   `https://lyzr.kailash-gm.com/MS/redirect/`
   Click Save.
8. Left menu **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**. Tick these and click **Add permissions**:
   - `User.Read`
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `Files.ReadWrite`
   - `Calendars.ReadWrite`
   - `Contacts.Read`
   - `MailboxSettings.ReadWrite` (added 2026-09-20: creating and deleting categories, inbox rules that sort mail automatically, time zone, automatic replies)
   - `offline_access`

Do not reuse the "Graph Python quick start" app or the "Lyzr Comms Tracker" app. The reasons are in PLAN.md section 2.

### 2. Consent test (about 2 minutes, once)

Lyzr's Microsoft 365 is set so ordinary staff cannot approve some permissions themselves. This test shows which ones.

1. The links are in [CONSENT-TEST.md](CONSENT-TEST.md), one per permission. Open them in a browser where you are signed in as kailash.gm@lyzr.com.
2. If you see **"Permissions requested"** with an **Accept** button: click Accept. Done.
3. If you see **"Need admin approval"**: ask a Lyzr Microsoft 365 admin (Global Administrator or Cloud Application Administrator) to open the app registration from step 1, go to **API permissions**, and click **Grant admin consent for Lyzr**. One click, once, and it covers mail, calendar and mailbox settings together.

Expected outcome: OneDrive, sending mail and contacts pass on their own; reading mail, the calendar and mailbox settings need the admin click. The app can be built and tested on OneDrive while waiting.

### 3. Sign in yourself whenever the app runs

Local or deployed, the app shows a Microsoft sign-in button and you sign in with kailash.gm@lyzr.com. Claude never sees your password, mailbox or calendar. The login token stays in your browser. Expect one sign-in bounce per day (Microsoft's limit for browser apps).

That is all. Step 4 (the production address) is already covered in step 1.7.

## Planned layout of this folder

```
MS UI/
├── README.md          this file
├── PLAN.md            feasibility study + phased plan (M0 to M6)
├── package.json       Next.js 16 static-export app with basePath /MS (created in M0)
├── app/               routes: /outlook, /onedrive, /calendar, /redirect, /login
├── components/        Gmail-style, Drive-style and Calendar-style UI
├── lib/               MSAL auth + Graph fetch wrapper
└── wrangler.jsonc     Cloudflare Worker serving the static build at lyzr.kailash-gm.com/MS
```

Hosting follows the `comms-tracker` pattern: a static build served by a small Cloudflare Worker, path-mounted on the existing domain. No backend, no server-side secrets.
