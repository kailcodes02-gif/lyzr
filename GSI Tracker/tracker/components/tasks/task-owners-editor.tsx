'use client'

import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useKnownEmails } from '@/lib/hooks/use-data'
import { addTaskOwner, removeTaskOwner } from '@/lib/actions'
import type { Task } from '@/lib/types/database'
import { Crown, X } from 'lucide-react'
import { toast } from 'sonner'

// Owners block for the task drawer: shows signed-in AND pending owners,
// lets anyone add an owner by email (primary or secondary) with suggestions
// from every address the tracker already knows.
export function TaskOwnersEditor({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { data: knownEmails } = useKnownEmails()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const pending = (task.pending_assignments || []).filter(p => !p.resolved_user_id)

  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try { await fn(); onChanged() } catch (err) {
      toast.error(`${failMsg}: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally { setBusy(false) }
  }

  const add = (role: 'primary' | 'secondary') =>
    run(() => addTaskOwner(task.id, email, role).then(() => setEmail('')), 'Failed to add owner')

  return (
    <div className="mb-4">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Owners</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {task.assignments?.map(a => (
          <div key={a.user_id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${a.role === 'primary' ? 'bg-amber-50 border border-amber-200' : 'bg-zinc-100'}`}>
            {a.role === 'primary' && <Crown className="w-3 h-3 text-amber-600" />}
            <Avatar className="w-5 h-5">
              <AvatarImage src={a.user?.avatar_url || ''} />
              <AvatarFallback className="bg-zinc-300 text-[9px]">{a.user?.display_name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-zinc-700">{a.user?.display_name}</span>
            <Badge variant="outline" className="text-[9px] border-zinc-300 text-zinc-500 capitalize">{a.role}</Badge>
            <button onClick={() => run(() => removeTaskOwner(task.id, { userId: a.user_id }), 'Failed to remove owner')}
              className="text-zinc-400 hover:text-red-600" title="Remove owner">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {pending.map(p => (
          <div key={p.email} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border border-dashed ${p.role === 'primary' ? 'bg-amber-50/50 border-amber-200' : 'bg-zinc-50 border-zinc-300'}`}
            title={`${p.email} — has not signed in yet`}>
            {p.role === 'primary' && <Crown className="w-3 h-3 text-amber-600" />}
            <span className="text-xs text-zinc-500 capitalize">{p.email.split('@')[0]}</span>
            <Badge variant="outline" className="text-[9px] border-zinc-300 text-zinc-400 capitalize">{p.role} · pending</Badge>
            <button onClick={() => run(() => removeTaskOwner(task.id, { email: p.email }), 'Failed to remove owner')}
              className="text-zinc-400 hover:text-red-600" title="Remove owner">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {!task.assignments?.length && !pending.length && (
          <span className="text-xs text-zinc-400 italic">Unassigned — inherits the channel&apos;s owners</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="email@lyzr.ai"
          list="known-owner-emails"
          className="h-7 w-56 text-xs bg-white border-zinc-300 text-zinc-800"
          onKeyDown={e => e.key === 'Enter' && email.trim() && add('secondary')}
        />
        <datalist id="known-owner-emails">
          {knownEmails?.map(e => <option key={e} value={e} />)}
        </datalist>
        <Button size="sm" disabled={busy || !email.trim()} onClick={() => add('secondary')}
          className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs">Add secondary</Button>
        <Button size="sm" variant="outline" disabled={busy || !email.trim()} onClick={() => add('primary')}
          className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50">
          <Crown className="w-3 h-3 mr-1" /> Make primary
        </Button>
      </div>
    </div>
  )
}
