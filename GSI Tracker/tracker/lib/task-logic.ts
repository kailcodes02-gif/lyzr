// Pure, dependency-light task logic, extracted so it can be unit-tested.
// `lib/actions/index.ts` is a 'use server' module and may only export async
// functions, so its helpers cannot be imported by tests directly. Keeping the
// logic here (a plain module) lets both the actions and the tests use it.

import { addDays, addWeeks, addMonths } from 'date-fns'

export type RecurrencePattern =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'custom'
  | string

// Advance a date by one recurrence interval. Used both when a recurring
// template is created (so the FIRST auto-spawned instance lands one interval
// after the original, not on the same day) and when the next instance spawns
// on completion, so the cadence stays consistent in both places.
export function advanceByPattern(
  date: Date,
  pattern: RecurrencePattern,
  customIntervalDays?: number | null
): Date {
  switch (pattern) {
    case 'daily': return addDays(date, 1)
    case 'weekly': return addWeeks(date, 1)
    case 'biweekly': return addWeeks(date, 2)
    case 'monthly': return addMonths(date, 1)
    case 'custom': return customIntervalDays ? addDays(date, customIntervalDays) : date
    default: return date
  }
}

// Normalize an email the same way everywhere (users, invites, mentions,
// assignments) so case/whitespace differences resolve to the same row.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Given a set of blocker tasks, return the ones that are still open. A task is
// "cleared" only when it is done or cancelled; anything else blocks closing.
export function incompleteBlockers<T extends { status: string }>(
  blockers: T[] | null | undefined
): T[] {
  return (blockers || []).filter((b) => b.status !== 'done' && b.status !== 'cancelled')
}
