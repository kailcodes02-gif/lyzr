import { describe, expect, it } from 'vitest'
import { checkInQueue, checkInSummary, moveOptions } from './check-in'

// Thursday 29 Oct 2026; the ISO week ends Sunday 1 Nov.
const NOW = new Date(2026, 9, 29, 10, 0)
const t = (id: string, status: string, due_date: string | null) => ({ id, status, due_date })

describe('checkInQueue', () => {
  it('keeps open work due by Sunday plus undated work in flight, overdue first', () => {
    const q = checkInQueue([
      t('later', 'not_started', '2026-11-03'),
      t('sun', 'not_started', '2026-11-01'),
      t('overdue', 'in_progress', '2026-10-20'),
      t('done', 'done', '2026-10-28'),
      t('undated-idle', 'not_started', null),
      t('undated-blocked', 'blocked', null),
      t('cancelled', 'cancelled', '2026-10-28'),
    ], NOW)
    expect(q.map(x => x.id)).toEqual(['overdue', 'sun', 'undated-blocked'])
  })
})

describe('moveOptions', () => {
  it('offers tomorrow, next Monday and week jumps', () => {
    expect(moveOptions(NOW).map(o => o.date)).toEqual(['2026-10-30', '2026-11-02', '2026-11-05', '2026-11-12'])
  })
})

describe('checkInSummary', () => {
  it('lists only the sections with items', () => {
    const s = checkInSummary('Kailash', { done: ['Deck'], moved: [], blocked: ['Form fix: waiting on IT'], started: [] }, 'Oct 26 to Nov 1')
    expect(s).toBe('*Kailash: check-in, Oct 26 to Nov 1*\nDone\n• Deck\nBlocked\n• Form fix: waiting on IT')
  })
  it('says so when nothing changed', () => {
    expect(checkInSummary('A', { done: [], moved: [], blocked: [], started: [] }, 'W')).toContain('No changes this week.')
  })
})
