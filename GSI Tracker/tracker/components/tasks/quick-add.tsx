'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Flag, Hash, Loader2, Plus, SlidersHorizontal, User } from 'lucide-react'
import { useChannels, useCurrentUser, useKnownEmails, useUsers } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { assignTaskByEmail, createTask } from '@/lib/actions'
import { parseQuickAdd, resolveChannel, resolveOwner } from '@/lib/quick-add'
import { PRIORITY_COLORS, type Channel, type TaskPriority } from '@/lib/types/database'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { CreateTaskDialog } from './create-task-dialog'
import { cn } from '@/lib/utils'

// One line, Enter, done. Everything optional except the title: no owner means
// you, no channel means the vertical's "No channel", no priority means P2.
// "More options" hands what was typed to the full New Task dialog.

export function QuickAdd({ autoFocus, onCreated, className }: {
  autoFocus?: boolean
  onCreated?: (taskId: string) => void
  className?: string
}) {
  const queryClient = useQueryClient()
  const { mode, vertical, verticals } = useVertical()
  const { data: me } = useCurrentUser()
  const { data: users } = useUsers()
  const { data: knownEmails } = useKnownEmails()
  const { data: channels } = useChannels('all')
  const [text, setText] = useState('')
  const [fullOpen, setFullOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])

  // Inside a vertical the task is tagged with it; elsewhere it goes to Lyzr,
  // the main board (same default as the API).
  const lyzr = verticals.find(v => v.slug === 'lyzr')
  const targetVertical = mode === 'space' && vertical ? vertical : lyzr || null

  const people = useMemo(() => {
    const map = new Map<string, { email: string; name: string | null; userId?: string }>()
    for (const u of users || []) {
      for (const e of [u.email, u.alt_email].filter(Boolean) as string[]) {
        map.set(e.toLowerCase(), { email: u.email.toLowerCase(), name: u.display_name, userId: u.id })
      }
    }
    for (const e of knownEmails || []) if (!map.has(e)) map.set(e, { email: e, name: null })
    return map
  }, [users, knownEmails])
  // Every address (alt emails included) maps to the person's main email, so
  // someone with two addresses is one match, not an ambiguous two.
  const peopleList = useMemo(() => [...people.entries()].flatMap(([alias, p]) => [
    { email: p.email, name: p.name },
    ...(alias !== p.email ? [{ email: p.email, name: p.name, alias }] : []),
  ]), [people])

  const liveChannels = useMemo(
    () => (channels || []).filter(c => c.is_active && c.slug !== 'no-channel'),
    [channels])

  const parsed = useMemo(() => parseQuickAdd(text), [text])
  const owners = parsed.owners.map(token => {
    const email = resolveOwner(token, peopleList)
    return { token, email: email ? (people.get(email)?.email || email) : null }
  })
  const channel: Channel | null = useMemo(() => {
    if (!parsed.channel) return null
    const own = liveChannels.filter(c => c.vertical_id === targetVertical?.id)
    return resolveChannel(parsed.channel, own) || resolveChannel(parsed.channel, liveChannels)
  }, [parsed.channel, liveChannels, targetVertical?.id])
  const channelMissing = !!parsed.channel && !channel
  const unknownOwner = owners.find(o => !o.email)

  const submit = () => {
    if (!parsed.title) { toast.error('Type what needs doing first'); return }
    if (unknownOwner) { toast.error(`Who is @${unknownOwner.token}? Use their email name, e.g. @priya or @priya.sharma`); return }
    if (channelMissing) { toast.error(`No single channel matches #${parsed.channel}. Type more of its name, or drop it.`); return }
    const vId = channel?.vertical_id || targetVertical?.id
    const bucket = channel || (channels || []).find(c => c.slug === 'no-channel' && !c.parent_channel_id && c.is_active && c.vertical_id === vId)
      || (channels || []).find(c => c.slug === 'no-channel' && !c.parent_channel_id && c.is_active)
    if (!bucket) { toast.error('No "No channel" bucket found. Use More options to pick a channel.'); return }

    const emails = owners.length ? owners.map(o => o.email!) : me ? [me.email.toLowerCase()] : []
    const unique = [...new Set(emails)]
    const assignments = unique
      .map((e, i) => ({ userId: people.get(e)?.userId, role: (i === 0 ? 'primary' : 'secondary') as 'primary' | 'secondary', email: e }))
    startTransition(async () => {
      try {
        const task = (await createTask({
          title: parsed.title,
          channel_id: bucket.id,
          vertical_ids: vId ? [vId] : [],
          priority: (parsed.priority || 'P2') as TaskPriority,
          due_date: parsed.dueDate || undefined,
          assignments: assignments.filter(a => a.userId).map(a => ({ user_id: a.userId!, role: a.role })),
        })) as { id: string }
        for (const a of assignments.filter(x => !x.userId)) {
          await assignTaskByEmail({ taskId: task.id, email: a.email, role: a.role }).catch(() => {
            toast.error(`Could not add ${a.email} as an owner`)
          })
        }
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        setText('')
        toast.success(`Added “${parsed.title}”`, onCreated ? { action: { label: 'Open', onClick: () => onCreated(task.id) } } : undefined)
        inputRef.current?.focus()
      } catch (err) {
        toast.error((err as Error).message || 'Could not create the task')
      }
    })
  }

  const chip = (icon: React.ReactNode, label: string, tone: 'ok' | 'bad' = 'ok', style?: React.CSSProperties) => (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
      tone === 'ok' ? 'border-zinc-200 bg-zinc-50 text-zinc-700' : 'border-red-200 bg-red-50 text-red-700')} style={style}>
      {icon}{label}
    </span>
  )

  const ownerLabel = (email: string) => people.get(email)?.name?.split(' ')[0] || email.split('@')[0]

  return (
    <div className={cn('rounded-xl border border-zinc-200 bg-white shadow-sm focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100', className)}>
      <div className="flex items-center gap-2 px-3">
        <Plus className="w-4 h-4 text-orange-500 shrink-0" />
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
          placeholder="Add a task… e.g. Draft webinar invite @priya #content !p1 fri"
          aria-label="Quick add a task"
          className="flex-1 min-w-0 h-11 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
        />
        {isPending
          ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          : text.trim() && <kbd className="hidden sm:inline text-[10px] text-zinc-400 border border-zinc-200 rounded px-1.5 py-0.5">Enter</kbd>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-3 py-2">
        {text.trim() ? (
          <>
            {owners.length
              ? owners.map(o => o.email
                ? <span key={o.token}>{chip(<User className="w-3 h-3" />, ownerLabel(o.email))}</span>
                : <span key={o.token}>{chip(<User className="w-3 h-3" />, `who is @${o.token}?`, 'bad')}</span>)
              : chip(<User className="w-3 h-3" />, 'You')}
            {channelMissing
              ? chip(<Hash className="w-3 h-3" />, `no match for #${parsed.channel}`, 'bad')
              : chip(<Hash className="w-3 h-3" />, channel ? channel.name : `${targetVertical?.name || ''} · No channel`.replace(/^ · /, ''))}
            {chip(<Flag className="w-3 h-3" />, parsed.priority || 'P2', 'ok', { color: PRIORITY_COLORS[parsed.priority || 'P2'] })}
            {parsed.dueLabel && chip(<CalendarDays className="w-3 h-3" />, parsed.dueLabel)}
          </>
        ) : (
          <span className="text-[11px] text-zinc-400">
            Optional: <b className="font-medium text-zinc-500">@name</b> owner · <b className="font-medium text-zinc-500">#channel</b> · <b className="font-medium text-zinc-500">!p0–!p4</b> priority · a date at the end (<i>fri</i>, <i>tomorrow</i>, <i>12 nov</i>)
          </span>
        )}
        <button type="button" onClick={() => setFullOpen(true)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900">
          <SlidersHorizontal className="w-3 h-3" /> More options
        </button>
      </div>
      {fullOpen && (
        <CreateTaskDialog
          open={fullOpen}
          onOpenChange={setFullOpen}
          defaultTitle={parsed.title || undefined}
          defaultDueDate={parsed.dueDate || undefined}
          defaultPriority={parsed.priority || undefined}
          defaultOwnerEmails={owners.every(o => o.email) && owners.length ? owners.map(o => o.email!) : undefined}
          defaultChannelId={channel?.id}
          defaultVerticalId={channel?.vertical_id}
          onSuccess={() => { setFullOpen(false); setText('') }}
        />
      )}
    </div>
  )
}

// The same box in a small dialog, opened from the header button or by
// pressing N anywhere outside a text field.
export function QuickAddDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (taskId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-3 bg-zinc-50" showCloseButton={false}>
        <DialogTitle className="sr-only">New task</DialogTitle>
        <QuickAdd autoFocus onCreated={id => { onOpenChange(false); onCreated?.(id) }} />
        <p className="px-1 text-[11px] text-zinc-400">Press <kbd className="border border-zinc-200 rounded px-1">N</kbd> anywhere to open this. <kbd className="border border-zinc-200 rounded px-1">Esc</kbd> closes it.</p>
      </DialogContent>
    </Dialog>
  )
}

export function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}
