'use client'

// Ask and reply, shown everywhere a task appears.
//   AskPills      small flags for cards and rows (awaiting reply / needs alignment)
//   AskReplyGrid  the full 2 x 2: priority and due date, asked and replied
//   ReplyBox      accept as asked, or propose your own priority and date
//   NeedsReplyStrip  the "needs your reply" list at the top of a page
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Clock, GitCompareArrows, Loader2, MessageSquareReply } from 'lucide-react'
import { PRIORITY_COLORS, type Task, type TaskPriority } from '@/lib/types/database'
import { askState, primaryAssignee, shortDate, PRIORITY_NAMES } from '@/lib/ask'
import { replyToTask } from '@/lib/actions'
import { cn } from '@/lib/utils'

export function PriorityTag({ p, muted }: { p: TaskPriority | null; muted?: boolean }) {
  if (!p) return <span className="text-xs text-zinc-400">—</span>
  const c = PRIORITY_COLORS[p]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', muted && 'opacity-60')} style={{ color: c }} title={PRIORITY_NAMES[p]}>
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />{p}
    </span>
  )
}

export function AskPills({ task, className }: { task: Task; className?: string }) {
  const s = askState(task)
  if (!s.tracked || s.self) return null
  if (s.awaiting) {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800', className)}
        title={`Asked for ${s.askedPriority}, due ${shortDate(s.askedDue)}. Waiting for ${primaryAssignee(task)?.user?.display_name || 'the assignee'} to accept or propose their own.`}>
        <Clock className="w-3 h-3" /> Awaiting reply
      </span>
    )
  }
  if (s.differs) {
    const bits = [
      s.priorityDiffers ? `asked ${s.askedPriority}, replied ${s.repliedPriority}` : null,
      s.dueDiffers ? `due asked ${shortDate(s.askedDue)}, replied ${shortDate(s.repliedDue)}` : null,
    ].filter(Boolean).join(' · ')
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700', className)}
        title={`Needs alignment: ${bits}${task.reply_note ? `. Note: ${task.reply_note}` : ''}`}>
        <GitCompareArrows className="w-3 h-3" />
        {s.priorityDiffers ? `${s.askedPriority} asked · ${s.repliedPriority} replied` : `Due ${shortDate(s.askedDue)} asked · ${shortDate(s.repliedDue)} replied`}
      </span>
    )
  }
  return null
}

// Asked vs replied, for both priority and due date. Always shows all four.
export function AskReplyGrid({ task, className }: { task: Task; className?: string }) {
  const s = askState(task)
  if (!s.tracked) return null
  const by = task.creator?.display_name || task.creator?.email || 'Assigned by'
  const to = primaryAssignee(task)?.user?.display_name || 'Assigned to'
  const cell = 'px-3 py-2 text-sm'
  return (
    <div className={cn('rounded-lg border border-zinc-200 overflow-hidden bg-white', className)}>
      <div className="grid grid-cols-[7rem_1fr_1fr] text-[11px] uppercase tracking-wider text-zinc-500 bg-zinc-50 border-b border-zinc-200">
        <span className="px-3 py-1.5" />
        <span className="px-3 py-1.5 truncate" title={`What ${by} asked for`}>Requested{s.self ? '' : ` · ${by.split(' ')[0]}`}</span>
        <span className="px-3 py-1.5 truncate" title={`What ${to} came back with`}>Replied{s.self ? '' : ` · ${to.split(' ')[0]}`}</span>
      </div>
      <div className="grid grid-cols-[7rem_1fr_1fr] border-b border-zinc-100">
        <span className={cn(cell, 'text-zinc-500 text-xs')}>Priority</span>
        <span className={cell}><PriorityTag p={s.askedPriority} /> <span className="text-xs text-zinc-500">{PRIORITY_NAMES[s.askedPriority]}</span></span>
        <span className={cn(cell, s.priorityDiffers && 'bg-rose-50')}>
          {s.replied ? <><PriorityTag p={s.repliedPriority} /> <span className="text-xs text-zinc-500">{PRIORITY_NAMES[s.repliedPriority || '']}</span></> : <span className="text-xs text-amber-700">Awaiting reply</span>}
        </span>
      </div>
      <div className="grid grid-cols-[7rem_1fr_1fr]">
        <span className={cn(cell, 'text-zinc-500 text-xs')}>Due date</span>
        <span className={cn(cell, 'text-zinc-800')}>{shortDate(s.askedDue)}</span>
        <span className={cn(cell, 'text-zinc-800', s.dueDiffers && 'bg-rose-50')}>
          {s.replied ? shortDate(s.repliedDue) : <span className="text-xs text-amber-700">Awaiting reply</span>}
        </span>
      </div>
      {(s.differs || task.reply_note) && (
        <div className="px-3 py-2 border-t border-zinc-100 text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
          {s.differs && <span className="inline-flex items-center gap-1 font-medium text-rose-700"><GitCompareArrows className="w-3.5 h-3.5" /> Needs alignment</span>}
          {task.reply_note && <span className="text-zinc-600">“{task.reply_note}”</span>}
          {s.differs && <span className="text-zinc-500">Talk it through in Chat below, then either side can update their value.</span>}
        </div>
      )}
    </div>
  )
}

