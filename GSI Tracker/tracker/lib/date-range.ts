import {
  addDays, addMonths, addQuarters, addWeeks, addYears, differenceInCalendarDays,
  endOfDay, endOfISOWeek, endOfMonth, endOfQuarter, endOfYear, format, isValid, parseISO,
  startOfDay, startOfISOWeek, startOfMonth, startOfQuarter, startOfYear, subDays,
} from 'date-fns'

// One date-range model for the whole app (Google-Calendar-style):
// a named preset, or a custom from/to pair, always resolvable to concrete
// bounds. Stored as plain strings so it persists and survives URL/local
// storage without Date objects.

export type RangePreset =
  | 'all' | 'today' | 'yesterday'
  | 'this_week' | 'last_week' | 'next_week'
  | 'this_month' | 'last_month' | 'next_month'
  | 'this_quarter' | 'last_quarter'
  | 'this_year'
  | 'last_7' | 'last_30' | 'last_90'
  | 'custom'

export interface DateRangeValue {
  preset: RangePreset
  from?: string // yyyy-MM-dd (custom only)
  to?: string
}

export interface ResolvedRange {
  from: Date | null
  to: Date | null
  label: string
  // How the arrows step this range (null = not steppable, e.g. "all time")
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'span' | null
}

export const ALL_TIME: DateRangeValue = { preset: 'all' }
export const ISO = 'yyyy-MM-dd'

export const PRESET_GROUPS: { title: string; items: { value: RangePreset; label: string }[] }[] = [
  { title: 'Day', items: [{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }] },
  { title: 'Week', items: [{ value: 'this_week', label: 'This week' }, { value: 'last_week', label: 'Last week' }, { value: 'next_week', label: 'Next week' }] },
  { title: 'Month', items: [{ value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' }, { value: 'next_month', label: 'Next month' }] },
  { title: 'Longer', items: [{ value: 'this_quarter', label: 'This quarter' }, { value: 'last_quarter', label: 'Last quarter' }, { value: 'this_year', label: 'This year' }] },
  { title: 'Rolling', items: [{ value: 'last_7', label: 'Last 7 days' }, { value: 'last_30', label: 'Last 30 days' }, { value: 'last_90', label: 'Last 90 days' }] },
  { title: '', items: [{ value: 'all', label: 'All time' }, { value: 'custom', label: 'Custom range' }] },
]

export function presetLabel(p: RangePreset): string {
  for (const g of PRESET_GROUPS) for (const i of g.items) if (i.value === p) return i.label
  return p
}

function fmtSpan(from: Date, to: Date): string {
  if (format(from, ISO) === format(to, ISO)) return format(from, 'd MMM yyyy')
  if (from.getFullYear() === to.getFullYear()) {
    if (from.getMonth() === to.getMonth()) return `${format(from, 'd')} to ${format(to, 'd MMM yyyy')}`
    return `${format(from, 'd MMM')} to ${format(to, 'd MMM yyyy')}`
  }
  return `${format(from, 'd MMM yyyy')} to ${format(to, 'd MMM yyyy')}`
}

export function resolveRange(v: DateRangeValue | null | undefined, now: Date = new Date()): ResolvedRange {
  const value = v || ALL_TIME
  const t = startOfDay(now)
  const span = (from: Date, to: Date, unit: ResolvedRange['unit'], label?: string): ResolvedRange =>
    ({ from: startOfDay(from), to: endOfDay(to), label: label || fmtSpan(from, to), unit })
  switch (value.preset) {
    case 'all': return { from: null, to: null, label: 'All time', unit: null }
    case 'today': return span(t, t, 'day')
    case 'yesterday': return span(subDays(t, 1), subDays(t, 1), 'day')
    case 'this_week': return span(startOfISOWeek(t), endOfISOWeek(t), 'week')
    case 'last_week': { const s = startOfISOWeek(addWeeks(t, -1)); return span(s, endOfISOWeek(s), 'week') }
    case 'next_week': { const s = startOfISOWeek(addWeeks(t, 1)); return span(s, endOfISOWeek(s), 'week') }
    case 'this_month': return span(startOfMonth(t), endOfMonth(t), 'month', format(t, 'MMMM yyyy'))
    case 'last_month': { const s = startOfMonth(addMonths(t, -1)); return span(s, endOfMonth(s), 'month', format(s, 'MMMM yyyy')) }
    case 'next_month': { const s = startOfMonth(addMonths(t, 1)); return span(s, endOfMonth(s), 'month', format(s, 'MMMM yyyy')) }
    case 'this_quarter': return span(startOfQuarter(t), endOfQuarter(t), 'quarter', format(t, "QQQ yyyy"))
    case 'last_quarter': { const s = startOfQuarter(addQuarters(t, -1)); return span(s, endOfQuarter(s), 'quarter', format(s, "QQQ yyyy")) }
    case 'this_year': return span(startOfYear(t), endOfYear(t), 'year', format(t, 'yyyy'))
    case 'last_7': return span(subDays(t, 6), t, 'span')
    case 'last_30': return span(subDays(t, 29), t, 'span')
    case 'last_90': return span(subDays(t, 89), t, 'span')
    case 'custom': {
      const from = value.from ? parseISO(value.from) : null
      const to = value.to ? parseISO(value.to) : null
      const okFrom = from && isValid(from) ? startOfDay(from) : null
      const okTo = to && isValid(to) ? endOfDay(to) : null
      if (!okFrom && !okTo) return { from: null, to: null, label: 'Custom range', unit: null }
      if (okFrom && okTo) return { from: okFrom, to: okTo, label: fmtSpan(okFrom, okTo), unit: 'span' }
      return { from: okFrom, to: okTo, label: okFrom ? `From ${format(okFrom, 'd MMM yyyy')}` : `Until ${format(okTo!, 'd MMM yyyy')}`, unit: null }
    }
  }
}

// Step a range backwards/forwards by its own length (the calendar arrows).
// Presets become custom ranges once moved, so the label stays exact.
export function shiftRange(v: DateRangeValue, direction: -1 | 1, now: Date = new Date()): DateRangeValue {
  const r = resolveRange(v, now)
  if (!r.from || !r.to || !r.unit) return v
  let from = r.from, to = r.to
  switch (r.unit) {
    case 'day': from = addDays(from, direction); to = addDays(to, direction); break
    case 'week': from = addWeeks(from, direction); to = endOfISOWeek(from); break
    case 'month': from = addMonths(from, direction); to = endOfMonth(from); break
    case 'quarter': from = addQuarters(from, direction); to = endOfQuarter(from); break
    case 'year': from = addYears(from, direction); to = endOfYear(from); break
    case 'span': {
      const len = differenceInCalendarDays(to, from) + 1
      from = addDays(from, direction * len); to = addDays(to, direction * len)
    }
  }
  return { preset: 'custom', from: format(from, ISO), to: format(to, ISO) }
}

// Does an ISO date string (or timestamp) fall inside the range? Null bounds are open.
export function inRange(dateStr: string | null | undefined, r: ResolvedRange): boolean {
  if (!r.from && !r.to) return true
  if (!dateStr) return false
  const d = parseISO(dateStr)
  if (!isValid(d)) return false
  if (r.from && d < r.from) return false
  if (r.to && d > r.to) return false
  return true
}

export function isActiveRange(v: DateRangeValue | null | undefined): boolean {
  const r = resolveRange(v)
  return !!(r.from || r.to)
}

export function customRange(from: Date, to: Date): DateRangeValue {
  return { preset: 'custom', from: format(from, ISO), to: format(to, ISO) }
}
