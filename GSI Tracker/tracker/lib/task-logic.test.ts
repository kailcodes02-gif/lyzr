import { describe, it, expect } from 'vitest'
import { format } from 'date-fns'
import {
  advanceByPattern, normalizeEmail, incompleteBlockers,
  advanceRecurrence, recurrenceLabel, legacyPatternFields,
} from './task-logic'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

describe('advanceByPattern', () => {
  const base = new Date('2026-06-01T00:00:00') // a Monday

  it('daily advances 1 day', () => expect(fmt(advanceByPattern(base, 'daily'))).toBe('2026-06-02'))
  it('weekly advances 7 days', () => expect(fmt(advanceByPattern(base, 'weekly'))).toBe('2026-06-08'))
  it('biweekly advances 14 days', () => expect(fmt(advanceByPattern(base, 'biweekly'))).toBe('2026-06-15'))
  it('monthly advances 1 month', () => expect(fmt(advanceByPattern(base, 'monthly'))).toBe('2026-07-01'))
  it('custom advances N days', () => expect(fmt(advanceByPattern(base, 'custom', 10))).toBe('2026-06-11'))
  it('custom without an interval is a no-op', () => expect(fmt(advanceByPattern(base, 'custom'))).toBe('2026-06-01'))
  it('unknown pattern is a no-op', () => expect(fmt(advanceByPattern(base, 'yearly'))).toBe('2026-06-01'))

  it('regression (bug 5c): the first recurrence does not land on the original due date', () => {
    // The original instance is due `base`; the template next_due_date is one
    // interval later, so the next spawned instance is never the same day.
    for (const p of ['daily', 'weekly', 'biweekly', 'monthly'] as const) {
      expect(fmt(advanceByPattern(base, p))).not.toBe(fmt(base))
    }
  })
})

describe('advanceRecurrence (Google-Calendar-style engine, migration 012)', () => {
  const mon = new Date('2026-08-03T00:00:00') // a Monday
  const wed = new Date('2026-08-05T00:00:00')

  it('daily: every N days', () => {
    expect(fmt(advanceRecurrence(mon, { interval_count: 1, interval_unit: 'day' }))).toBe('2026-08-04')
    expect(fmt(advanceRecurrence(mon, { interval_count: 5, interval_unit: 'day' }))).toBe('2026-08-08')
  })

  it('weekly with no weekday filter: same weekday, N weeks later', () => {
    expect(fmt(advanceRecurrence(mon, { interval_count: 1, interval_unit: 'week' }))).toBe('2026-08-10')
    expect(fmt(advanceRecurrence(mon, { interval_count: 2, interval_unit: 'week' }))).toBe('2026-08-17')
  })

  it('monthly: same day next month, clamped at month end', () => {
    expect(fmt(advanceRecurrence(mon, { interval_count: 1, interval_unit: 'month' }))).toBe('2026-09-03')
    expect(fmt(advanceRecurrence(new Date('2026-01-31T00:00:00'), { interval_count: 1, interval_unit: 'month' }))).toBe('2026-02-28')
  })

  it('weekly with specific weekdays stays within the active week first', () => {
    // Mon+Wed, starting Monday -> next stop is Wednesday, same week
    expect(fmt(advanceRecurrence(mon, { interval_count: 1, interval_unit: 'week', by_weekdays: [1, 3] }))).toBe('2026-08-05')
  })

  it('weekly with specific weekdays wraps to next week after the last selected day', () => {
    // Mon+Wed, starting Wednesday -> next stop is Monday of the following week
    expect(fmt(advanceRecurrence(wed, { interval_count: 1, interval_unit: 'week', by_weekdays: [1, 3] }))).toBe('2026-08-10')
  })

  it('every 2 weeks on Mon+Wed skips the off week entirely', () => {
    let d = mon
    const seq: string[] = []
    for (let i = 0; i < 4; i++) {
      d = advanceRecurrence(d, { interval_count: 2, interval_unit: 'week', by_weekdays: [1, 3] })
      seq.push(fmt(d))
    }
    // wk1: Mon 3, Wed 5 (start) -> wk3: Mon 17, Wed 19 -> wk5: Mon 31, Wed Sep 2
    expect(seq).toEqual(['2026-08-05', '2026-08-17', '2026-08-19', '2026-08-31'])
  })
})

describe('recurrenceLabel', () => {
  it('reads like Google Calendar', () => {
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'day' })).toBe('Daily')
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'week' })).toBe('Weekly')
    expect(recurrenceLabel({ interval_count: 2, interval_unit: 'week' })).toBe('Every 2 weeks')
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'month' })).toBe('Monthly')
    expect(recurrenceLabel({ interval_count: 3, interval_unit: 'month' })).toBe('Every 3 months')
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'week', by_weekdays: [1, 3, 5] })).toBe('Weekly on Mon, Wed, Fri')
  })
  it('appends the end condition', () => {
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'week' }, { type: 'on_date', date: '2026-12-31' }))
      .toBe('Weekly · until 2026-12-31')
    expect(recurrenceLabel({ interval_count: 1, interval_unit: 'day' }, { type: 'after_count', total: 10 }))
      .toBe('Daily · 10 times')
  })
})

describe('legacyPatternFields (back-compat mirror for the old pattern column)', () => {
  it('maps the four presets exactly', () => {
    expect(legacyPatternFields({ interval_count: 1, interval_unit: 'day' }).pattern).toBe('daily')
    expect(legacyPatternFields({ interval_count: 1, interval_unit: 'week' }).pattern).toBe('weekly')
    expect(legacyPatternFields({ interval_count: 2, interval_unit: 'week' }).pattern).toBe('biweekly')
    expect(legacyPatternFields({ interval_count: 1, interval_unit: 'month' }).pattern).toBe('monthly')
  })
  it('anything else falls back to custom with an approximate day count', () => {
    const r = legacyPatternFields({ interval_count: 3, interval_unit: 'week' })
    expect(r.pattern).toBe('custom')
    expect(r.custom_interval_days).toBe(21)
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims (regression bug 5b)', () =>
    expect(normalizeEmail('  Foo.Bar@LYZR.ai ')).toBe('foo.bar@lyzr.ai'))
  it('leaves an already-clean email unchanged', () =>
    expect(normalizeEmail('a@lyzr.ai')).toBe('a@lyzr.ai'))
})

describe('incompleteBlockers', () => {
  it('keeps open blockers, drops done/cancelled (regression bug 5d)', () => {
    const blockers = [
      { id: '1', status: 'not_started' },
      { id: '2', status: 'done' },
      { id: '3', status: 'in_progress' },
      { id: '4', status: 'cancelled' },
      { id: '5', status: 'blocked' },
    ]
    expect(incompleteBlockers(blockers).map((b) => b.id)).toEqual(['1', '3', '5'])
  })
  it('treats null/empty as no blockers', () => {
    expect(incompleteBlockers(null)).toEqual([])
    expect(incompleteBlockers(undefined)).toEqual([])
    expect(incompleteBlockers([])).toEqual([])
  })
})
