// When the welcome walkthrough opens by itself. Pure: unit-tested in
// tour-logic.test.ts.
//
// Each person sees it automatically TWICE in their lifetime: on their first
// visit, and once more on a later day (never twice on the same day). A
// showing counts the moment it opens, so closing it early still uses it up.
// Replays from the Guide or the account menu are unlimited and never count.
// Accounts that finished the one-time tour before this rule (flag
// "tour:v3") count as one showing, so they get exactly one more.

export const TOUR_AUTO_LIMIT = 2

export type TourFlags = Record<string, unknown> | undefined

export function tourAutoCount(flags: TourFlags): number {
  const n = Number(flags?.['tour:auto'])
  if (Number.isFinite(n) && n > 0) return n
  return flags?.['tour:v3'] ? 1 : 0
}

export function shouldAutoStartTour(flags: TourFlags, today: string): boolean {
  const count = tourAutoCount(flags)
  if (count >= TOUR_AUTO_LIMIT) return false
  return count === 0 || flags?.['tour:auto:last'] !== today
}

// The flags to save when a showing opens automatically.
export function tourShownFlags(flags: TourFlags, today: string): Record<string, unknown> {
  return { 'tour:auto': tourAutoCount(flags) + 1, 'tour:auto:last': today }
}
