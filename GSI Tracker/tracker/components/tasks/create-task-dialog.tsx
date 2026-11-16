'use client'

// New task, in three short steps:
//   1. What and who     task name + Assign to (required; first person is primary)
//   2. When and urgency due date + priority (both required), where it sits
//   3. Details          description, sub-tasks, contributors, campaign, extras
// You are "Assigned by" automatically, so the form never asks about you. It
// reads the page it was opened from: a person's page pre-fills that person,
// My Tasks asks "for me or someone else?" first, channel / vertical / product /
// campaign views pre-fill their tag.
import { useState, useTransition, useEffect, useMemo, useRef } from 'react'
import { format, addDays, nextFriday, nextMonday, isFriday } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useChannels, useUsers, useKnownEmails, useCampaigns, useCurrentUser, useProducts } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { mergeChannelsByName } from '@/lib/task-channels'
import { createTask, assignTaskByEmail, addChecklistItem } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { type TaskPriority, type AssignmentRole } from '@/lib/types/database'
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight, Star, X, ArrowLeft, ArrowRight, User, Users, Check } from 'lucide-react'
import { RecurrencePicker, DEFAULT_RECURRENCE, type RecurrenceValue } from './recurrence-picker'
import { PriorityChips } from './ask-reply'
import { cn } from '@/lib/utils'

interface CreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultChannelId?: string
  defaultCategoryId?: string
  defaultVerticalId?: string
  defaultTitle?: string
  defaultDescription?: string
  defaultCampaignId?: string
  defaultDueDate?: string
  defaultPriority?: TaskPriority
  defaultOwnerEmails?: string[]
  /** Opened from a person's page: the task is for them. */
  forPerson?: { email: string; name: string }
  /** Opened from My Tasks: ask "for me or someone else?" first. */
  askWho?: boolean
  parentTaskId?: string
  nestingLevel?: number
  onSuccess?: () => void
}

type PersonOption = { email: string; userId?: string; label: string; pending: boolean }

