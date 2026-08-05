'use client'

import { useCurrentUser, useTasks, useMentionsForUser, useRecentActivity, useAllChannelOwners } from '@/lib/hooks/use-data'
import { effectiveOwnerEmails } from '@/lib/effective-owners'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'
import { CheckSquare, MessageSquare, Clock, Activity, User as UserIcon, Plus } from 'lucide-react'
import { format } from 'date-fns'

export default function MyTasksPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: mentions } = useMentionsForUser()
  const { data: activities } = useRecentActivity(50)
  const { data: channelOwners } = useAllChannelOwners()

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  if (userLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-200 rounded w-1/4" />
        <div className="h-4 bg-zinc-200 rounded w-1/3" />
        <div className="h-96 bg-zinc-200 rounded-xl" />
      </div>
    )
  }

  if (!user) return null

  const myEmail = user.email.toLowerCase()

  // Directly assigned (signed-in assignment or pending under my email)
  const myAssignedTasks = tasks?.filter(t =>
    t.assignments?.some(a => a.user_id === user.id) ||
    (t.pending_assignments || []).some(p => !p.resolved_user_id && p.email.toLowerCase() === myEmail)
  ) || []

  // Inherited: no direct owner anywhere on the task, but the ownership chain
  // (parent activity -> sub-channel -> channel) resolves to me.
  const tasksById = new Map((tasks || []).map(t => [t.id, t]))
  const directIds = new Set(myAssignedTasks.map(t => t.id))
  const myInheritedTasks = (tasks || []).filter(t => {
    if (directIds.has(t.id)) return false
    const eff = effectiveOwnerEmails(t, tasksById, channelOwners || [], new Map())
    return eff.source !== 'direct' && eff.emails.has(myEmail)
  })

  // Split by role (direct assignments only — inherited tasks have no role)
  const getTasksByRole = (role?: string) => {
    if (!role) return myAssignedTasks
    return myAssignedTasks.filter(t =>
      t.assignments?.some(a => a.user_id === user.id && a.role === role) ||
      (t.pending_assignments || []).some(p => !p.resolved_user_id && p.email.toLowerCase() === myEmail && p.role === role)
    )
  }

  // Mentioned tasks: tasks where user is mentioned in `mentions` table
  const mentionedTaskIds = mentions?.map(m => m.task_id) || []
  const myMentionedTasks = tasks?.filter(t => mentionedTaskIds.includes(t.id)) || []

  // Personal activity log: activities by this user
  const myActivities = activities?.filter(a => a.actor_id === user.id) || []

  const surfaceLabels = {
    task_description: 'Description',
    task_comment: 'Comment',
    checklist_item: 'Checklist Item',
    blocked_description: 'Blocked Reason',
    insight: 'Insights'
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      
      {/* Header */}
      <div className="pl-12 lg:pl-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <UserIcon className="w-6 h-6 text-blue-600" /> My Tasks
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your campaigns, assignments, and mentions</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white self-start">
          <Plus className="w-4 h-4 mr-2" /> New Task
        </Button>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="assigned" className="w-full">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="bg-white border border-zinc-200 p-1 rounded-lg inline-flex w-auto min-w-max">
            <TabsTrigger value="assigned" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <CheckSquare className="w-4 h-4 mr-2" /> Assigned to Me
            </TabsTrigger>
            <TabsTrigger value="mentioned" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <MessageSquare className="w-4 h-4 mr-2" /> Mentioned ({myMentionedTasks.length})
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900">
              <Activity className="w-4 h-4 mr-2" /> My Activity
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Assigned Tasks Tab */}
        <TabsContent value="assigned" className="mt-6 space-y-6">
          <Tabs defaultValue="all" className="w-full">
            <div className="flex justify-between items-center mb-4 overflow-x-auto -mx-1 px-1">
              <TabsList className="bg-zinc-100 border border-zinc-200 p-0.5 rounded-lg inline-flex w-auto min-w-max">
                <TabsTrigger value="all" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  All
                </TabsTrigger>
                <TabsTrigger value="primary" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Primary
                </TabsTrigger>
                <TabsTrigger value="secondary" className="text-xs text-zinc-600 data-[state=active]:bg-zinc-200/70 data-[state=active]:text-zinc-900 py-1">
                  Secondary
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="all" className="mt-0">
              <TaskView tasks={getTasksByRole()} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="primary" className="mt-0">
              <TaskView tasks={getTasksByRole('primary')} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="secondary" className="mt-0">
              <TaskView tasks={getTasksByRole('secondary')} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
          </Tabs>

          {/* Inherited via ownership chain (parent activity / sub-channel / channel) */}
          {myInheritedTasks.length > 0 && (
            <div className="space-y-3 pt-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-700">
                  Also yours via ownership ({myInheritedTasks.length})
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Tasks with no direct owner that fall to you through the chain: sub-activity → activity owner → sub-channel owner → channel owner.
                </p>
              </div>
              <TaskView tasks={myInheritedTasks} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </div>
          )}
        </TabsContent>

        {/* Mentioned Tasks Tab */}
        <TabsContent value="mentioned" className="mt-6">
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-0 overflow-hidden">
              {myMentionedTasks.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 text-sm">
                  You haven't been mentioned in any tasks yet.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200">
                  {myMentionedTasks.map(task => {
                    const taskMentions = mentions?.filter(m => m.task_id === task.id) || []
                    
                    return (
                      <div 
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className="p-4 hover:bg-zinc-100 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1 min-w-0">
                          <h4 className="text-sm font-medium text-zinc-800 truncate">{task.title}</h4>
                          <div className="flex flex-wrap gap-2 items-center text-xs text-zinc-500">
                            <span>Status: {task.status}</span>
                            <span>•</span>
                            <span className="text-violet-600">
                              Mentioned in {taskMentions.map(m => surfaceLabels[m.surface] || m.surface).join(', ')}
                            </span>
                          </div>
                        </div>
                        <Badge className="bg-zinc-200 text-zinc-600 border-zinc-300 self-start md:self-auto">
                          View Task
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Activity Tab */}
        <TabsContent value="activity" className="mt-6">
          <Card className="bg-white border-zinc-200 backdrop-blur-xl">
            <CardContent className="p-6 space-y-6 max-h-[600px] overflow-y-auto pr-2">
              {myActivities.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-sm">
                  No recent activity logged by you.
                </div>
              ) : (
                myActivities.map(log => (
                  <div key={log.id} className="flex gap-3 text-xs">
                    <div className="p-2 bg-zinc-200 text-zinc-600 rounded-lg shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-zinc-700">
                        You {log.action === 'created' && 'created task'}{' '}
                        {log.action === 'status_changed' && 'updated status of'}{' '}
                        {log.action === 'commented' && 'commented on'}{' '}
                        {log.action === 'imported_leads' && 'imported CSV leads'}{' '}
                        <span 
                          onClick={() => log.task?.id && setSelectedTaskId(log.task.id)}
                          className="text-blue-600 hover:underline cursor-pointer font-medium"
                        >
                          {log.task?.title || 'a task'}
                        </span>
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {format(new Date(log.created_at), 'd MMM yyyy · h:mm a')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create dialog — requires channel + sub-channel choice */}
      {createOpen && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
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
