# Cloudflare Access Setup Runbook

> **Purpose.** Step-by-step runbook to gate the Work OS site behind Cloudflare
> Access (Zero Trust), so that protected paths are checked at the Cloudflare edge
> before any byte reaches the browser. This replaces the bypassable client-side
> Google OAuth on the pipeline dashboard as the real security boundary.
>
> **Who runs this.** A human with Cloudflare dashboard access to the account that
> owns the `lyzr-work-os` Pages project and the `lyzr.kailash-gm.com` zone. The
> dashboard steps below cannot be automated from this repo; they must be performed
> by the user. This doc is the exact click path.
>
> **Convention.** No em dashes anywhere (Lyzr style).

| | |
|---|---|
| **Site** | `https://lyzr.kailash-gm.com` (Cloudflare Pages project `lyzr-work-os`) |
| **Zone** | `kailash-gm.com` (or whichever zone the subdomain lives under) |
| **Product** | Cloudflare Zero Trust > Access |
| **Cost** | Access is free for up to 50 seats, which is more than enough for the `@lyzr.ai` team |

---

## 0. Before you start: what Access does and does not do

Cloudflare Access sits in front of the site at the edge. When a request hits a
protected path, Access checks for a valid session cookie (`CF_Authorization`). If
there is none, the user is bounced to a Cloudflare-hosted login page, authenticates
against an identity provider (IdP), and only then is the request allowed through to
Pages. Static files, Pages Functions, and `data.json` are all gated equally,
because the check happens before Pages is reached.

This is strictly stronger than the current client-side Google OAuth on the pipeline
(see `pipeline/README.md`), which only hides the UI: the static `data.json` is
readable directly by anyone who knows the URL. Access closes that hole.

What Access does NOT do: it does not change your application code, it does not read
or write `data.json`, and it does not replace the per-row Google Bearer token check
inside `functions/api/rows.js` (that check stays as defense in depth; see section 6).

---

## 1. Decide which paths to protect

Map the site surfaces to a protect / leave-public decision. This is the single most
important design choice, so get it right before touching the dashboard.

| Path | Decision | Reason |
|---|---|---|
| `/pipeline/*` | **PROTECT** | Internal opportunity tracker UI |
| `/pipeline/data.json` | **PROTECT** | The raw data; covered by `/pipeline/*` but call it out explicitly so nobody assumes the JSON is exempt |
| `/api/*` | **PROTECT** (with a service-token caveat) | The live read/write API (`/api/data`, `/api/rows`). See section 6 for how the GitHub-backed write path interacts with Access |
| `/control/*` | **PROTECT** | Admin control panel (already `noindex`; today its only gate is a test-grade password) |
| `/demo_pipeline/*` | **EXCLUDE (leave public)** | Intentionally public, embeddable live-demo dashboard. Gating it would break the embeds. See section 4 |
| `/reports/*` | Leave public (default) | Public marketing reports; gate only if the business later decides reports are confidential |
| `/tasks/*`, `/` (home) | Leave public (default) | Low-sensitivity landing/index pages |

> **Why `/demo_pipeline/*` must stay public.** `_redirects` rewrites
> `/demo_pipeline/*` to `/prototypes/`, and `_headers` sets `X-Frame-Options:
> ALLOWALL` + `frame-ancestors *` so the demo can be embedded in external pages.
> Access inserts a login interstitial that cannot complete inside a third-party
> iframe, so protecting this path would break every embed. Leave it out of every
> Access application below.

> **One subtlety about `/demo_pipeline/` and `/pipeline/data.json`.** The public
> demo and the protected pipeline read the **same** underlying `pipeline/data.json`.
> The demo reaches it through its own Pages Function (`prototypes` / `functions/api/data.js`
> path), not by fetching `/pipeline/data.json` directly. So protecting
> `/pipeline/*` does not starve the public demo, as long as you protect the
> `/pipeline/` path prefix and NOT the function the demo calls. Confirm the demo
> still loads in the verification checklist (section 7). If the demo turns out to
> fetch `/pipeline/data.json` directly, you have two options: (a) add a public
> bypass policy specifically for `/pipeline/data.json`, which re-opens the data, or
> (b) have the pipeline agent point the demo at a separate public copy. Option (b)
> is preferred; flag it to the pipeline agent.

