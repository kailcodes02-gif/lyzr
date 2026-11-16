'use client'

// Budgets: money set against campaigns and thunderclaps, channels, products
// and verticals. They are horizontal: one task can count toward several
// budgets, so each kind is totalled separately and never added to another.
// Everyone can read; admins, leadership and heads set and change them.
import { useMemo, useState } from 'react'
import { addMonths, format, startOfMonth } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, Landmark, Pencil, Plus } from 'lucide-react'
import { useBudgets, useChannels, useTasks } from '@/lib/hooks/use-data'
import { CADENCE_LABEL, SCOPE_LABEL, channelFamilies, money, rollup, taskSpend, type BudgetRollup } from '@/lib/budgets'
import { BudgetDialog, SCOPE_ICON, useBudgetScopes } from '@/components/budgets/budget-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { InfoTip } from '@/components/ui/info-tip'
import { primaryAssignee, shortDate } from '@/lib/ask'
import { STATUS_CONFIG, type Budget, type BudgetScope } from '@/lib/types/database'
import { cn } from '@/lib/utils'

const KINDS: BudgetScope[] = ['campaign', 'channel', 'product', 'vertical']
// Notes carried over from the old seed carry a bookkeeping tag; hide it.
const cleanNote = (n: string) => { const i = n.lastIndexOf(' [from '); return i >= 0 ? n.slice(0, i) : n }

