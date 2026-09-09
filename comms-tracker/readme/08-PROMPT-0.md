# Prompt 0 — The Kickoff Prompt

If you are the person this project was handed to: copy everything inside
the fenced block below, exactly as it is, and paste it as your **first
message** to Claude Code (or any coding agent with file access to this
`comms-tracker/` folder and a shell). Don't edit it, don't summarize it —
paste it whole. It is written to be self-contained: the agent needs
nothing else from you to build a correct mental model and get moving.

It tells the agent to read this whole `readme/` folder and the codebase
before doing anything, report back what it found in its own words so you
can sanity-check its understanding, and then work through the outstanding
setup and roadmap in order — stopping to check with you at each point
listed in the prompt's own "stop and ask" rules, rather than guessing on
anything that is actually your call to make.

---

```
You are taking over as the lead engineer for an existing project called
Comms Tracker. You have shell and file access to its codebase, which is
the folder you are currently rooted in (comms-tracker/, or wherever this
repository's root now lives). Someone else built it and has fully
documented the handover in a folder inside this repo: readme/. Do not
trust your assumptions about what a project like this "usually" looks
like — this one has specific, sometimes unusual decisions (a static
export talking straight to Supabase with no server, syncs that
deliberately do NOT run inside the Cloudflare Worker, one channel that is
permanently read-only by product decision) that only the readme/ folder
and the actual code will tell you.

PHASE 0 — Build a correct mental model before touching anything.

Read, in this exact order:
  readme/00-START-HERE.md
  readme/01-PRODUCT-REQUIREMENTS.md
  readme/02-ARCHITECTURE-AND-CURRENT-HOSTING.md
  readme/03-SECRETS-AND-CREDENTIALS.md
  readme/04-HANDOVER-SETUP-GUIDE.md
  readme/05-DATABASE-SCHEMA-AND-MIGRATIONS.md
  readme/06-OPERATIONS-RUNBOOK.md
  readme/07-KNOWN-ISSUES-AND-ROADMAP.md

Then skim the actual code to confirm the docs still match reality (docs
rot; the code is the final authority when they disagree): package.json,
wrangler.jsonc, worker/index.ts (every route), the supabase/migrations/
folder (just the filenames and each file's header comment is enough at
this stage), lib/sync/, lib/mail/, lib/knowledge/, lib/ai/, and the app/
folder's page structure. Check whether comms-tracker/.env.local exists
and has real-looking values in it (it is gitignored, so `git status`
alone will not show it — use `ls -la`) — it holds the actual current
secret values referenced throughout readme/03-SECRETS-AND-CREDENTIALS.md.

Also check, before assuming anything about hosting or git state:
  - Is this folder already its own git repository (`git remote -v`), or
    still sitting inside someone else's larger repo?
  - Is a Cloudflare Worker already deployed and reachable at whatever URL
    NEXT_PUBLIC_SITE_URL in wrangler.jsonc currently claims?
  - Do the Supabase credentials in .env.local currently point at a live,
    reachable project (a quick authenticated REST call to
    `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/accounts?select=id&limit=1` with
    the service-role key will tell you), and if so, which of the 15
    migrations in supabase/migrations/ are already applied there versus
    still pending? (Check for a column/table a later migration adds —
    e.g. communication_events.body_text for migration 011 — the same way
    readme/05-DATABASE-SCHEMA-AND-MIGRATIONS.md describes checking this.)
  - Is there a GitHub Actions workflow already running on a schedule
    somewhere for this project (`gh workflow list`, if you know which
    repo), separate from the copy inside this folder's own
    .github/workflows/?

Then report back to me, in your own words, before doing anything else:
  1. What this product actually does and who it's for, in 2-3 sentences.
  2. What is fully built and live right now versus what is built-but-off
     versus what does not exist in code at all yet — pull this from
     readme/01-PRODUCT-REQUIREMENTS.md and confirm it against the code,
     don't just restate the doc.
  3. Whether this folder is already a standalone repo with its own live
     hosting, or still needs the full readme/04-HANDOVER-SETUP-GUIDE.md
     migration to a new Supabase project / git repo / Cloudflare Worker —
     based on what you actually found in the checks above, not an
     assumption.
  4. Which of migrations 011 through 015 are already applied on whichever
     Supabase project .env.local currently points at, and which are not.
  5. Anything in the docs that contradicts what you found in the code —
     flag it, don't silently pick one side.

Stop after this report and wait for me to confirm or correct your
understanding before moving to Phase 1. This is the one mandatory
checkpoint in this whole prompt — everything after this point you should
work through on your own judgment, checking in only where a rule below
tells you to.

PHASE 1 — Get to a known-good, fully operational state.

Work through readme/04-HANDOVER-SETUP-GUIDE.md and
readme/05-DATABASE-SCHEMA-AND-MIGRATIONS.md as applicable given what
Phase 0 found:

  - If this is genuinely fresh hosting: walk the setup guide in full —
    new Supabase project, migrations 001 through 015 in order, new git
    repo, new Cloudflare Worker, OAuth redirect URIs added (not replaced)
    on the existing Google and Microsoft app registrations, GitHub
    Actions secrets, a full data refresh, and the smoke checks the guide
    describes.
  - If hosting already exists and is live: just get the database current
    (apply whichever of migrations 011-015 Phase 0 found missing, in
    order, one at a time, in the Supabase SQL Editor) and verify the app
    still works end to end afterward — sign in, the Tracker page loads
    with real data, Data & Sync's "Refresh all" successfully queues and
    completes.
  - Either way: confirm the daily refresh is actually scheduled and
    working (check the most recent scheduled run's outcome, not just that
    the workflow file exists), not merely deployed-and-hoped.

Do not decommission or delete anything belonging to the previous owner
(their Cloudflare Worker, their Supabase project, their git repo) as part
of this phase, even if your setup guide's own later steps mention it as
an eventual option — that is a call for me to make once I've personally
verified the new setup, not something to do automatically.

PHASE 2 — Chase down what's blocking, not coding.

readme/07-KNOWN-ISSUES-AND-ROADMAP.md names one thing blocked purely on a
human action, not code: Outlook mail and OneDrive/SharePoint are fully
built and deployed but inert until a Lyzr Microsoft 365 Global
Administrator grants one tenant-wide admin consent. Find the exact link
(readme/03-SECRETS-AND-CREDENTIALS.md has it, built from
MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / NEXT_PUBLIC_SITE_URL in this
project's own config) and tell me who to send it to and what to say —
don't try to grant it yourself, you almost certainly don't hold that
role. Once it's granted (I'll tell you), verify Outlook mail reading and
the onedrive knowledge source both actually work with a real connected
mailbox, the same way readme/06-OPERATIONS-RUNBOOK.md describes verifying
any other source.

PHASE 3 — Build what's explicitly queued next, in order.

Per readme/01-PRODUCT-REQUIREMENTS.md section 3:

  3.1 is the Phase 2 admin-consent item above, not a coding task by
      itself — once it's granted, confirming it works IS the deliverable
      for 3.1. No further code should be needed.

  3.2 Add Microsoft/Outlook as a genuine SIGN-IN method for the app
      itself (distinct from the mailbox-connection feature that already
      exists — re-read the PRD section carefully, the two are easy to
      conflate and the doc explains exactly why they're different). This
      is real, unbuilt work. Before writing any code for this: the PRD
      flags an actual product decision that has not been made yet
      (whether signing in with Microsoft should auto-link that same
      mailbox for reading, or leave that as a separate later consent step
      the way Gmail sign-in and Gmail mailbox-connection are separate
      today). Bring me that specific decision explicitly and get my
      answer before building — do not assume either direction on your
      own. Once you have my answer, build it, and hold it to the same bar
      as the rest of this codebase: it already has a working, deployed
      convention for OAuth flows (both the Supabase-Auth-managed Google
      flow and the Worker-owned Microsoft mail flow) — follow whichever
      pattern fits, don't invent a third one. Update
      readme/01-PRODUCT-REQUIREMENTS.md to move this from "to be built"
      to "built" with the same level of description the other built
      features have, once it's done and verified.

PHASE 4 — Ongoing operation.

Once Phases 1-3 are done, you are effectively the maintainer of this
project going forward. readme/06-OPERATIONS-RUNBOOK.md is your reference
for routine tasks (triggering refreshes, adding admins, rotating a
secret, diagnosing a failed sync). readme/07-KNOWN-ISSUES-AND-ROADMAP.md
has the backlog of known-but-not-queued gaps (Needs Review has no manual
linking action, Cortex's richer project fields aren't synced, a
duplicate-record edge case worth watching for) — treat these as things to
raise with me before starting, not things to silently pick up on your own
initiative, since none of them were requested as "build this now."

RULES THAT APPLY THE WHOLE TIME, NOT JUST ONE PHASE:

  - Never commit comms-tracker/.env.local, never paste its contents into
    a chat message, a commit message, a doc, or anywhere else outside
    that one file and whatever secret-manager equivalent you configure
    (Cloudflare Worker secrets, GitHub Actions secrets). If you ever need
    to reference what a secret IS, name it and point to
    readme/03-SECRETS-AND-CREDENTIALS.md — never restate its value.
  - Before running any command that could discard uncommitted work
    (git checkout/restore/reset/clean, rm -rf, restoring from a backup),
    check git status first and stash or commit what's there.
  - Before pushing to git, deploying to Cloudflare, applying a migration
    to a database with real data in it, or granting/rotating a shared
    credential: tell me what you're about to do and why, in one or two
    sentences, before doing it — these are exactly the "hard to reverse
    or visible to others" actions that deserve a beat of confirmation
    even when you're otherwise working autonomously.
  - If something in the readme/ docs turns out to be stale or wrong once
    you check it against the live code or a live service, say so plainly
    and update the doc — don't silently work around a doc you know is
    wrong, and don't silently leave it wrong for the next person either.
  - Match your own future documentation style to what's already here:
    the readme/ docs explain WHY a decision was made, not just what it
    is, and they say plainly when something is not yet done rather than
    implying it's further along than it is. Keep doing that.
```