---

## 2. Connect an identity provider (one-time)

You want users to log in with their `@lyzr.ai` Google Workspace identity.

1. Go to `https://one.dash.cloudflare.com/` and pick the correct account.
2. Left nav: **Settings > Authentication** (under the Zero Trust section). In the
   2026 dashboard this is **Zero Trust > Settings > Authentication > Login methods**.
3. You have two valid choices:

   **Option A: One-time PIN (no IdP setup, simplest).**
   Cloudflare emails a 6-digit code to the address the user enters. You then write
   the Access policy to only allow the `lyzr.ai` email domain (section 3). Zero IdP
   configuration. Good enough for v1 and recommended if you want this live today.

   **Option B: Google Workspace IdP (cleanest UX, SSO).**
   - Click **Add new > Google Workspace** (use "Google Workspace", not plain
     "Google", so you can restrict by the `lyzr.ai` hosted domain).
   - In Google Cloud Console (signed in as a `@lyzr.ai` admin), create an OAuth
     2.0 Client ID (Web application). You can reuse the existing `lyzr-pipeline`
     OAuth project described in `pipeline/README.md`, or make a new one.
   - Authorized redirect URI: the callback URL Cloudflare shows you on this screen
     (it looks like `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`).
     Copy it from Cloudflare and paste it into the Google client.
   - Back in Cloudflare, paste the Google **Client ID**, **Client secret**, and your
     Workspace **admin email** + the **Google Workspace domain** `lyzr.ai`.
   - Click **Save**, then **Test** to confirm the round trip works.

   **Recommendation:** start with Option A (One-time PIN) to ship today, then switch
   to Option B (Google Workspace) for smoother SSO once a Workspace admin has ten
   minutes. The Access policy in section 3 is written so the same email-domain rule
   works for either login method.

4. Set your **team name** if prompted (this becomes `<team-name>.cloudflareaccess.com`).
   Note it down; it appears in IdP redirect URIs and the login page URL.

---

## 3. Create the Access application + policy

Create ONE self-hosted Access application that covers the protected paths, with a
single allow policy for the `lyzr.ai` email domain.

1. Zero Trust dashboard > **Access > Applications** > **Add an application**.
2. Choose type **Self-hosted**.
3. **Application configuration:**
   - **Application name:** `Lyzr Work OS - Internal`
   - **Session duration:** `24 hours` (or `1 week` if you prefer fewer logins;
     shorter is safer).
   - **Application domain / paths:** add the protected paths. Cloudflare Access lets
     you specify domain + path. Add one row per protected prefix:
     - `lyzr.kailash-gm.com` path `pipeline` (covers `/pipeline/*` including
       `/pipeline/data.json`)
     - `lyzr.kailash-gm.com` path `control` (covers `/control/*`)
     - `lyzr.kailash-gm.com` path `api` (covers `/api/*`; read section 6 first)
   - Do **NOT** add `lyzr.kailash-gm.com` with a bare `/` or `*` path. A wildcard at
     the root would swallow `/demo_pipeline/*`, `/reports/*`, and the home page and
     gate the entire site. Add only the specific path prefixes above.
   - Leave `/demo_pipeline`, `/reports`, `/tasks`, and `/` OUT of this application.
4. Click **Next** to define the policy.
5. **Policy:**
   - **Policy name:** `Allow lyzr.ai`
   - **Action:** `Allow`
   - **Configure rules > Include:** choose selector **Emails ending in** and value
     `@lyzr.ai`.
   - (Optional, if you used the Google Workspace IdP in section 2 Option B, you can
     instead use selector **Login Methods** = your Google Workspace connector, or
     **Emails ending in** `@lyzr.ai`; either works, the email-domain rule is the
     portable one.)
   - Leave **Require** and **Exclude** empty for v1.