const selectCls = 'h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 disabled:opacity-50'
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function CreateTaskDialog({
  open, onOpenChange, defaultChannelId, defaultVerticalId, defaultTitle, defaultDescription, defaultCampaignId,
  defaultDueDate, defaultPriority, defaultOwnerEmails, forPerson, askWho, parentTaskId, nestingLevel = 0, onSuccess,
}: CreateTaskDialogProps) {
  const queryClient = useQueryClient()
  const { verticalId: currentVerticalId, verticals, vertical: currentVertical, product: currentProduct, campaign: currentCampaign } = useVertical()
  const onLyzrBoard = currentVerticalId === 'all' || currentVertical?.slug === 'lyzr'
  const lyzrVerticalId = verticals.find(v => v.slug === 'lyzr')?.id || ''
  const { data: me } = useCurrentUser()
  const { data: users } = useUsers()
  const { data: knownEmails } = useKnownEmails()
  const { data: products } = useProducts()
  const { data: rawChannels } = useChannels('all')
  const [isPending, startTransition] = useTransition()

  // ----- step 1: what and who -----
  const [title, setTitle] = useState(defaultTitle || '')
  // Assigned to, in order. `primary` is one of them.
  const [assignees, setAssignees] = useState<string[]>([])
  const [primary, setPrimary] = useState<string>('')
  // ----- step 2: when and how urgent -----
  const [due, setDue] = useState(defaultDueDate || '')
  const [priority, setPriority] = useState<TaskPriority | ''>(defaultPriority || '')
  const [pickedVertical, setPickedVertical] = useState<string>(defaultVerticalId || (onLyzrBoard ? '' : currentVerticalId))
  const startProduct = currentProduct && currentProduct.slug !== 'lyzr' ? currentProduct.id : ''
  const [productId, setProductId] = useState(startProduct)
  const [channelId, setChannelId] = useState(defaultChannelId || '')
  const [pickedTop, setPickedTop] = useState('')
  const [otherChannel, setOtherChannel] = useState(false)
  const [whereOpen, setWhereOpen] = useState(false)
  // ----- step 3: details -----
  const [description, setDescription] = useState(defaultDescription || '')
  const [subtasks, setSubtasks] = useState<string[]>([])
  const [subDraft, setSubDraft] = useState('')
  const [helpers, setHelpers] = useState<string[]>([])
  const [campaignId, setCampaignId] = useState<string>(defaultCampaignId || currentCampaign?.id || '')
  const [showMore, setShowMore] = useState(false)
  const [checklist, setChecklist] = useState<string[]>([])
  const [checklistDraft, setChecklistDraft] = useState('')
  const [targets, setTargets] = useState<{ type: string; value: string }[]>([])
  const [targetType, setTargetType] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [links, setLinks] = useState<{ label: string; url: string }[]>([])
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [frequency, setFrequency] = useState('')
  const [budget, setBudget] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(DEFAULT_RECURRENCE)

  // Step 0 only exists on My Tasks ("for me or someone else?").
  const presetPeople = !!forPerson || !!defaultOwnerEmails?.length
  const hasWhoStep = !!askWho && !presetPeople && !parentTaskId
  const [step, setStep] = useState<0 | 1 | 2 | 3>(hasWhoStep ? 0 : 1)
  const titleRef = useRef<HTMLInputElement>(null)

  const showVerticalPicker = !defaultVerticalId && !parentTaskId
  const lockedChannel = !!defaultChannelId && !(parentTaskId && otherChannel)
  const effectiveVertical = pickedVertical || defaultVerticalId || (parentTaskId ? '' : (onLyzrBoard ? lyzrVerticalId : currentVerticalId))
  const { data: campaigns } = useCampaigns(pickedVertical || 'all')
  const channels = useMemo(
    () => mergeChannelsByName((rawChannels || []).filter(c => c.is_active || c.slug === 'no-channel'), effectiveVertical || lyzrVerticalId).channels,
    [rawChannels, effectiveVertical, lyzrVerticalId])
  const choosableProducts = useMemo(() => (products || []).filter(p => p.slug !== 'lyzr'), [products])
  const productGroups = useMemo(() => [...new Set(choosableProducts.map(p => p.group_name))], [choosableProducts])

  const people = useMemo(() => {
    const map = new Map<string, PersonOption>()
    users?.filter(u => u.email !== 'preview@lyzr.ai' && u.email !== 'preview@lyzr.com').forEach(u =>
      map.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), userId: u.id, label: u.display_name || u.email, pending: false }))
    knownEmails?.forEach(e => {
      if (!map.has(e)) map.set(e, { email: e, label: e.split('@')[0].split('.')[0].replace(/^./, (c: string) => c.toUpperCase()), pending: true })
    })
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [users, knownEmails])
  const person = (email: string): PersonOption =>
    people.find(o => o.email === email) || { email, label: email.split('@')[0], pending: true }
  const myEmail = me?.email.toLowerCase() || ''

  // Fresh state every time the dialog opens.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect -- reset the form each time the dialog is (re)opened */
    const preset = forPerson ? [forPerson.email.toLowerCase()] : (defaultOwnerEmails || []).map(e => e.toLowerCase())
    setAssignees(preset); setPrimary(preset[0] || '')
    setTitle(defaultTitle || ''); setDescription(defaultDescription || '')
    setDue(defaultDueDate || ''); setPriority(defaultPriority || '')
    setChannelId(defaultChannelId || ''); setPickedTop(''); setOtherChannel(false); setWhereOpen(false)
    setStep(hasWhoStep ? 0 : 1)
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const addAssignee = (email: string) => {
    const e = email.toLowerCase()
    setHelpers(h => h.filter(x => x !== e))
    setAssignees(a => a.includes(e) ? a : [...a, e])
    setPrimary(p => p || e)
  }
  const removeAssignee = (email: string) => {
    const rest = assignees.filter(x => x !== email)
    setAssignees(rest)
    if (primary === email) setPrimary(rest[0] || '')
  }

  const today = new Date()
  const dateChips = [
    { label: 'Today', value: iso(today) },
    { label: 'Tomorrow', value: iso(addDays(today, 1)) },
    { label: isFriday(today) ? 'Next Friday' : 'This Friday', value: iso(nextFriday(today)) },
    { label: 'Next Monday', value: iso(nextMonday(today)) },
  ]

  const channelName = (id: string) => channels.find(c => c.id === id)?.name
  const whereSummary = [
    showVerticalPicker ? (verticals.find(v => v.id === (pickedVertical || lyzrVerticalId))?.name || 'Lyzr') : null,
    !parentTaskId ? (choosableProducts.find(p => p.id === productId)?.name || 'Lyzr') : null,
    channelId ? (channelName(channelId) || 'Channel') : 'No channel',
  ].filter(Boolean) as string[]

  const step1Ok = title.trim().length > 0 && assignees.length > 0 && !!primary
  const step2Ok = !!due && !!priority
  const canSubNest = nestingLevel < 2

  const addTargetRow = () => {
    if (!targetType.trim() || !targetValue.trim()) return
    setTargets([...targets, { type: targetType.trim(), value: targetValue.trim() }]); setTargetType(''); setTargetValue('')
  }
  const addLinkRow = () => {
    if (!linkUrl.trim()) return
    const clean = linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`
    let name = linkLabel.trim()
    if (!name) { try { name = new URL(clean).hostname.replace('www.', '') } catch { name = clean } }
    setLinks([...links, { label: name, url: clean }]); setLinkLabel(''); setLinkUrl('')
  }

  const resetAll = () => {
    setTitle(''); setAssignees([]); setPrimary(''); setDue(''); setPriority(''); setDescription('')
    setSubtasks([]); setSubDraft(''); setHelpers([]); setChecklist([]); setChecklistDraft('')
    setTargets([]); setLinks([]); setFrequency(''); setBudget(''); setProductId(startProduct)
    setIsRecurring(false); setRecurrence(DEFAULT_RECURRENCE); setShowMore(false)
  }

  const submit = () => {
    if (!step1Ok) { setStep(1); toast.error(title.trim() ? 'Pick who this is assigned to' : 'Give the task a name'); return }
    if (!step2Ok) { setStep(2); toast.error(!due ? 'Pick a due date' : 'Pick a priority'); return }
    let channel = channelId
    if (!channel) {
      const bucket = (rawChannels || []).find(c => c.slug === 'no-channel' && !c.parent_channel_id && c.is_active)
      if (!bucket) { toast.error('Pick a channel: the “No channel” option is missing from the database'); setStep(2); setWhereOpen(true); return }
      channel = bucket.id
    }
    // Sub-task drafts typed but not yet added still count.
    const subs = [...subtasks, ...(subDraft.trim() ? [subDraft.trim()] : [])]
    const rows: { email: string; role: AssignmentRole }[] = [
      ...assignees.map(e => ({ email: e, role: (e === primary ? 'primary' : 'secondary') as AssignmentRole })),
      ...helpers.filter(e => !assignees.includes(e)).map(e => ({ email: e, role: 'other' as AssignmentRole })),
    ]
    const signedIn = rows.filter(r => person(r.email).userId).map(r => ({ user_id: person(r.email).userId!, role: r.role }))
    const pending = rows.filter(r => !person(r.email).userId)

    startTransition(async () => {
      try {
        const task = (await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          priority: priority as TaskPriority,
          due_date: due,
          channel_id: channel,
          vertical_ids: effectiveVertical ? [effectiveVertical] : [],
          product_ids: productId ? [productId] : [],
          parent_task_id: parentTaskId,
          nesting_level: nestingLevel,
          budget_allocated: budget.trim() === '' ? null : Number(budget),
          campaign_id: campaignId || null,
          planning_fields: {
            ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
            ...(targets.length ? { targets, kpi_target: `${targets[0].type}: ${targets[0].value}` } : {}),
            ...(links.length ? { links } : {}),
          },
          assignments: signedIn,
          recurrence: isRecurring ? { rule: recurrence.rule, end: recurrence.end } : undefined,
        })) as { id: string }

        for (const a of pending) {
          try { await assignTaskByEmail({ taskId: task.id, email: a.email, role: a.role }) }
          catch (err) { toast.error(`Could not add ${a.email}: ${(err as Error)?.message || 'unknown'}`) }
        }
        for (const body of checklist) {
          try { await addChecklistItem(task.id, body) } catch (err) { console.error('checklist item failed:', body, err) }
        }
        // Sub-tasks go to the same people with the same date and priority; change them on the task later.
        for (const sub of subs) {
          try {
            const child = (await createTask({
              title: sub, priority: priority as TaskPriority, due_date: due, channel_id: channel,
              parent_task_id: task.id, nesting_level: nestingLevel + 1,
              assignments: signedIn.filter(a => a.role !== 'other'),
            })) as { id: string }
            for (const a of pending.filter(x => x.role !== 'other')) await assignTaskByEmail({ taskId: child.id, email: a.email, role: a.role }).catch(() => {})
          } catch (err) { toast.error(`Sub-task “${sub}” failed: ${(err as Error)?.message || 'unknown'}`) }
        }

        const who = person(primary).label.split(' ')[0]
        const selfOnly = primary === myEmail
        toast.success(selfOnly ? 'Task added to your list' : `Task sent to ${who}. They will accept or come back with their own priority and date.`)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task'] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        queryClient.invalidateQueries({ queryKey: ['pendingInvites'] })
        resetAll()
        onOpenChange(false)
        onSuccess?.()
      } catch (err) {
        console.error('createTask failed:', err)
        toast.error((err as Error)?.message || 'Failed to create task')
      }
    })
  }

  const heading = parentTaskId ? 'New sub-task' : forPerson ? `New task for ${forPerson.name.split(' ')[0]}` : 'New task'
  const STEPS = [
    { n: 1 as const, label: 'What and who' },
    { n: 2 as const, label: 'When and how urgent' },
    { n: 3 as const, label: 'Details', optional: true },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-zinc-200 text-zinc-900 sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-semibold text-zinc-900">{heading}</DialogTitle>
          {step > 0 && (
            <ol className="flex items-center gap-1.5 pt-2">
              {STEPS.map((s, i) => {
                const reachable = s.n === 1 || (s.n === 2 && step1Ok) || (s.n === 3 && step1Ok && step2Ok)
                return (
                  <li key={s.n} className="flex items-center gap-1.5">
                    {i > 0 && <span className="w-5 h-px bg-zinc-200" />}
                    <button type="button" disabled={!reachable} onClick={() => setStep(s.n)}
                      className={cn('flex items-center gap-1.5 text-xs rounded-full pr-2 py-0.5 cursor-pointer disabled:cursor-default',
                        step === s.n ? 'text-zinc-900 font-medium' : 'text-zinc-500')}>
                      <span className={cn('w-5 h-5 rounded-full grid place-items-center text-[10px] font-semibold',
                        step === s.n ? 'bg-zinc-900 text-white' : step > s.n ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500')}>
                        {step > s.n ? <Check className="w-3 h-3" /> : s.n}
                      </span>
                      <span className="hidden sm:inline">{s.label}{s.optional ? ' (optional)' : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </DialogHeader>

        {/* ---------- step 0: for me or someone else? (My Tasks only) ---------- */}
        {step === 0 && (
          <div className="px-6 py-6">
            <p className="text-sm font-medium text-zinc-900 mb-3">Who is this task for?</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { if (myEmail) { setAssignees([myEmail]); setPrimary(myEmail) } setStep(1) }}
                className="rounded-xl border border-zinc-200 hover:border-zinc-900 hover:bg-zinc-50 p-4 text-left transition-colors cursor-pointer">
                <User className="w-5 h-5 text-blue-600 mb-2" />
                <p className="text-sm font-semibold text-zinc-900">For me</p>
                <p className="text-xs text-zinc-500 mt-0.5">Goes straight on your own list.</p>
              </button>
              <button type="button" onClick={() => { setAssignees([]); setPrimary(''); setStep(1) }}
                className="rounded-xl border border-zinc-200 hover:border-zinc-900 hover:bg-zinc-50 p-4 text-left transition-colors cursor-pointer">
                <Users className="w-5 h-5 text-violet-600 mb-2" />
                <p className="text-sm font-semibold text-zinc-900">For someone else</p>
                <p className="text-xs text-zinc-500 mt-0.5">You pick who. They reply with what works for them.</p>
              </button>
            </div>
          </div>
        )}

        {/* ---------- step 1: what and who ---------- */}
        {step === 1 && (
          <div className="px-6 py-5 space-y-5 min-h-[25rem]">
            <Field label="Task name" required>
              <input ref={titleRef} autoFocus value={title} onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && step1Ok) { e.preventDefault(); setStep(2) } }}
                placeholder="What needs to be done?"
                className="w-full h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900" />
            </Field>

            <Field label="Assign to" required hint={assignees.length > 1 ? 'The starred person is the primary: they reply on priority and due date. Click a star to change it.' : undefined}>
              {assignees.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {assignees.map(e => {
                    const p = person(e); const isPrimary = e === primary
                    return (
                      <span key={e} className={cn('inline-flex items-center gap-1.5 rounded-full border pl-1.5 pr-1 py-1 text-sm',
                        isPrimary ? 'border-amber-300 bg-amber-50 text-zinc-900' : 'border-zinc-200 bg-zinc-50 text-zinc-800')}>
                        <button type="button" onClick={() => setPrimary(e)} title={isPrimary ? 'Primary' : 'Make primary'} className="cursor-pointer">
                          <Star className={cn('w-3.5 h-3.5', isPrimary ? 'text-amber-500 fill-amber-400' : 'text-zinc-300 hover:text-amber-400')} />
                        </button>
                        {e === myEmail ? 'Me' : p.label}
                        {assignees.length > 1 && isPrimary && <span className="text-[10px] uppercase tracking-wide text-amber-700">Primary</span>}
                        {p.pending && <span className="text-[10px] text-amber-700" title="Has not signed in yet. The task waits for them.">not signed in</span>}
                        <button type="button" onClick={() => removeAssignee(e)} aria-label={`Remove ${p.label}`} className="text-zinc-400 hover:text-red-600 p-0.5 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    )
                  })}
                </div>
              )}
              <PeoplePicker people={people} exclude={assignees} myEmail={myEmail} onPick={addAssignee}
                placeholder={assignees.length ? 'Add another person…' : 'Type a name…'} showMe={!assignees.includes(myEmail)} />
            </Field>
          </div>
        )}

        {/* ---------- step 2: when and how urgent ---------- */}
        {step === 2 && (
          <div className="px-6 py-5 space-y-5">
            <Field label="Due date" required>
              <div className="flex flex-wrap items-center gap-1.5">
                {dateChips.map(c => (
                  <button key={c.label} type="button" onClick={() => setDue(c.value)}
                    className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors cursor-pointer',
                      due === c.value ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100')}>
                    {c.label}
                  </button>
                ))}
                <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Pick a date"
                  className={cn(selectCls, 'w-40', due && !dateChips.some(c => c.value === due) && 'border-zinc-900')} />
              </div>
            </Field>

            <Field label="Priority" required hint={primary && primary !== myEmail ? `${person(primary).label.split(' ')[0]} can accept this or reply with their own priority and date.` : undefined}>
              <PriorityChips value={priority} onChange={setPriority} />
            </Field>

            <div className="rounded-lg border border-zinc-200">
              <button type="button" onClick={() => setWhereOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer">
                {whereOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
                <span className="text-xs text-zinc-500 w-14 shrink-0">Where</span>
                <span className="text-sm text-zinc-800 truncate flex-1">{whereSummary.join(' · ')}</span>
                <span className="text-xs text-blue-600">{whereOpen ? 'Done' : 'Change'}</span>
              </button>
              {whereOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-zinc-100">
                  {showVerticalPicker && (
                    <Mini label="Vertical">
                      <select value={pickedVertical || lyzrVerticalId} onChange={e => setPickedVertical(e.target.value)} className={selectCls} aria-label="Vertical">
                        {verticals.map(v => <option key={v.id} value={v.id}>{v.slug === 'lyzr' ? 'Lyzr (no specific vertical)' : v.name}</option>)}
                      </select>
                    </Mini>
                  )}
                  {!parentTaskId && !!products?.length && (
                    <Mini label="Product">
                      <select value={productId} onChange={e => setProductId(e.target.value)} className={selectCls} aria-label="Product">
                        <option value="">Lyzr (no specific product)</option>
                        {productGroups.map(g => (
                          <optgroup key={g} label={g}>
                            {choosableProducts.filter(p => p.group_name === g).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </Mini>
                  )}
                  {parentTaskId && defaultChannelId && (
                    <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
                      <input type="checkbox" checked={otherChannel} className="accent-orange-500"
                        onChange={e => { setOtherChannel(e.target.checked); if (!e.target.checked) setChannelId(defaultChannelId); else { setChannelId(''); setPickedTop('') } }} />
                      This sub-task belongs to a different channel
                    </label>
                  )}
                  {!lockedChannel ? (
                    <Mini label="Channel">
                      <div className="flex flex-wrap gap-2">
                        <select value={pickedTop} onChange={e => { setPickedTop(e.target.value); setChannelId(e.target.value || '') }} className={selectCls} aria-label="Channel">
                          <option value="">No channel</option>
                          {channels.filter(c => !c.parent_channel_id && c.slug !== 'no-channel').sort((a, b) => a.sort_order - b.sort_order)
                            .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {pickedTop && channels.some(c => c.parent_channel_id === pickedTop) && (
                          <select value={channelId !== pickedTop ? channelId : ''} onChange={e => setChannelId(e.target.value || pickedTop)} className={selectCls} aria-label="Sub-channel">
                            <option value="">Whole channel</option>
                            {channels.filter(c => c.parent_channel_id === pickedTop).sort((a, b) => a.sort_order - b.sort_order).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                      </div>
                    </Mini>
                  ) : (
                    <Mini label="Channel"><span className="text-sm text-zinc-700">{channelName(channelId) || 'This channel'}</span></Mini>
                  )}
                  <p className="text-[11px] text-zinc-500">Leave these as Lyzr and No channel unless the task is for one vertical, product or channel.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- step 3: details (all optional) ---------- */}
        {step === 3 && (
          <div className="px-6 py-5 space-y-5">
            <Field label="Description">
              <Textarea value={description} onChange={e => setDescription(e.target.value)} autoFocus
                className="bg-white border-zinc-300 min-h-[84px] text-sm"
                placeholder="What needs to happen, and what “done” looks like" />
            </Field>

            {canSubNest && (
              <Field label="Sub-tasks" hint="Each one becomes its own task under this one, for the same people and date.">
                <div className="space-y-1.5">
                  {subtasks.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md bg-zinc-50 border border-zinc-200 px-2.5 py-1.5">
                      <span className="text-sm text-zinc-800 flex-1">{item}</span>
                      <button type="button" onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600 cursor-pointer" aria-label="Remove sub-task"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <Input value={subDraft} onChange={e => setSubDraft(e.target.value)} placeholder="Type a sub-task and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (subDraft.trim()) { setSubtasks([...subtasks, subDraft.trim()]); setSubDraft('') } } }}
                    className="bg-white border-zinc-300 h-9 text-sm" />
                </div>
              </Field>
            )}

            <Field label="Contributors" hint="People pitching in. They see the task but are not accountable for it.">
              {helpers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {helpers.map(e => (
                    <span key={e} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 pl-2.5 pr-1 py-1 text-sm text-zinc-800">
                      {e === myEmail ? 'Me' : person(e).label}
                      <button type="button" onClick={() => setHelpers(helpers.filter(x => x !== e))} aria-label="Remove" className="text-zinc-400 hover:text-red-600 p-0.5 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  ))}
                </div>
              )}
              <PeoplePicker people={people} exclude={[...assignees, ...helpers]} myEmail={myEmail} placeholder="Add a contributor…"
                onPick={e => setHelpers(h => h.includes(e) ? h : [...h, e])} showMe={!assignees.includes(myEmail) && !helpers.includes(myEmail)} />
            </Field>

            {(campaigns || []).length > 0 && (
              <Field label="Campaign" hint="Link it to a big push so it shows on that campaign.">
                <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className={cn(selectCls, 'w-full')}>
                  <option value="">None</option>
                  {(campaigns || []).map(c => <option key={c.id} value={c.id}>{c.kind === 'thunderclap' ? '⚡' : c.kind === 'launch' ? '🚀' : '🎯'} {c.name}</option>)}
                </select>
              </Field>
            )}

            <div className="rounded-lg border border-zinc-200">
              <button type="button" onClick={() => setShowMore(m => !m)} className="w-full flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-zinc-700 cursor-pointer">
                {showMore ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                More <span className="font-normal text-zinc-500">checklist, targets, links, budget, repeat</span>
              </button>
              {showMore && (
                <div className="px-3 pb-3 space-y-4 border-t border-zinc-100 pt-3">
                  <Extra title="Checklist" hint="Small steps inside the task that people tick off.">
                    <div className="space-y-1.5">
                      {checklist.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-md bg-zinc-50 border border-zinc-200 px-2.5 py-1.5">
                          <span className="w-3.5 h-3.5 rounded border border-zinc-400 shrink-0" />
                          <span className="text-xs text-zinc-700 flex-1">{item}</span>
                          <button type="button" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600" aria-label="Remove item"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      <Input value={checklistDraft} onChange={e => setChecklistDraft(e.target.value)} placeholder="Type a step and press Enter"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (checklistDraft.trim()) { setChecklist([...checklist, checklistDraft.trim()]); setChecklistDraft('') } } }}
                        className="bg-white border-zinc-300 h-8 text-sm" />
                    </div>
                  </Extra>
                  <Extra title="Targets" hint="What success looks like, as numbers. e.g. Leads: 50.">
                    {targets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {targets.map((t, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px]">
                            <span className="font-semibold text-emerald-900">{t.type}</span><span className="text-emerald-700">{t.value}</span>
                            <button type="button" onClick={() => setTargets(targets.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600" aria-label="Remove target">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Input value={targetType} onChange={e => setTargetType(e.target.value)} placeholder="Measure" className="bg-white border-zinc-300 h-8 text-sm w-36" />
                      <Input value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="Goal"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTargetRow() } }} className="bg-white border-zinc-300 h-8 text-sm flex-1" />
                      <Button type="button" variant="outline" size="sm" disabled={!targetType.trim() || !targetValue.trim()} onClick={addTargetRow} className="h-8 border-zinc-300"><Plus className="w-3.5 h-3.5" /></Button>
                    </div>
                  </Extra>
                  <Extra title="Links" hint="Briefs, docs, landing pages.">
                    {links.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {links.map((l, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px]">
                            <span className="text-blue-700 font-medium">{l.label}</span>
                            <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600" aria-label="Remove link">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Name (optional)" className="bg-white border-zinc-300 h-8 text-sm w-36" />
                      <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLinkRow() } }} className="bg-white border-zinc-300 h-8 text-sm flex-1" />
                      <Button type="button" variant="outline" size="sm" disabled={!linkUrl.trim()} onClick={addLinkRow} className="h-8 border-zinc-300"><Plus className="w-3.5 h-3.5" /></Button>
                    </div>
                  </Extra>
                  <div className="grid grid-cols-2 gap-4">
                    <Extra title="Budget ($)" hint="Money this task plans to spend.">
                      <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. 500" className="bg-white border-zinc-300 h-8 text-sm" />
                    </Extra>
                    <Extra title="How often" hint="e.g. Weekly, Monthly, Ongoing.">
                      <Input value={frequency} onChange={e => setFrequency(e.target.value)} placeholder="e.g. Monthly" className="bg-white border-zinc-300 h-8 text-sm" />
                    </Extra>
                  </div>
                  <Extra title="Repeat" hint="Create this task again automatically on a schedule.">
                    <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer select-none">
                      <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="accent-orange-500 w-4 h-4" />
                      Repeat this task
                    </label>
                    {isRecurring && (
                      <div className="pt-2">
                        <RecurrencePicker value={recurrence} onChange={setRecurrence} anchorWeekday={due ? new Date(due).getDay() : undefined} />
                      </div>
                    )}
                  </Extra>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- footer ---------- */}
        {step > 0 && (
          <div className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
            {(step > 1 || hasWhoStep) ? (
              <Button type="button" variant="ghost" onClick={() => setStep((step - 1) as 0 | 1 | 2)} className="text-zinc-600"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-600">Cancel</Button>
            )}
            <span className="flex-1" />
            {step === 1 && (
              <Button type="button" disabled={!step1Ok} onClick={() => setStep(2)} className="bg-zinc-900 hover:bg-zinc-800 text-white border-0">
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {step === 2 && (
              <>
                <Button type="button" variant="outline" disabled={!step2Ok || isPending} onClick={() => setStep(3)} className="border-zinc-300 text-zinc-700">Add details</Button>
                <Button type="button" disabled={!step2Ok || isPending} onClick={submit} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                  {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{parentTaskId ? 'Create sub-task' : 'Create task'}
                </Button>
              </>
            )}
            {step === 3 && (
              <Button type="button" disabled={isPending} onClick={submit} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{parentTaskId ? 'Create sub-task' : 'Create task'}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Type a name, pick from the list. A full email that nobody has yet is fine:
// the task waits for that person's first sign-in.
function PeoplePicker({ people, exclude, myEmail, onPick, placeholder, showMe }: {
  people: PersonOption[]; exclude: string[]; myEmail: string; onPick: (email: string) => void; placeholder: string; showMe?: boolean
}) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(0)
  const q = text.trim().toLowerCase()
  const matches = useMemo(() => people
    .filter(p => !exclude.includes(p.email))
    .filter(p => !q || p.label.toLowerCase().includes(q) || p.email.includes(q))
    .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
    .slice(0, 7), [people, exclude, q])
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)
  const pick = (email: string) => { onPick(email); setText(''); setHi(0) }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {showMe && myEmail && (
          <button type="button" onClick={() => pick(myEmail)}
            className="h-10 shrink-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:border-zinc-900 hover:bg-zinc-50 cursor-pointer">
            Me
          </button>
        )}
        <input value={text} onChange={e => { setText(e.target.value); setHi(0) }} placeholder={placeholder}
          onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') {
              if (!q) return
              e.preventDefault()
              if (matches[hi]) pick(matches[hi].email)
              else if (isEmail) pick(q)
            }
          }}
          className="h-10 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900" />
      </div>
      {focused && (matches.length > 0 || isEmail) && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-zinc-200 bg-white shadow-lg max-h-52 overflow-y-auto py-1">
          {matches.map((p, i) => (
            <button key={p.email} type="button" onMouseDown={e => { e.preventDefault(); pick(p.email) }} onMouseEnter={() => setHi(i)}
              className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer', i === hi ? 'bg-zinc-100' : '')}>
              <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-700 grid place-items-center text-[11px] font-semibold shrink-0">{p.label.charAt(0).toUpperCase()}</span>
              <span className="text-zinc-900 truncate">{p.email === myEmail ? `${p.label} (me)` : p.label}</span>
              <span className="text-xs text-zinc-400 truncate ml-auto">{p.pending ? 'not signed in yet' : p.email}</span>
            </button>
          ))}
          {!matches.length && isEmail && (
            <button type="button" onMouseDown={e => { e.preventDefault(); pick(q) }} className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 cursor-pointer">
              Assign to <span className="font-medium">{q}</span> <span className="text-xs text-zinc-400">they will see it on first sign-in</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-900 mb-1.5">{label}{required && <span className="text-orange-500 ml-0.5">*</span>}</p>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-1.5">{hint}</p>}
    </div>
  )
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-xs text-zinc-500">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Extra({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-900">{title}</p>
      <p className="text-[11px] text-zinc-500 mb-1.5">{hint}</p>
      {children}
    </div>
  )
}
