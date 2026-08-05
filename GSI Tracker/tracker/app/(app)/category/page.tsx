'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCategories, useChannels, useTasks, useBudgetPeriods } from '@/lib/hooks/use-data'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { Plus, DollarSign, ListTodo, Clipboard, ChevronDown, ChevronRight, BarChart3, Calendar } from 'lucide-react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { TIER_CONFIG } from '@/lib/types/database'
import { taskInScope } from '@/lib/task-channels'

function CategoryContent() {
  const slug = useSearchParams().get('slug') || ''
  const { data: categories, isLoading: catsLoading } = useCategories()
  
  const category = categories?.find(c => c.slug === slug)
  const categoryId = category?.id

  const { data: channels, isLoading: channelsLoading } = useChannels(categoryId)
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: budgets } = useBudgetPeriods()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({})

  if (catsLoading || channelsLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-96 bg-zinc-200 rounded-xl" />
          <div className="md:col-span-2 h-96 bg-zinc-200 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!category) {
    return (
      <div className="p-8 text-center text-zinc-600">
        Category not found.
      </div>
    )
  }

  // Filter tasks belonging to the channels in this category
  const categoryChannelIds = channels?.map(c => c.id) || []
  const categoryTasks = tasks?.filter(t => taskInScope(t, categoryChannelIds)) || []

  // Category Budget calculations
  const categoryBudget = budgets?.find(b => b.scope_type === 'category' && b.scope_id === category.id)
  const limit = categoryBudget ? Number(categoryBudget.total_budget) : 0
  const allocated = categoryTasks
    .filter(t => t.budget_allocated)
    .reduce((sum, t) => sum + Number(t.budget_allocated), 0)
  const remaining = Math.max(0, limit - allocated)
  const budgetPercent = limit > 0 ? Math.round((allocated / limit) * 100) : 0

  // Group tasks by channel for the Tracker view
  const trackerTasks = categoryTasks.filter(t => 
    t.status === 'live' || t.status === 'done' || t.status === 'cancelled'
  )
  
  const tasksByChannel: Record<string, typeof trackerTasks> = {}
  trackerTasks.forEach(task => {
    if (!tasksByChannel[task.channel_id]) {
      tasksByChannel[task.channel_id] = []
    }
    tasksByChannel[task.channel_id].push(task)
  })

  const toggleChannelExpand = (id: string) => {
    setExpandedChannels(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-zinc-50 text-zinc-900">
      {/* Category sub-navigation (channels tree) */}
      <aside className="w-64 border-r border-zinc-200 bg-white flex-shrink-0 flex flex-col p-4 overflow-y-auto">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 px-2">
          {category.name} Channels
        </h3>
        <nav className="space-y-1">
          {channels?.filter(ch => !ch.parent_channel_id).map(channel => {
            const children = channels.filter(c => c.parent_channel_id === channel.id)
            const hasChildren = children.length > 0
            const isExpanded = expandedChannels[channel.id] ?? true

            return (
              <div key={channel.id} className="space-y-0.5">
                <div className="flex items-center justify-between rounded-lg hover:bg-zinc-100 px-2 py-1.5 transition-colors">
                  <Link
                    href={`/channel/?id=${channel.id}`}
                    className="flex-1 text-sm text-zinc-600 hover:text-zinc-900 truncate"
                  >
                    {channel.tier && <span className="mr-1.5" title={TIER_CONFIG[channel.tier].label} aria-hidden>{TIER_CONFIG[channel.tier].emoji}</span>}
                    {channel.name}
                  </Link>
                  {hasChildren && (
                    <button
                      onClick={() => toggleChannelExpand(channel.id)}
                      className="p-1 text-zinc-500 hover:text-zinc-700"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {hasChildren && isExpanded && (
                  <div className="ml-4 space-y-0.5 border-l border-zinc-200 pl-2">
                    {children.map(child => (
                      <Link
                        key={child.id}
                        href={`/channel/?id=${child.id}`}
                        className="block px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 rounded hover:bg-zinc-100 truncate"
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {channels?.length === 0 && (
            <p className="text-xs text-zinc-600 px-2">No channels configured</p>
          )}
        </nav>
      </aside>

      {/* Main panel */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 lg:p-8 space-y-6">
        
        {/* Category Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{category.name}</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Campaigns, tasks, and budgets</p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <Link href={`/calendar?category=${category.id}`}>
              <Button variant="outline" className="border-zinc-300 hover:bg-zinc-100 text-zinc-700">
                <Calendar className="w-4 h-4 mr-2" /> Calendar View
              </Button>
            </Link>
            <Button 
              onClick={() => setCreateOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white border-0"
            >
              <Plus className="w-4 h-4 mr-2" /> New Task
            </Button>
          </div>
        </div>

        {/* Category Budget Card */}
        {categoryBudget && (
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Category Budget
                </p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-2xl font-bold text-zinc-900">${limit.toLocaleString()}</h3>
                  <span className="text-xs text-zinc-500">for {categoryBudget.period_label}</span>
                </div>
              </div>

              <div className="flex-1 max-w-md space-y-1.5">
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>Allocated: ${allocated.toLocaleString()} ({budgetPercent}%)</span>
                  <span className={remaining < 0 ? 'text-red-600' : 'text-zinc-500'}>
                    {remaining < 0 ? 'Over budget by ' : ''}${Math.abs(remaining).toLocaleString()} remaining
                  </span>
                </div>
                <Progress 
                  value={budgetPercent} 
                  className="h-2 bg-zinc-200"
                  indicatorClassName={budgetPercent > 100 ? 'bg-red-500' : budgetPercent > 80 ? 'bg-orange-500' : 'bg-emerald-500'}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tab View */}
        <Tabs defaultValue="tasks" className="w-full">
          <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg">
            <TabsTrigger value="tasks" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <ListTodo className="w-4 h-4 mr-2" /> Tasks
            </TabsTrigger>
            <TabsTrigger value="tracker" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <BarChart3 className="w-4 h-4 mr-2" /> Tracker
            </TabsTrigger>
            <TabsTrigger value="budget" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <DollarSign className="w-4 h-4 mr-2" /> Budget
            </TabsTrigger>
          </TabsList>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="mt-6">
            <TaskView 
              tasks={categoryTasks} 
              onTaskClick={(t) => setSelectedTaskId(t.id)} 
              showChannelColumn 
            />
          </TabsContent>

          {/* Tracker Tab */}
          <TabsContent value="tracker" className="mt-6 space-y-6">
            {Object.keys(tasksByChannel).length === 0 ? (
              <div className="text-center py-16 border border-dashed border-zinc-200 rounded-xl text-zinc-500 text-sm">
                No active or completed metrics campaigns in this category yet.
              </div>
            ) : (
              Object.entries(tasksByChannel).map(([chId, chTasks]) => {
                const channelName = channels?.find(c => c.id === chId)?.name || 'Unknown Channel'
                return (
                  <Card key={chId} className="bg-white border-zinc-200 backdrop-blur-xl">
                    <CardHeader className="py-4 border-b border-zinc-200">
                      <CardTitle className="text-sm font-semibold text-zinc-700">{channelName}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                            <th className="text-left font-medium py-3 px-4">Campaign Task</th>
                            <th className="text-left font-medium py-3 px-4">Status</th>
                            <th className="text-left font-medium py-3 px-4">Insights</th>
                            <th className="text-left font-medium py-3 px-4">Result URL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {chTasks.map(task => (
                            <tr 
                              key={task.id}
                              onClick={() => setSelectedTaskId(task.id)}
                              className="hover:bg-zinc-100 transition-colors cursor-pointer"
                            >
                              <td className="py-3.5 px-4 font-medium text-zinc-800">{task.title}</td>
                              <td className="py-3.5 px-4">
                                <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300">
                                  {task.status}
                                </Badge>
                              </td>
                              <td className="py-3.5 px-4 text-zinc-600 max-w-xs truncate">
                                {task.tracker_fields?.insights ? (
                                  <span>{String(task.tracker_fields.insights)}</span>
                                ) : (
                                  <span className="text-zinc-600">-</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                {task.result_url ? (
                                  <a 
                                    href={task.result_url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-blue-600 hover:underline"
                                  >
                                    Link
                                  </a>
                                ) : (
                                  <span className="text-zinc-600">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </TabsContent>

          {/* Budget Tab */}
          <TabsContent value="budget" className="mt-6">
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                      <th className="text-left font-medium py-3 px-4">Task</th>
                      <th className="text-left font-medium py-3 px-4">Owner</th>
                      <th className="text-left font-medium py-3 px-4">Status</th>
                      <th className="text-right font-medium py-3 px-4">Allocated Budget</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {categoryTasks.filter(t => t.budget_allocated).map(task => (
                      <tr 
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className="hover:bg-zinc-100 transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-4 font-medium text-zinc-800">{task.title}</td>
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
                    {categoryTasks.filter(t => t.budget_allocated).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-zinc-500">
                          No budget allocations created for tasks in this category.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Task Creation Dialog */}
      {createOpen && (
        <CreateTaskDialog 
          open={createOpen} 
          onOpenChange={setCreateOpen}
          defaultCategoryId={category.id}
          onSuccess={() => setCreateOpen(false)}
        />
      )}

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


export default function CategoryPage() {
  return (
    <Suspense fallback={<div className="p-8 bg-zinc-50 min-h-screen" />}>
      <CategoryContent />
    </Suspense>
  )
}
