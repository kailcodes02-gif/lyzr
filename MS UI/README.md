# MS UI

A web app for your Microsoft 365 mailbox, OneDrive and calendar, built on the Microsoft Graph API. All three live under one path on the existing domain:

| URL | What it shows | Looks like |
|---|---|---|
| `lyzr.kailash-gm.com/MS/outlook` | your Outlook mail | Gmail |
| `lyzr.kailash-gm.com/MS/onedrive` | your OneDrive, same folder names as in OneDrive | Google Drive |
| `lyzr.kailash-gm.com/MS/calendar` | your Outlook calendar | Google Calendar |

Locally the same three pages run at `http://localhost:3000/MS/outlook`, `/MS/onedrive`, `/MS/calendar`.

**Status (2026-09-20, late): built and live; second version being finished.** All three screens are deployed at the URLs above.

What each screen does today:

- **Outlook (Gmail layout).** Folders and sub-folders, Starred, Primary / Social / Promotions tabs (Social and Promotions are Outlook categories kept up to date by inbox rules the app creates), labels you can click to see everything inside them, labels with conditions (senders, domains, subject words, calendar invitations, newsletters) that become Outlook's own server-side rules, "skip the inbox" so labelled mail lives only under its label (the app creates a folder of the same name and Outlook moves matching mail there on arrival), a Filters list of every rule with a one-click "Set up my labels" that installs the preset labels (Leadership, GSI, Marketing, Meeting scripts, Calendar; senders listed in the app and in the plan), threaded reading pane with safe HTML, compose with undo send, reply, reply all, forward, attachments, Gmail keyboard shortcuts, live inbox refresh.
- **OneDrive (Google Drive layout).** My files with breadcrumbs, Docs / Sheets / Slides / PDFs / Images / Videos views, Starred, Recent, Shared with me, grid and list, search and filters by type, person and date, new folder, rename, move by drag or dialog, copy, delete, upload with resume for big files, preview for images, PDF, video and text, share by link or invitation. Double-clicking a Word, Excel or PowerPoint file opens it in that app on the web; the menu also offers the desktop app.
- **Calendar (Google Calendar layout).** Day, week, month, 4-day and agenda views, mini month, My calendars and Other calendars with colour toggles, subscribe to a colleague and see their busy or free blocks over your own grid (details when they have shared their calendar with you), calendars shared with you, quick create, full edit with recurrence, guests suggested from your contacts and the Lyzr directory, find a time, RSVP, Teams links, reminders. Until a Lyzr Microsoft 365 admin approves the app's permissions, real mail, files and calendar data show a "needs admin approval" panel; everything can be tried in demo mode (sample data) meanwhile. The feasibility study and build plan is in [PLAN.md](PLAN.md).

| Live | |
|---|---|
| Sign-in | https://lyzr.kailash-gm.com/MS/login/ |
| Demo (no account needed) | https://lyzr.kailash-gm.com/MS/login/?mock=1 |
| Cloudflare Worker | `ms-ui`, route `lyzr.kailash-gm.com/MS*`, assets only, no server code |

Production sign-in needs the production redirect URI in the app registration (step 1.7 below); without it Microsoft shows error AADSTS50011.

| App registration (not secret) | |
|---|---|
| Name | Lyzr MS UI |
| Application (client) ID | `cd569c2f-9121-4a99-8ba0-691c6df81cbd` |
| Directory (tenant) ID | `4b1018eb-9480-4542-89d0-4e6233aba226` |
| Account types | Lyzr only (single tenant) |
| Microsoft account that signs in | kailash.gm@lyzr.com |

Consent test result (2026-09-20): `User.Read` approved by the user; all six other permissions say "Need admin approval". Still to do by hand: add the `MailboxSettings.ReadWrite` permission (step 1.8), confirm the production redirect URI (step 1.7), forward [ADMIN-REQUEST.md](ADMIN-REQUEST.md) to a Lyzr Microsoft 365 admin.

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
   - `Calendars.Read.Shared` and `Calendars.ReadWrite.Shared` (added 2026-09-20: see colleagues' calendars they have shared with you)
   - `Contacts.Read`
   - `People.Read` (added 2026-09-20: suggest the people you email most)
   - `User.ReadBasic.All` (added 2026-09-20: suggest anyone in the Lyzr directory when adding guests or recipients)
   - `MailboxSettings.ReadWrite` (added 2026-09-20: creating and deleting categories, inbox rules that sort mail automatically, time zone, automatic replies)
   - `offline_access`

Do not add `People.Read.All`: it is a higher-privilege permission that reads other people's relationship data, it is not used, and it needs a stricter admin consent. If it is present, remove it (its row menu, Remove permission).

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

## Run it locally

```
cd "MS UI"
npm install
npm run dev
```

Then open http://localhost:3000/MS/login/ and click **Sign in with Microsoft** (kailash.gm@lyzr.com). After sign-in you land on Outlook, with OneDrive and Calendar in the left rail. Each page shows the "Microsoft permissions" panel: green means approved, red means the admin still has to click. Sign out is in the bottom-left card.

**Demo mode.** On the sign-in page click **Try the demo with sample data** (or add `?mock=1` to any URL). Every page then runs on realistic sample mail, files and events with no Microsoft account, so the whole UI can be tried before the admin approval. Sign out leaves demo mode.

**Tests.** `npm test` runs the unit tests (vitest). `npm run test:e2e` runs browser tests in demo mode (Playwright, uses the installed Google Chrome). `npx tsc --noEmit` and `npm run lint` must both be clean before a deploy.

**Build and deploy.** `npm run build` produces the static site in `out/` and stages it under `dist/MS/` with the security headers file at the root (`scripts/stage.mjs` also hashes the inline scripts for the Content Security Policy). `npm run cf:preview` serves that locally on port 8787 through the Cloudflare Worker; `npm run cf:deploy` publishes to `lyzr.kailash-gm.com/MS`.

## Layout of this folder

```
MS UI/
├── README.md              this file
├── PLAN.md                feasibility study + phased plan (M0 to M6)
├── CONSENT-TEST.md        one sign-in link per permission, to see what the tenant allows
├── ADMIN-REQUEST.md       ready-to-forward request for the admin consent click
├── package.json           Next.js 16 static export, basePath /MS
├── next.config.ts         output: export, basePath /MS, trailingSlash
├── app/
│   ├── layout.tsx         root layout, deliberately without auth providers
│   ├── redirect/          MSAL v5 redirect bridge page (the registered redirect URI)
│   └── (msal)/            everything behind the auth providers
│       ├── login/         sign-in page
│       └── (shell)/       auth guard + left rail; outlook/, onedrive/, calendar/
├── components/            providers, auth guard, sidebar, consent status panel
├── lib/                   config (client id, tenant, scopes), msal, graph fetch, hooks
├── public/_headers        Cloudflare security headers (CSP), bridge page exception
├── scripts/stage.mjs      copies out/ to dist/MS/ after next build
└── wrangler.jsonc         Cloudflare assets-only Worker at lyzr.kailash-gm.com/MS
```

Hosting follows the `comms-tracker` pattern: a static build served by a small Cloudflare Worker, path-mounted on the existing domain. No backend, no server-side secrets.
