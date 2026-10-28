import { addDays, endOfISOWeek, format, nextMonday, parseISO, startOfDay } from 'date-fns'
import { OPEN_STATUSES } from './week-logic'

// The weekly check-in walks one person through the open work that needs a
// word from them: anything overdue or due by Sunday, plus anything in
// progress or blocked with no date (those go stale silently). Overdue first,
// then by date; undated last. Pure: unit-tested in check-in.test.ts.

type Checkable = { id: string; status: string; due_date: string | null; parent_task_id?: string | null }

export function checkInQueue<T extends Checkable>(tasks: T[], now: Date = new Date()): T[] {
  const end = endOfISOWeek(now)
  return tasks
    .filter(t => OPEN_STATUSES.has(t.status))
    .filter(t => t.due_date
      ? parseISO(t.due_date) <= end
      : t.status === 'in_progress' || t.status === 'blocked')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))
}

// Shortcut dates offered when someone moves a task.
export function moveOptions(now: Date = new Date()) {
  const today = startOfDay(now)
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  return [
    { label: 'Tomorrow', date: iso(addDays(today, 1)) },
    { label: 'Next Monday', date: iso(nextMonday(today)) },
    { label: 'In a week', date: iso(addDays(today, 7)) },
    { label: 'In 2 weeks', date: iso(addDays(today, 14)) },
  ]
}

export interface CheckInTally { done: string[]; moved: string[]; blocked: string[]; started: string[] }

// Plain-text recap the person can paste into Slack or a standup thread.
export function checkInSummary(name: string, tally: CheckInTally, weekLabel: string) {
  const lines = [`*${name}: check-in, ${weekLabel}*`]
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push(`${title}`, ...items.map(i => `• ${i}`))
  }
  section('Done', tally.done)
  section('Started', tally.started)
  section('Moved', tally.moved)
  section('Blocked', tally.blocked)
  if (lines.length === 1) lines.push('No changes this week.')
  return lines.join('\n')
}
