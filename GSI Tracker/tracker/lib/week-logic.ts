import { startOfISOWeek, endOfISOWeek, addWeeks, format, parseISO, isBefore, isAfter } from 'date-fns'

// Pure week bucketing used by the workspace Weekly view, the function
// roll-up and the vertical cards. A task "belongs" to a week by its due
// date (planned vs delivered). No React, no Supabase: unit-tested.

export interface WeekRange { start: Date; end: Date; key: string; label: string }

const ISO_DATE = 'yyyy-MM-dd'

export function buildWeeks(count: number, from: Date = new Date()): WeekRange[] {
  const thisWeekStart = startOfISOWeek(from)
  const weeks: WeekRange[] = []
  for (let i = 0; i < count; i++) {
    const start = addWeeks(thisWeekStart, -i)
    const end = endOfISOWeek(start)
    const sameMonth = format(start, 'MMM') === format(end, 'MMM')
    const label = sameMonth
      ? `${format(start, 'MMM d')} to ${format(end, 'd')}`
      : `${format(start, 'MMM d')} to ${format(end, 'MMM d')}`
    weeks.push({ start, end, key: format(start, ISO_DATE), label })
  }
  return weeks
}

export function currentWeek(from: Date = new Date()): WeekRange {
  return buildWeeks(1, from)[0]
}

export const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'live', 'blocked'])

export interface WeekBuckets<T extends { status: string; due_date: string | null }> {
  done: T[]          // due in the week and done
  notDone: T[]       // due in the week and still open
  cancelled: T[]     // due in the week but cancelled
  overdueCarried: T[] // due BEFORE the week and still open
}

export function bucketWeek<T extends { status: string; due_date: string | null }>(
  tasks: T[],
  week: { start: Date; end: Date },
): WeekBuckets<T> {
  const out: WeekBuckets<T> = { done: [], notDone: [], cancelled: [], overdueCarried: [] }
  for (const t of tasks) {
    if (!t.due_date) continue
    const due = parseISO(t.due_date)
    const inWeek = !isBefore(due, week.start) && !isAfter(due, week.end)
    if (inWeek) {
      if (t.status === 'done') out.done.push(t)
      else if (t.status === 'cancelled') out.cancelled.push(t)
      else out.notDone.push(t)
    } else if (isBefore(due, week.start) && OPEN_STATUSES.has(t.status)) {
      out.overdueCarried.push(t)
    }
  }
  return out
}

export type GroupKey = 'vertical' | 'channel' | 'owner'

export interface Group<T> {
  key: string
  label: string
  items: T[]
  children?: Group<T>[]
}

// Nested grouping: groupTasks(tasks, ['vertical','channel','owner'], resolvers)
export function groupTasks<T>(
  items: T[],
  keys: GroupKey[],
  resolve: (item: T, key: GroupKey) => { key: string; label: string },
): Group<T>[] {
  if (!keys.length) return []
  const [head, ...rest] = keys
  const map = new Map<string, Group<T>>()
  for (const it of items) {
    const { key, label } = resolve(it, head)
    let g = map.get(key)
    if (!g) { g = { key, label, items: [] }; map.set(key, g) }
    g.items.push(it)
  }
  const groups = [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  if (rest.length) for (const g of groups) g.children = groupTasks(g.items, rest, resolve)
  return groups
}

export function weekCompletionRate(b: WeekBuckets<{ status: string; due_date: string | null }>): number {
  const planned = b.done.length + b.notDone.length
  return planned ? Math.round((b.done.length / planned) * 100) : 0
}
