import { describe, it, expect } from 'vitest'
import { format } from 'date-fns'
import { resolveRange, shiftRange, inRange, customRange } from './date-range'

const iso = (d: Date | null) => (d ? format(d, 'yyyy-MM-dd') : null)

const now = new Date('2026-09-23T10:00:00') // Wednesday

describe('resolveRange', () => {
  it('all time has open bounds', () => {
    const r = resolveRange({ preset: 'all' }, now)
    expect(r.from).toBeNull(); expect(r.to).toBeNull(); expect(r.label).toBe('All time')
  })
  it('this week is Monday to Sunday', () => {
    const r = resolveRange({ preset: 'this_week' }, now)
    expect(iso(r.from)).toBe('2026-09-21')
    expect(iso(r.to)).toBe('2026-09-27')
  })
  it('last month', () => {
    const r = resolveRange({ preset: 'last_month' }, now)
    expect(r.label).toBe('August 2026')
    expect(r.from!.getDate()).toBe(1); expect(r.to!.getDate()).toBe(31)
  })
  it('custom keeps the given bounds', () => {
    const r = resolveRange({ preset: 'custom', from: '2026-09-01', to: '2026-09-10' }, now)
    expect(r.label).toBe('1 to 10 Sep 2026'); expect(r.unit).toBe('span')
  })
  it('custom with only from is open-ended', () => {
    const r = resolveRange({ preset: 'custom', from: '2026-09-01' }, now)
    expect(r.to).toBeNull(); expect(r.label).toBe('From 1 Sep 2026')
  })
})

describe('shiftRange', () => {
  it('steps a month by a month', () => {
    const v = shiftRange({ preset: 'this_month' }, -1, now)
    expect(v).toEqual({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' })
  })
  it('steps a span by its length', () => {
    const v = shiftRange(customRange(new Date('2026-09-01'), new Date('2026-09-10')), 1, now)
    expect(v).toEqual({ preset: 'custom', from: '2026-09-11', to: '2026-09-20' })
  })
  it('does not step all time', () => {
    expect(shiftRange({ preset: 'all' }, 1, now)).toEqual({ preset: 'all' })
  })
})

describe('inRange', () => {
  const r = resolveRange({ preset: 'custom', from: '2026-09-01', to: '2026-09-10' }, now)
  it('includes bounds and rejects outside', () => {
    expect(inRange('2026-09-01', r)).toBe(true)
    expect(inRange('2026-09-10T18:30:00', r)).toBe(true)
    expect(inRange('2026-09-11', r)).toBe(false)
    expect(inRange(null, r)).toBe(false)
  })
  it('all time accepts everything, even null', () => {
    expect(inRange(null, resolveRange({ preset: 'all' }))).toBe(true)
  })
})
