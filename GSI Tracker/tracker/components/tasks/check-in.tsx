'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, isBefore, parseISO, startOfDay } from 'date-fns'
import { ArrowRight, Ban, Check, CheckCircle2, Copy, Loader2, Play, CalendarClock } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { updateTask } from '@/lib/actions'
import { checkInQueue, checkInSummary, moveOptions, type CheckInTally } from '@/lib/check-in'
import { currentWeek } from '@/lib/week-logic'
import { STATUS_CONFIG, type Task } from '@/lib/types/database'
import { isTypingTarget } from './quick-add'
import { cn } from '@/lib/utils'

// "Update my week" in about two minutes: one task at a time, one click (or
// key) each. Same rules as the drawer: closing a task with open dependencies
// asks first, recurring tasks spawn their next occurrence.

type Mode = 'ask' | 'move' | 'block' | 'force'

export function CheckInDialog({ open, onOpenChange, tasks, name }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: Task[]
  name: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-white">
        <DialogTitle className="text-base font-semibold text-zinc-900">Weekly check-in</DialogTitle>
        {/* Mounted per opening, so each check-in starts fresh. */}
        {open && <CheckInBody tasks={tasks} name={name} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CheckInBody({ tasks, name, onClose }: { tasks: Task[]; name: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  // Frozen at opening so answered tasks don't reshuffle the walk-through.
  const [queue] = useState<Task[]>(() => checkInQueue(tasks))
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('ask')
  const [reason, setReason] = useState('')
  const [pickDate, setPickDate] = useState('')
  const [tally, setTally] = useState<CheckInTally>({ done: [], moved: [], blocked: [], started: [] })
  const [isPending, startTransition] = useTransition()

  const task = queue[index]
  const finished = queue.length > 0 && index >= queue.length
  const week = currentWeek()
  const options = useMemo(() => moveOptions(), [])

  const next = () => { setIndex(i => i + 1); setMode('ask'); setReason(''); setPickDate('') }

  const apply = (patch: Parameters<typeof updateTask>[1], record: keyof CheckInTally, label: string, opts?: { overrideBlockers?: boolean }) => {
    if (!task) return
    startTransition(async () => {
      try {
        await updateTask(task.id, patch, opts)
        setTally(t => ({ ...t, [record]: [...t[record], label] }))
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', task.id] })
        next()
      } catch (err) {
        const msg = (err as Error).message || ''
        if (patch.status === 'done' && /blocking task/i.test(msg)) setMode('force')
        else toast.error(msg || 'Could not update the task')
      }
    })
  }

  const done = (force = false) => apply({ status: 'done' }, 'done', task!.title, force ? { overrideBlockers: true } : undefined)
  const start = () => apply({ status: 'in_progress' }, 'started', task!.title)
  const move = (date: string) => apply({ due_date: date }, 'moved', `${task!.title} → ${format(parseISO(date), 'EEE d MMM')}`)
  const block = () => {
    if (!reason.trim()) { toast.error('Say what it is waiting on'); return }
    apply({ status: 'blocked', blocked_reason: reason.trim() }, 'blocked', `${task!.title}: ${reason.trim()}`)
  }

  // Keys: D done, S start, M move, B blocked, → or K skip.
  useEffect(() => {
    if (!task || mode !== 'ask' || isPending) return
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'd') { e.preventDefault(); done() }
      else if (k === 's' && task.status === 'not_started') { e.preventDefault(); start() }
      else if (k === 'm') { e.preventDefault(); setMode('move') }
      else if (k === 'b') { e.preventDefault(); setMode('block') }
      else if (k === 'arrowright' || k === 'k') { e.preventDefault(); next() }
    }
    // Capture phase: the dialog's focus handling swallows arrow keys on bubble.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const summary = checkInSummary(name, tally, week.label)
  const copy = async () => {
    try { await navigator.clipboard.writeText(summary); toast.success('Copied. Paste it in Slack.') }
    catch { toast.error('Could not copy. Select the text and copy it.') }
  }

  const today = startOfDay(new Date())
  const late = task?.due_date && isBefore(parseISO(task.due_date), today)

  return (
    <>
        {queue.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-medium text-zinc-800">You are all caught up.</p>
            <p className="text-xs text-zinc-500">Nothing overdue, nothing due this week, nothing stuck without a date.</p>
            <Button variant="outline" className="mt-2" onClick={onClose}>Close</Button>
          </div>
        ) : finished ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              {([['Done', tally.done.length, 'text-emerald-700'], ['Started', tally.started.length, 'text-amber-700'],
                ['Moved', tally.moved.length, 'text-blue-700'], ['Blocked', tally.blocked.length, 'text-red-700']] as const).map(([l, n, c]) => (
                <div key={l} className="rounded-lg border border-zinc-200 py-2">
                  <div className={cn('text-xl font-semibold', c)}>{n}</div>
                  <div className="text-[11px] text-zinc-500">{l}</div>
                </div>
              ))}
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-700">{summary}</pre>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={copy}><Copy className="w-4 h-4 mr-1.5" /> Copy for Slack</Button>
              <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={onClose}>Finish</Button>
            </div>
          </div>
        ) : task && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span>{index + 1} of {queue.length}</span>
              <div className="flex-1 h-1 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full bg-orange-500 transition-all" style={{ width: `${(index / queue.length) * 100}%` }} />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 space-y-1.5">
              <p className="text-[11px] text-zinc-500 truncate">{task.channel?.name || 'No channel'}</p>
              <p className="text-base font-semibold text-zinc-900 leading-snug">{task.title}</p>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: STATUS_CONFIG[task.status].bgColor, color: STATUS_CONFIG[task.status].color }}>
                  {STATUS_CONFIG[task.status].label}
                </span>
                {task.due_date
                  ? <span className={late ? 'text-red-600 font-medium' : 'text-zinc-600'}>{late ? 'Was due' : 'Due'} {format(parseISO(task.due_date), 'EEE d MMM')}</span>
                  : <span className="text-zinc-500">No due date</span>}
              </div>
              {task.status === 'blocked' && task.blocked_reason && <p className="text-xs text-red-700">Blocked: {task.blocked_reason}</p>}
            </div>

            {mode === 'ask' && (
              <div className="grid grid-cols-2 gap-2">
                <ActionButton icon={<Check className="w-4 h-4" />} label="Done" k="D" tone="emerald" onClick={() => done()} disabled={isPending} />
                {task.status === 'not_started'
                  ? <ActionButton icon={<Play className="w-4 h-4" />} label="Started it" k="S" tone="amber" onClick={start} disabled={isPending} />
                  : <ActionButton icon={<ArrowRight className="w-4 h-4" />} label="Still on track" k="→" tone="zinc" onClick={next} disabled={isPending} />}
                <ActionButton icon={<CalendarClock className="w-4 h-4" />} label="Move the date" k="M" tone="blue" onClick={() => setMode('move')} disabled={isPending} />
                <ActionButton icon={<Ban className="w-4 h-4" />} label="Blocked" k="B" tone="red" onClick={() => setMode('block')} disabled={isPending} />
              </div>
            )}

            {mode === 'move' && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-700">New due date</p>
                <div className="grid grid-cols-2 gap-2">
                  {options.map(o => (
                    <Button key={o.label} variant="outline" disabled={isPending} onClick={() => move(o.date)} className="justify-between">
                      {o.label} <span className="text-[11px] text-zinc-400">{format(parseISO(o.date), 'd MMM')}</span>
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="date" value={pickDate} onChange={e => setPickDate(e.target.value)} aria-label="Pick a date"
                    className="flex-1 h-9 rounded-md border border-zinc-300 px-2 text-sm" />
                  <Button disabled={!pickDate || isPending} onClick={() => move(pickDate)}>Set</Button>
                  <Button variant="ghost" onClick={() => setMode('ask')}>Back</Button>
                </div>
              </div>
            )}

            {mode === 'block' && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-700">What is it waiting on?</p>
                <input autoFocus value={reason} onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') block() }}
                  placeholder="e.g. Creative approval from Priya" className="w-full h-9 rounded-md border border-zinc-300 px-2 text-sm" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setMode('ask')}>Back</Button>
                  <Button disabled={isPending} onClick={block} className="bg-red-600 hover:bg-red-700 text-white">Mark blocked</Button>
                </div>
              </div>
            )}

            {mode === 'force' && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">This task depends on tasks that are not finished yet. Close it anyway?</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setMode('ask')}>Back</Button>
                  <Button disabled={isPending} onClick={() => done(true)}>Close anyway</Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>{isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Keys: D · S · M · B · → skip'}</span>
              <button className="hover:text-zinc-700" onClick={next}>Skip</button>
            </div>
          </div>
        )}
    </>
  )
}

const TONES = {
  emerald: 'hover:border-emerald-300 hover:bg-emerald-50 text-emerald-800',
  amber: 'hover:border-amber-300 hover:bg-amber-50 text-amber-800',
  blue: 'hover:border-blue-300 hover:bg-blue-50 text-blue-800',
  red: 'hover:border-red-300 hover:bg-red-50 text-red-800',
  zinc: 'hover:border-zinc-300 hover:bg-zinc-50 text-zinc-800',
}

function ActionButton({ icon, label, k, tone, onClick, disabled }: {
  icon: React.ReactNode; label: string; k: string; tone: keyof typeof TONES; onClick: () => void; disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn('flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50', TONES[tone])}>
      {icon}<span className="flex-1 text-left">{label}</span>
      <kbd className="text-[10px] text-zinc-400 border border-zinc-200 rounded px-1">{k}</kbd>
    </button>
  )
}