6. Save. The application is live within seconds. Cloudflare will now challenge any
   unauthenticated request to `/pipeline/*`, `/control/*`, and `/api/*`.

> **Service token note for the write API:** if section 6 leads you to allow a
> service token for `/api/*`, add a **second policy** on this same application
> named `Service token for writes`, action `Service Auth` (or `Non-Identity`),
> Include = **Service Token** = the token you create. Order policies so the human
> `Allow lyzr.ai` policy is first.

---

## 4. Confirm `/demo_pipeline/*` is excluded

Because you only added specific path prefixes (`pipeline`, `control`, `api`) and
never a root wildcard, `/demo_pipeline/*` is already untouched and stays public.
Double-check there is no separate Access application with a broad `lyzr.kailash-gm.com`
domain rule that would catch it.

If you ever DO add a site-wide Access application later, you must add a **Bypass**
policy that includes `/demo_pipeline/*` (action `Bypass`, Include = `Everyone`),
ordered above the allow policy, or the embeds break.

---

## 5. How this replaces the existing client-side OAuth

Today there are three independent auth layers (see `KNOWLEDGE_BASE.md` section 10):

1. **Pipeline client-side Google OAuth** (in `pipeline/index.html`): cosmetic only,
   bypassable, because `data.json` is a static file.
2. **`/control/` password modal** (`sessionStorage.wos_auth`): test-grade
   (`kailash` / `Kail@lyzr`), no real protection.
3. **GSI Tracker Supabase auth:** separate app, not deployed here, unaffected.

Once Access is live on `/pipeline/*` and `/control/*`:

