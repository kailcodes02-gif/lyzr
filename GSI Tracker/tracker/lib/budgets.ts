// Budget maths (migration 039).
//
// A budget is an amount against a campaign, channel, product or vertical.
// "Planned" is what the tasks in that scope carry in their Budget field,
// counted by due date into the budget's current window; "spent" is what those
// tasks reported in their results. Budgets of different kinds overlap by
// design (one task, several budgets), so they are never summed together.
import { endOfMonth, endOfQuarter, endOfYear, format, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import type { Budget, BudgetCadence, BudgetScope, Channel, Task } from '@/lib/types/database'
import { taskChannelIds } from '@/lib/task-channels'

export const SCOPE_LABEL: Record<BudgetScope, { one: string; many: string }> = {
  campaign: { one: 'Campaign', many: 'Campaigns' },
  channel: { one: 'Channel', many: 'Channels' },
  product: { one: 'Product', many: 'Products' },
  vertical: { one: 'Vertical', many: 'Verticals' },
}
export const CADENCE_LABEL: Record<BudgetCadence, { pick: string; per: string }> = {
  one_time: { pick: 'One-time', per: 'total' },
  monthly: { pick: 'Every month', per: 'a month' },
  quarterly: { pick: 'Every quarter', per: 'a quarter' },
  yearly: { pick: 'Every year', per: 'a year' },
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export interface BudgetWindow { start: string | null; end: string | null; label: string }

const day = (d: string) => new Date(`${d}T00:00:00`)

// The stretch of time this budget's amount covers when looking at `month`.
// null = the budget is not running in that month.
export function windowFor(b: Budget, month: Date): BudgetWindow | null {
  const mStart = iso(startOfMonth(month)), mEnd = iso(endOfMonth(month))
  if (b.starts_on && b.starts_on > mEnd) return null
  if (b.ends_on && b.ends_on < mStart) return null
  switch (b.cadence) {
    case 'monthly': return { start: mStart, end: mEnd, label: format(month, 'MMM yyyy') }
    case 'quarterly': return { start: iso(startOfQuarter(month)), end: iso(endOfQuarter(month)), label: `Q${Math.floor(month.getMonth() / 3) + 1} ${format(month, 'yyyy')}` }
    case 'yearly': return { start: iso(startOfYear(month)), end: iso(endOfYear(month)), label: format(month, 'yyyy') }
    default: {
      const from = b.starts_on ? format(day(b.starts_on), 'd MMM') : 'Start'
      const to = b.ends_on ? format(day(b.ends_on), 'd MMM yyyy') : 'open'
      return { start: b.starts_on, end: b.ends_on, label: b.starts_on || b.ends_on ? `${from} to ${to}` : 'Whole budget' }
    }
  }
}

// channel id -> itself plus every sub-channel under it
export function channelFamilies(channels: Pick<Channel, 'id' | 'parent_channel_id'>[]) {
  const kids = new Map<string, string[]>()
  for (const c of channels) if (c.parent_channel_id) kids.set(c.parent_channel_id, [...(kids.get(c.parent_channel_id) || []), c.id])
  const family = (id: string): string[] => [id, ...(kids.get(id) || []).flatMap(family)]
  const cache = new Map<string, Set<string>>()
  return (id: string) => { if (!cache.has(id)) cache.set(id, new Set(family(id))); return cache.get(id)! }
}

export function taskInScope(b: Budget, t: Task, familyOf: (id: string) => Set<string>) {
  switch (b.scope_type) {
    case 'campaign': return t.campaign_id === b.scope_id
    case 'channel': { const fam = familyOf(b.scope_id); return taskChannelIds(t).some(id => fam.has(id)) }
    case 'product': return (t.product_ids || []).includes(b.scope_id)
    case 'vertical': return (t.vertical_ids || []).includes(b.scope_id)
  }
}

const taskDate = (t: Task) => (t.due_date || t.created_at || '').slice(0, 10)

// What a task reported as actually spent, from its results fields.
export function taskSpend(t: Task) {
  const f = (t.tracker_fields || {}) as Record<string, unknown>
  for (const k of ['spend', 'total_spend', 'actual_spend', 'money_spent']) {
    const v = f[k]
    if (v === undefined || v === null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

export interface BudgetRollup {
  budget: Budget
  window: BudgetWindow
  /** In scope and in the window, with money on them. */
  tasks: Task[]
  /** Every task in scope and in the window. */
  inScope: number
  planned: number
  spent: number
  /** Amount minus planned. */
  left: number
  /** Planned as a share of the amount. */
  pct: number
}

export function rollup(b: Budget, month: Date, tasks: Task[], familyOf: (id: string) => Set<string>): BudgetRollup | null {
  const w = windowFor(b, month)
  if (!w) return null
  const scoped = tasks.filter(t => t.status !== 'cancelled' && taskInScope(b, t, familyOf)).filter(t => {
    const d = taskDate(t)
    return (!w.start || d >= w.start) && (!w.end || d <= w.end)
  })
  const withMoney = scoped.filter(t => Number(t.budget_allocated) > 0 || taskSpend(t) > 0)
    .sort((x, y) => Number(y.budget_allocated || 0) - Number(x.budget_allocated || 0))
  const planned = withMoney.reduce((s, t) => s + Number(t.budget_allocated || 0), 0)
  const spent = withMoney.reduce((s, t) => s + taskSpend(t), 0)
  const pct = b.amount > 0 ? Math.round((planned / b.amount) * 100) : planned > 0 ? 999 : 0
  return { budget: b, window: w, tasks: withMoney, inScope: scoped.length, planned, spent, left: b.amount - planned, pct }
}
