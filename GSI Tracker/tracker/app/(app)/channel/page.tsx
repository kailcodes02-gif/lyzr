'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCategories, useChannels, useTasks, useBudgetPeriods, useChannelFields, useHubSpotSyncedContacts } from '@/lib/hooks/use-data'
import { getFieldsForChannel } from '@/components/tasks/channel-fields'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { Plus, DollarSign, ListTodo, ChevronDown, ChevronRight, BarChart3, Calendar, Users, Lightbulb, Target } from 'lucide-react'
import Link from 'next/link'
import { TierBadge, ChannelOwnerChips, ChannelResourcesCard, ChannelLearningsCard, ChannelTargetsCard, ChannelTargetChips, ChannelDescription } from '@/components/channel/channel-meta'
import { TIER_CONFIG } from '@/lib/types/database'
import { taskInScope } from '@/lib/task-channels'

function ChannelContent() {
  const channelId = useSearchParams().get('id') || ''
  const { data: categories, isLoading: catsLoading } = useCategories()
  const { data: allChannels, isLoading: channelsLoading } = useChannels()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: budgets } = useBudgetPeriods()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({})

  // Default values for contact conversion
  const [defaultTitle, setDefaultTitle] = useState('')
  const [defaultDescription, setDefaultDescription] = useState('')

  const { data: allFields } = useChannelFields()
  const { data: syncedContacts } = useHubSpotSyncedContacts()

  if (catsLoading || channelsLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse bg-zinc-50 min-h-screen">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-96 bg-zinc-200 rounded-xl" />
          <div className="md:col-span-2 h-96 bg-zinc-200 rounded-xl" />
        </div>
      </div>
    )
  }

  const channel = allChannels?.find(c => c.id === channelId)
  if (!channel) {
    return (
      <div className="p-8 text-center text-zinc-600 bg-zinc-50 min-h-screen">
        Channel not found.
      </div>
    )
  }

  const category = categories?.find(c => c.id === channel.category_id)
  const parentChannel = allChannels?.find(c => c.id === channel.parent_channel_id)

  // Find all child channel IDs recursively (depth up to 2 for sub-channels)
  const getChildChannelIds = (chId: string): string[] => {
    const directChildren = allChannels?.filter(c => c.parent_channel_id === chId) || []
    const directIds = directChildren.map(c => c.id)
    const recursiveIds = directIds.flatMap(id => getChildChannelIds(id))
    return [...directIds, ...recursiveIds]
  }
  const scopeChannelIds = [channel.id, ...getChildChannelIds(channel.id)]

  // Filter tasks in scope
  // Includes multi-homed tasks whose "also in" list touches this scope
  const channelTasks = tasks?.filter(t => taskInScope(t, scopeChannelIds)) || []

  // Channel Budget calculations
  const channelBudget = budgets?.find(b => b.scope_type === 'channel' && b.scope_id === channel.id)
  const limit = channelBudget ? Number(channelBudget.total_budget) : 0
  const allocated = channelTasks
    .filter(t => t.budget_allocated)
    .reduce((sum, t) => sum + Number(t.budget_allocated), 0)
  const remaining = Math.max(0, limit - allocated)
  const budgetPercent = limit > 0 ? Math.round((allocated / limit) * 100) : 0

  // Tracker fields definition
  const trackerFields = getFieldsForChannel(
    channel.slug,
    parentChannel?.slug,
    'tracker',
    allFields || [],
    allChannels || []
  )

  // Grouped channel tree for sidebar
  const siblings = allChannels?.filter(ch => ch.category_id === channel.category_id) || []
  
  const toggleChannelExpand = (id: string) => {
    setExpandedChannels(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Filter for completed/live/cancelled tasks
  const trackerTasks = channelTasks.filter(t => 
    t.status === 'live' || t.status === 'done' || t.status === 'cancelled'
  )

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-zinc-50 text-zinc-900">
      
      {/* Sub-channel navigation — scoped to the CURRENT channel's family */}
      <aside className="w-64 border-r border-zinc-200 bg-white flex-shrink-0 flex flex-col p-4 overflow-y-auto">
        {(() => {
          // If the current channel has its own children, IT is the family root
          // (covers mid-level channels in 3-deep trees); otherwise its parent.
          const hasOwnChildren = allChannels?.some(c => c.parent_channel_id === channel.id)
          const topChannel = hasOwnChildren ? channel : (parentChannel || channel)
          const subChannels = allChannels?.filter(c => c.parent_channel_id === topChannel.id) || []
          return (
            <>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 px-2">
                Channel
              </h3>
              <Link
                href={`/channel/?id=${topChannel.id}`}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold truncate transition-colors mb-3 ${
                  topChannel.id === channel.id ? 'bg-zinc-200/70 text-zinc-900' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {topChannel.tier && <span title={TIER_CONFIG[topChannel.tier].label} aria-hidden>{TIER_CONFIG[topChannel.tier].emoji}</span>}
                <span className="truncate">{topChannel.name}</span>
              </Link>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2">
                Sub-channels ({subChannels.length})
              </h3>
              <nav className="space-y-0.5">
                {subChannels.map(sub => {
                  const isCurrent = sub.id === channel.id
                  return (
                    <Link
                      key={sub.id}
                      href={`/channel/?id=${sub.id}`}
                      className={`block rounded-lg px-2 py-1.5 text-[13px] truncate transition-colors ${
                        isCurrent ? 'bg-zinc-200/70 text-zinc-900 font-medium' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                      }`}
                    >
                      {sub.name}
                    </Link>
                  )
                })}
                {subChannels.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-zinc-400">No sub-channels yet.</p>
                )}
              </nav>
            </>
          )
        })()}
      </aside>

      {/* Main Panel */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 lg:p-8 space-y-6">
        
        {/* Channel Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              {category && <span>{category.name}</span>}
              {parentChannel && (
                <>
                  <span>/</span>
                  <span>{parentChannel.name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{channel.name}</h1>
              <TierBadge tier={channel.tier} />
              {channel.budget_note && !channelBudget && (
                <Badge variant="outline" className="border-zinc-300 bg-zinc-100/50 text-zinc-600 text-[11px]">
                  {channel.budget_note}
                </Badge>
              )}
            </div>
            <ChannelDescription channelId={channel.id} goal={channel.goal} />
            <div className="mt-2">
              <ChannelTargetChips channelId={channel.id} />
            </div>
            <div className="mt-2">
              <ChannelOwnerChips channelId={channel.id} />
            </div>
          </div>
          <div className="flex items-center gap-3 self-start">
            <Link href={`/calendar?category=${channel.category_id}&channel=${channel.id}`}>
              <Button variant="outline" className="border-zinc-300 hover:bg-zinc-100 text-zinc-700">
                <Calendar className="w-4 h-4 mr-2" /> Calendar View
              </Button>
            </Link>
            <Button 
              onClick={() => {
                setDefaultTitle('')
                setDefaultDescription('')
                setCreateOpen(true)
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white border-0"
            >
              <Plus className="w-4 h-4 mr-2" /> New Task
            </Button>
          </div>
        </div>

        {/* Channel Budget Card */}
        {channelBudget && (
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Channel Budget
                </p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-2xl font-bold text-zinc-900">${limit.toLocaleString()}</h3>
                  <span className="text-xs text-zinc-500 font-normal">for {channelBudget.period_label}</span>
                </div>
              </div>

              <div className="flex-1 max-w-md space-y-1.5">
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>Allocated: ${allocated.toLocaleString()} ({budgetPercent}%)</span>
                  <span className={remaining < 0 ? 'text-red-600 font-medium' : 'text-zinc-500'}>
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
            <TabsTrigger value="resources" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <Lightbulb className="w-4 h-4 mr-2" /> Targets & Resources
            </TabsTrigger>
            {channel.slug === 'hubspot' && (
              <TabsTrigger value="hubspot-contacts" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
                <Users className="w-4 h-4 mr-2" /> HubSpot Synced Contacts
              </TabsTrigger>
            )}
          </TabsList>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="mt-6">
            <TaskView 
              tasks={channelTasks} 
              onTaskClick={(t) => setSelectedTaskId(t.id)} 
              showChannelColumn={scopeChannelIds.length > 1} 
            />
          </TabsContent>

          {/* Tracker Tab */}
          <TabsContent value="tracker" className="mt-6">
            <Card className="bg-white border-zinc-200 backdrop-blur-xl">
              <CardContent className="p-0 overflow-x-auto">
                {trackerTasks.length === 0 ? (
                  <div className="text-center py-16 text-zinc-500 text-sm">
                    No active or completed metrics campaigns in this channel yet.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                        <th className="text-left font-medium py-3 px-4 min-w-[150px]">Task</th>
                        <th className="text-left font-medium py-3 px-4">Status</th>
                        {trackerFields.map(field => (
                          <th key={field.slug} className="text-left font-medium py-3 px-4">
                            {field.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {trackerTasks.map(task => {
                        const tFields = task.tracker_fields || {}
                        
                        return (
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
                            {trackerFields.map(field => {
                              const rawVal = tFields[field.slug]
                              let display = '-'
                              
                              if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                                if (field.field_type === 'currency') {
                                  display = `$${Number(rawVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                } else if (field.field_type === 'url') {
                                  display = 'Link'
                                } else if (field.field_type === 'date_range' && typeof rawVal === 'object') {
                                  const range = rawVal as { start?: string; end?: string }
                                  display = `${range.start || ''} ~ ${range.end || ''}`
                                } else {
                                  display = String(rawVal)
                                }
                              }

                              return (
                                <td key={field.slug} className="py-3.5 px-4 text-zinc-600 max-w-[200px] truncate">
                                  {field.field_type === 'url' && rawVal ? (
                                    <a 
                                      href={String(rawVal)} 
                                      target="_blank" 
                                      rel="noreferrer" 
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-blue-600 hover:underline"
                                    >
                                      Link
                                    </a>
                                  ) : (
                                    <span>{display}</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
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
                    {channelTasks.filter(t => t.budget_allocated).map(task => (
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
                    {channelTasks.filter(t => t.budget_allocated).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-zinc-500">
                          No budget allocations created for tasks in this channel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Targets, Resources & Learnings Tab */}
          <TabsContent value="resources" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <ChannelTargetsCard channelId={channel.id} />
              <ChannelResourcesCard channelId={channel.id} />
              <ChannelLearningsCard channelId={channel.id} />
            </div>
          </TabsContent>

          {/* HubSpot Synced Contacts Tab */}
          {channel.slug === 'hubspot' && (
            <TabsContent value="hubspot-contacts" className="mt-6">
              <Card className="bg-white border-zinc-200 backdrop-blur-xl">
                <CardContent className="p-0 overflow-x-auto">
                  {!syncedContacts || syncedContacts.length === 0 ? (
                    <div className="text-center py-16 text-zinc-500 text-sm">
                      No synced contacts found from HubSpot. Go to Admin Panel &gt; HubSpot to link and synchronize.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-100/40 text-zinc-600">
                          <th className="text-left font-medium py-3 px-4">Name</th>
                          <th className="text-left font-medium py-3 px-4">Email</th>
                          <th className="text-left font-medium py-3 px-4">Company</th>
                          <th className="text-left font-medium py-3 px-4">Lifecycle Stage</th>
                          <th className="text-left font-medium py-3 px-4">Active Sequences</th>
                          <th className="text-right py-3 px-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {syncedContacts.map((contact: any) => (
                          <tr key={contact.hubspot_contact_id} className="hover:bg-zinc-100 transition-colors">
                            <td className="py-3 px-4 font-semibold text-zinc-800">
                              {contact.first_name || ''} {contact.last_name || ''}
                            </td>
                            <td className="py-3 px-4 text-zinc-600 font-mono">{contact.email}</td>
                            <td className="py-3 px-4 text-zinc-700">{contact.company || '-'}</td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="capitalize border-zinc-300 text-zinc-600 bg-zinc-100/50">
                                {contact.lifecycle_stage}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 space-y-1">
                              {contact.sequence_memberships?.map((seq: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-1.5">
                                  <Badge className="bg-blue-50 border-blue-200 text-blue-600 text-[10px]">
                                    {seq.name}
                                  </Badge>
                                  <Badge className={seq.status === 'Active' ? 'bg-emerald-50 border-emerald-200 text-emerald-600 text-[10px]' : 'bg-zinc-100 border-zinc-300 text-zinc-600 text-[10px]'}>
                                    {seq.status}
                                  </Badge>
                                </div>
                              )) || '-'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDefaultTitle(`HubSpot Lead: ${contact.first_name || ''} ${contact.last_name || ''} (${contact.company || 'Unknown'})`)
                                  setDefaultDescription(`Follow up with lead synced from HubSpot.\nEmail: ${contact.email}\nCompany: ${contact.company || 'None'}\nHubSpot Contact ID: ${contact.hubspot_contact_id}`)
                                  setCreateOpen(true)
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 h-8 px-2"
                              >
                                <Plus className="w-3.5 h-3.5 mr-1" /> Create Task
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Task Creation Dialog */}
      {createOpen && (
        <CreateTaskDialog 
          open={createOpen} 
          onOpenChange={setCreateOpen}
          defaultChannelId={channel.id}
          defaultTitle={defaultTitle}
          defaultDescription={defaultDescription}
          onSuccess={() => {
            setCreateOpen(false)
            setDefaultTitle('')
            setDefaultDescription('')
          }}
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


export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="p-8 bg-zinc-50 min-h-screen" />}>
      <ChannelContent />
    </Suspense>
  )
}