- The pipeline client-side OAuth becomes **redundant as a gate**. You can leave it
  in (harmless, and it still gives the app the user's email/name for the "My
  pipeline" view and for `created_by`), or simplify it later. Recommendation:
  **leave it for now**, since the app uses the Google identity for attribution. Just
  understand the real boundary is now Access, not that JS.
- The `/control/` password modal becomes redundant and weaker than Access. You can
  leave the modal (harmless) or remove it in a later cleanup. Either way, Access is
  now the real gate. Note: with Access in front, the modal will only ever be seen by
  already-authenticated `@lyzr.ai` users.
- Cloudflare passes the verified identity to your app in the `Cf-Access-Jwt-Assertion`
  header and the `CF_Authorization` cookie. If you later want the app to read the
  Access identity instead of running its own Google sign-in, the Pages Function can
  validate that JWT against `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`.
  That is a future enhancement, not required for this runbook.

---

## 6. Handling the GitHub-backed write API behind Access

The write path is: `pipeline/index.html` calls `POST /api/rows` or `PUT /api/rows?id=`,
which hits the root Pages Function `functions/api/rows.js`. That function verifies a
Google Bearer token server-side and commits the change to GitHub using a PAT.

When Access protects `/api/*`, two things are true:

1. **Browser writes still work.** A logged-in `@lyzr.ai` user already holds the
   `CF_Authorization` cookie from loading `/pipeline/`. Their browser sends that
   cookie on the `fetch('/api/rows', ...)` call automatically (same origin), so
   Access lets it through, and the existing in-function Google Bearer check still
   runs. No code change needed. This is the common case and it just works.

2. **Non-browser / automated writes need a service token.** If anything other than a
   logged-in browser must call `/api/*` (for example a future cron job, a CI step,
   or the Google Sheets sync function described in `docs/google-sheets-sync.md`),
   it will NOT have a `CF_Authorization` cookie and Access will block it with a
   login redirect. For those, create a **Cloudflare Access service token**:
   - Zero Trust > **Access > Service Auth > Service Tokens** > **Create Service Token**.
   - Name it (e.g. `sheet-sync-writer`), copy the **Client ID** and **Client Secret**
     (shown once).
   - Add the second policy described at the end of section 3 (`Service Auth`,
     Include = that service token) to the Work OS application.
   - The automated caller then sends two headers on every request:
     `CF-Access-Client-Id: <client-id>` and `CF-Access-Client-Secret: <client-secret>`.
   - Store those secrets wherever the caller runs (GitHub Actions secrets, or
     Cloudflare Pages secrets), never in the repo.

> **Decision for v1:** if you have no automated writers yet, you do NOT need a
> service token. Add it only when you wire up the Sheets sync or a cron writer.

> **Important ordering caveat.** The in-function Google Bearer check in
> `functions/api/rows.js` is owned by the pipeline agent. Do not remove it when you
> add Access; keep both. Access gates the edge, the Bearer check gates the identity
> recorded into `edit_history`. Belt and braces.

---

## 7. Verification checklist

Run all of these after the application + policy are live. Use a private/incognito
window so you start with no session.

- [ ] **Protected, logged out:** open `https://lyzr.kailash-gm.com/pipeline/` in
      incognito. You are redirected to the Cloudflare Access login page (One-time
      PIN screen, or Google). You are NOT shown the dashboard first.
- [ ] **Raw data is gated:** open `https://lyzr.kailash-gm.com/pipeline/data.json`
      directly in incognito. You are redirected to Access login, NOT served JSON.
      (This is the key win over the old client-side OAuth.)
- [ ] **Control is gated:** open `https://lyzr.kailash-gm.com/control/` in incognito.
      You hit the Access login, not the control panel.
- [ ] **Login with @lyzr.ai succeeds:** complete the PIN or Google flow with a
      `@lyzr.ai` address. You land on the requested page.
- [ ] **Login with non-lyzr address fails:** try a personal Gmail. Access denies
      with "You do not have access" (the `@lyzr.ai` policy rejected it).
- [ ] **Demo stays public:** open `https://lyzr.kailash-gm.com/demo_pipeline/` in
      incognito. It loads with NO login prompt.
- [ ] **Demo embed still works:** if the demo is embedded anywhere (iframe), confirm
      the iframe still renders and is not replaced by an Access login screen.
- [ ] **Reports and home stay public:** `https://lyzr.kailash-gm.com/reports/` and
      `/` load with no login prompt.
- [ ] **Browser write still works:** while logged in, add or edit a row in the
      pipeline dashboard. Confirm it saves (a `data: add` / `data: edit` commit
      appears in GitHub within ~30s). This proves `/api/*` lets the cookie through.
- [ ] **Session expiry:** after the session duration you set, confirm you are asked
      to log in again (optional, slow to test).

---

## 8. Rollback

If anything is gated that should not be, or the demo breaks:

1. Zero Trust > **Access > Applications**.
2. Either **Edit** the `Lyzr Work OS - Internal` application and remove the
   offending path, or **Delete** the application entirely to instantly remove all
   Access gating (the site reverts to the prior client-side-OAuth-only state).
3. Changes take effect within seconds. No redeploy needed (Access is independent of
   the Pages build).

---

## 9. What input is needed from the user

To actually turn Access on, the user must:

- [ ] Confirm which login method to use: **One-time PIN** (ship today, no IdP) or
      **Google Workspace IdP** (needs a Workspace admin and a Google OAuth client).
- [ ] Confirm the exact set of protected paths matches section 1 (especially: is it
      OK that `/reports/*` stays public? Default assumption: yes).
- [ ] Confirm whether the public demo (`/demo_pipeline/`) reads `/pipeline/data.json`
      directly or via its own function. If directly, decide between a public bypass
      on `/pipeline/data.json` (re-opens data) or a separate public data copy
      (preferred; needs the pipeline agent).
- [ ] Decide whether any automated/non-browser writer exists yet. If yes, a service
      token (section 6) is needed; if no, skip it.
- [ ] Perform the dashboard steps in sections 2 and 3 (this runbook cannot do them).
