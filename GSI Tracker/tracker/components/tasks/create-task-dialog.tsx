'use client'

import { useState, useTransition, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useCategories, useChannels, useUsers, useKnownEmails, useCampaigns, useCurrentUser, buildChannelTree } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { createTask, assignTaskByEmail, addChecklistItem } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PRIORITY_COLORS, type TaskPriority, type AssignmentRole } from '@/lib/types/database'
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { RecurrencePicker, DEFAULT_RECURRENCE, type RecurrenceValue } from './recurrence-picker'

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
  due_date: z.string().optional(),
  channel_id: z.string().min(1, 'Channel is required'),
})

type FormData = z.infer<typeof schema>

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
  parentTaskId?: string
  nestingLevel?: number
  onSuccess?: () => void
}

export function CreateTaskDialog({
  open, onOpenChange, defaultChannelId, defaultCategoryId, defaultVerticalId, defaultTitle, defaultDescription, defaultCampaignId, defaultDueDate, defaultPriority, defaultOwnerEmails, parentTaskId, nestingLevel = 0, onSuccess
}: CreateTaskDialogProps) {
  const queryClient = useQueryClient()
  // Vertical: the current space by default; in workspace mode the user picks one.
  const { verticalId: currentVerticalId, verticals } = useVertical()
  const { data: allChannelsForDefault } = useChannels('all')
  const [pickedVertical, setPickedVertical] = useState<string>(
    defaultVerticalId || (currentVerticalId !== 'all' ? currentVerticalId : '')
  )
  const showVerticalPicker = !defaultChannelId && currentVerticalId === 'all' && !defaultVerticalId
  const [isPending, startTransition] = useTransition()
  const [campaignId, setCampaignId] = useState<string>(defaultCampaignId || '')
  // Sub-tasks default to the parent's channel but may live on another one
  // (design work for a webinar belongs to the Design board).
  const [otherChannel, setOtherChannel] = useState(false)
  const lockedChannel = !!defaultChannelId && !(parentTaskId && otherChannel)
  const { data: campaigns } = useCampaigns(pickedVertical || 'all')

  const priorityLabels = {
    P0: 'P0 (Critical)',
    P1: 'P1 (High)',
    P2: 'P2 (Medium)',
    P3: 'P3 (Low)',
    P4: 'P4 (Backlog)'
  }

  const roleLabels = {
    primary: 'Primary',
    secondary: 'Secondary',
    tertiary: 'Tertiary',
    other: 'Other'
  }

  const effectiveVertical = pickedVertical || (defaultChannelId ? allChannelsForDefault?.find(c => c.id === defaultChannelId)?.vertical_id : undefined) || 'all'
  const { data: categories } = useCategories(effectiveVertical)
  const { data: channels } = useChannels(effectiveVertical)
  const { data: users } = useUsers()
  
  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(DEFAULT_RECURRENCE)

  // One unified owner list: signed-in users AND known-but-not-signed-in
  // teammates. Rows are keyed by email; picking a pending person queues the
  // assignment for their first login.
  const [ownerRows, setOwnerRows] = useState<{ email: string; role: AssignmentRole }[]>([])
  // Checklist items to create along with the task
  const [checklist, setChecklist] = useState<string[]>([])
  const [checklistDraft, setChecklistDraft] = useState('')
  // Targets (Type + Value pairs)
  const [targets, setTargets] = useState<{ type: string; value: string }[]>([])
  const [targetType, setTargetType] = useState('')
  const [targetValue, setTargetValue] = useState('')
  // Links (multiple URLs)
  const [links, setLinks] = useState<{ label: string; url: string }[]>([])
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  // Frequency + budget
  const [frequency, setFrequency] = useState('')
  const [showMore, setShowMore] = useState(false)
  const { data: me } = useCurrentUser()
  const [budget, setBudget] = useState('')

  const addTargetRow = () => {
    if (!targetType.trim() || !targetValue.trim()) return
    setTargets([...targets, { type: targetType.trim(), value: targetValue.trim() }])
    setTargetType(''); setTargetValue('')
  }
  const addLinkRow = () => {
    if (!linkUrl.trim()) return
    const clean = linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`
    let name = linkLabel.trim()
    if (!name) { try { name = new URL(clean).hostname.replace('www.', '') } catch { name = clean } }
    setLinks([...links, { label: name, url: clean }])
    setLinkLabel(''); setLinkUrl('')
  }
  const { data: knownEmails } = useKnownEmails()
  const [selectedCategory, setSelectedCategory] = useState<string>(defaultCategoryId || '')
  const [pickedTop, setPickedTop] = useState<string>('')

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: defaultTitle || '',
      description: defaultDescription || '',
      priority: 'P2',
      channel_id: defaultChannelId || '',
    },
  })

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        title: defaultTitle || '',
        description: defaultDescription || '',
        priority: defaultPriority || 'P2',
        due_date: defaultDueDate || '',
        channel_id: defaultChannelId || '',
      })
      if (defaultOwnerEmails?.length) setOwnerRows(defaultOwnerEmails.map((email, i) => ({ email, role: i === 0 ? 'primary' : 'secondary' })))
      // Asana-style default: the person creating the task owns it until changed.
      else if (me?.email) setOwnerRows(rows => rows.length ? rows : [{ email: me.email.toLowerCase(), role: 'primary' }])
    }
  }, [open, defaultTitle, defaultDescription, defaultChannelId, defaultDueDate, defaultPriority, defaultOwnerEmails, reset, me?.email])

  const channelId = watch('channel_id')


  const filteredChannels = channels?.filter(ch => {
    if (!selectedCategory) return true
    return ch.category_id === selectedCategory
  }) || []

  // Flatten channel tree for select
  const flattenChannels = (channels: typeof filteredChannels, prefix = '') => {
    const result: { id: string; label: string }[] = []
    const tree = buildChannelTree(channels)
    const flatten = (items: typeof tree, pre: string) => {
      items.forEach(ch => {
        result.push({ id: ch.id, label: pre + ch.name })
        if (ch.children?.length) flatten(ch.children, pre + '  ')
      })
    }
    flatten(tree, prefix)
    return result
  }

  const ownerOptions = useMemo(() => {
    const map = new Map<string, { email: string; userId?: string; label: string; pending: boolean }>()
    users?.filter(u => u.email !== 'preview@lyzr.ai').forEach(u =>
      map.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), userId: u.id, label: u.display_name || u.email, pending: false }))
    knownEmails?.forEach(e => {
      if (!map.has(e)) map.set(e, { email: e, label: e.split('@')[0].split('.')[0].replace(/^./, (c: string) => c.toUpperCase()), pending: true })
    })
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [users, knownEmails])
  const optionByEmail = (email: string) => ownerOptions.find(o => o.email === email)

  const addAssignment = () => {
    setOwnerRows([...ownerRows, { email: '', role: ownerRows.length === 0 ? 'primary' : 'secondary' }])
  }

  const removeAssignment = (index: number) => {
    setOwnerRows(ownerRows.filter((_, i) => i !== index))
  }

  const updateAssignment = (index: number, field: 'email' | 'role', value: string) => {
    const updated = [...ownerRows]
    updated[index] = { ...updated[index], [field]: value }
    setOwnerRows(updated)
  }


  const onSubmit = (data: FormData) => {
    // Typed text can be an email or a name — resolve names to known emails.
    const resolveRow = (raw: string) => {
      const text = raw.trim().toLowerCase()
      if (optionByEmail(text)) return text
      const byName = ownerOptions.filter(o => o.label.toLowerCase() === text || o.label.toLowerCase().startsWith(text))
      return byName.length === 1 ? byName[0].email : text
    }
    const pickedRows = ownerRows.filter(r => r.email.trim()).map(r => ({ ...r, email: resolveRow(r.email) }))
    const invalid = pickedRows.filter(r => !optionByEmail(r.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
    if (invalid.length) {
      toast.error(`Unrecognized owner: "${invalid[0].email}" — pick a suggestion or type a full email`)
      return
    }
    const validAssignments = pickedRows
      .filter(r => optionByEmail(r.email)?.userId)
      .map(r => ({ user_id: optionByEmail(r.email)!.userId!, role: r.role }))
    const validEmails = pickedRows
      .filter(r => !optionByEmail(r.email)?.userId)
      .map(r => ({ email: r.email, role: r.role }))

    if (validAssignments.length === 0 && validEmails.length === 0) {
      toast.error('At least one owner is required')
      return
    }
    const hasPrimary =
      validAssignments.some(a => a.role === 'primary') ||
      validEmails.some(a => a.role === 'primary')
    if (!hasPrimary) {
      toast.error('Exactly one primary owner is required')
      return
    }

    startTransition(async () => {
      try {
        const task = await createTask({
          ...data,
          parent_task_id: parentTaskId,
          nesting_level: nestingLevel,
          budget_allocated: budget.trim() === '' ? null : Number(budget),
          campaign_id: campaignId || null,
          planning_fields: {
            ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
            ...(targets.length ? { targets, kpi_target: `${targets[0].type}: ${targets[0].value}` } : {}),
            ...(links.length ? { links } : {}),
          },
          assignments: validAssignments,
          recurrence: isRecurring ? { rule: recurrence.rule, end: recurrence.end } : undefined,
        })

        // Create checklist items added in the dialog
        for (const body of checklist) {
          try {
            await addChecklistItem((task as any).id, body)
          } catch (err) {
            console.error('checklist item failed:', body, err)
          }
        }

        // Queue pending assignments for not-yet-signed-up emails.
        // Resolves automatically on first Google SSO sign-in via handle_new_user trigger.
        for (const a of validEmails) {
          try {
            await assignTaskByEmail({ taskId: (task as any).id, email: a.email, role: a.role })
          } catch (err: any) {
            console.error('assignTaskByEmail failed for', a.email, err)
            toast.error(`Pending-assign failed for ${a.email}: ${err?.message || 'unknown'}`)
          }
        }
        toast.success(
          validEmails.length > 0
            ? `Task created. ${validEmails.length} pending invite(s) will resolve on first sign-in.`
            : 'Task created'
        )
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task'] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        queryClient.invalidateQueries({ queryKey: ['pendingInvites'] })
        reset()
        setOwnerRows([])
        setChecklist([])
        setChecklistDraft('')
        setTargets([]); setTargetType(''); setTargetValue('')
        setLinks([]); setLinkLabel(''); setLinkUrl('')
        setFrequency(''); setBudget('')
        setIsRecurring(false)
        setRecurrence(DEFAULT_RECURRENCE)
        onOpenChange(false)
        if (onSuccess) onSuccess()
      } catch (err: any) {
        console.error('createTask failed:', err)
        toast.error(err?.message || 'Failed to create task')
      }
    })
  }

  const priority = watch('priority')
  const extrasCount = checklist.length + targets.length + links.length + (frequency ? 1 : 0) + (budget ? 1 : 0) + (isRecurring ? 1 : 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-zinc-200 text-zinc-900 sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-1">
          <DialogTitle className="brand-label text-zinc-500 font-normal">
            {parentTaskId ? 'New sub-task' : 'New task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="px-6 pb-2">
            <input
              {...register('title')}
              autoFocus
              placeholder="Write a task name"
              className="w-full border-0 bg-transparent px-0 py-1 text-xl font-semibold text-zinc-900 placeholder:text-zinc-400 outline-none"
            />
            {errors.title && <p className="text-red-600 text-xs">{errors.title.message}</p>}
          </div>

          {/* Property rows */}
          <div className="px-6 py-2 space-y-1">
            {(showVerticalPicker || !lockedChannel) && (
              <Row label="Where" hint="Which vertical and channel this task belongs to">
                <div className="flex flex-wrap gap-2 w-full">
                  {showVerticalPicker && (
                    <select value={pickedVertical}
                      onChange={e => { setPickedVertical(e.target.value); setPickedTop(''); setValue('channel_id', '') }}
                      className={selectCls}>
                      <option value="">Vertical…</option>
                      {verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  )}
                  {!lockedChannel && (
                    <>
                      <select value={pickedTop} disabled={showVerticalPicker && !pickedVertical}
                        onChange={e => { setPickedTop(e.target.value); setValue('channel_id', e.target.value || '') }}
                        className={selectCls}>
                        <option value="">{showVerticalPicker && !pickedVertical ? 'Pick a vertical first' : 'Channel…'}</option>
                        {(channels || []).filter(c => !c.parent_channel_id).sort((a, b) => a.sort_order - b.sort_order).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {pickedTop && (channels || []).some(c => c.parent_channel_id === pickedTop) && (
                        <select value={channelId !== pickedTop ? channelId : ''}
                          onChange={e => setValue('channel_id', e.target.value || pickedTop)}
                          className={selectCls}>
                          <option value="">Whole channel</option>
                          {(channels || []).filter(c => c.parent_channel_id === pickedTop).sort((a, b) => a.sort_order - b.sort_order).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>
                {errors.channel_id && <p className="text-red-600 text-xs mt-1 w-full">Pick a channel — every task lives in one.</p>}
              </Row>
            )}

            {parentTaskId && defaultChannelId && (
              <Row label="" hint="">
                <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
                  <input type="checkbox" checked={otherChannel} onChange={e => { setOtherChannel(e.target.checked); if (!e.target.checked) setValue('channel_id', defaultChannelId); else { setValue('channel_id', ''); setPickedTop('') } }} className="accent-orange-500" />
                  This sub-task belongs to a different channel
                </label>
              </Row>
            )}

            <Row label="Owner" hint="Who is doing it. The first person is the main owner; add helpers below them.">
              <div className="w-full space-y-1.5">
                {ownerRows.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <Input value={a.email} onChange={e => updateAssignment(i, 'email', e.target.value)}
                        placeholder="Type a name or email…" list="create-task-owner-options"
                        className="w-full bg-white border-zinc-300 h-8 px-2.5 text-sm" />
                      {a.email && optionByEmail(a.email.trim().toLowerCase())?.pending && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 pointer-events-none">joins on first sign-in</span>
                      )}
                    </div>
                    {i === 0 && ownerRows.length === 1 ? (
                      <span className="text-[11px] text-zinc-500 w-24">Main owner</span>
                    ) : (
                      <Select value={a.role} onValueChange={(val) => updateAssignment(i, 'role', (val || 'other') as any)}>
                        <SelectTrigger className="w-24 bg-white border-zinc-300 h-8 px-2 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-white border border-zinc-300">
                          <SelectItem value="primary">Main owner</SelectItem>
                          <SelectItem value="secondary">Helper</SelectItem>
                          <SelectItem value="tertiary">Reviewer</SelectItem>
                          <SelectItem value="other">FYI</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <button type="button" onClick={() => removeAssignment(i)} aria-label="Remove owner" className="text-zinc-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={addAssignment} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> {ownerRows.length ? 'Add another person' : 'Add an owner'}
                </button>
                <datalist id="create-task-owner-options">
                  {ownerOptions.map(o => <option key={o.email} value={o.email}>{`${o.label}${o.pending ? ' · not signed in yet' : ''}`}</option>)}
                </datalist>
              </div>
            </Row>

            <Row label="Due date" hint="When it should be done">
              <Input type="date" {...register('due_date')} className="w-44 bg-white border-zinc-300 h-8 text-sm" />
            </Row>

            <Row label="Priority" hint="How urgent it is">
              <div className="flex flex-wrap gap-1.5">
                {(['P0', 'P1', 'P2', 'P3'] as const).map(p => (
                  <button key={p} type="button" onClick={() => setValue('priority', p)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${priority === p ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}>
                    <span className="w-2 h-2 rounded-full ring-1 ring-white/70" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                    {priorityLabels[p].replace(/^P\d \((.*)\)$/, '$1')}
                  </button>
                ))}
              </div>
            </Row>

            {(campaigns || []).length > 0 && (
              <Row label="Campaign" hint="Optional — link it to a big push so it shows on that campaign">
                <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className={selectCls}>
                  <option value="">None</option>
                  {(campaigns || []).map(c => <option key={c.id} value={c.id}>{c.kind === 'thunderclap' ? '⚡' : c.kind === 'launch' ? '🚀' : '🎯'} {c.name}</option>)}
                </select>
              </Row>
            )}
          </div>

          <div className="px-6 pt-2 pb-4">
            <Textarea {...register('description')}
              className="bg-white border-zinc-300 min-h-[84px] text-sm"
              placeholder="Add a description — what needs to happen, and what “done” looks like" />
          </div>

          {/* Optional extras */}
          <div className="border-t border-zinc-200">
            <button type="button" onClick={() => setShowMore(m => !m)}
              className="w-full flex items-center gap-1.5 px-6 py-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
              {showMore ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              More details {extrasCount > 0 && <span className="rounded-full bg-zinc-200 px-1.5 text-[10px]">{extrasCount}</span>}
              <span className="font-normal text-zinc-500">— checklist, targets, links, budget, repeat</span>
            </button>
            {showMore && (
              <div className="px-6 pb-4 space-y-5">
                <Extra title="Checklist" hint="Small steps inside the task that people tick off.">
                  <div className="space-y-1.5">
                    {checklist.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md bg-zinc-50 border border-zinc-200 px-2.5 py-1.5">
                        <span className="w-3.5 h-3.5 rounded border border-zinc-400 shrink-0" />
                        <span className="text-xs text-zinc-700 flex-1">{item}</span>
                        <button type="button" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600" aria-label="Remove item"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <Input value={checklistDraft} onChange={e => setChecklistDraft(e.target.value)}
                      placeholder="Type a step and press Enter"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (checklistDraft.trim()) { setChecklist([...checklist, checklistDraft.trim()]); setChecklistDraft('') } } }}
                      className="bg-white border-zinc-300 h-8 text-sm" />
                  </div>
                </Extra>

                <Extra title="Targets" hint="What success looks like, as numbers — e.g. Impressions: 10,000/mo.">
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
                    <Input value={targetType} onChange={e => setTargetType(e.target.value)} placeholder="Measure (e.g. Leads)" className="bg-white border-zinc-300 h-8 text-sm w-40" />
                    <Input value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="Goal (e.g. 50)"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTargetRow() } }} className="bg-white border-zinc-300 h-8 text-sm flex-1" />
                    <Button type="button" variant="outline" size="sm" disabled={!targetType.trim() || !targetValue.trim()} onClick={addTargetRow} className="h-8 border-zinc-300"><Plus className="w-3.5 h-3.5" /></Button>
                  </div>
                </Extra>

                <Extra title="Links" hint="Briefs, docs, landing pages — anything people need to open.">
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
                    <Input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Name (optional)" className="bg-white border-zinc-300 h-8 text-sm w-40" />
                    <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLinkRow() } }} className="bg-white border-zinc-300 h-8 text-sm flex-1" />
                    <Button type="button" variant="outline" size="sm" disabled={!linkUrl.trim()} onClick={addLinkRow} className="h-8 border-zinc-300"><Plus className="w-3.5 h-3.5" /></Button>
                  </div>
                </Extra>

                <div className="grid grid-cols-2 gap-4">
                  <Extra title="Budget ($)" hint="Money this task plans to spend.">
                    <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. 500" className="bg-white border-zinc-300 h-8 text-sm" />
                  </Extra>
                  <Extra title="How often" hint="Free text, e.g. “Monthly” or “Ongoing”.">
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
                      <RecurrencePicker value={recurrence} onChange={setRecurrence}
                        anchorWeekday={watch('due_date') ? new Date(watch('due_date')!).getDay() : undefined} />
                    </div>
                  )}
                </Extra>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-600">Cancel</Button>
            <Button type="submit" disabled={isPending} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {parentTaskId ? 'Create sub-task' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const selectCls = 'h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 disabled:opacity-50'

// One Asana-style property row: label on the left, control on the right.
function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-24 shrink-0 pt-1.5 text-xs text-zinc-500" title={hint}>{label}</span>
      <div className="flex-1 min-w-0 flex flex-wrap items-center">{children}</div>
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
