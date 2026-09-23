import { describe, it, expect } from 'vitest'
import { buildWeeks, bucketWeek, groupTasks, weekCompletionRate } from './week-logic'

const week = { start: new Date('2026-09-21T00:00:00'), end: new Date('2026-09-27T23:59:59.999') }
const t = (due: string | null, status: string, extra: Record<string, unknown> = {}) => ({ due_date: due, status, ...extra })

describe('buildWeeks', () => {
  it('starts on the ISO Monday and counts backwards', () => {
    const weeks = buildWeeks(3, new Date('2026-09-23T12:00:00'))
    expect(weeks[0].key).toBe('2026-09-21')
    expect(weeks[1].key).toBe('2026-09-14')
    expect(weeks[2].key).toBe('2026-09-07')
  })
})

describe('bucketWeek', () => {
  it('buckets by due date', () => {
    const b = bucketWeek([
      t('2026-09-22', 'done'),
      t('2026-09-25', 'in_progress'),
      t('2026-09-27', 'cancelled'),
      t('2026-09-10', 'not_started'),
      t('2026-09-10', 'done'),
      t('2026-10-01', 'not_started'),
      t(null, 'not_started'),
    ], week)
    expect(b.done).toHaveLength(1)
    expect(b.notDone).toHaveLength(1)
    expect(b.cancelled).toHaveLength(1)
    expect(b.overdueCarried).toHaveLength(1)
  })

  it('computes completion over planned work only', () => {
    const b = bucketWeek([t('2026-09-22', 'done'), t('2026-09-22', 'done'), t('2026-09-23', 'live')], week)
    expect(weekCompletionRate(b)).toBe(67)
    expect(weekCompletionRate(bucketWeek([], week))).toBe(0)
  })
})

describe('groupTasks', () => {
  it('nests groups in key order', () => {
    const items = [
      { v: 'GSI', c: 'Paid', o: 'a' },
      { v: 'GSI', c: 'Paid', o: 'b' },
      { v: 'GSI', c: 'Content', o: 'a' },
      { v: 'Lyzr', c: 'Content', o: 'a' },
    ]
    const groups = groupTasks(items, ['vertical', 'channel', 'owner'], (it, key) => {
      const val = key === 'vertical' ? it.v : key === 'channel' ? it.c : it.o
      return { key: val, label: val }
    })
    expect(groups.map(g => g.label)).toEqual(['GSI', 'Lyzr'])
    const gsi = groups[0]
    expect(gsi.items).toHaveLength(3)
    expect(gsi.children!.map(c => c.label)).toEqual(['Content', 'Paid'])
    expect(gsi.children![1].children!.map(o => o.label)).toEqual(['a', 'b'])
  })
})
