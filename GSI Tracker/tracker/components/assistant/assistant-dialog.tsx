'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles, Send, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InfoTip } from '@/components/ui/info-tip'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { createClient } from '@/lib/supabase/client'
import { useChannels, useTasks, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { STATUS_CONFIG, type Task, type TaskPriority } from '@/lib/types/database'

// Two intents only: create a task (prefills the normal form; you press
// Create) and find a task (status + link). Everything else is refused.

type Reply =
  | { intent: 'create_task'; task: { title?: string; description?: string; channel_id?: string | null; due_date?: string; priority?: TaskPriority; owner_emails?: string[]; missing?: string[] } }
  | { intent: 'find_task'; task_id: string; answer: string; alternatives?: string[] }
  | { intent: 'clarify'; question: string }
  | { intent: 'refuse'; answer: string }

const EXAMPLES = ['Assign "Draft the Q4 ABM email" on GSI Email to Anju, due Friday', 'What is the status of the Accenture webinar task?']

export function AssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { verticals } = useVertical()
  const { data: channels } = useChannels('all')
  const { data: users } = useUsers()
  const { data: tasks } = useTasks({ verticalId: 'all' })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  const vName = (id?: string | null) => verticals.find(v => v.id === id)?.name || ''
  const channelById = useMemo(() => new Map((channels || []).map(c => [c.id, c])), [channels])
  const taskById = useMemo(() => new Map((tasks || []).map(t => [t.id, t])), [tasks])

  const context = () => ({
    today: new Date().toISOString().slice(0, 10),
    channels: (channels || []).map(c => ({ id: c.id, name: c.name, vertical: vName(c.vertical_id), parent: c.parent_channel_id ? channelById.get(c.parent_channel_id)?.name : undefined })),
    users: (users || []).filter(u => u.email !== 'preview@lyzr.ai').map(u => ({ email: u.email, name: u.display_name })),
    tasks: (tasks || [])
      .filter(t => t.status !== 'cancelled')
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 600)
      .map(t => ({
        id: t.id, title: t.title, status: t.status, channel: t.channel?.name || '', vertical: vName(t.channel?.vertical_id), due: t.due_date,
        owners: [...(t.assignments || []).map(a => a.user?.display_name || a.user?.email || ''), ...(t.pending_assignments || []).filter(p => !p.resolved_user_id).map(p => p.email)].filter(Boolean),
      })),
  })

  const send = async (msg?: string) => {
    const message = (msg ?? text).trim()
    if (!message || busy) return
    setBusy(true); setReply(null)
    try {
      const { data: { session } } = await createClient().auth.getSession()
      if (!session) throw new Error('Sign in first')
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ message, context: context() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setReply(data as Reply)
      if (data.intent === 'create_task') setCreateOpen(true)
    } catch (e: any) { toast.error(e?.message || 'Assistant failed') }
    finally { setBusy(false) }
  }

  const taskHit = (t: Task, answer?: string) => {
    const cfg = STATUS_CONFIG[t.status]
    const v = verticals.find(x => x.id === t.channel?.vertical_id)
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-1.5">
        {answer && <p className="text-sm text-zinc-800">{answer}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="text-[10px] border-0" style={{ backgroundColor: cfg.bgColor, color: cfg.color }}>{cfg.label}</Badge>
          <span className="text-sm font-medium text-zinc-900">{t.title}</span>
          <span className="text-[11px] text-zinc-500">{v?.name} › {t.channel?.name}{t.due_date ? ` · due ${t.due_date}` : ''}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button onClick={() => setDrawerId(t.id)} className="text-blue-600 hover:underline">Open task</button>
          <Link href={withVertical('/channel/', v?.slug || 'all', { id: t.channel_id })} className="text-zinc-600 hover:underline inline-flex items-center gap-1" onClick={() => onOpenChange(false)}><ExternalLink className="w-3 h-3" /> Channel board</Link>
        </div>
      </div>
    )
  }

  const create = reply?.intent === 'create_task' ? reply.task : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" /> Assistant <InfoTip k="assistant" /></DialogTitle></DialogHeader>
          <div className="space-y-3">
            <form onSubmit={e => { e.preventDefault(); send() }} className="flex gap-2">
              <Input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Create a task… or ask where a task is" className="bg-zinc-100 border-zinc-300 h-10" />
              <Button type="submit" disabled={busy || !text.trim()} className="bg-gradient-to-r from-blue-600 to-violet-600 text-white border-0 h-10">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</Button>
            </form>
            {!reply && !busy && (
              <div className="space-y-1">
                <p className="text-[11px] text-zinc-500">Two things it can do. Try:</p>
                {EXAMPLES.map(x => <button key={x} onClick={() => { setText(x); send(x) }} className="block text-left text-xs text-blue-600 hover:underline">“{x}”</button>)}
              </div>
            )}
            {reply?.intent === 'find_task' && taskById.get(reply.task_id) && (
              <div className="space-y-2">
                taskHit(taskById.get(reply.task_id)!, reply.answer)
                {reply.alternatives?.filter(id => taskById.get(id)).map(id => <div key={id}>{taskHit(taskById.get(id)!)}</div>)}
              </div>
            )}
            {reply?.intent === 'clarify' && <p className="text-sm text-zinc-700 rounded-lg bg-zinc-50 border border-zinc-200 p-3">{reply.question}</p>}
            {reply?.intent === 'refuse' && <p className="text-sm text-zinc-700 rounded-lg bg-zinc-50 border border-zinc-200 p-3">{reply.answer}</p>}
            {create && !createOpen && <p className="text-xs text-zinc-500">Form opened with what you said. {create.missing?.length ? `Still needed: ${create.missing.join(', ')}.` : 'Press Create to save it.'}</p>}
          </div>
        </DialogContent>
      </Dialog>
      {create && createOpen && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={o => { setCreateOpen(o); if (!o) setReply(null) }}
          defaultChannelId={create.channel_id || undefined}
          defaultVerticalId={create.channel_id ? channelById.get(create.channel_id)?.vertical_id : undefined}
          defaultTitle={create.title}
          defaultDescription={create.description}
          defaultDueDate={create.due_date}
          defaultPriority={create.priority}
          defaultOwnerEmails={create.owner_emails}
          onSuccess={() => { setCreateOpen(false); setReply(null); onOpenChange(false); setText('') }}
        />
      )}
      {drawerId && <TaskDetailDrawer taskId={drawerId} open onOpenChange={o => { if (!o) setDrawerId(null) }} onTaskIdChange={setDrawerId} />}
    </>
  )
}
