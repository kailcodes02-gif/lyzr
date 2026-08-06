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

// ============ Google-Calendar-style recurrence (migration 012) ============

export type IntervalUnit = 'day' | 'week' | 'month'

export type RecurrenceRule = {
  interval_count: number
  interval_unit: IntervalUnit
  // Only meaningful when interval_unit is 'week'; 0=Sun..6=Sat (Date#getDay()
  // convention). Empty/null means "the same weekday as the anchor date".
  by_weekdays?: number[] | null
}

export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'on_date'; date: string }
  | { type: 'after_count'; total: number }

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Advance a date by one recurrence step under the new rule shape. Weekly
// recurrence with specific weekdays follows Google Calendar's own behaviour:
// walk forward through the selected days within the current week, then jump
// (interval_count - 1) extra weeks before landing on the first selected day.
export function advanceRecurrence(date: Date, rule: RecurrenceRule): Date {
  const count = Math.max(1, rule.interval_count || 1)
  if (rule.interval_unit === 'day') return addDays(date, count)
  if (rule.interval_unit === 'month') return addMonths(date, count)

  const days = rule.by_weekdays && rule.by_weekdays.length
    ? [...new Set(rule.by_weekdays)].sort((a, b) => a - b)
    : [date.getDay()]
  const cur = date.getDay()
  // Stay within the current cycle's week if another selected day is still
  // ahead — the "every N weeks" gap only applies once we've exhausted the
  // active week's selected days.
  const laterThisWeek = days.find(d => d > cur)
  if (laterThisWeek !== undefined) {
    return addDays(date, laterThisWeek - cur)
  }
  // Wrap to the end of this week, skip the extra interval weeks, then land
  // on the first selected weekday.
  const toWeekEnd = 6 - cur
  return addDays(date, toWeekEnd + days[0] + 1 + (count - 1) * 7)
}

// Best-fit legacy label so the pre-existing `pattern`/`custom_interval_days`
// columns stay populated for anything that still reads them directly.
export function legacyPatternFields(rule: RecurrenceRule): {
  pattern: RecurrencePattern
  custom_interval_days: number | null
} {
  const { interval_count: c, interval_unit: u, by_weekdays } = rule
  const noWeekdayFilter = !by_weekdays || by_weekdays.length === 0
  if (u === 'day' && c === 1) return { pattern: 'daily', custom_interval_days: null }
  if (u === 'week' && c === 1 && noWeekdayFilter) return { pattern: 'weekly', custom_interval_days: null }
  if (u === 'week' && c === 2 && noWeekdayFilter) return { pattern: 'biweekly', custom_interval_days: null }
  if (u === 'month' && c === 1) return { pattern: 'monthly', custom_interval_days: null }
  const approxDays = u === 'day' ? c : u === 'week' ? c * 7 : c * 30
  return { pattern: 'custom', custom_interval_days: approxDays }
}

// Human summary in Google Calendar's own voice: "Daily", "Every 2 weeks on
// Mon, Wed", "Every 3 months", "Weekly · ends after 10 occurrences".
export function recurrenceLabel(rule: RecurrenceRule, end?: RecurrenceEnd): string {
  const { interval_count: c, interval_unit: u, by_weekdays } = rule
  const unitWord = c === 1 ? u : `${u}s`
  let base = c === 1 ? { day: 'Daily', week: 'Weekly', month: 'Monthly' }[u] : `Every ${c} ${unitWord}`
  if (u === 'week' && by_weekdays && by_weekdays.length) {
    base += ` on ${[...by_weekdays].sort((a, b) => a - b).map(d => WEEKDAY_ABBR[d]).join(', ')}`
  }
  if (end?.type === 'on_date') base += ` · until ${end.date}`
  if (end?.type === 'after_count') base += ` · ${end.total} time${end.total === 1 ? '' : 's'}`
  return base
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
