import { describe, it, expect } from 'vitest'
import { format } from 'date-fns'
import { advanceByPattern, normalizeEmail, incompleteBlockers } from './task-logic'

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
