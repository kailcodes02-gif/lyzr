# Known Issues and Roadmap

## Blocking on someone else, not on code

**Outlook mail + OneDrive/SharePoint are fully built and deployed but
switched off**, waiting on a Lyzr Microsoft 365 Global Administrator to
grant tenant-wide consent (one link, one click — see
[03-SECRETS-AND-CREDENTIALS.md](03-SECRETS-AND-CREDENTIALS.md) for the
exact link). This is the single highest-value thing to chase down first —
everything else in the "to be built" list is genuinely new work, but this
one just needs a click from someone with the right role in the tenant.

## Explicitly queued next (see the PRD for full detail)

1. **Complete Microsoft/Outlook access** — the admin-consent click above.
2. **Add Microsoft/Outlook as a sign-in method** (distinct from mailbox
   reading, which already exists) — not built at all yet. See
   [01-PRODUCT-REQUIREMENTS.md](01-PRODUCT-REQUIREMENTS.md) §3.2 for what
   this actually involves and the product decision it needs before
   building.

## Known gaps, not currently queued

- **Needs Review has no manual action** — it surfaces unmatched HubSpot
  companies and unmatched emails but offers no way to manually link them
  from the UI.
- **Cortex's richer project fields aren't synced** — budget, health
  status, dates, hours, and weekly status notes exist in the Cortex API
  but the sync only pulls name, status, and the project manager today.
  The weekly status note in particular would be good input for the
  AI topic-suggestion engine.
- **A duplicate-record edge case**: two Cortex projects (Verifone,
  one WTW project) each appeared twice with different statuses during an
  audit — most likely duplicate Cortex-side records, not a sync bug, but
  worth a look if account rows seem to duplicate.

## Fixed during this handover (2026-09-09) — verify they landed if you
   inherit the existing Supabase project rather than starting fresh

- **Mislabeling risk**: a HubSpot contact who is actually a Lyzr teammate
  (CC'd on a deal, an internal test contact) could previously be filed as
  an external client contact if HubSpot's sync ran before Cortex ever
  recorded that person. Fixed at both the application level
  (`lib/sync/hubspot-sync.ts`, `lib/sync/people.ts`) and the database
  level (migration `013`, a trigger that makes this impossible regardless
  of code path). A live check at the time found zero already-affected
  rows.
- **No project-scoped visibility**: every signed-in user could see every
  account and project. Migration `014` restricts non-admins to only what
  they are an internal stakeholder on.
- **Full email bodies missing**: only a ~400-character preview was ever
  stored, so the double-click "read the full email" feature could only
  show a preview. Migration `011` adds full-body storage.
- **Knowledge search was full-table-scan slow**: migration `012` adds a
  proper indexed ranked-search function; the app still works without it
  (slower fallback), so this is a performance fix, not a correctness one.

If you inherit the existing Supabase project, these five migrations
(011–015) need to be run before relying on the features they enable — see
[05-DATABASE-SCHEMA-AND-MIGRATIONS.md](05-DATABASE-SCHEMA-AND-MIGRATIONS.md)
for their current status.

## Things that look like bugs but are deliberate design

- **Needs Review being empty is normal**, not evidence something is
  broken — it only holds records a sync genuinely could not match; see
  the product requirements doc §2.9 for why.
- **A member seeing zero accounts on the Tracker page** after the
  visibility change (migration 014) is expected if that person has never
  been recorded as an internal owner on any project — not a bug in the
  new restriction, just what "you only see what you're associated with"
  means for someone new.
- **Instantly is read-only, permanently, by product decision** — it will
  never become a send channel. If someone asks for that, it's a scope
  change to confirm explicitly, not a bug report.
