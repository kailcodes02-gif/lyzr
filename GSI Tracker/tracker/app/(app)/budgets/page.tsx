'use client'

import { useBudgetPeriods, useTasks, useCategories, useChannels } from '@/lib/hooks/use-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useState } from 'react'
import { DollarSign, Landmark, Layers, Tag, HelpCircle } from 'lucide-react'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'

export default function BudgetsPage() {
  const { data: budgets, isLoading: budgetsLoading } = useBudgetPeriods()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: categories } = useCategories()
  const { data: channels } = useChannels()

  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  if (budgetsLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-44 bg-zinc-200 rounded-xl" />
          <div className="h-44 bg-zinc-200 rounded-xl" />
          <div className="h-44 bg-zinc-200 rounded-xl" />
        </div>
        <div className="h-96 bg-zinc-200 rounded-xl" />
      </div>
    )
  }

  // Group budgets by period label (e.g. "May 2026")
  const periodsMap = new Map<string, typeof budgets>()
  budgets?.forEach(b => {
    const list = periodsMap.get(b.period_label) || []
    list.push(b)
    periodsMap.set(b.period_label, list)
  })

  const periodLabels = Array.from(periodsMap.keys())
  const activeLabel = selectedPeriodLabel || periodLabels[0] || ''

  if (!activeLabel) {
    return (
      <div className="p-8 text-center text-zinc-500 bg-zinc-50 min-h-screen">
        No budget periods defined yet. Go to Admin panel to create budgets.
      </div>
    )
  }

  const activeBudgets = periodsMap.get(activeLabel) || []
  
  // Find global budget for active period
  const globalBudget = activeBudgets.find(b => b.scope_type === 'global')
  const totalGlobalBudget = globalBudget ? Number(globalBudget.total_budget) : 0
  const allocatedGlobalBudget = globalBudget ? Number(globalBudget.allocated) : 0
  const remainingGlobalBudget = Math.max(0, totalGlobalBudget - allocatedGlobalBudget)
  const globalPercent = totalGlobalBudget > 0 ? Math.round((allocatedGlobalBudget / totalGlobalBudget) * 100) : 0

  // Category and channel budgets for active period
  const categoryBudgets = activeBudgets.filter(b => b.scope_type === 'category')
  const channelBudgets = activeBudgets.filter(b => b.scope_type === 'channel')

  // Find all tasks allocated to any budget period in this active group
  const activePeriodIds = activeBudgets.map(b => b.budget_period_id)
  const budgetedTasks = tasks?.filter(t => 
    t.budget_allocated && t.budget_period_id && activePeriodIds.includes(t.budget_period_id)
  ).sort((a, b) => Number(b.budget_allocated) - Number(a.budget_allocated)) || []

  return (
    <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-600" /> Budgets
          </h1>
          <p className="text-sm text-zinc-500 mt-1">GSI/SI marketing budget allocations and scope limits</p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Period:</span>
          <Select 
            value={activeLabel} 
            onValueChange={(val) => {
              setSelectedPeriodLabel(val || '')
            }}
          >
            <SelectTrigger className="w-[180px] bg-white border-zinc-300 text-xs">
              <SelectValue placeholder="Select Period" />
            </SelectTrigger>
            <SelectContent className="bg-white border-zinc-300 text-xs text-zinc-700">
              {periodLabels.map(label => (
                <SelectItem key={label} value={label}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Global Card */}
      {globalBudget && (
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardHeader className="pb-3 border-b border-zinc-200">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" /> Global Budget Summary
              </CardTitle>
              <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200">
                Active Limit
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Total Cap</span>
              <h2 className="text-3xl font-bold text-zinc-900">${totalGlobalBudget.toLocaleString()}</h2>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Total Allocated</span>
              <h2 className="text-3xl font-bold text-emerald-600">${allocatedGlobalBudget.toLocaleString()}</h2>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Remaining Funds</span>
              <h2 className={`text-3xl font-bold ${remainingGlobalBudget < 0 ? 'text-red-600' : 'text-zinc-600'}`}>
                ${remainingGlobalBudget.toLocaleString()}
              </h2>
            </div>

            <div className="col-span-1 md:col-span-3 space-y-2 mt-2">
              <div className="flex justify-between text-xs text-zinc-600">
                <span>Allocation usage: {globalPercent}%</span>
                <span>{globalBudget.notes || 'No scope notes'}</span>
              </div>
              <Progress 
                value={globalPercent} 
                className="h-2 bg-zinc-200"
                indicatorClassName={globalPercent > 100 ? 'bg-red-500' : globalPercent > 80 ? 'bg-orange-500' : 'bg-emerald-500'}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scope Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Category-level budgets */}
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" /> Category Scopes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {categoryBudgets.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-6">No category-scoped budgets for this period.</p>
            ) : (
              categoryBudgets.map(cb => {
                const catName = categories?.find(c => c.id === cb.scope_id)?.name || 'Unknown Category'
                const cap = Number(cb.total_budget)
                const alloc = Number(cb.allocated)
                const pct = cap > 0 ? Math.round((alloc / cap) * 100) : 0
                return (
                  <div key={cb.budget_period_id} className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-700">{catName}</span>
                      <span className="text-zinc-600">
                        ${alloc.toLocaleString()} / ${cap.toLocaleString()} ({pct}%)
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5 bg-zinc-200" indicatorClassName="bg-blue-500" />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* Channel-level budgets */}
        <Card className="bg-white border-zinc-200 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-2">
              <Tag className="w-4 h-4 text-violet-600" /> Channel Scopes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {channelBudgets.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-6">No channel-scoped budgets for this period.</p>
            ) : (
              channelBudgets.map(chb => {
                const chName = channels?.find(c => c.id === chb.scope_id)?.name || 'Unknown Channel'
                const cap = Number(chb.total_budget)
                const alloc = Number(chb.allocated)
                const pct = cap > 0 ? Math.round((alloc / cap) * 100) : 0
                return (
                  <div key={chb.budget_period_id} className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-zinc-700">{chName}</span>
                      <span className="text-zinc-600">
                        ${alloc.toLocaleString()} / ${cap.toLocaleString()} ({pct}%)
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5 bg-zinc-200" indicatorClassName="bg-violet-500" />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budgeted Tasks Table */}
      <Card className="bg-white border-zinc-200 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-zinc-900">Budgeted Tasks Allocation List</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                <th className="text-left font-medium py-3 px-4">Task Title</th>
                <th className="text-left font-medium py-3 px-4">Channel</th>
                <th className="text-left font-medium py-3 px-4">Primary Owner</th>
                <th className="text-left font-medium py-3 px-4">Status</th>
                <th className="text-right font-medium py-3 px-4">Allocated Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {budgetedTasks.map(task => (
                <tr 
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className="hover:bg-zinc-100 transition-colors cursor-pointer"
                >
                  <td className="py-3.5 px-4 font-medium text-zinc-800">{task.title}</td>
                  <td className="py-3.5 px-4 text-zinc-600">{task.channel?.name || '-'}</td>
                  <td className="py-3.5 px-4 text-zinc-600">
                    {task.assignments?.find(a => a.role === 'primary')?.user?.display_name || 'Unassigned'}
                  </td>
                  <td className="py-3.5 px-4">
                    <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">
                      {task.status}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-4 text-right text-emerald-600 font-semibold">
                    ${Number(task.budget_allocated).toLocaleString()}
                  </td>
                </tr>
              ))}
              {budgetedTasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-zinc-500">
                    No budgeted tasks allocations found in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Task Detail Drawer */}
      {selectedTaskId && (
        <TaskDetailDrawer 
          taskId={selectedTaskId} 
          open={!!selectedTaskId} 
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null)
          }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}
