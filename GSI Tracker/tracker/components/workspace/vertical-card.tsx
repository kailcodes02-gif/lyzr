'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Building2, Crown, AlertCircle, Radio, CheckSquare, ArrowRight } from 'lucide-react'
import { withVertical } from '@/lib/hooks/use-space-href'
import type { Vertical, VerticalOwner, User, Task } from '@/lib/types/database'
import { bucketWeek, currentWeek, OPEN_STATUSES } from '@/lib/week-logic'

export function verticalStats(tasks: Task[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const open = tasks.filter(t => OPEN_STATUSES.has(t.status))
  const overdue = open.filter(t => t.due_date && new Date(t.due_date) < today)
  const live = tasks.filter(t => t.status === 'live')
  const week = bucketWeek(tasks, currentWeek())
  return { open: open.length, overdue: overdue.length, live: live.length, weekDone: week.done.length, weekNotDone: week.notDone.length }
}

export function VerticalCard({ vertical, tasks, owners, users, owned }: {
  vertical: Vertical
  tasks: Task[]
  owners: VerticalOwner[]
  users: User[]
  owned: boolean
}) {
  const s = verticalStats(tasks)
  const userByEmail = new Map(users.map(u => [u.email.toLowerCase(), u]))
  const planned = s.weekDone + s.weekNotDone
  const pct = planned ? Math.round((s.weekDone / planned) * 100) : 0

  return (
    <Link href={withVertical('/dashboard/', vertical.slug)} className="block group">
      <Card className="bg-white border-zinc-200 group-hover:border-blue-300 group-hover:shadow-lg group-hover:shadow-blue-500/5 transition-all h-full">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-semibold text-zinc-900 truncate">{vertical.name}</h3>
                {owned && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-label="You own this vertical" />}
              </div>
              <p className="text-xs text-zinc-500 truncate">{vertical.description || `${tasks.length} tasks`}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-blue-500 transition-colors shrink-0" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-zinc-50 py-2">
              <p className="text-lg font-bold text-zinc-900">{s.open}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1"><CheckSquare className="w-3 h-3" />Open</p>
            </div>
            <div className={`rounded-lg py-2 ${s.overdue ? 'bg-red-50' : 'bg-zinc-50'}`}>
              <p className={`text-lg font-bold ${s.overdue ? 'text-red-600' : 'text-zinc-900'}`}>{s.overdue}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1"><AlertCircle className="w-3 h-3" />Overdue</p>
            </div>
            <div className="rounded-lg bg-zinc-50 py-2">
              <p className="text-lg font-bold text-emerald-600">{s.live}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1"><Radio className="w-3 h-3" />Live</p>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
              <span>This week</span>
              <span>{s.weekDone} done · {s.weekNotDone} not done</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-200 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {owners.slice(0, 4).map(o => {
              const u = userByEmail.get(o.email.toLowerCase())
              return (
                <Avatar key={o.email} className="w-6 h-6 border border-white -ml-1 first:ml-0" title={u?.display_name || o.email}>
                  <AvatarImage src={u?.avatar_url || ''} />
                  <AvatarFallback className="bg-zinc-200 text-zinc-700 text-[10px]">
                    {(u?.display_name || o.email).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )
            })}
            <span className="text-[11px] text-zinc-500 ml-1 truncate">
              {owners.length ? owners.map(o => userByEmail.get(o.email.toLowerCase())?.display_name?.split(' ')[0] || o.email.split('@')[0]).slice(0, 3).join(', ') : 'No owners yet'}
              {owners.length > 3 ? ` +${owners.length - 3}` : ''}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
