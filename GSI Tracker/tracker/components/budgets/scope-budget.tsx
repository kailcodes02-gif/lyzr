'use client'

// The budget strip on a campaign, channel, product or vertical page: what is
// set against this thing right now, how much tasks have planned, and a button
// to set one for the people allowed to.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Landmark, Pencil, Plus } from 'lucide-react'
import { useBudgets, useChannels, useTasks } from '@/lib/hooks/use-data'
import { CADENCE_LABEL, channelFamilies, money, rollup } from '@/lib/budgets'
import { BudgetDialog, useBudgetScopes } from './budget-dialog'
import type { Budget, BudgetScope } from '@/lib/types/database'
import { cn } from '@/lib/utils'

export function ScopeBudget({ scopeType, scopeId, className }: { scopeType: BudgetScope; scopeId: string; className?: string }) {
  const { data } = useBudgets()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const scopes = useBudgetScopes()
  const [dialog, setDialog] = useState<null | { budget?: Budget }>(null)
  const familyOf = useMemo(() => channelFamilies(channels || []), [channels])
  const month = useMemo(() => new Date(), [])
  const rows = useMemo(() => (data?.rows || []).filter(b => b.scope_type === scopeType && b.scope_id === scopeId)
    .map(b => rollup(b, month, tasks || [], familyOf)).filter((r): r is NonNullable<typeof r> => !!r), [data, scopeType, scopeId, month, tasks, familyOf])
  const canEdit = scopes.can(scopeType, scopeId)

  if (!data?.ready || (!rows.length && !canEdit)) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Link href="/budgets/" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900"><Landmark className="w-3.5 h-3.5 text-emerald-600" /> Budget</Link>
      {rows.map(r => {
        const over = r.planned > r.budget.amount
        return (
          <button key={r.budget.id} type="button" disabled={!canEdit} onClick={() => setDialog({ budget: r.budget })}
            title={`${r.window.label}: ${money(r.planned)} planned on tasks of ${money(r.budget.amount)}${r.spent > 0 ? `, ${money(r.spent)} spent` : ''}${canEdit ? '. Click to edit.' : ''}`}
            className={cn('inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs', over ? 'border-red-200' : 'border-zinc-200', canEdit && 'hover:border-zinc-400 cursor-pointer')}>
            <span className="font-semibold text-zinc-900">{money(r.budget.amount)}</span>
            <span className="text-zinc-500">{r.budget.cadence === 'one_time' ? (r.budget.name || 'one-time') : CADENCE_LABEL[r.budget.cadence].per}</span>
            <span className={cn('rounded-full px-1.5 text-[10px] font-medium', over ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>{over ? `${money(-r.left)} over` : `${money(r.planned)} planned`}</span>
            {canEdit && <Pencil className="w-3 h-3 text-zinc-400" />}
          </button>
        )
      })}
      {canEdit && (
        <button type="button" onClick={() => setDialog({})} className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 cursor-pointer">
          <Plus className="w-3 h-3" /> {rows.length ? 'Add another' : 'Set a budget'}
        </button>
      )}
      {dialog && <BudgetDialog open onOpenChange={o => { if (!o) setDialog(null) }} budget={dialog.budget} preset={dialog.budget ? undefined : { scope_type: scopeType, scope_id: scopeId }} />}
    </div>
  )
}
