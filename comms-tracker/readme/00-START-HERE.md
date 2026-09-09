# Comms Tracker — Handover Package

Read this folder before touching anything. It is written for whoever is
taking this project over, assuming no prior context beyond what is in this
folder and the `comms-tracker/` codebase itself.

## What this project is, in one paragraph

Comms Tracker is an internal Lyzr tool that reconciles three systems —
Cortex (who is engaged, on what project), HubSpot (who is a paying
customer, and the sales/deal side), and every email channel available
(Instantly campaigns, HubSpot activity, and each user's own connected
Gmail/Outlook mailbox) — into one dashboard. Its job is to catch a
customer going quiet on their product-update cadence before it becomes a
relationship problem, and to make sending the next update easy: it
suggests topics grounded in Lyzr's own content (blog posts, Slack, Drive,
meeting notes, internal email) and drafts the email, but the actual send
always happens in the user's own Gmail or Outlook, one click at a time.

## Why this handover exists

The person building this is handing the `comms-tracker/` folder to someone
else, who will run it going forward under their own Supabase project, own
git repository, own Cloudflare hosting, and (redirect URIs aside) the same
OAuth apps. Everything needed to do that is in this folder.

## Read in this order

1. **[01-PRODUCT-REQUIREMENTS.md](01-PRODUCT-REQUIREMENTS.md)** — what the
   product is supposed to do. Every feature that is built, with a
   description of how it actually works, and every feature that is not
   built yet, with why and what it would take.
2. **[02-ARCHITECTURE-AND-CURRENT-HOSTING.md](02-ARCHITECTURE-AND-CURRENT-HOSTING.md)**
   — the stack, the data flow, and exactly what is live today (URLs,
   accounts, repo) so you know what you are inheriting before you change
   any of it.
3. **[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md)** —
   every API key, OAuth credential, and secret the app uses: what it is
   for, where its current value lives, and how to get or rotate your own.
4. **[04-HANDOVER-SETUP-GUIDE.md](04-HANDOVER-SETUP-GUIDE.md)** — the
   concrete steps to stand this app up under a new Supabase project, a new
   git repository, and new Cloudflare hosting, reusing the existing OAuth
   app credentials.
5. **[05-DATABASE-SCHEMA-AND-MIGRATIONS.md](05-DATABASE-SCHEMA-AND-MIGRATIONS.md)**
   — what every one of the 15 migration files does, and the order to run
   them in on a fresh Supabase project.
6. **[06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md)** — the things
   you will actually do week to week: trigger a refresh, add an admin,
   fix a stuck sync, read the logs.
7. **[07-KNOWN-ISSUES-AND-ROADMAP.md](07-KNOWN-ISSUES-AND-ROADMAP.md)** —
   open bugs, deliberate gaps, and the two features explicitly queued next
   (finishing Microsoft/Outlook access, and Outlook as a sign-in option).
8. **[08-PROMPT-0.md](08-PROMPT-0.md)** — a ready-to-paste prompt for
   Claude or any coding agent that reads all of the above, confirms its
   understanding with you, and then works through setup and the roadmap
   in order. If you'd rather have an AI walk you through this whole
   folder than read it yourself first, start there instead of at step 1.

## The one-sentence status

Everything in the product requirements' "Built" section is live today at
`https://lyzr.kailash-gm.com/abm-tracker/` and syncs daily; the only things
not fully switched on are Outlook mail/OneDrive/SharePoint (blocked on a
Microsoft tenant admin clicking one consent link) and Microsoft as a
sign-in option (not built at all yet — see the roadmap doc).

## Where the actual secrets are

This document set explains what each secret is and where to find or
rotate it. It does **not** duplicate the live values — those already exist
in this folder's `comms-tracker/.env.local`, which is being handed over
with the rest of the folder and is excluded from git (`.gitignore`) on
purpose. Treat that file exactly like a password vault: never commit it,
never paste its contents into chat, Slack, or a doc.