export default function BudgetsPage() {
  const { data: budgetData, isLoading } = useBudgets()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const { data: channels } = useChannels('all')
  const scopes = useBudgetScopes()

  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [tab, setTab] = useState<BudgetScope | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | { budget?: Budget }>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const familyOf = useMemo(() => channelFamilies(channels || []), [channels])
  const rows = useMemo(() => {
    const out: BudgetRollup[] = []
    for (const b of budgetData?.rows || []) { const r = rollup(b, month, tasks || [], familyOf); if (r) out.push(r) }
    return out.sort((a, b) => b.budget.amount - a.budget.amount)
  }, [budgetData, month, tasks, familyOf])
  const notRunning = (budgetData?.rows.length || 0) - rows.length
  const byKind = (k: BudgetScope) => rows.filter(r => r.budget.scope_type === k)
  const shown = tab === 'all' ? rows : byKind(tab)

  if (isLoading) {
    return <div className="p-8 space-y-6 animate-pulse"><div className="h-8 bg-zinc-200 rounded w-1/4" /><div className="h-28 bg-zinc-200 rounded-xl" /><div className="h-96 bg-zinc-200 rounded-xl" /></div>
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Landmark className="w-6 h-6 text-emerald-600" /> Budgets <InfoTip k="budgets" /></h1>
          <p className="text-sm text-zinc-500 mt-1">Money set against campaigns, channels, products and verticals, and what tasks have planned against it.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5">
          <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" className="h-8 w-8 grid place-items-center rounded-md hover:bg-zinc-100 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium w-28 text-center">{format(month, 'MMMM yyyy')}</span>
          <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month" className="h-8 w-8 grid place-items-center rounded-md hover:bg-zinc-100 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
        </div>
        {scopes.canAny && budgetData?.ready && (
          <button onClick={() => setDialog({})} className="inline-flex items-center gap-1.5 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm cursor-pointer">
            <Plus className="w-4 h-4" /> New budget
          </button>
        )}
      </div>

      {!budgetData?.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Budgets need database update 039. Once an admin runs it, this page fills in.</div>
      )}

      {/* one tile per kind: they overlap, so there is no grand total */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KINDS.map(k => {
          const list = byKind(k); const Icon = SCOPE_ICON[k]
          const total = list.reduce((s, r) => s + r.budget.amount, 0), planned = list.reduce((s, r) => s + r.planned, 0)
          const pct = total > 0 ? Math.min(100, Math.round((planned / total) * 100)) : 0
          return (
            <button key={k} onClick={() => setTab(tab === k ? 'all' : k)}
              className={cn('text-left rounded-xl border bg-white p-4 transition-colors cursor-pointer', tab === k ? 'border-zinc-900' : 'border-zinc-200 hover:border-zinc-400')}>
              <p className="text-xs text-zinc-500 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {SCOPE_LABEL[k].many} <span className="ml-auto rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-600">{list.length}</span></p>
              <p className="text-2xl font-bold mt-1.5">{money(total)}</p>
              <div className="h-1.5 rounded-full bg-zinc-100 mt-2 overflow-hidden"><div className={cn('h-full rounded-full', planned > total ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${planned > total ? 100 : pct}%` }} /></div>
              <p className="text-[11px] text-zinc-500 mt-1.5">{money(planned)} planned on tasks</p>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-zinc-500 -mt-3">The four kinds overlap: a task can count toward its campaign, its channel, its product and its vertical at once. So each kind has its own total and they are not added together.</p>

      <div className="inline-flex flex-wrap rounded-lg bg-zinc-100 p-0.5">
        {(['all', ...KINDS] as const).map(k => (
          <button key={k} onClick={() => setTab(k)} className={cn('px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer', tab === k ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900')}>
            {k === 'all' ? 'All' : SCOPE_LABEL[k].many} <span className="text-zinc-400">{k === 'all' ? rows.length : byKind(k).length}</span>
          </button>
        ))}
      </div>

      {!shown.length && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm font-medium">No {tab === 'all' ? '' : `${SCOPE_LABEL[tab].one.toLowerCase()} `}budgets running in {format(month, 'MMMM yyyy')}.</p>
          <p className="text-xs text-zinc-500 mt-1">{scopes.canAny ? 'Set one with New budget: pick a campaign, channel, product or vertical and an amount.' : 'Admins, leadership and heads set budgets. You will see them here.'}</p>
          {notRunning > 0 && <p className="text-xs text-zinc-500 mt-1">{notRunning} budget{notRunning === 1 ? '' : 's'} in other months. Use the arrows above.</p>}
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map(r => {
          const b = r.budget; const Icon = SCOPE_ICON[b.scope_type]; const open = openId === b.id
          const over = r.planned > b.amount
          const canEdit = scopes.can(b.scope_type, b.scope_id)
          return (
            <section key={b.id} className={cn('rounded-xl border bg-white overflow-hidden', over ? 'border-red-200' : 'border-zinc-200')}>
              <div role="button" tabIndex={0} onClick={() => setOpenId(open ? null : b.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(open ? null : b.id) }}
                className="w-full text-left px-4 py-3.5 cursor-pointer hover:bg-zinc-50">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-8 h-8 rounded-lg bg-zinc-100 grid place-items-center shrink-0"><Icon className="w-4 h-4 text-zinc-700" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{scopes.nameOf(b.scope_type, b.scope_id)}{b.name && <span className="font-normal text-zinc-500"> · {b.name}</span>}</p>
                    <p className="text-[11px] text-zinc-500">{SCOPE_LABEL[b.scope_type].one} · {b.cadence === 'one_time' ? 'One-time' : `${money(b.amount)} ${CADENCE_LABEL[b.cadence].per}`} · {r.window.label}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm"><span className={cn('font-semibold', over && 'text-red-600')}>{money(r.planned)}</span> <span className="text-zinc-400">of</span> <span className="font-semibold">{money(b.amount)}</span></p>
                    <p className={cn('text-[11px]', over ? 'text-red-600 font-medium' : 'text-zinc-500')}>{over ? `${money(-r.left)} over` : `${money(r.left)} left`}{r.spent > 0 && ` · ${money(r.spent)} spent`}</p>
                  </div>
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); setDialog({ budget: b }) }} aria-label="Edit budget" title="Edit budget"
                      className="h-8 w-8 grid place-items-center rounded-md text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                  )}
                  <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform', open && 'rotate-180')} />
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 mt-3 overflow-hidden">
                  <div className={cn('h-full rounded-full', over ? 'bg-red-500' : r.pct > 80 ? 'bg-orange-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, r.pct)}%` }} />
                </div>
              </div>
              {open && (
                <div className="border-t border-zinc-100">
                  {b.notes && <p className="px-4 pt-3 text-xs text-zinc-600">{cleanNote(b.notes)}</p>}
                  {!r.tasks.length ? (
                    <p className="px-4 py-5 text-xs text-zinc-500">
                      No task here carries money in {r.window.label}. {r.inScope > 0 ? `${r.inScope} task${r.inScope === 1 ? '' : 's'} in scope: open one and fill in its Budget to plan against this.` : 'Add a task, then fill in its Budget.'}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead><tr className="text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                          <th className="font-medium py-2 pl-4 pr-3">Task</th><th className="font-medium py-2 px-3">Assigned to</th><th className="font-medium py-2 px-3">Due</th><th className="font-medium py-2 px-3">Status</th>
                          <th className="font-medium py-2 px-3 text-right">Planned</th><th className="font-medium py-2 px-3 pr-4 text-right">Spent</th>
                        </tr></thead>
                        <tbody>
                          {r.tasks.map(t => (
                            <tr key={t.id} onClick={() => setSelectedTaskId(t.id)} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50 cursor-pointer">
                              <td className="py-2 pl-4 pr-3 font-medium text-zinc-900">{t.title}</td>
                              <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">{primaryAssignee(t)?.user?.display_name || 'Nobody yet'}</td>
                              <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">{t.due_date ? shortDate(t.due_date) : '—'}</td>
                              <td className="py-2 px-3"><span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: STATUS_CONFIG[t.status].bgColor, color: STATUS_CONFIG[t.status].color }}>{STATUS_CONFIG[t.status].label}</span></td>
                              <td className="py-2 px-3 text-right font-semibold text-zinc-900">{Number(t.budget_allocated) > 0 ? money(Number(t.budget_allocated)) : '—'}</td>
                              <td className="py-2 px-3 pr-4 text-right text-zinc-600">{taskSpend(t) > 0 ? money(taskSpend(t)) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {dialog && <BudgetDialog open onOpenChange={o => { if (!o) setDialog(null) }} budget={dialog.budget} />}
      {selectedTaskId && <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />}
    </div>
  )
}
