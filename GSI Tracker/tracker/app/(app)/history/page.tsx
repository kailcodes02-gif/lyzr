'use client'

import { useState } from 'react'
import { useRecentActivity, useUsers } from '@/lib/hooks/use-data'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { History as HistoryIcon } from 'lucide-react'
import { format } from 'date-fns'

const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'edited',
  status_changed: 'changed status of',
  commented: 'commented on',
  imported_leads: 'imported leads via',
  deleted: 'deleted',
}

// Compact human summary of a from→to change payload
function changeSummary(from: unknown, to: unknown): string | null {
  if (!to || typeof to !== 'object') return null
  const t = to as Record<string, unknown>
  const f = (from || {}) as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(t)) {
    if (key === 'title' && !f.title) continue
    const before = f[key]
    const after = t[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const fmt = (v: unknown) =>
      v == null ? '—' : typeof v === 'object' ? '(fields)' : String(v).slice(0, 40)
    parts.push(before !== undefined ? `${key}: ${fmt(before)} → ${fmt(after)}` : `${key}: ${fmt(after)}`)
  }
  return parts.length ? parts.slice(0, 4).join(' · ') : null
}

export default function HistoryPage() {
  const { data: activities, isLoading } = useRecentActivity(300)
  const { data: users } = useUsers()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [actorFilter, setActorFilter] = useState<string>('')

  const filtered = (activities || []).filter(a => !actorFilter || a.actor_id === actorFilter)

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <HistoryIcon className="w-6 h-6 text-blue-600" /> History
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Every logged edit across the tracker — who did what, and when.
          </p>
        </div>
        <select
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700"
        >
          <option value="">All people</option>
          {users?.filter(u => u.email !== 'preview@lyzr.ai').map(u => (
            <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
          ))}
        </select>
      </div>

      <Card className="bg-white border-zinc-200">
        <CardContent className="p-0 divide-y divide-zinc-200 max-h-[75vh] overflow-y-auto">
          {isLoading && <p className="p-8 text-center text-sm text-zinc-500">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="p-8 text-center text-sm text-zinc-500">No activity logged yet.</p>
          )}
          {filtered.map(log => {
            const summary = changeSummary(log.from_value, log.to_value)
            return (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50">
                <Avatar className="w-7 h-7 border border-zinc-200 shrink-0 mt-0.5">
                  <AvatarImage src={log.actor?.avatar_url || ''} />
                  <AvatarFallback className="bg-zinc-200 text-zinc-700 text-[10px]">
                    {(log.actor?.display_name || '?').charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700">
                    <span className="font-medium text-zinc-900">{log.actor?.display_name || 'Someone'}</span>{' '}
                    {ACTION_LABELS[log.action] || log.action}{' '}
                    {log.task ? (
                      <button
                        onClick={() => setSelectedTaskId(log.task!.id)}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {log.task.title}
                      </button>
                    ) : (
                      <span className="text-zinc-500">a task</span>
                    )}
                  </p>
                  {summary && <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{summary}</p>}
                </div>
                <span className="text-[11px] text-zinc-400 shrink-0 mt-1">
                  {format(new Date(log.created_at), 'd MMM · h:mm a')}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={open => { if (!open) setSelectedTaskId(null) }}
          onTaskIdChange={setSelectedTaskId}
        />
      )}
    </div>
  )
}
