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
import { useCategories, useChannels, useUsers, useKnownEmails, buildChannelTree } from '@/lib/hooks/use-data'
import { createTask, assignTaskByEmail, addChecklistItem } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TaskPriority, AssignmentRole } from '@/lib/types/database'
import { Plus, Trash2, Loader2 } from 'lucide-react'

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
  defaultTitle?: string
  defaultDescription?: string
  parentTaskId?: string
  nestingLevel?: number
  onSuccess?: () => void
}

export function CreateTaskDialog({
  open, onOpenChange, defaultChannelId, defaultCategoryId, defaultTitle, defaultDescription, parentTaskId, nestingLevel = 0, onSuccess
}: CreateTaskDialogProps) {
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const priorityLabels = {
    P0: 'P0 (Critical)',
    P1: 'P1 (High)',
    P2: 'P2 (Medium)',
    P3: 'P3 (Low)',
    P4: 'P4 (Backlog)'
  }

  const recurrenceLabels = {
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
    custom: 'Custom (Days)'
  }

  const roleLabels = {
    primary: 'Primary',
    secondary: 'Secondary',
    tertiary: 'Tertiary',
    other: 'Other'
  }

  const { data: categories } = useCategories()
  const { data: channels } = useChannels()
  const { data: users } = useUsers()
  
  // Recurrence states
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'>('weekly')
  const [customInterval, setCustomInterval] = useState(7)
  const [recurrenceEndsOn, setRecurrenceEndsOn] = useState('')

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
        priority: 'P2',
        channel_id: defaultChannelId || '',
      })
    }
  }, [open, defaultTitle, defaultDescription, defaultChannelId, reset])

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
          planning_fields: {
            ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
            ...(targets.length ? { targets, kpi_target: `${targets[0].type}: ${targets[0].value}` } : {}),
            ...(links.length ? { links } : {}),
          },
          assignments: validAssignments,
          recurrence: isRecurring ? {
            pattern: recurrencePattern,
            custom_interval_days: recurrencePattern === 'custom' ? customInterval : undefined,
            ends_on: recurrenceEndsOn || undefined,
          } : undefined,
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
        setRecurrencePattern('weekly')
        setCustomInterval(7)
        setRecurrenceEndsOn('')
        onOpenChange(false)
        if (onSuccess) onSuccess()
      } catch (err: any) {
        console.error('createTask failed:', err)
        toast.error(err?.message || 'Failed to create task')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-zinc-300 text-zinc-900 sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            {parentTaskId ? 'Create Subtask' : 'Create Task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          {/* Title */}
          <div>
            <Label className="text-zinc-600 text-xs">Title *</Label>
            <Input
              {...register('title')}
              className="mt-1 bg-zinc-100 border-zinc-300 text-zinc-900"
              placeholder="Task title"
            />
            {errors.title && <p className="text-red-600 text-xs mt-1">{errors.title.message}</p>}
          </div>

          {/* Description */}
          <div>
            <Label className="text-zinc-600 text-xs">Description</Label>
            <Textarea
              {...register('description')}
              className="mt-1 bg-zinc-100 border-zinc-300 text-zinc-900 min-h-[80px]"
              placeholder="What needs to be done..."
            />
          </div>

          {/* Priority + Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-600 text-xs">Priority</Label>
              <Select
                value={watch('priority')}
                onValueChange={(val) => setValue('priority', (val || 'P2') as any)}
              >
                <SelectTrigger className="mt-1 w-full bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 flex justify-between items-center rounded-lg">
                  <span>{priorityLabels[watch('priority')]}</span>
                </SelectTrigger>
                <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                  <SelectItem value="P0" className="text-sm py-2 px-3 hover:bg-zinc-100">P0 (Critical)</SelectItem>
                  <SelectItem value="P1" className="text-sm py-2 px-3 hover:bg-zinc-100">P1 (High)</SelectItem>
                  <SelectItem value="P2" className="text-sm py-2 px-3 hover:bg-zinc-100">P2 (Medium)</SelectItem>
                  <SelectItem value="P3" className="text-sm py-2 px-3 hover:bg-zinc-100">P3 (Low)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-zinc-600 text-xs">Due Date</Label>
              <Input
                type="date"
                {...register('due_date')}
                className="mt-1 bg-zinc-100 border-zinc-300 text-zinc-900"
              />
            </div>
          </div>

          {/* Channel → Sub-channel (2 clicks) */}
          {!defaultChannelId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-600 text-xs">1 · Channel *</Label>
                <select
                  value={pickedTop}
                  onChange={e => { setPickedTop(e.target.value); setValue('channel_id', e.target.value || '') }}
                  className="mt-1 w-full text-sm rounded-lg border border-zinc-300 bg-zinc-100 px-3 h-9 text-zinc-900"
                >
                  <option value="">Select channel…</option>
                  {(channels || []).filter(c => !c.parent_channel_id).sort((a, b) => a.sort_order - b.sort_order).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-zinc-600 text-xs">2 · Sub-channel</Label>
                <select
                  value={channelId !== pickedTop ? channelId : ''}
                  disabled={!pickedTop}
                  onChange={e => setValue('channel_id', e.target.value || pickedTop)}
                  className="mt-1 w-full text-sm rounded-lg border border-zinc-300 bg-zinc-100 px-3 h-9 text-zinc-900 disabled:opacity-50"
                >
                  <option value="">{pickedTop ? 'Entire channel (or pick below)' : 'Pick a channel first'}</option>
                  {(channels || []).filter(c => c.parent_channel_id === pickedTop).sort((a, b) => a.sort_order - b.sort_order).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {errors.channel_id && <p className="text-red-600 text-xs mt-1">{errors.channel_id.message}</p>}
              </div>
            </div>
          )}

          {/* Recurrence Pattern Configuration */}
          <div className="border border-zinc-200 bg-zinc-100/50 rounded-lg p-3 space-y-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_recurring"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="rounded border-zinc-300 bg-zinc-100 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              />
              <Label htmlFor="is_recurring" className="text-zinc-600 text-xs cursor-pointer select-none font-medium">
                Is Recurring Task
              </Label>
            </div>

            {isRecurring && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <Label className="text-zinc-600 text-[10px]">Recurrence Pattern</Label>
                  <Select
                    value={recurrencePattern}
                    onValueChange={(val) => setRecurrencePattern((val || 'weekly') as any)}
                  >
                    <SelectTrigger className="mt-1 w-full bg-zinc-100 border-zinc-300 text-zinc-900 h-8 text-xs px-3 flex justify-between items-center rounded-lg">
                      <span>{recurrenceLabels[recurrencePattern]}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                      <SelectItem value="daily" className="text-xs py-1.5 px-2.5 hover:bg-zinc-100">Daily</SelectItem>
                      <SelectItem value="weekly" className="text-xs py-1.5 px-2.5 hover:bg-zinc-100">Weekly</SelectItem>
                      <SelectItem value="biweekly" className="text-xs py-1.5 px-2.5 hover:bg-zinc-100">Bi-weekly</SelectItem>
                      <SelectItem value="monthly" className="text-xs py-1.5 px-2.5 hover:bg-zinc-100">Monthly</SelectItem>
                      <SelectItem value="custom" className="text-xs py-1.5 px-2.5 hover:bg-zinc-100">Custom (Days)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {recurrencePattern === 'custom' ? (
                  <div>
                    <Label className="text-zinc-600 text-[10px]">Every X Days</Label>
                    <Input
                      type="number"
                      value={customInterval}
                      onChange={e => setCustomInterval(Number(e.target.value) || 1)}
                      className="mt-1 bg-zinc-100 border-zinc-300 h-8 text-xs text-zinc-900"
                      min="1"
                    />
                  </div>
                ) : (
                  <div>
                    <Label className="text-zinc-600 text-[10px]">End Date (Optional)</Label>
                    <Input
                      type="date"
                      value={recurrenceEndsOn}
                      onChange={e => setRecurrenceEndsOn(e.target.value)}
                      className="mt-1 bg-zinc-100 border-zinc-300 h-8 text-xs text-zinc-900"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Owners */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-zinc-600 text-xs">Owners *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addAssignment}
                className="text-xs text-blue-600 hover:text-blue-700 h-auto p-1"
              >
                <Plus className="w-3 h-3 mr-1" /> Add Owner
              </Button>
            </div>
            <div className="space-y-2">
              {ownerRows.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      value={a.email}
                      onChange={e => updateAssignment(i, 'email', e.target.value)}
                      placeholder="Type a name or email…"
                      list="create-task-owner-options"
                      className="w-full bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm"
                    />
                    {a.email && optionByEmail(a.email.trim().toLowerCase())?.pending && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 pointer-events-none">
                        joins on first sign-in
                      </span>
                    )}
                  </div>
                  <Select
                    value={a.role}
                    onValueChange={(val) => updateAssignment(i, 'role', (val || 'other') as any)}
                  >
                    <SelectTrigger className="w-32 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 flex justify-between items-center rounded-lg">
                      <span>{roleLabels[a.role]}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                      <SelectItem value="primary" className="text-sm py-2 px-3 hover:bg-zinc-100">Primary</SelectItem>
                      <SelectItem value="secondary" className="text-sm py-2 px-3 hover:bg-zinc-100">Secondary</SelectItem>
                      <SelectItem value="tertiary" className="text-sm py-2 px-3 hover:bg-zinc-100">Tertiary</SelectItem>
                      <SelectItem value="other" className="text-sm py-2 px-3 hover:bg-zinc-100">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAssignment(i)}
                    className="text-zinc-500 hover:text-red-600 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <datalist id="create-task-owner-options">
                {ownerOptions.map(o => (
                  <option key={o.email} value={o.email}>{`${o.label}${o.pending ? ' · not signed in yet' : ''}`}</option>
                ))}
              </datalist>
              {ownerRows.length === 0 && (
                <p className="text-xs text-zinc-600 py-2">Click "Add Owner", then type a name or email</p>
              )}
            </div>

          </div>

          {/* Checklist */}
          <div>
            <Label className="text-zinc-600 text-xs">Checklist (optional)</Label>
            <div className="mt-2 space-y-1.5">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-100 border border-zinc-200 px-3 py-1.5 group">
                  <span className="w-3.5 h-3.5 rounded border border-zinc-400 shrink-0" />
                  <span className="text-xs text-zinc-700 flex-1">{item}</span>
                  <button
                    type="button"
                    onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}
                    className="text-zinc-400 hover:text-red-600"
                    title="Remove item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={checklistDraft}
                  onChange={e => setChecklistDraft(e.target.value)}
                  placeholder="Add a checklist item and press Enter…"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (checklistDraft.trim()) {
                        setChecklist([...checklist, checklistDraft.trim()])
                        setChecklistDraft('')
                      }
                    }
                  }}
                  className="flex-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!checklistDraft.trim()}
                  onClick={() => { setChecklist([...checklist, checklistDraft.trim()]); setChecklistDraft('') }}
                  className="text-xs text-blue-600 hover:text-blue-700 h-9"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>

          {/* Frequency + Budget */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-600 text-xs">Frequency</Label>
              <Input
                value={frequency}
                onChange={e => setFrequency(e.target.value)}
                placeholder="e.g. Monthly 1x, Ongoing"
                className="mt-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm"
              />
            </div>
            <div>
              <Label className="text-zinc-600 text-xs">Budget ($)</Label>
              <Input
                type="number"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                placeholder="e.g. 500"
                className="mt-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm"
              />
            </div>
          </div>

          {/* Targets */}
          <div>
            <Label className="text-zinc-600 text-xs">Targets</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {targets.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-300 px-2 py-1 text-[11px]">
                  <span className="font-semibold text-emerald-900">{t.type}</span>
                  <span className="text-emerald-700">{t.value}</span>
                  <button type="button" onClick={() => setTargets(targets.filter((_, j) => j !== i))}
                    className="text-zinc-400 hover:text-red-600" title="Remove">×</button>
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Input value={targetType} onChange={e => setTargetType(e.target.value)} placeholder="Type (e.g. Impressions)"
                className="bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm w-44" />
              <Input value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="Value (e.g. 10,000/mo)"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTargetRow() } }}
                className="bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm flex-1" />
              <Button type="button" variant="ghost" size="sm" disabled={!targetType.trim() || !targetValue.trim()}
                onClick={addTargetRow} className="text-xs text-emerald-700 hover:text-emerald-800 h-9">
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
          </div>

          {/* Links */}
          <div>
            <Label className="text-zinc-600 text-xs">Links</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {links.map((l, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px]">
                  <span className="text-blue-700 font-medium">{l.label}</span>
                  <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))}
                    className="text-zinc-400 hover:text-red-600" title="Remove">×</button>
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Name (optional)"
                className="bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm w-44" />
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLinkRow() } }}
                className="bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm flex-1" />
              <Button type="button" variant="ghost" size="sm" disabled={!linkUrl.trim()}
                onClick={addLinkRow} className="text-xs text-blue-600 hover:text-blue-700 h-9">
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-zinc-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 text-white border-0"
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {parentTaskId ? 'Create Subtask' : 'Create Task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
