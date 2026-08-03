'use client'

import { useState, useTransition, useEffect } from 'react'
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
import { useCategories, useChannels, useUsers, buildChannelTree } from '@/lib/hooks/use-data'
import { createTask, assignTaskByEmail } from '@/lib/actions'
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

  const [assignments, setAssignments] = useState<{ user_id: string; role: AssignmentRole }[]>([])
  const [emailAssignments, setEmailAssignments] = useState<{ email: string; role: AssignmentRole }[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>(defaultCategoryId || '')

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

  const addAssignment = () => {
    setAssignments([...assignments, { user_id: '', role: assignments.length === 0 ? 'primary' : 'other' }])
  }

  const removeAssignment = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index))
  }

  const updateAssignment = (index: number, field: 'user_id' | 'role', value: string) => {
    const updated = [...assignments]
    updated[index] = { ...updated[index], [field]: value }
    setAssignments(updated)
  }

  const addEmailAssignment = () => {
    setEmailAssignments([...emailAssignments, { email: '', role: 'other' }])
  }

  const removeEmailAssignment = (index: number) => {
    setEmailAssignments(emailAssignments.filter((_, i) => i !== index))
  }

  const updateEmailAssignment = (index: number, field: 'email' | 'role', value: string) => {
    const updated = [...emailAssignments]
    updated[index] = { ...updated[index], [field]: value }
    setEmailAssignments(updated)
  }

  const onSubmit = (data: FormData) => {
    const validAssignments = assignments.filter(a => a.user_id)
    const validEmails = emailAssignments
      .map(a => ({ ...a, email: a.email.trim().toLowerCase() }))
      .filter(a => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))

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
          assignments: validAssignments,
          recurrence: isRecurring ? {
            pattern: recurrencePattern,
            custom_interval_days: recurrencePattern === 'custom' ? customInterval : undefined,
            ends_on: recurrenceEndsOn || undefined,
          } : undefined,
        })

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
        setAssignments([])
        setEmailAssignments([])
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
      <DialogContent className="bg-white border border-zinc-300 text-zinc-900 max-w-lg max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-6">
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

          {/* Category + Channel */}
          {!defaultChannelId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-600 text-xs">Category</Label>
                <Select
                  value={selectedCategory}
                  onValueChange={(val) => {
                    setSelectedCategory(val || '')
                    setValue('channel_id', '') // Reset channel on category change
                  }}
                >
                  <SelectTrigger className="mt-1 w-full bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 flex justify-between items-center rounded-lg">
                    <span>{categories?.find(cat => cat.id === selectedCategory)?.name || 'Select Category'}</span>
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                    <SelectItem value="" className="text-sm py-2 px-3 hover:bg-zinc-100">Select Category</SelectItem>
                    {categories?.map(cat => (
                      <SelectItem key={cat.id} value={cat.id} className="text-sm py-2 px-3 hover:bg-zinc-100">{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-zinc-600 text-xs">Channel *</Label>
                <Select
                  value={channelId}
                  onValueChange={(val) => setValue('channel_id', val || '')}
                >
                  <SelectTrigger className="mt-1 w-full bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 flex justify-between items-center rounded-lg">
                    <span>{flattenChannels(filteredChannels).find(ch => ch.id === channelId)?.label || 'Select Channel'}</span>
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                    <SelectItem value="" className="text-sm py-2 px-3 hover:bg-zinc-100">Select Channel</SelectItem>
                    {flattenChannels(filteredChannels).map(ch => (
                      <SelectItem key={ch.id} value={ch.id} className="text-sm py-2 px-3 hover:bg-zinc-100">{ch.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              {assignments.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={a.user_id}
                    onValueChange={(val) => updateAssignment(i, 'user_id', val || '')}
                  >
                    <SelectTrigger className="flex-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 flex justify-between items-center rounded-lg">
                      <span>{users?.find(u => u.id === a.user_id)?.display_name || users?.find(u => u.id === a.user_id)?.email || 'Select user'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-zinc-300 text-zinc-900 rounded-lg">
                      <SelectItem value="" className="text-sm py-2 px-3 hover:bg-zinc-100">Select user</SelectItem>
                      {users?.map(u => (
                        <SelectItem key={u.id} value={u.id} className="text-sm py-2 px-3 hover:bg-zinc-100">{u.display_name || u.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              {assignments.length === 0 && emailAssignments.length === 0 && (
                <p className="text-xs text-zinc-600 py-2">Click "Add Owner" to assign owners</p>
              )}
            </div>

            {/* Assign by email (pre-signup) */}
            <div className="mt-3 pt-3 border-t border-dashed border-zinc-200">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-zinc-500 text-[11px] uppercase tracking-wider">Assign by email (pre-signup)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addEmailAssignment}
                  className="text-xs text-violet-600 hover:text-violet-600 h-auto p-1"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add email
                </Button>
              </div>
              <div className="space-y-2">
                {emailAssignments.map((a, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      type="email"
                      value={a.email}
                      onChange={e => updateEmailAssignment(i, 'email', e.target.value)}
                      placeholder="teammate@lyzr.ai"
                      className="flex-1 bg-zinc-100 border-zinc-300 text-zinc-900 h-9 px-3 text-sm"
                    />
                    <Select
                      value={a.role}
                      onValueChange={(val) => updateEmailAssignment(i, 'role', (val || 'other') as any)}
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
                      onClick={() => removeEmailAssignment(i)}
                      className="text-zinc-500 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {emailAssignments.length > 0 && (
                  <p className="text-[10px] text-zinc-500 pt-1">
                    These emails will be queued. The task auto-attaches to their account on first @lyzr.ai sign-in.
                  </p>
                )}
              </div>
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
