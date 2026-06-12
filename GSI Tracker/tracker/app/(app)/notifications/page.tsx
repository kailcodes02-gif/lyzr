'use client'

import { useNotifications } from '@/lib/hooks/use-data'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useState, useTransition } from 'react'
import { Bell, Check, CheckSquare, MessageSquare, AlertCircle, Info, ShieldAlert, ArrowRight } from 'lucide-react'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { markNotificationsRead, markAllNotificationsRead } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const { data: notifications, isLoading } = useNotifications()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (isLoading) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        <div className="h-8 bg-zinc-800 rounded w-1/4" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-zinc-800 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const handleMarkAllRead = () => {
    startTransition(async () => {
      try {
        await markAllNotificationsRead()
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
        toast.success('All notifications marked as read')
      } catch (err: any) {
        console.error('markAllNotificationsRead failed:', err)
        toast.error(err?.message || 'Failed to mark notifications as read')
      }
    })
  }

  const handleMarkSingleRead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    startTransition(async () => {
      try {
        await markNotificationsRead([id])
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      } catch (err: any) {
        console.error('markNotificationsRead failed:', err)
        toast.error(err?.message || 'Failed to update notification')
      }
    })
  }

  const handleNotificationClick = (taskId: string | null, id: string) => {
    if (taskId) {
      setSelectedTaskId(taskId)
    }
    // Mark as read automatically when clicked
    startTransition(async () => {
      try {
        await markNotificationsRead([id])
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      } catch (err) {
        // fail silently
      }
    })
  }

  const notificationIcons = {
    assigned: <CheckSquare className="w-4 h-4 text-blue-400" />,
    mentioned: <MessageSquare className="w-4 h-4 text-violet-400" />,
    comment: <MessageSquare className="w-4 h-4 text-emerald-400" />,
    status_change: <Info className="w-4 h-4 text-zinc-400" />,
    dependency_completed: <Check className="w-4 h-4 text-emerald-400" />,
    subtask_completed: <Check className="w-4 h-4 text-emerald-400" />,
    parent_blocked: <ShieldAlert className="w-4 h-4 text-red-400" />,
    budget_overrun_warning: <ShieldAlert className="w-4 h-4 text-orange-400" />,
    overdue: <AlertCircle className="w-4 h-4 text-red-400" />,
  }

  const getNotificationText = (type: string, payload: any) => {
    switch (type) {
      case 'assigned':
        return `You have been assigned to task "${payload.task_title}" as ${payload.role || 'owner'}.`
      case 'mentioned':
        return `You were mentioned in a ${payload.surface?.replace('_', ' ') || 'field'} by another user.`
      case 'comment':
        return `New comment added: "${payload.comment_body?.substring(0, 50)}..."`
      case 'status_change':
        return `Status of your task updated from ${payload.from_status} to ${payload.to_status}.`
      case 'dependency_completed':
        return `A task you depend on is now marked Done.`
      case 'subtask_completed':
        return `A subtask of your campaign has been completed.`
      case 'parent_blocked':
        return `A subtask is blocked: "${payload.blocked_reason || 'no reason given'}"`
      case 'budget_overrun_warning':
        return `Budget warning: Task allocation has pushed scope bucket over limits.`
      case 'overdue':
        return `Your task is overdue! Please update status or due date.`
      default:
        return 'New update on your marketing task.'
    }
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-4xl mx-auto bg-[#0a0a0f] text-zinc-100 min-h-screen">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Bell className="w-6 h-6 text-violet-400" /> Notifications
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Stay updated with assignments, mentions, and updates</p>
        </div>
        {notifications && notifications.length > 0 && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleMarkAllRead}
            disabled={isPending}
            className="border-white/10 text-zinc-300 hover:text-white"
          >
            Mark all as read
          </Button>
        )}
      </div>

      {/* Notifications List */}
      <Card className="bg-zinc-900/40 border-white/5 backdrop-blur-xl">
        <CardContent className="p-0">
          {notifications && notifications.length > 0 ? (
            <div className="divide-y divide-white/5">
              {notifications.map(notif => (
                <div 
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif.task_id, notif.id)}
                  className="p-4 hover:bg-white/5 transition-colors cursor-pointer flex items-start gap-4"
                >
                  <div className="p-2 bg-white/5 rounded-lg shrink-0 mt-0.5">
                    {notificationIcons[notif.type] || <Info className="w-4 h-4 text-zinc-400" />}
                  </div>
                  
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="text-sm text-zinc-200 leading-snug">
                      {getNotificationText(notif.type, notif.payload)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      {notif.task && (
                        <span className="text-blue-400 font-medium hover:underline">
                          {notif.task.title}
                        </span>
                      )}
                      {notif.task && <span>•</span>}
                      <span>{formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleMarkSingleRead(notif.id, e)}
                    className="h-8 w-8 text-zinc-500 hover:text-zinc-300 rounded-lg"
                    title="Mark as read"
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-zinc-500 text-sm">
              All caught up! No unread notifications. 🎉
            </div>
          )}
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
