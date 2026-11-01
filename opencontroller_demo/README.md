# opencontroller interactive demo

Live at `https://lyzr.kailash-gm.com/opencontroller_demo/`. Static ES modules, no build step, served by
the root Cloudflare Pages site; the sign-in API is Pages Functions in `functions/api/ocdemo/`.

| Path | What it is |
|---|---|
| `/opencontroller_demo/` | Landing page (Lyzr dark brand) with "Explore the demo" and "Book a demo", and the access gate |
| `/opencontroller_demo/app/` | The clickable prototype: every opencontroller screen on synthetic data, with an explainer card per screen |
| `/opencontroller_demo/admin/` | Who signed in and what they opened (Campaign Analytics editors only) |

## The gate

- **I work at Lyzr**: Microsoft sign-in (MSAL popup, the "Lyzr MS UI" Entra app). The token is checked
  against Graph `/me`; only `@lyzr.com` / `@lyzr.ai` get in.
- **I am outside Lyzr**: name, work email, company, role. The email must be well formed, not a personal or
  throwaway provider (Gmail, Outlook.com, Yahoo, Proton, Mailinator and about 150 more), and its domain must
  have MX records (Cloudflare DNS over HTTPS). With a mail provider configured, a 6-digit code is emailed too.
- Each sign-in is stored in `ocdemo_leads`; screens opened and actions taken go to `ocdemo_events`.

## Setup

1. **Database** (needed to keep sign-ins): run `supabase/001_ocdemo_leads.sql` in the SQL editor of the
   Supabase project behind the Pages secret `CA_SUPABASE_URL` (the Campaign Analytics project). Until then
   visitors still get in, and the function log says `lead not stored`.
2. **Microsoft sign-in**: in Entra ID › App registrations › "Lyzr MS UI" (client `cd569c2f-…`) ›
   Authentication › Single-page application, add the redirect URI
   `https://lyzr.kailash-gm.com/opencontroller_demo/`.
3. **Email codes** (optional): set Pages secrets `RESEND_API_KEY` and `OCDEMO_MAIL_FROM`
   (e.g. `opencontroller <demo@lyzr.ai>`, on a domain verified in Resend). Without them the gate verifies
   the domain only.

## The prototype

- `app/js/data.mjs` builds the estate from a fixed seed (483 assets, 36 policies, spend, gateway,
  traces, evals). `store.mjs` derives every number from it (registered %, findings, needs-attention)
  and holds every action; changes persist in the visitor's browser, and Reset puts the seed back.
- `explain.mjs` holds the "About this screen" cards and the 15-stop guided tour.
- The role switch in the top bar (Owner, Admin, Operator, Viewer) disables what each role cannot do.
- Tests: an end-to-end Playwright run (109 checks: every route, every flow, phone widths) was used
  before publishing; see the build log in `KNOWLEDGE_BASE.md`.