const PRIOS: TaskPriority[] = ['P0', 'P1', 'P2', 'P3']

export function PriorityChips({ value, onChange, size = 'md' }: { value: TaskPriority | ''; onChange: (p: TaskPriority) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRIOS.map(p => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={cn('inline-flex items-center gap-1.5 rounded-full border transition-colors cursor-pointer',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-sm',
            value === p ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100')}>
          <span className="w-2 h-2 rounded-full ring-1 ring-white/70" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
          <span className="font-semibold">{p}</span>
          <span className={cn(value === p ? 'text-zinc-300' : 'text-zinc-500')}>{PRIORITY_NAMES[p]}</span>
        </button>
      ))}
    </div>
  )
}

// The assignee's answer. "Accept" sends the asked values back; "Propose"
// opens priority + date + an optional note.
export function ReplyBox({ task, onDone, compact }: { task: Task; onDone?: () => void; compact?: boolean }) {
  const qc = useQueryClient()
  const s = askState(task)
  const [proposing, setProposing] = useState(false)
  const [p, setP] = useState<TaskPriority>(s.askedPriority)
  const [d, setD] = useState<string>(s.askedDue || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'accept' | 'propose' | null>(null)
  const by = task.creator?.display_name?.split(' ')[0] || 'They'

  const send = async (kind: 'accept' | 'propose') => {
    const prio = kind === 'accept' ? s.askedPriority : p
    const due = kind === 'accept' ? (s.askedDue || '') : d
    if (!due) { setProposing(true); toast.error('This task has no due date yet. Pick the date you can commit to.'); return }
    setBusy(kind)
    try {
      await replyToTask(task.id, prio, due, kind === 'propose' ? note : undefined)
      toast.success(kind === 'accept' ? 'Accepted as asked' : `Replied: ${prio}, due ${shortDate(due)}. ${by} has been told.`)
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', task.id] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setProposing(false)
      onDone?.()
    } catch (err) {
      toast.error((err as Error).message || 'Could not send the reply')
    } finally { setBusy(null) }
  }

  return (
    <div className={cn('rounded-lg border border-amber-200 bg-amber-50/60', compact ? 'p-2.5' : 'p-3')} onClick={e => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-xs text-zinc-700 flex-1 min-w-[12rem]">
          <MessageSquareReply className="inline w-3.5 h-3.5 mr-1 text-amber-700" />
          <span className="font-medium">{by}</span> asked for <PriorityTag p={s.askedPriority} />, due <span className="font-medium">{shortDate(s.askedDue)}</span>. Does that work for you?
        </p>
        {!proposing && (
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={!!busy} onClick={() => send('accept')}
              className="inline-flex items-center gap-1 h-7 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-2.5 disabled:opacity-60 cursor-pointer">
              {busy === 'accept' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Accept
            </button>
            <button type="button" disabled={!!busy} onClick={() => setProposing(true)}
              className="h-7 rounded-md border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-medium px-2.5 cursor-pointer">
              Propose my own
            </button>
          </div>
        )}
      </div>
      {proposing && (
        <div className="mt-2.5 pt-2.5 border-t border-amber-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500 w-16">My priority</span>
            <PriorityChips value={p} onChange={setP} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500 w-16">My date</span>
            <input type="date" value={d} onChange={e => setD(e.target.value)}
              className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-900" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500 w-16">Why</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional. e.g. Launch week, can start Thursday"
              className="h-7 flex-1 min-w-[12rem] rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-900 placeholder:text-zinc-400" />
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            <button type="button" onClick={() => setProposing(false)} className="h-7 px-2.5 text-xs text-zinc-600 hover:text-zinc-900 cursor-pointer">Cancel</button>
            <button type="button" disabled={!!busy || !d} onClick={() => send('propose')}
              className="inline-flex items-center gap-1 h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium px-3 disabled:opacity-60 cursor-pointer">
              {busy === 'propose' && <Loader2 className="w-3 h-3 animate-spin" />} Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Pinned at the top of a page until every task in it has an answer.
export function NeedsReplyStrip({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  if (!tasks.length) return null
  return (
    <section className="rounded-xl border border-amber-300 bg-white shadow-sm">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50 rounded-t-xl">
        <MessageSquareReply className="w-4 h-4 text-amber-700" />
        <h2 className="text-sm font-semibold text-zinc-900">Needs your reply</h2>
        <span className="rounded-full bg-amber-200 text-amber-900 text-[11px] font-semibold px-1.5">{tasks.length}</span>
        <span className="text-xs text-zinc-500 hidden sm:inline">Accept what was asked, or come back with your own priority and date.</span>
      </header>
      <div className="divide-y divide-zinc-100">
        {tasks.map(t => (
          <div key={t.id} className="px-4 py-3 space-y-2">
            <button type="button" onClick={() => onOpen(t.id)} className="text-left text-sm font-medium text-zinc-900 hover:text-blue-700 cursor-pointer">{t.title}</button>
            <ReplyBox task={t} compact />
          </div>
        ))}
      </div>
    </section>
  )
}
