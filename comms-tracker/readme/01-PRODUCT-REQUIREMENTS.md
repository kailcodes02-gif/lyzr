# Product Requirements — Comms Tracker

This is the working PRD as of 2026-09-09. It documents what has actually
been built and verified against live data, and what is explicitly queued
next. Where something in an earlier planning conversation was suggested
but never requested or built, it is called out at the end as backlog, not
mixed into the built list.

Every "Built" item below has been exercised against the live Supabase
project and, where it touches an external API, against a real account
(Cortex, HubSpot, Instantly, or a real Gmail inbox). Nothing in the Built
section is speculative.

---

## 1. Purpose

Give Lyzr account owners one place to see, per customer project: who is
engaged, who is a paying customer, what has already been communicated
across every channel, and whether the relationship is going quiet — with
a fast path to draft and send the next update grounded in Lyzr's own
recent content, from the sender's own mailbox.

---

## 2. Built

### 2.1 Authentication and access control

- **Google SSO**, restricted at the UI level to the `lyzr.ai` account
  chooser (`hd=lyzr.ai` on the OAuth request). This is a hint to Google's
  account picker, not a server-enforced domain lock — see
  [03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md) for the
  implication.
- **Two access tiers**: `admin` and `member`, stored on the `users` table.
  New sign-ins default to `member`; a fixed list of email addresses gets
  `admin` automatically on first sign-in (currently `subs@lyzr.ai`,
  `kailash.gm@lyzr.ai`, `shekar@lyzr.ai`, `kailash.gm@lyzr.com`,
  `deepankar.dimri@lyzr.com`, `shekar@lyzr.com` — see migration `015`).
  Admins can promote or demote any other user from the Users page.
- **Project-scoped visibility for non-admins** (migration `014`): an admin
  sees every account and project, unchanged. Anyone else only sees the
  accounts and projects where they are recorded as an internal
  stakeholder (Product Owner, Deal Owner, Project Owner, or any other
  admin-configured owner role) — enforced with Postgres Row Level Security
  on `accounts`, `projects`, `project_people`, `account_people`,
  `communication_events`, `tasks`, and `task_items`, so it holds even if
  someone queries Supabase directly rather than through the app's UI. The
  dashboard pages needed no code changes for this — they already query
  through the signed-in user's own session, so RLS does the filtering
  transparently.

### 2.2 Data hierarchy

- **Account → Projects → Stakeholders.** Each customer account can have
  multiple Cortex projects; each project has its own internal owners and
  its own external (client) contacts, rather than one flat contact list
  per account.
- **Two distinct role concepts, kept separate on purpose:**
  - *Project-level stakeholder roles* — Product Owner and Deal Owner
    auto-populate from Cortex (project manager) and HubSpot (deal owner)
    respectively on every sync; Project Owner has no automatic source and
    is admin-assigned. Admins can rename, deactivate, or add new roles
    from the Project Roles page. Reassigning a role from a project's page
    locks it as a manual override so the next sync does not silently
    revert it.
  - *Dashboard access tier* — `admin` / `member`, unrelated to the above.

### 2.3 Data sources (synced daily, and on demand)

All three run through GitHub Actions, not the Cloudflare Worker directly
— a Worker invocation is capped at a small number of outbound HTTP calls
("too many subrequests"), which even the smallest of these three exceeds
once real volume is involved.

- **Cortex** — accounts, projects, project status, the project manager
  (Product Owner), and client sponsors/contacts. ~54 accounts, ~130
  projects at current scale.
