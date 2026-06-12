'use client'

import { useCurrentUser, useTasks, useMentionsForUser, useRecentActivity } from '@/lib/hooks/use-data'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskView } from '@/components/tasks/task-view'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'
import { CheckSquare, MessageSquare, Clock, Activity, User as UserIcon } from 'lucide-react'
import { format } from 'date-fns'

export default function MyTasksPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: tasks, isLoading: tasksLoading } = useTasks()
  const { data: mentions } = useMentionsForUser()
  const { data: activities } = useRecentActivity(50)

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  if (userLoading || tasksLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-800 rounded w-1/4" />
        <div className="h-4 bg-zinc-800 rounded w-1/3" />
        <div className="h-96 bg-zinc-800 rounded-xl" />
      </div>
    )
  }

  if (!user) return null

  // Filter tasks assigned to current user
  const myAssignedTasks = tasks?.filter(t => 
    t.assignments?.some(a => a.user_id === user.id)
  ) || []

  // Split by role
  const getTasksByRole = (role?: string) => {
    if (!role) return myAssignedTasks
    return myAssignedTasks.filter(t => 
      t.assignments?.some(a => a.user_id === user.id && a.role === role)
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
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto bg-[#0a0a0f] text-zinc-100 min-h-screen">
      
      {/* Header */}
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <UserIcon className="w-6 h-6 text-blue-400" /> My Tasks
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Manage your campaigns, assignments, and mentions</p>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="assigned" className="w-full">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="bg-zinc-900/60 border border-white/5 p-1 rounded-lg inline-flex w-auto min-w-max">
            <TabsTrigger value="assigned" className="text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white">
              <CheckSquare className="w-4 h-4 mr-2" /> Assigned to Me
            </TabsTrigger>
            <TabsTrigger value="mentioned" className="text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white">
              <MessageSquare className="w-4 h-4 mr-2" /> Mentioned ({myMentionedTasks.length})
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white">
              <Activity className="w-4 h-4 mr-2" /> My Activity
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Assigned Tasks Tab */}
        <TabsContent value="assigned" className="mt-6 space-y-6">
          <Tabs defaultValue="all" className="w-full">
            <div className="flex justify-between items-center mb-4 overflow-x-auto -mx-1 px-1">
              <TabsList className="bg-white/5 border border-white/5 p-0.5 rounded-lg inline-flex w-auto min-w-max">
                <TabsTrigger value="all" className="text-xs text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white py-1">
                  All
                </TabsTrigger>
                <TabsTrigger value="primary" className="text-xs text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white py-1">
                  Primary
                </TabsTrigger>
                <TabsTrigger value="secondary" className="text-xs text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white py-1">
                  Secondary
                </TabsTrigger>
                <TabsTrigger value="tertiary" className="text-xs text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white py-1">
                  Tertiary
                </TabsTrigger>
                <TabsTrigger value="other" className="text-xs text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white py-1">
                  Other
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
            <TabsContent value="tertiary" className="mt-0">
              <TaskView tasks={getTasksByRole('tertiary')} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
            <TabsContent value="other" className="mt-0">
              <TaskView tasks={getTasksByRole('other')} onTaskClick={(t) => setSelectedTaskId(t.id)} showChannelColumn />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Mentioned Tasks Tab */}
        <TabsContent value="mentioned" className="mt-6">
          <Card className="bg-zinc-900/30 border-white/5 backdrop-blur-xl">
            <CardContent className="p-0 overflow-hidden">
              {myMentionedTasks.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 text-sm">
                  You haven't been mentioned in any tasks yet.
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {myMentionedTasks.map(task => {
                    const taskMentions = mentions?.filter(m => m.task_id === task.id) || []
                    
                    return (
                      <div 
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className="p-4 hover:bg-white/5 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1 min-w-0">
                          <h4 className="text-sm font-medium text-zinc-200 truncate">{task.title}</h4>
                          <div className="flex flex-wrap gap-2 items-center text-xs text-zinc-500">
                            <span>Status: {task.status}</span>
                            <span>•</span>
                            <span className="text-violet-400">
                              Mentioned in {taskMentions.map(m => surfaceLabels[m.surface] || m.surface).join(', ')}
                            </span>
                          </div>
                        </div>
                        <Badge className="bg-zinc-800 text-zinc-400 border-zinc-700 self-start md:self-auto">
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
          <Card className="bg-zinc-900/30 border-white/5 backdrop-blur-xl">
            <CardContent className="p-6 space-y-6 max-h-[600px] overflow-y-auto pr-2">
              {myActivities.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-sm">
                  No recent activity logged by you.
                </div>
              ) : (
                myActivities.map(log => (
                  <div key={log.id} className="flex gap-3 text-xs">
                    <div className="p-2 bg-zinc-800 text-zinc-400 rounded-lg shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-zinc-300">
                        You {log.action === 'created' && 'created task'}{' '}
                        {log.action === 'status_changed' && 'updated status of'}{' '}
                        {log.action === 'commented' && 'commented on'}{' '}
                        {log.action === 'imported_leads' && 'imported CSV leads'}{' '}
                        <span 
                          onClick={() => log.task?.id && setSelectedTaskId(log.task.id)}
                          className="text-blue-400 hover:underline cursor-pointer font-medium"
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
