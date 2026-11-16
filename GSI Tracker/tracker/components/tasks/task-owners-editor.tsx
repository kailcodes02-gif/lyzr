'use client'

import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useKnownEmails } from '@/lib/hooks/use-data'
import { addTaskOwner, removeTaskOwner } from '@/lib/actions'
import type { Task } from '@/lib/types/database'
import { Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// People on a task, in the drawer:
//   Assigned to   one or more; the starred one is the primary (replies on
//                 priority and due date). Roles primary + secondary.
//   Contributors  pitching in, not accountable. Every other role.
// Works for signed-in people and for emails still waiting on a first sign-in.
type Row = { key: string; label: string; avatar?: string | null; role: string; userId?: string; email?: string; pending: boolean }

export function TaskOwnersEditor({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { data: knownEmails } = useKnownEmails()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const rows: Row[] = [
    ...(task.assignments || []).map(a => ({
      key: a.user_id, label: a.user?.display_name || a.user?.email || 'Someone', avatar: a.user?.avatar_url,
      role: a.role, userId: a.user_id, email: a.user?.email, pending: false,
    })),
    ...(task.pending_assignments || []).filter(p => !p.resolved_user_id).map(p => ({
      key: p.email, label: p.email.split('@')[0], role: p.role, email: p.email, pending: true,
    })),
  ]
  const isAssigned = (r: Row) => r.role === 'primary' || r.role === 'secondary'
  const assigned = rows.filter(isAssigned).sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
  const helping = rows.filter(r => !isAssigned(r))

  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); onChanged() } catch (err) {
      toast.error(`${failMsg}: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally { setBusy(false) }
  }
  const remove = (r: Row) => run(() => removeTaskOwner(task.id, r.pending ? { email: r.email } : { userId: r.userId }), 'Could not remove them')
  // The first person assigned is the primary.
  const add = (kind: 'assign' | 'contribute') =>
    run(() => addTaskOwner(task.id, email, kind === 'contribute' ? 'other' : assigned.length ? 'secondary' : 'primary').then(() => setEmail('')), 'Could not add them')

  const chip = (r: Row) => (
    <div key={r.key} title={r.pending ? `${r.email} has not signed in yet` : r.email}
      className={cn('flex items-center gap-1.5 rounded-full pl-1.5 pr-1 py-1 border',
        r.role === 'primary' ? 'bg-amber-50 border-amber-200' : r.pending ? 'bg-zinc-50 border-dashed border-zinc-300' : 'bg-zinc-50 border-zinc-200')}>
      {isAssigned(r) && (
        <button type="button" disabled={busy || r.role === 'primary' || !r.email}
          onClick={() => r.email && run(() => addTaskOwner(task.id, r.email!, 'primary'), 'Could not change the primary')}
          title={r.role === 'primary' ? 'Primary: replies on priority and due date' : 'Make primary'} className="cursor-pointer disabled:cursor-default">
          <Star className={cn('w-3.5 h-3.5', r.role === 'primary' ? 'text-amber-500 fill-amber-400' : 'text-zinc-300 hover:text-amber-400')} />
        </button>
      )}
      {!r.pending && (
        <Avatar className="w-5 h-5">
          <AvatarImage src={r.avatar || ''} />
          <AvatarFallback className="bg-zinc-300 text-[9px]">{r.label.charAt(0)}</AvatarFallback>
        </Avatar>
      )}
      <span className={cn('text-xs', r.pending ? 'text-zinc-500 capitalize' : 'text-zinc-800')}>{r.label}</span>
      {r.role === 'primary' && assigned.length > 1 && <span className="text-[9px] uppercase tracking-wide text-amber-700">Primary</span>}
      {r.pending && <span className="text-[9px] text-zinc-400">pending</span>}
      <button onClick={() => remove(r)} className="text-zinc-400 hover:text-red-600 p-0.5 cursor-pointer" title="Remove"><X className="w-3 h-3" /></button>
    </div>
  )

  return (
    <div className="mb-4 space-y-3">
      <div>
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5" title="Who has to get this done. With more than one person, the starred one is the primary: they reply on priority and due date.">Assigned to</p>
        <div className="flex flex-wrap gap-1.5">
          {assigned.map(chip)}
          {!assigned.length && <span className="text-xs text-zinc-400 italic">Nobody yet. Add a person below.</span>}
        </div>
      </div>
      <div>
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5" title="People pitching in. They see the task but are not accountable for it.">Contributors</p>
        <div className="flex flex-wrap gap-1.5">
          {helping.map(chip)}
          {!helping.length && <span className="text-xs text-zinc-400 italic">None</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@lyzr.com" list="known-owner-emails"
          className="h-7 w-56 text-xs bg-white border-zinc-300 text-zinc-800"
          onKeyDown={e => e.key === 'Enter' && email.trim() && add('assign')} />
        <datalist id="known-owner-emails">
          {knownEmails?.map(e => <option key={e} value={e} />)}
        </datalist>
        <Button size="sm" disabled={busy || !email.trim()} onClick={() => add('assign')} className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs">Assign</Button>
        <Button size="sm" variant="outline" disabled={busy || !email.trim()} onClick={() => add('contribute')} className="h-7 text-xs border-zinc-300 text-zinc-700">Add as contributor</Button>
      </div>
    </div>
  )
}