- **HubSpot** — reconciled against Cortex-anchored accounts by exact
  domain match (not a full portal crawl — HubSpot has ~250k companies,
  only the ones matching a known account domain are pulled). Adds
  customer/deal status, the deal owner (Deal Owner role), HubSpot
  contacts as additional client POCs, and HubSpot's own email-activity
  history as communication events. **Internal-domain safety net**: a
  HubSpot "contact" whose address is `@lyzr.ai` or `@lyzr.com` (a
  teammate CC'd on a deal, an internal test contact) is never filed as an
  external client contact — enforced both in the sync code and with a
  database trigger (migration `013`) so it holds regardless of which
  future code path writes a `people` row.
- **Instantly** — read-only, by explicit product decision. Pulls sent
  emails from campaigns tagged for product updates (currently tag
  `ABM`). Instantly is never a send channel from this app.
- One shared **Sync Admin / Data & Sync** page shows every source, its
  last-run time, a manual per-source "Refresh" button, and a scrollable
  log of recent runs with their fetched/stored counts and any error text.

### 2.4 Going-dark tracking

A project with no matched communication in the last 15 days is flagged,
across 4 increasingly severe shades the further past that threshold it
drifts (a project never contacted at all is the worst shade). An
account's row shows whichever of its projects is furthest gone — the
worst case, not an average, since a quietly-slipping single project is
exactly the failure mode this exists to catch.

### 2.5 Mailbox reading (per-user, opt-in, read-only)

- **Gmail**: one Google consent grants both this and Drive knowledge
  access (`drive.readonly` + `gmail.readonly`). Reads Sent and Inbox
  (Gmail's own spam/promotions/social folders excluded), keeps only
  messages touching a tracked account or contact, and logs them as
  communication events tied to the right project — so an email sent from
  someone's personal inbox shows up exactly like one sent through
  Instantly or HubSpot.
- **Outlook**: same idea via Microsoft Graph, through a separate
  Worker-owned OAuth flow (not Supabase Auth — sign-in to the app itself
  stays Google-only; Outlook here is a *connected mailbox*, not a sign-in
  method — see §3 for the distinction and what "add Outlook OAuth" as a
  sign-in method would additionally mean).
- **Confirms optimistic "sent via app" rows**: when the Generate & Send
  flow opens a compose window, it immediately logs an unconfirmed row;
  once the real sent message shows up in that mailbox, the row is stamped
  confirmed.
- Feeds the **internal-email knowledge store** (see 2.6) with anything
  from `siva@lyzr.ai` / `siva@lyzr.com` seen in any connected mailbox.
- **Status**: Gmail is fully live and verified against a real inbox.
  Outlook's code is complete and deployed but inert until a Lyzr
  Microsoft 365 Global Administrator grants tenant-wide consent — see
  [07-KNOWN-ISSUES-AND-ROADMAP.md](07-KNOWN-ISSUES-AND-ROADMAP.md).

### 2.6 Knowledge base (feeds the suggestion/draft engine below)

Six distinct sources, each tracked separately by type and recency (not
one blob):

| Source | What it is | Status |
|---|---|---|
| `lyzr_blog` / `lyzr_case_study` | Full-site scrape of lyzr.ai, summarized by Sonnet, re-checked weekly by content hash | Live — 405 blog posts, 53 case studies |
| `slack` | Channels the bot has been invited into | Live — 5 channels |
| `drive` | Google Docs/Sheets/Slides the connected user can open | Live — 199 documents |
| `onedrive` | OneDrive + SharePoint documents, via the same Microsoft connection as Outlook | Built, waiting on the same tenant admin consent as Outlook mail |
| `meeting_notes` | Google Meet's "Notes by Gemini" documents, filed separately from generic Drive files | Live — 116 documents |
| `internal_email` | Emails from `siva@lyzr.ai` / `siva@lyzr.com`, populated by the mailbox reads | Live — 26 documents |

### 2.7 AI-assisted topic suggestion and drafting (Sonnet only, everywhere)

On a project's **Generate & Send**:

- **Five topic suggestions**, ranked by recency across the knowledge base,
  each tagged with the source it came from.
- **A free-text "your topic" box**: whatever the user types becomes a
  selectable topic in its own right, and simultaneously triggers a ranked
  full-text search across every knowledge source (indexed search when
  migration `012` is applied; a client-side-ranked fallback otherwise).
  Matching documents appear as selectable items with an excerpt of the
  relevant passage; the top three matches are pre-selected.
- **Grounded drafting**: whichever documents are ticked (suggested,
  searched, or both) are passed to Sonnet as reference material with an
  explicit instruction not to invent facts, numbers, or dates that are not
  in them. This is what makes the draft specific to Lyzr's actual recent
  work rather than generic filler.
- **Subject and body are always visible and editable**, whether or not a
  draft has been generated — a user can write the whole email by hand and
  skip generation entirely, or edit a generated draft before sending.
- **Gmail / Outlook toggle**: the "Open" button builds a pre-filled
  compose URL for whichever provider is selected and opens it in a new
  tab. The app never sends on the user's behalf — every send is a manual
  click inside the provider's own compose window. The app immediately logs
  an unconfirmed "sent via app" row (see 2.5 for how it gets confirmed).

### 2.8 Tasks

A lightweight per-account checklist for the "get the next update out"
workflow — description, due date, a list of checklist items each
optionally assigned to a Lyzr teammate, status rolled up automatically
from item completion. Anyone can create a task and check off items;
deletion is restricted to the task's creator or an admin.

### 2.9 Needs Review

A safety net, not a queue that is expected to be busy: any HubSpot company
that could not be domain-matched to a Cortex account, or any synced email
whose sender/recipient could not be resolved to a known account or
person, is parked here instead of being silently dropped. Read-only today
(no manual "link this to that account" action yet — see §4). The sidebar
entry is hidden entirely until there is actually something in it, with a
count badge when there is.

### 2.10 Full email viewing

Double-clicking (or pressing Enter on) any email row — in an account
timeline, a project timeline, a contact's recent-emails list, or the
Needs Review list — opens the complete message: from, to, date, source,
direction, the linked account/project, the AI summary if one exists, and
the full body. HubSpot, Instantly, Gmail, and Outlook all store the full
plain-text body (migration `011`); older previews before that migration
show the stored snippet instead and say so.

### 2.11 Admin tooling

- **Project Roles** — rename, deactivate, or add project-level owner
  roles.
- **Users** — see everyone who has signed in, promote or demote admins.
- **Data & Sync** — trigger any source, mailbox, or knowledge refresh on
  demand; see the last 20-ish runs with their outcome and any error.

### 2.12 Design system

Every screen is built on a small shared shadcn/ui-style component set
(button, badge, card, table, tabs, input/textarea/select/label, dialog,
tooltip, page-header/empty-state/loading helpers) on top of shadcn's
neutral design tokens, so the whole app reads as one consistent product
rather than a collection of one-off screens.

---

## 3. To be built

### 3.1 Finish Microsoft/Outlook access (mailbox + OneDrive/SharePoint)

**What's already done**: the code for Outlook mail reading and
OneDrive/SharePoint knowledge ingestion is complete, deployed, and
covered by the same "Connect Outlook" button on Data & Sync. It is
verified working end-to-end for the OAuth exchange, token storage, and
API calls — the only thing blocking it is authorization.

**What's left, and it is not a code task**: Lyzr's Microsoft 365 tenant
is configured so that ordinary users cannot consent to a new app's
permissions themselves (`Sites.Read.All` in particular triggers this). A
Global Administrator, Privileged Role Administrator, or Cloud Application
Administrator in the tenant needs to open one link and click Accept —
this grants the app's five permissions (`Mail.Read`, `Files.Read.All`,
`Sites.Read.All`, `User.Read`, `offline_access`) for the whole
organization at once. The exact link is in
[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md) under the
Microsoft/Azure entry. Once granted, every `@lyzr.com` user can click
Connect Outlook with no further setup, and OneDrive/SharePoint ingestion
starts working on the very next scheduled refresh.

### 3.2 Add Microsoft/Outlook as a sign-in method

This is distinct from 3.1 above, and worth spelling out because the two
are easy to conflate. Today, signing *into the app itself* is Google-only
(`app/login/page.tsx`). "Connect Outlook" is a separate, later step a
signed-in user takes to link their mailbox for reading — it never lets
someone sign into the app with a Microsoft account.

Adding Microsoft as a genuine second sign-in option means:

- Enabling the Microsoft/Azure AD provider in Supabase Auth (Authentication
  → Providers), pointed at the same Azure app registration already used
  for mail (or a dedicated one, since sign-in typically wants a narrower
  scope than `Mail.Read`/`Files.Read.All` — `openid`, `email`, `profile`
  are enough for authentication alone).
- A second button on the login page ("Continue with Microsoft"), and the
  domain restriction (`hd=lyzr.ai` today) reconsidered for whatever the
  Microsoft-side equivalent should be — Microsoft's authorize endpoint
  does not have a direct analogue to Google's `hd` hint, so the
  restriction would likely need to move to `MS_GRAPH_TENANT_ID` (already
  in place) so only that one tenant's accounts can authenticate at all.
- Deciding whether a user who signs in with Microsoft still gets the
  "Connect Gmail"/"Connect Outlook" mailbox flows as-is, or whether
  signing in with Microsoft should auto-link that same mailbox for reading
  (skipping a separate consent step) — a real product decision, not just
  an implementation detail, and one that should be made explicitly before
  building it rather than assumed.

Nothing for this item exists in code yet. It is a genuinely new piece of
work, roughly comparable in size to the Outlook mailbox-reading feature
that already exists.

---

## 4. Known gaps (not requested as "to be built," but worth the next
   owner knowing about)

- **Needs Review has no manual action.** It shows what could not be
  auto-matched but offers no "link this HubSpot company to this account"
  or "assign this email to this person" button yet.
- **Cortex's richer project fields are not synced.** The Cortex API
  returns budget, health status, start/end dates, hours, and a weekly
  status-note summary per project; today only name, status, and the
  project manager are pulled. The weekly status note in particular would
  be strong material for the topic-suggestion engine. This was scoped out
  during an audit, not requested, and is a reasonable next enhancement.
- **A duplicate-domain edge case in HubSpot matching** was observed
  (Verifone and one WTW project each appeared twice with different
  statuses), most likely duplicate records on the Cortex side rather than
  a sync bug — worth a closer look if it recurs.
