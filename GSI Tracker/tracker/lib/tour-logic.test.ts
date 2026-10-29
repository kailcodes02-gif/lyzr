import { describe, expect, it } from 'vitest'
import { shouldAutoStartTour, tourAutoCount, tourShownFlags } from './tour-logic'

const D1 = '2026-10-29'
const D2 = '2026-10-30'

describe('welcome walkthrough auto-start', () => {
  it('opens on the very first visit', () => {
    expect(shouldAutoStartTour({}, D1)).toBe(true)
    expect(shouldAutoStartTour(undefined, D1)).toBe(true)
  })

  it('opens a second time, but only on a later day', () => {
    const afterFirst = tourShownFlags({}, D1)
    expect(afterFirst).toEqual({ 'tour:auto': 1, 'tour:auto:last': D1 })
    expect(shouldAutoStartTour(afterFirst, D1)).toBe(false)
    expect(shouldAutoStartTour(afterFirst, D2)).toBe(true)
  })

  it('never opens by itself a third time', () => {
    const afterSecond = { ...tourShownFlags({}, D1), ...tourShownFlags(tourShownFlags({}, D1), D2) }
    expect(tourAutoCount(afterSecond)).toBe(2)
    expect(shouldAutoStartTour(afterSecond, '2027-01-01')).toBe(false)
  })

  it('counts people who finished the old one-time tour as one showing', () => {
    const legacy = { 'tour:v3': true }
    expect(tourAutoCount(legacy)).toBe(1)
    expect(shouldAutoStartTour(legacy, D1)).toBe(true)
    expect(shouldAutoStartTour({ ...legacy, ...tourShownFlags(legacy, D1) }, D2)).toBe(false)
  })
})
