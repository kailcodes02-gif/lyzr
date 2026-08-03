# Architectural Decisions

## D1: Next.js 16 instead of 14
The scaffold created Next.js 16.2.6 (latest). Keeping it rather than downgrading since it is backwards-compatible with the App Router patterns specified and avoids wasting time on version management.

## D2: Tailwind v4 with CSS-based config
The scaffold uses Tailwind v4 with @tailwindcss/postcss. shadcn/ui supports this. No tailwind.config.js needed; CSS variables in globals.css.

## D3: Hardcoded channel fields (not generic engine)
Per Core v0 scope, channel-specific planning and tracker fields from spec section 8 are hardcoded as typed React form components. The generic Notion-style custom-field engine is Phase 3 (backlog item 9).

## D4: Supabase for auth + DB + storage
Single backend. Google SSO via Supabase Auth with domain restriction to @lyzr.ai. RLS enabled but permissive first, tightened in final pass.

## D5: Vercel for deployment
Zero-config Next.js hosting. Free tier. Domain lyzr.kailash-gm.com pointed via CNAME from Cloudflare.

## D6: IST timezone display
All dates stored as UTC in Postgres. Displayed in Asia/Kolkata (IST) using date-fns-tz. No per-user timezone override.

## D7: Inter font
Internal tool - legibility over brand. Using Inter from Google Fonts via next/font.

## D8: Permissive RLS first
All RLS policies start permissive (any authenticated user can read/write). Final tightening pass near the end of the session to match spec section 6 exactly.

## D9: Server Actions for mutations
All write operations go through Next.js Server Actions using the Supabase service role key (server-side only). Client reads use the anon key with RLS.

## D10: TanStack Query for client cache
All data fetching on the client uses TanStack Query for caching, background refetching, and optimistic updates.

## D11: Vitest for unit tests
Added Vitest (`npm test` / `npm run test:watch`). Pure, dependency-light logic is
extracted into `lib/task-logic.ts` because `lib/actions/index.ts` is a `'use server'`
module and may only export async functions, so its helpers cannot be imported by tests.
First suite (`lib/task-logic.test.ts`) covers recurrence-date advancement, email
normalization, and the blocker-completion filter (the closing-while-blocked guard).

## D12: Taxonomy replaced by the GSI_GTM_2 blueprint (Aug 2026)
The generic 7-category seed (001/006) is retired. The operating taxonomy now
comes from the GSI_GTM_2 board: 4 categories → 12 channels → 38 sub-channels,
with the 94 blueprint activities seeded as tasks. Channel-level tier / goal /
target / budget-note / owners / resources / learnings live in migration 010.
Data is seeded by `scripts/seed-gtm.mjs` from `scripts/gtm-blueprint.json`
(exported verbatim from `GSI_GTM_2/index.html`) — the DB is reset with the
generated `supabase/RESET_ALL.sql` (skips 006; see RESTRUCTURE.md). Activity
star grades map to priority (gold→P0, silver→P1, bronze→P2) and are kept
verbatim in `planning_fields.grade`. Owner names map to emails via
`scripts/owner-emails.json`; unresolved people are held in pending_assignments
until first sign-in.
