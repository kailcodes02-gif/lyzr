'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Bell, Check, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { useNotifications, useUsers } from '@/lib/hooks/use-data'
import { markNotificationsRead, markAllNotificationsRead } from '@/lib/actions'
import { notificationText, notificationHref } from '@/lib/notification-text'

// "What needs me": unread notifications, right on the home screens.
export function InboxCard({ limit = 6 }: { limit?: number }) {
  const { data: notifications } = useNotifications()
  const { data: users } = useUsers()
  const qc = useQueryClient()
  const router = useRouter()
  const [taskId, setTaskId] = useState<string | null>(null)
  const list = (notifications || []).slice(0, limit)
  const actor = (p: any) => { const id = p?.actor_id || p?.assigned_by || p?.commented_by || p?.changed_by || p?.mentioned_by; return users?.find(u => u.id === id)?.display_name?.split(' ')[0] }
  const open = async (n: NonNullable<typeof notifications>[number]) => {
    const h = notificationHref(n.type, n.payload as any)
    if (n.task_id) setTaskId(n.task_id)
    try { await markNotificationsRead([n.id]); qc.invalidateQueries({ queryKey: ['notifications'] }) } catch {}
    if (h) router.push(h)
  }
  const clear = async () => { try { await markAllNotificationsRead(); qc.invalidateQueries({ queryKey: ['notifications'] }) } catch {} }

  return (
    <Card className="bg-white border-zinc-200">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-violet-600" /> Needs you <span className="font-normal text-zinc-400">{notifications?.length || 0}</span></CardTitle>
        <div className="flex items-center gap-3 text-xs">
          {!!notifications?.length && <button onClick={clear} className="text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Clear all</button>}
          <Link href="/notifications/" className="text-blue-600 hover:underline inline-flex items-center gap-1">All <ArrowRight className="w-3 h-3" /></Link>
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-zinc-100">
        {list.length === 0 && <p className="p-5 text-sm text-zinc-400 text-center">Nothing waiting on you.</p>}
        {list.map(n => (
          <button key={n.id} onClick={() => open(n)} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50">
            <p className="text-sm text-zinc-800 leading-snug">{notificationText(n.type, n.payload as any, actor(n.payload))}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
          </button>
        ))}
      </CardContent>
      {taskId && <TaskDetailDrawer taskId={taskId} open onOpenChange={o => { if (!o) setTaskId(null) }} onTaskIdChange={setTaskId} />}
    </Card>
  )
}
