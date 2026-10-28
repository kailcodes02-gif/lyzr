import { describe, expect, it } from 'vitest'
import { parseQuickAdd, resolveChannel, resolveOwner } from './quick-add'

// Thursday 29 Oct 2026
const NOW = new Date(2026, 9, 29, 10, 0)

describe('parseQuickAdd', () => {
  it('pulls owner, channel, priority and a trailing date out of the title', () => {
    const p = parseQuickAdd('Send ICP sequence @priya #instantly !p1 fri', NOW)
    expect(p).toMatchObject({ title: 'Send ICP sequence', owners: ['priya'], channel: 'instantly', priority: 'P1', dueDate: '2026-10-30' })
  })

  it('keeps a leading weekday as part of the title', () => {
    expect(parseQuickAdd('Monday newsletter draft', NOW)).toMatchObject({ title: 'Monday newsletter draft', dueDate: null })
  })

  it('reads "by <date>" anywhere', () => {
    expect(parseQuickAdd('Ship deck by tomorrow for Infosys', NOW)).toMatchObject({ title: 'Ship deck for Infosys', dueDate: '2026-10-30' })
  })

  it('reads day-month in either order, rolling past dates into next year', () => {
    expect(parseQuickAdd('Webinar 12 nov', NOW).dueDate).toBe('2026-11-12')
    expect(parseQuickAdd('Webinar nov 12th', NOW).dueDate).toBe('2026-11-12')
    expect(parseQuickAdd('Plan offsite 5 jan', NOW).dueDate).toBe('2027-01-05')
  })

  it('handles relative phrases', () => {
    expect(parseQuickAdd('Recap today', NOW).dueDate).toBe('2026-10-29')
    expect(parseQuickAdd('Recap next week', NOW).dueDate).toBe('2026-11-02')
    expect(parseQuickAdd('Recap in 2 weeks', NOW).dueDate).toBe('2026-11-12')
    expect(parseQuickAdd('Recap thu', NOW).dueDate).toBe('2026-11-05') // same weekday = next week
    expect(parseQuickAdd('Recap eow', NOW).dueDate).toBe('2026-10-30')
  })

  it('never turns the whole line into a date', () => {
    expect(parseQuickAdd('tomorrow', NOW)).toMatchObject({ title: 'tomorrow', dueDate: null })
  })

  it('maps priority words', () => {
    expect(parseQuickAdd('Fix form !urgent', NOW).priority).toBe('P0')
    expect(parseQuickAdd('Fix form !nope', NOW)).toMatchObject({ title: 'Fix form !nope', priority: null })
  })
})

describe('resolveOwner', () => {
  const people = [
    { email: 'priya.sharma@lyzr.com', name: 'Priya Sharma' },
    { email: 'kiran@lyzr.com', name: 'Kiran' },
    { email: 'anish.dutta@lyzr.com', name: 'Anish Dutta' },
    { email: 'aritra.choudhury@lyzr.com', name: 'Aritra Choudhury' },
  ]
  it('matches the email local part or first name', () => {
    expect(resolveOwner('priya', people)).toBe('priya.sharma@lyzr.com')
    expect(resolveOwner('kiran', people)).toBe('kiran@lyzr.com')
    expect(resolveOwner('anish.dutta', people)).toBe('anish.dutta@lyzr.com')
  })
  it('returns null when ambiguous or unknown', () => {
    expect(resolveOwner('a', people)).toBeNull()
    expect(resolveOwner('zed', people)).toBeNull()
  })
  it('treats a second address as the same person', () => {
    const two = [...people, { email: 'kiran@lyzr.com', name: 'Kiran', alias: 'kiran.t@lyzr.ai' }]
    expect(resolveOwner('kiran', two)).toBe('kiran@lyzr.com')
    expect(resolveOwner('kiran.t', two)).toBe('kiran@lyzr.com')
    expect(resolveOwner('kiran.t@lyzr.ai', two)).toBe('kiran@lyzr.com')
  })
  it('accepts a full email for someone not signed in yet', () => {
    expect(resolveOwner('new.person@lyzr.com', people)).toBe('new.person@lyzr.com')
  })
})

describe('resolveChannel', () => {
  const channels = [
    { id: '1', slug: 'linkedin-ads', name: 'LinkedIn Ads' },
    { id: '2', slug: 'linkedin-page', name: 'LinkedIn page' },
    { id: '3', slug: 'instantly', name: 'Instantly' },
  ]
  it('matches slug, name, or a unique prefix', () => {
    expect(resolveChannel('instantly', channels)?.id).toBe('3')
    expect(resolveChannel('linkedin-ads', channels)?.id).toBe('1')
    expect(resolveChannel('inst', channels)?.id).toBe('3')
  })
  it('refuses an ambiguous prefix', () => {
    expect(resolveChannel('linkedin', channels)).toBeNull()
  })
})
