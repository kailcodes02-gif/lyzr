'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Calendar, Layers, Plus, Trash2, Send, Loader2,
  CheckSquare, MessageSquare, Link as LinkIcon, Upload,
  AlertTriangle, Pencil, Target, Repeat,
} from 'lucide-react'
import { useTask, useUsers, useTasks, useCurrentUser, useKnownEmails, useChannels } from '@/lib/hooks/use-data'
import {
  updateTask, deleteTask, addChecklistItem, toggleChecklistItem,
  deleteChecklistItem, addComment, createMention, updateAssignments, uploadResultFile,
  addTaskDependency, removeTaskDependency, makeTaskRecurring, stopTaskRecurring,
} from '@/lib/actions'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  type Task, type TaskStatus, type TaskPriority,
  STATUS_CONFIG, PRIORITY_COLORS,
} from '@/lib/types/database'
import { CreateTaskDialog } from './create-task-dialog'
import { ChannelFields } from './channel-fields'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { toZonedTime, format as formatTz } from 'date-fns-tz'
import { TaskOwnersEditor } from './task-owners-editor'

interface TaskDetailDrawerProps {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onTaskIdChange?: (id: string | null) => void
}

export function TaskDetailDrawer({ taskId, open, onOpenChange, onTaskIdChange }: TaskDetailDrawerProps) {
  const queryClient = useQueryClient()
  const { data: task, isLoading } = useTask(taskId)
  const { data: users } = useUsers()
  const { data: allTasks } = useTasks()
  const { data: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.role === 'admin'

  const supabase = createClient()
  
  // Predecessors query
  const { data: dependencies, refetch: refetchDeps } = useQuery({
    queryKey: ['taskDependencies', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_dependencies')
        .select(`
          *,
          depends_on_task:tasks!depends_on_task_id(id, title, status, priority)
        `)
        .eq('task_id', taskId!)
      if (error) throw error
      return data
    }
  })

  // Successors (blocks) query
  const { data: blocks, refetch: refetchBlocks } = useQuery({
    queryKey: ['taskBlocks', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_dependencies')
        .select(`
          *,
          blocked_task:tasks!task_id(id, title, status, priority)
        `)
        .eq('depends_on_task_id', taskId!)
      if (error) throw error
      return data
    }
  })

  const [depSearch, setDepSearch] = useState('')
  const [adminOverride, setAdminOverride] = useState(false)

  const [isPending, startTransition] = useTransition()
  const [newChecklistItem, setNewChecklistItem] = useState('')
  const [newComment, setNewComment] = useState('')
  // @mention autocomplete over every known dashboard email
  const { data: knownEmails } = useKnownEmails()
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [createSubtaskOpen, setCreateSubtaskOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Sub-activities never get their own drawer: opening one redirects to its
  // parent activity, where all sub-activity operations live inline.
  useEffect(() => {
    if (task?.parent_task_id && onTaskIdChange) onTaskIdChange(task.parent_task_id)
  }, [task?.parent_task_id, onTaskIdChange])

  if (!taskId) return null

  const isFrozen = task?.tracker_frozen_at ? new Date(task.tracker_frozen_at) < new Date() : false
  const isFieldDisabled = isFrozen && (!isAdmin || !adminOverride)

  const incompleteDeps = dependencies?.filter(
    d => d.depends_on_task && d.depends_on_task.status !== 'done' && d.depends_on_task.status !== 'cancelled'
  ) || []

  const handleAddDependency = (depId: string) => {
    if (depId === taskId) return
    startTransition(async () => {
      try {
        await addTaskDependency(taskId!, depId)
        refetchDeps()
        refetchBlocks()
        toast.success('Dependency added')
      } catch (err: any) {
        console.error('addTaskDependency failed:', err)
        toast.error(err?.message || 'Failed to add dependency')
      }
    })
  }

  const handleRemoveDependency = (depId: string) => {
    startTransition(async () => {
      try {
        await removeTaskDependency(taskId!, depId)
        refetchDeps()
        refetchBlocks()
        toast.success('Dependency removed')
      } catch (err: any) {
        console.error('removeTaskDependency failed:', err)
        toast.error(err?.message || 'Failed to remove dependency')
      }
    })
  }

  const eligibleTasks = allTasks?.filter(t => {
    if (t.id === taskId) return false
    if (t.parent_task_id === taskId) return false
    if (dependencies?.some(d => d.depends_on_task_id === t.id)) return false
    if (depSearch.trim()) {
      return t.title.toLowerCase().includes(depSearch.toLowerCase())
    }
    return true
  }).slice(0, 10) || []

  const showTrackerFields = task && ['live', 'done', 'cancelled'].includes(task.status)

  const handleStatusChange = (status: TaskStatus) => {
    // Check if trying to mark done with incomplete subtasks
    if (status === 'done' && task?.subtasks?.some(s => s.status !== 'done' && s.status !== 'cancelled')) {
      toast.error('All subtasks must be done or cancelled first')
      return
    }
    // Check if trying to mark done with incomplete dependencies
    let overrideBlockers = false
    if (status === 'done' && incompleteDeps.length > 0) {
      if (!confirm('This task has incomplete dependencies. Mark as done anyway?')) {
        return
      }
      overrideBlockers = true
    }
    startTransition(async () => {
      try {
        await updateTask(taskId!, { status }, { overrideBlockers })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        toast.success(`Status updated to ${STATUS_CONFIG[status].label}`)
      } catch (err: any) {
        console.error('updateTask (status) failed:', err)
        toast.error(err?.message || 'Failed to update status')
      }
    })
  }

  const handlePriorityChange = (priority: TaskPriority) => {
    startTransition(async () => {
      try {
        await updateTask(taskId!, { priority })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      } catch (err: any) {
        console.error('updateTask (priority) failed:', err)
        toast.error(err?.message || 'Failed to update priority')
      }
    })
  }

  const handleSaveEdit = () => {
    startTransition(async () => {
      try {
        await updateTask(taskId!, { title: editTitle, description: editDescription || null })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
        setIsEditing(false)
        toast.success('Task updated')
      } catch (err: any) {
        console.error('updateTask (title/description) failed:', err)
        toast.error(err?.message || 'Failed to update')
      }
    })
  }

  const handleAddChecklist = () => {
    if (!newChecklistItem.trim()) return
    startTransition(async () => {
      try {
        await addChecklistItem(taskId!, newChecklistItem.trim())
        setNewChecklistItem('')
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      } catch (err: any) {
        console.error('addChecklistItem failed:', err)
        toast.error(err?.message || 'Failed to add item')
      }
    })
  }

  const handleToggleChecklist = (itemId: string, done: boolean) => {
    startTransition(async () => {
      try {
        await toggleChecklistItem(itemId, done)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      } catch (err: any) {
        console.error('toggleChecklistItem failed:', err)
        toast.error(err?.message || 'Failed to toggle item')
      }
    })
  }

  const mentionPeople = (() => {
    const map = new Map<string, { email: string; label: string }>()
    users?.filter(u => u.email !== 'preview@lyzr.ai').forEach(u =>
      map.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), label: u.display_name || u.email }))
    knownEmails?.forEach(e => {
      if (!map.has(e)) map.set(e, { email: e, label: e.split('@')[0].split('.')[0].replace(/^./, (c: string) => c.toUpperCase()) })
    })
    return [...map.values()]
  })()

  const mentionSuggestions = mentionQuery === null ? [] : mentionPeople
    .filter(pn => pn.email.includes(mentionQuery) || pn.label.toLowerCase().includes(mentionQuery))
    .slice(0, 6)

  const onCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setNewComment(v)
    const caret = e.target.selectionStart ?? v.length
    const m = v.slice(0, caret).match(/@([\w.+-]*)$/)
    setMentionQuery(m ? m[1].toLowerCase() : null)
  }

  const pickMention = (email: string) => {
    setNewComment(prev => prev.replace(/@([\w.+-]*)$/, `@${email} `))
    setMentionQuery(null)
  }

  // Resolve @tokens in a comment to known emails (full emails or name prefixes)
  const extractMentionEmails = (body: string): string[] => {
    const out = new Set<string>()
    for (const m of body.matchAll(/@([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g)) out.add(m[1].toLowerCase())
    for (const m of body.matchAll(/@([A-Za-z][\w.-]{1,30})(?!\S*@)/g)) {
      const token = m[1].toLowerCase()
      if (token.includes('@')) continue
      const matches = mentionPeople.filter(pn => pn.label.toLowerCase() === token || pn.email.split('@')[0] === token)
      if (matches.length === 1) out.add(matches[0].email)
    }
    return [...out]
  }

  const handleAddComment = () => {
    if (!newComment.trim()) return
    startTransition(async () => {
      try {
        const body = newComment.trim()
        await addComment(taskId!, body)
        const mentioned = extractMentionEmails(body)
        for (const email of mentioned) {
          try { await createMention(taskId!, 'task_comment', email) } catch (err) { console.error('mention failed', email, err) }
        }
        if (mentioned.length) toast.success(`Mentioned ${mentioned.length} ${mentioned.length === 1 ? 'person' : 'people'}`)
        setNewComment('')
        setMentionQuery(null)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
        queryClient.invalidateQueries({ queryKey: ['activity'] })
        toast.success('Comment added')
      } catch (err: any) {
        console.error('addComment failed:', err)
        toast.error(err?.message || 'Failed to add comment')
      }
    })
  }

  const handleDelete = () => {
    if (!confirm('Delete this task and all subtasks?')) return
    startTransition(async () => {
      try {
        await deleteTask(taskId!)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        onOpenChange(false)
        toast.success('Task deleted')
      } catch (err: any) {
        console.error('deleteTask failed:', err)
        toast.error(err?.message || 'Failed to delete')
      }
    })
  }

  const handleFieldUpdate = (surface: 'planning_fields' | 'tracker_fields', fields: Record<string, unknown>) => {
    startTransition(async () => {
      try {
        await updateTask(taskId!, { [surface]: fields })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      } catch (err: any) {
        console.error('updateTask (fields) failed:', err)
        toast.error(err?.message || 'Failed to update fields')
      }
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('File must be under 2MB'); return }
    const formData = new FormData()
    formData.append('file', file)
    startTransition(async () => {
      try {
        await uploadResultFile(taskId!, formData)
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['task', taskId] })
        toast.success('File uploaded')
      } catch (err: any) {
        console.error('uploadResultFile failed:', err)
        toast.error(err?.message || 'Failed to upload file')
      }
    })
  }

  const formatDate = (dateStr: string) => {
    const date = toZonedTime(new Date(dateStr), 'Asia/Kolkata')
    return formatTz(date, 'dd MMM yyyy, hh:mm a', { timeZone: 'Asia/Kolkata' })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="bg-white border-zinc-200 text-zinc-900 data-[side=right]:w-full data-[side=right]:sm:w-[50vw] data-[side=right]:sm:max-w-none overflow-y-auto p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
            </div>
          ) : task ? (
            <div className="p-6">
              <SheetHeader className="mb-4">
                {/* Context breadcrumb: Category › Channel › Sub-channel */}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2 flex-wrap">
                  {(task.channel as any)?.category?.name && (
                    <><span>{(task.channel as any).category.name}</span><span className="text-zinc-300">›</span></>
                  )}
                  {(task.channel as any)?.parent_channel?.name && (
                    <><span>{(task.channel as any).parent_channel.name}</span><span className="text-zinc-300">›</span></>
                  )}
                  <span className="font-medium text-zinc-700">{task.channel?.name}</span>
                </div>
                {/* Status + Priority */}
                <div className="flex items-center gap-2 mb-3">
                  <Select value={task.status} onValueChange={(val) => { if (val) handleStatusChange(val as TaskStatus) }}>
                    <SelectTrigger className="w-auto bg-transparent border-0 p-0 h-auto">
                      <Badge
                        className="text-xs font-medium border-0 cursor-pointer"
                        style={{
                          backgroundColor: STATUS_CONFIG[task.status].bgColor,
                          color: STATUS_CONFIG[task.status].color,
                        }}
                      >
                        {STATUS_CONFIG[task.status].label}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent className="bg-white shadow-lg border-zinc-300">
                      {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                            {config.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={task.priority} onValueChange={(val) => { if (val) handlePriorityChange(val as TaskPriority) }}>
                    <SelectTrigger className="w-auto bg-transparent border-0 p-0 h-auto">
                      <span className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
                        {task.priority}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="bg-white shadow-lg border-zinc-300">
                      {(['P0', 'P1', 'P2', 'P3', 'P4'] as TaskPriority[]).map(p => (
                        <SelectItem key={p} value={p}>
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                            {p}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <span className="text-xs text-zinc-600 ml-auto">
                    {task.channel?.name}
                  </span>
                </div>

                {/* Title */}
                {isEditing ? (
                  <div className="space-y-2">
                    <Input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="bg-zinc-100 border-zinc-300 text-lg font-semibold"
                    />
                    <Textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      className="bg-zinc-100 border-zinc-300 min-h-[60px]"
                      placeholder="Description..."
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white">Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="text-zinc-600">Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <SheetTitle className="text-xl font-semibold text-zinc-900">
                        {task.title}
                      </SheetTitle>
                      <button
                        onClick={() => { setEditTitle(task.title); setEditDescription(task.description || ''); setIsEditing(true) }}
                        className="p-1.5 rounded-md bg-zinc-100 border border-zinc-300 text-zinc-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 shrink-0 transition-colors"
                        title="Edit name & description"
                      >
                        <Pencil className="w-3.5 h-3.5" fill="currentColor" />
                      </button>
                    </div>
                    {task.description ? (
                      <p
                        className="text-sm text-zinc-600 mt-1 whitespace-pre-wrap cursor-text"
                        onClick={() => { setEditTitle(task.title); setEditDescription(task.description || ''); setIsEditing(true) }}
                        title="Click to edit"
                      >
                        {task.description}
                      </p>
                    ) : (
                      <button
                        onClick={() => { setEditTitle(task.title); setEditDescription(''); setIsEditing(true) }}
                        className="mt-1.5 text-xs text-zinc-500 border border-dashed border-zinc-300 rounded-md px-2.5 py-1 hover:text-blue-600 hover:border-blue-300 transition-colors"
                      >
                        + Add description
                      </button>
                    )}
                  </div>
                )}
              </SheetHeader>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-4 py-4 border-y border-zinc-200 my-4">
                <div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Due Date</p>
                  <Input
                    type="date"
                    value={task.due_date || ''}
                    onChange={e => {
                      startTransition(async () => {
                        try {
                          await updateTask(taskId!, { due_date: e.target.value || null })
                          queryClient.invalidateQueries({ queryKey: ['tasks'] })
                          queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                        } catch (err: any) {
                          console.error('updateTask (due_date) failed:', err)
                          toast.error(err?.message || 'Failed to update due date')
                        }
                      })
                    }}
                    className="bg-zinc-100 border-zinc-300 text-sm h-8"
                  />
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Result URL</p>
                  <Input
                    value={task.result_url || ''}
                    placeholder="https://..."
                    onChange={e => {
                      const val = e.target.value
                      startTransition(async () => {
                        try {
                          await updateTask(taskId!, { result_url: val || null })
                          queryClient.invalidateQueries({ queryKey: ['tasks'] })
                          queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                        } catch (err: any) {
                          console.error('updateTask (result_url) failed:', err)
                          toast.error(err?.message || 'Failed to update result URL')
                        }
                      })
                    }}
                    className="bg-zinc-100 border-zinc-300 text-sm h-8"
                  />
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Created</p>
                  <p className="text-sm text-zinc-700">{formatDate(task.created_at)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Result File</p>
                  <label className="flex items-center gap-2 text-sm text-blue-600 cursor-pointer hover:text-blue-700">
                    <Upload className="w-3.5 h-3.5" />
                    {task.result_file_path ? 'Replace file' : 'Upload (2MB max)'}
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>

              {/* Recurrence — make an existing task repeat, or stop it */}
              <RecurrenceSection task={task} onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                queryClient.invalidateQueries({ queryKey: ['tasks'] })
              }} />

              {/* Owners — signed-in + pending, with add/remove */}
              <TaskOwnersEditor task={task} onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                queryClient.invalidateQueries({ queryKey: ['tasks'] })
              }} />

              {/* Checklist — line items, right under owners */}
              <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                <h4 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-green-600" />
                  Checklist {((task as any).checklist_items || []).length > 0 ? `(${((task as any).checklist_items || []).length})` : ''}
                </h4>

                  <div className="space-y-2 mb-3">
                    {((task as any).checklist_items || []).map((item: any) => (
                      <div key={item.id} className="flex items-center gap-3 group">
                        <Checkbox
                          checked={item.is_done}
                          onCheckedChange={(checked) => handleToggleChecklist(item.id, !!checked)}
                          className="border-zinc-300 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                        />
                        <span className={cn(
                          'text-sm flex-1',
                          item.is_done ? 'text-zinc-600 line-through' : 'text-zinc-700'
                        )}>
                          {item.body}
                        </span>
                        <button
                          onClick={() => {
                            startTransition(async () => {
                              try {
                                await deleteChecklistItem(item.id)
                                queryClient.invalidateQueries({ queryKey: ['tasks'] })
                                queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                              } catch (err: any) {
                                console.error('deleteChecklistItem failed:', err)
                                toast.error(err?.message || 'Failed to delete item')
                              }
                            })
                          }}
                          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-600 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newChecklistItem}
                      onChange={e => setNewChecklistItem(e.target.value)}
                      placeholder="Add checklist item..."
                      className="bg-zinc-100 border-zinc-300 text-sm"
                      onKeyDown={e => e.key === 'Enter' && handleAddChecklist()}
                    />
                    <Button size="sm" onClick={handleAddChecklist} disabled={isPending} className="bg-zinc-200/70 hover:bg-zinc-300/70 text-zinc-900 shrink-0">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
              </div>

              {/* Sub-activities — always visible, fully operable inline */}
              {task.nesting_level === 0 && (
                <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-violet-600" />
                      Sub-activities ({task.subtasks?.length || 0})
                    </h4>
                    <Button
                      size="sm"
                      onClick={() => setCreateSubtaskOpen(true)}
                      className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {task.subtasks?.map(sub => (
                      <SubtaskInlineRow
                        key={sub.id}
                        sub={sub as Task}
                        parentPriority={task.priority}
                        onChanged={() => {
                          queryClient.invalidateQueries({ queryKey: ['task', taskId] })
                          queryClient.invalidateQueries({ queryKey: ['tasks'] })
                        }}
                      />
                    ))}
                    {(!task.subtasks || task.subtasks.length === 0) && (
                      <p className="text-xs text-zinc-500 py-2 text-center">No sub-activities yet — expand the work into steps with the Add button.</p>
                    )}
                  </div>
                </div>
              )}

              <Tabs defaultValue="details" className="mt-4">
                <TabsList className="bg-zinc-100 border border-zinc-200">
                  <TabsTrigger value="details" className="text-xs data-[state=active]:bg-zinc-200/70">Details</TabsTrigger>
                  <TabsTrigger value="dependencies" className="text-xs data-[state=active]:bg-zinc-200/70">
                    Dependencies
                    {((dependencies?.length || 0) + (blocks?.length || 0)) > 0 && <TabDot />}
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="text-xs data-[state=active]:bg-zinc-200/70">
                    Comments {(task as any).comments?.length ? `(${(task as any).comments.length})` : ''}
                    {((task as any).comments?.length || 0) > 0 && <TabDot />}
                  </TabsTrigger>
                </TabsList>

                {/* Details / Channel Fields */}
                <TabsContent value="details" className="mt-4 space-y-4">
                  {isFrozen && (
                    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg flex items-center justify-between text-xs mb-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span>This tracker has been frozen (45 days elapsed since campaign went live).</span>
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAdminOverride(!adminOverride)}
                          className="border-red-500/30 hover:bg-red-500/20 text-red-600 h-7"
                        >
                          {adminOverride ? 'Disable Override' : 'Admin Override'}
                        </Button>
                      )}
                    </div>
                  )}

                  {incompleteDeps.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 p-3 rounded-lg flex items-start gap-2.5 text-xs mb-4">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold block mb-0.5">Blocked by Incomplete Dependencies</span>
                        This task depends on the following incomplete tasks:
                        <ul className="list-disc pl-4 mt-1 space-y-1">
                          {incompleteDeps.map(d => (
                            <li key={d.id}>
                              {onTaskIdChange ? (
                                <button
                                  onClick={() => onTaskIdChange(d.depends_on_task_id)}
                                  className="underline hover:text-amber-300 font-medium text-left"
                                >
                                  {d.depends_on_task?.title}
                                </button>
                              ) : (
                                <span className="font-medium">{d.depends_on_task?.title}</span>
                              )}{' '}
                              ({STATUS_CONFIG[d.depends_on_task?.status as TaskStatus]?.label})
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Targets — called out explicitly, above the generic fields */}
                  <TargetsSection
                    planningFields={task.planning_fields}
                    onSave={(fields) => handleFieldUpdate('planning_fields', fields)}
                  />

                  {/* Links — any number of URLs on this activity */}
                  <LinksEditor
                    planningFields={task.planning_fields}
                    onSave={(fields) => handleFieldUpdate('planning_fields', fields)}
                  />

                  {/* Multi-homing: show this task on other channels' boards too */}
                  <AlsoChannelsEditor
                    homeChannelId={task.channel_id}
                    planningFields={task.planning_fields}
                    onSave={(fields) => handleFieldUpdate('planning_fields', fields)}
                  />

                  {/* Planning Fields (frequency, star grade, etc.) */}
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Planning Fields</h4>
                    <ChannelFields
                      channelSlug={task.channel?.slug || ''}
                      parentChannelSlug={(task.channel as any)?.parent_channel?.slug}
                      surface="planning"
                      values={task.planning_fields}
                      excludeSlugs={['kpi_target', 'opp_target', 'additional_targets']}
                      onChange={(fields: Record<string, unknown>) => handleFieldUpdate('planning_fields', fields)}
                    />
                  </div>

                  {/* Tracker Fields */}
                  {showTrackerFields && (
                    <div>
                      <Separator className="bg-zinc-100 my-4" />
                      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Tracker Fields</h4>
                      <ChannelFields
                        channelSlug={task.channel?.slug || ''}
                        parentChannelSlug={(task.channel as any)?.parent_channel?.slug}
                        surface="tracker"
                        values={task.tracker_fields}
                        onChange={(fields: Record<string, unknown>) => handleFieldUpdate('tracker_fields', fields)}
                        disabled={isFieldDisabled}
                      />
                      <ResultsEditor
                        trackerFields={task.tracker_fields}
                        disabled={isFieldDisabled}
                        onSave={(fields) => handleFieldUpdate('tracker_fields', fields)}
                      />
                    </div>
                  )}
                </TabsContent>

                {/* Dependencies Tab */}
                <TabsContent value="dependencies" className="mt-4 space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Depends On (Predecessors)</h4>
                    <div className="space-y-2 mb-4">
                      {dependencies && dependencies.length > 0 ? (
                        dependencies.map(dep => (
                          <div key={dep.id} className="flex items-center justify-between bg-zinc-100/60 rounded-lg px-3 py-2 border border-zinc-200">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[dep.depends_on_task?.priority as TaskPriority] || '#3b82f6' }} />
                              <div className="text-sm">
                                {onTaskIdChange ? (
                                  <button
                                    onClick={() => onTaskIdChange(dep.depends_on_task_id)}
                                    className="text-zinc-700 font-medium hover:underline hover:text-blue-600 text-left"
                                  >
                                    {dep.depends_on_task?.title}
                                  </button>
                                ) : (
                                  <span className="text-zinc-700 font-medium">{dep.depends_on_task?.title}</span>
                                )}
                                <Badge className="ml-2 text-[9px] border-0" style={{
                                  backgroundColor: STATUS_CONFIG[dep.depends_on_task?.status as TaskStatus]?.bgColor,
                                  color: STATUS_CONFIG[dep.depends_on_task?.status as TaskStatus]?.color
                                }}>
                                  {STATUS_CONFIG[dep.depends_on_task?.status as TaskStatus]?.label}
                                </Badge>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveDependency(dep.depends_on_task_id)}
                              className="text-zinc-500 hover:text-red-600 p-1 h-auto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">No task dependencies defined</p>
                      )}
                    </div>

                    <Separator className="bg-zinc-100 my-4" />

                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Blocks (Successors)</h4>
                    <div className="space-y-2 mb-4">
                      {blocks && blocks.length > 0 ? (
                        blocks.map(block => (
                          <div key={block.id} className="flex items-center justify-between bg-zinc-100/60 rounded-lg px-3 py-2 border border-zinc-200">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[block.blocked_task?.priority as TaskPriority] || '#3b82f6' }} />
                              <div className="text-sm">
                                {onTaskIdChange ? (
                                  <button
                                    onClick={() => onTaskIdChange(block.task_id)}
                                    className="text-zinc-700 font-medium hover:underline hover:text-blue-600 text-left"
                                  >
                                    {block.blocked_task?.title}
                                  </button>
                                ) : (
                                  <span className="text-zinc-700 font-medium">{block.blocked_task?.title}</span>
                                )}
                                <Badge className="ml-2 text-[9px] border-0" style={{
                                  backgroundColor: STATUS_CONFIG[block.blocked_task?.status as TaskStatus]?.bgColor,
                                  color: STATUS_CONFIG[block.blocked_task?.status as TaskStatus]?.color
                                }}>
                                  {STATUS_CONFIG[block.blocked_task?.status as TaskStatus]?.label}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">No other tasks depend on this task</p>
                      )}
                    </div>

                    <Separator className="bg-zinc-100 my-4" />

                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Add Dependency</h4>
                    <div className="space-y-2">
                      <Input
                        value={depSearch}
                        onChange={e => setDepSearch(e.target.value)}
                        placeholder="Search tasks by title..."
                        className="bg-zinc-100 border-zinc-300 text-sm h-9"
                      />
                      {depSearch.trim() && eligibleTasks.length > 0 && (
                        <div className="bg-white border border-zinc-300 rounded-lg overflow-hidden divide-y divide-zinc-200 max-h-48 overflow-y-auto">
                          {eligibleTasks.map(t => (
                            <div
                              key={t.id}
                              onClick={() => { handleAddDependency(t.id); setDepSearch('') }}
                              className="flex items-center justify-between px-3 py-2 hover:bg-zinc-100 cursor-pointer text-xs transition-colors"
                            >
                              <span className="text-zinc-700 truncate mr-2">{t.title}</span>
                              <Badge variant="outline" className="text-[9px] border-zinc-300 text-zinc-500 shrink-0">
                                {STATUS_CONFIG[t.status]?.label}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                      {depSearch.trim() && eligibleTasks.length === 0 && (
                        <p className="text-xs text-zinc-600">No matching tasks found</p>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* Subtasks */}

                {/* Checklist */}

                {/* Comments */}
                <TabsContent value="comments" className="mt-4">
                  <div className="space-y-4 mb-4 max-h-64 overflow-y-auto">
                    {((task as any).comments || []).map((comment: any) => (
                      <div key={comment.id} className="flex gap-3">
                        <Avatar className="w-7 h-7 shrink-0">
                          <AvatarImage src={comment.user?.avatar_url || ''} />
                          <AvatarFallback className="bg-zinc-300 text-[10px]">{comment.user?.display_name?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-zinc-700">{comment.user?.display_name}</span>
                            <span className="text-[11px] text-zinc-600">{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}</span>
                          </div>
                          <p className="text-sm text-zinc-600 mt-0.5">{comment.body}</p>
                        </div>
                      </div>
                    ))}
                    {(!(task as any).comments || (task as any).comments.length === 0) && (
                      <p className="text-sm text-zinc-600 py-4 text-center">No comments yet</p>
                    )}
                  </div>
                  <div className="relative">
                    {mentionQuery !== null && mentionSuggestions.length > 0 && (
                      <div className="absolute bottom-full mb-1 left-0 w-72 rounded-lg border border-zinc-300 bg-white shadow-lg z-50 overflow-hidden">
                        {mentionSuggestions.map(pn => (
                          <button
                            key={pn.email}
                            type="button"
                            onMouseDown={e => { e.preventDefault(); pickMention(pn.email) }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
                          >
                            <span className="font-medium text-zinc-800 capitalize">{pn.label}</span>
                            <span className="text-zinc-500 truncate">{pn.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Textarea
                      value={newComment}
                      onChange={onCommentChange}
                      placeholder="Add a comment... type @ to mention someone"
                      className="bg-zinc-100 border-zinc-300 text-sm min-h-[60px]"
                    />
                  </div>
                  <div className="flex justify-end mt-2">
                    <Button size="sm" onClick={handleAddComment} disabled={isPending || !newComment.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
                      <Send className="w-3.5 h-3.5 mr-1" /> Comment
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Delete */}
              <div className="mt-8 pt-4 border-t border-zinc-200">
                <Button
                  size="sm"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-500 text-white"
                >
                  <Trash2 className="w-4 h-4 mr-1" fill="currentColor" /> Delete Task
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {task && (
        <CreateTaskDialog
          open={createSubtaskOpen}
          onOpenChange={setCreateSubtaskOpen}
          defaultChannelId={task.channel_id}
          parentTaskId={task.id}
          nestingLevel={task.nesting_level + 1}
        />
      )}
    </>
  )
}

// Small brown dot on drawer tabs that contain content — a glanceable "there's
// something in here" signal.
function TabDot() {
  return <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-700 align-middle" aria-label="has items" />
}

// One sub-activity, fully operable inline (no separate drawer): status,
// priority (locked to P0 under a P0 parent), due date, description, delete.
function SubtaskInlineRow({ sub, parentPriority, onChanged }: {
  sub: Task
  parentPriority: TaskPriority
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(sub.title)
  const [desc, setDesc] = useState(sub.description || '')
  const [busy, setBusy] = useState(false)
  // Full record (checklist items etc.) fetched only when the row is expanded
  const { data: subFull } = useTask(expanded ? sub.id : null)
  const [newItem, setNewItem] = useState('')
  const subQueryClient = useQueryClient()

  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      subQueryClient.invalidateQueries({ queryKey: ['task', sub.id] })
      onChanged()
    } catch (err: any) {
      toast.error(`${failMsg}: ${err?.message || 'unknown'}`)
    } finally { setBusy(false) }
  }

  const priorityLocked = parentPriority === 'P0'

  return (
    <div className="rounded-lg bg-zinc-100/60 border border-zinc-200 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-zinc-500 hover:text-zinc-800 shrink-0"
          title={expanded ? 'Collapse' : 'Edit description'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-sm text-zinc-800 flex-1 truncate">{sub.title}</span>

        {/* Priority — inline */}
        <select
          value={sub.priority}
          disabled={busy || priorityLocked}
          title={priorityLocked ? 'Parent activity is P0 — sub-activities inherit P0' : 'Priority'}
          onChange={e => run(() => updateTask(sub.id, { priority: e.target.value as TaskPriority }), 'Priority update failed')}
          className="text-[11px] font-bold rounded-md border border-zinc-300 bg-white px-1 py-0.5 disabled:opacity-60"
          style={{ color: PRIORITY_COLORS[sub.priority] }}
        >
          {(['P0', 'P1', 'P2', 'P3', 'P4'] as TaskPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {/* Status — inline */}
        <select
          value={sub.status}
          disabled={busy}
          onChange={e => run(() => updateTask(sub.id, { status: e.target.value as TaskStatus }), 'Status update failed')}
          className="text-[11px] font-medium rounded-md border border-zinc-300 bg-white px-1 py-0.5"
          style={{ color: STATUS_CONFIG[sub.status].color }}
        >
          {Object.entries(STATUS_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>

        {/* Due date — inline */}
        <input
          type="date"
          value={sub.due_date || ''}
          disabled={busy}
          onChange={e => run(() => updateTask(sub.id, { due_date: e.target.value || null }), 'Due date update failed')}
          className="text-[11px] rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-zinc-700"
        />

        <button
          onClick={() => { if (confirm(`Delete sub-activity "${sub.title}"?`)) run(() => deleteTask(sub.id), 'Delete failed') }}
          className="p-1 rounded-md bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 shrink-0"
          title="Delete sub-activity"
        >
          <Trash2 className="w-3.5 h-3.5" fill="currentColor" />
        </button>
      </div>
      {expanded && (
        <div className="pl-6 space-y-3">
          {/* Rename */}
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-sm bg-white border-zinc-300 text-zinc-900 h-8 font-medium"
            />
            <Button
              size="sm"
              disabled={busy || !title.trim() || title === sub.title}
              onClick={() => run(() => updateTask(sub.id, { title: title.trim() }), 'Rename failed')}
              className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-xs shrink-0"
            >
              Rename
            </Button>
          </div>

          {/* Description */}
          <div className="flex items-start gap-2">
            <Textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Describe this sub-activity…"
              className="text-xs bg-white border-zinc-300 text-zinc-800 resize-none"
            />
            <Button
              size="sm"
              disabled={busy || desc === (sub.description || '')}
              onClick={() => run(() => updateTask(sub.id, { description: desc || null }), 'Description save failed')}
              className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs"
            >
              Save
            </Button>
          </div>

          {/* Owners — same primary/secondary controls as the activity */}
          <TaskOwnersEditor
            task={(subFull || sub) as Task}
            onChanged={() => {
              // The expanded row renders from the sub's OWN query — refresh it
              // too, or newly added owners don't appear until a full reload.
              subQueryClient.invalidateQueries({ queryKey: ['task', sub.id] })
              onChanged()
            }}
          />

          {/* Checklist — plain line items, not tasks */}
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Checklist</p>
            <div className="space-y-1 mb-1.5">
              {(subFull?.checklist_items || []).map(item => (
                <div key={item.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={item.is_done}
                    onCheckedChange={() => run(() => toggleChecklistItem(item.id, !item.is_done), 'Checklist toggle failed')}
                    className="border-zinc-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 w-3.5 h-3.5"
                  />
                  <span className={`text-xs flex-1 ${item.is_done ? 'line-through text-zinc-400' : 'text-zinc-700'}`}>{item.body}</span>
                  <button
                    onClick={() => run(() => deleteChecklistItem(item.id), 'Checklist delete failed')}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600"
                    title="Remove item"
                  >
                    <Trash2 className="w-3 h-3" fill="currentColor" />
                  </button>
                </div>
              ))}
              {expanded && (subFull?.checklist_items || []).length === 0 && (
                <p className="text-[11px] text-zinc-400 italic">No checklist items yet</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                placeholder="Add checklist item…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newItem.trim()) {
                    run(() => addChecklistItem(sub.id, newItem.trim()).then(() => setNewItem('')), 'Checklist add failed')
                  }
                }}
                className="h-7 text-xs bg-white border-zinc-300 text-zinc-800"
              />
              <Button
                size="sm"
                disabled={busy || !newItem.trim()}
                onClick={() => run(() => addChecklistItem(sub.id, newItem.trim()).then(() => setNewItem('')), 'Checklist add failed')}
                className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs shrink-0"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Targets + Links for this sub-activity */}
          <TargetsSection
            planningFields={(subFull || sub).planning_fields || {}}
            onSave={(fields) => run(() => updateTask(sub.id, { planning_fields: fields }), 'Targets save failed')}
          />
          <LinksEditor
            compact
            planningFields={(subFull || sub).planning_fields || {}}
            onSave={(fields) => run(() => updateTask(sub.id, { planning_fields: fields }), 'Links save failed')}
          />

          {/* Multi-homing for this sub-activity */}
          <AlsoChannelsEditor
            homeChannelId={sub.channel_id || ''}
            planningFields={(subFull || sub).planning_fields || {}}
            onSave={(fields) => run(() => updateTask(sub.id, { planning_fields: fields }), 'Channels save failed')}
          />


        </div>
      )}
    </div>
  )
}

// Multiple named results on completion — {name, value} pairs (text or number),
// stored in tracker_fields.results alongside the channel's tracker metrics.
function ResultsEditor({ trackerFields, disabled, onSave }: {
  trackerFields: Record<string, unknown>
  disabled?: boolean
  onSave: (fields: Record<string, unknown>) => void
}) {
  const results = (trackerFields?.results as { name: string; value: string }[] | undefined) || []
  const [name, setName] = useState('')
  const [value, setValue] = useState('')

  const save = (next: { name: string; value: string }[]) =>
    onSave({ ...trackerFields, results: next })

  const add = () => {
    if (!name.trim() || !value.trim()) return
    save([...results, { name: name.trim(), value: value.trim() }])
    setName(''); setValue('')
  }

  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Results</h4>
      <div className="space-y-1.5 mb-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 group">
            <span className="text-xs font-medium text-emerald-800">{r.name}</span>
            <span className="text-xs text-emerald-700 flex-1">{r.value}</span>
            {!disabled && (
              <button
                onClick={() => save(results.filter((_, j) => j !== i))}
                className="p-0.5 rounded bg-white/60 text-zinc-500 hover:text-red-600"
                title="Remove result"
              >
                <Trash2 className="w-3 h-3" fill="currentColor" />
              </button>
            )}
          </div>
        ))}
        {results.length === 0 && (
          <p className="text-xs text-zinc-500">No results recorded yet — add outcomes as name + value (e.g. &quot;Leads generated&quot; / &quot;42&quot;).</p>
        )}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Result name"
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800 w-44" />
          <Input value={value} onChange={e => setValue(e.target.value)} placeholder="Value (text or number)"
            onKeyDown={e => e.key === 'Enter' && add()}
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800 flex-1" />
          <Button size="sm" onClick={add} disabled={!name.trim() || !value.trim()}
            className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add result
          </Button>
        </div>
      )}
    </div>
  )
}

// Targets: each target is a Type + Value pair (e.g. "Impressions" / "10k/mo").
// Stored in planning_fields.targets; legacy single-string fields are shown as
// initial rows until first save. kpi_target stays synced for the card chips.
type TargetRow = { type: string; value: string }

function readTargets(pf: Record<string, unknown>): TargetRow[] {
  const arr = pf?.targets as TargetRow[] | undefined
  if (arr) return arr
  const legacy: TargetRow[] = []
  if (pf?.kpi_target) legacy.push({ type: 'KPI', value: String(pf.kpi_target) })
  if (pf?.opp_target != null) legacy.push({ type: 'Opportunities', value: String(pf.opp_target) })
  ;((pf?.additional_targets as string) || '').split('\n').map(x => x.trim()).filter(Boolean)
    .forEach(v => legacy.push({ type: 'Target', value: v }))
  return legacy
}

function TargetsSection({ planningFields, onSave }: {
  planningFields: Record<string, unknown>
  onSave: (fields: Record<string, unknown>) => void
}) {
  const targets = readTargets(planningFields)
  const [type, setType] = useState('')
  const [value, setValue] = useState('')

  const save = (next: TargetRow[]) => onSave({
    ...planningFields,
    targets: next,
    kpi_target: next[0] ? `${next[0].type}: ${next[0].value}` : null,
  })

  const add = () => {
    if (!type.trim() || !value.trim()) return
    save([...targets, { type: type.trim(), value: value.trim() }])
    setType(''); setValue('')
  }

  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5 text-emerald-600" /> Targets
      </h4>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {targets.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-white border border-emerald-300 px-2 py-1 text-[11px] group">
              <span className="font-semibold text-emerald-900">{t.type}</span>
              <span className="text-emerald-700">{t.value}</span>
              <button
                onClick={() => save(targets.filter((_, j) => j !== i))}
                className="text-zinc-400 hover:text-red-600"
                title="Remove target"
              >
                ×
              </button>
            </span>
          ))}
          {targets.length === 0 && <span className="text-[11px] text-zinc-400 italic">No targets yet</span>}
        </div>
        <div className="flex items-center gap-2">
          <Input value={type} onChange={e => setType(e.target.value)} placeholder="Type (e.g. Impressions)"
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800 w-44" />
          <Input value={value} onChange={e => setValue(e.target.value)} placeholder="Value (e.g. 10,000/mo)"
            onKeyDown={e => e.key === 'Enter' && add()}
            className="h-8 text-xs bg-white border-zinc-300 text-zinc-800 flex-1" />
          <Button size="sm" onClick={add} disabled={!type.trim() || !value.trim()}
            className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white text-xs shrink-0">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>
    </div>
  )
}

// Links: any number of URLs on an activity or sub-activity,
// stored in planning_fields.links as {label, url}.
export function LinksEditor({ planningFields, onSave, compact }: {
  planningFields: Record<string, unknown>
  onSave: (fields: Record<string, unknown>) => void
  compact?: boolean
}) {
  const links = (planningFields?.links as { label: string; url: string }[] | undefined) || []
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const save = (next: { label: string; url: string }[]) => onSave({ ...planningFields, links: next })

  const add = () => {
    if (!url.trim()) return
    const clean = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`
    let name = label.trim()
    if (!name) { try { name = new URL(clean).hostname.replace('www.', '') } catch { name = clean } }
    save([...links, { label: name, url: clean }])
    setLabel(''); setUrl('')
  }

  return (
    <div className={compact ? '' : 'mb-4'}>
      <h4 className={cn('font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5', compact ? 'text-[11px]' : 'text-xs')}>
        <LinkIcon className={compact ? 'w-3 h-3 text-blue-600' : 'w-3.5 h-3.5 text-blue-600'} /> Links
      </h4>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {links.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px]">
            <a href={l.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline font-medium">{l.label}</a>
            <button
              onClick={() => save(links.filter((_, j) => j !== i))}
              className="text-zinc-400 hover:text-red-600"
              title="Remove link"
            >
              ×
            </button>
          </span>
        ))}
        {links.length === 0 && <span className="text-[11px] text-zinc-400 italic">No links yet</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name (optional)"
          className="h-7 text-xs bg-white border-zinc-300 text-zinc-800 w-36" />
        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
          onKeyDown={e => e.key === 'Enter' && add()}
          className="h-7 text-xs bg-white border-zinc-300 text-zinc-800 flex-1" />
        <Button size="sm" onClick={add} disabled={!url.trim()}
          className="h-7 bg-blue-600 hover:bg-blue-500 text-white text-xs shrink-0">
          <Plus className="w-3 h-3 mr-0.5" /> Add
        </Button>
      </div>
    </div>
  )
}


// Recurrence on an existing task: creates a template from the task as-is
// (title, priority, fields, owners); completing the task then spawns the next
// instance one interval after its due date.
function RecurrenceSection({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pattern, setPattern] = useState<'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'>('weekly')
  const [intervalDays, setIntervalDays] = useState(7)
  const [endsOn, setEndsOn] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: template } = useQuery({
    queryKey: ['recurringTemplate', task.recurring_template_id],
    enabled: !!task.recurring_template_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recurring_templates')
        .select('id, pattern, custom_interval_days, ends_on, is_active, next_due_date')
        .eq('id', task.recurring_template_id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      queryClient.invalidateQueries({ queryKey: ['recurringTemplate', task.recurring_template_id] })
      onChanged()
    } catch (err: any) {
      toast.error(`${failMsg}: ${err?.message || 'unknown'}`)
    } finally { setBusy(false) }
  }

  const patternLabel = (t: { pattern: string; custom_interval_days: number | null }) =>
    t.pattern === 'custom' ? `every ${t.custom_interval_days} days` : t.pattern

  if (task.recurring_template_id && template) {
    return (
      <div className="mb-4 flex items-center gap-2 flex-wrap rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2">
        <Repeat className="w-3.5 h-3.5 text-violet-600" />
        {template.is_active ? (
          <>
            <span className="text-xs text-violet-800 font-medium">
              Recurring · {patternLabel(template)}
              {template.next_due_date && ` · next on ${template.next_due_date}`}
              {template.ends_on && ` · until ${template.ends_on}`}
            </span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => stopTaskRecurring(task.id), 'Failed to stop recurrence')}
              className="h-6 bg-white border border-violet-300 text-violet-700 hover:bg-violet-100 text-[11px] ml-auto"
            >
              Stop recurring
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-zinc-500">Recurrence stopped ({patternLabel(template)})</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(async () => {
                const { data, error } = await supabase
                  .from('recurring_templates')
                  .update({ is_active: true })
                  .eq('id', template.id)
                  .select('id')
                if (error) throw error
                if (!data?.length) throw new Error('Only the template creator or an admin can resume it')
              }, 'Failed to resume recurrence')}
              className="h-6 bg-violet-600 hover:bg-violet-500 text-white text-[11px] ml-auto"
            >
              Resume
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-violet-700 border border-dashed border-violet-300 rounded-md px-2.5 py-1 hover:bg-violet-50 inline-flex items-center gap-1.5 transition-colors"
        >
          <Repeat className="w-3 h-3" /> Make recurring
        </button>
      ) : (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 flex items-center gap-2 flex-wrap">
          <Repeat className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          <select
            value={pattern}
            onChange={e => setPattern(e.target.value as any)}
            className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-800"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom (days)</option>
          </select>
          {pattern === 'custom' && (
            <Input
              type="number"
              value={intervalDays}
              onChange={e => setIntervalDays(Number(e.target.value) || 7)}
              className="h-7 w-20 text-xs bg-white border-zinc-300 text-zinc-800"
            />
          )}
          <span className="text-[11px] text-zinc-500">ends (optional)</span>
          <Input
            type="date"
            value={endsOn}
            onChange={e => setEndsOn(e.target.value)}
            className="h-7 w-36 text-xs bg-white border-zinc-300 text-zinc-800"
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(() => makeTaskRecurring(task.id, {
              pattern,
              custom_interval_days: pattern === 'custom' ? intervalDays : undefined,
              ends_on: endsOn || undefined,
            }).then(() => setOpen(false)), 'Failed to make recurring')}
            className="h-7 bg-violet-600 hover:bg-violet-500 text-white text-xs"
          >
            Start
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 text-xs text-zinc-500">
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}


// "Also in" channels: multi-home a task onto other channels' boards.
// Home stays fixed (tasks.channel_id); extras live in planning_fields.also_channels.
function AlsoChannelsEditor({ homeChannelId, planningFields, onSave }: {
  homeChannelId: string
  planningFields: Record<string, unknown>
  onSave: (fields: Record<string, unknown>) => void
}) {
  const { data: channels } = useChannels()
  const [pick, setPick] = useState('')
  const also = (planningFields?.also_channels as string[] | undefined) || []

  const label = (id: string) => {
    const ch = channels?.find(c => c.id === id)
    if (!ch) return 'Unknown channel'
    const parent = channels?.find(c => c.id === ch.parent_channel_id)
    return parent ? `${parent.name} › ${ch.name}` : ch.name
  }

  const options = (channels || [])
    .filter(c => c.id !== homeChannelId && !also.includes(c.id))
    .map(c => ({ id: c.id, label: label(c.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const save = (next: string[]) => onSave({ ...planningFields, also_channels: next })

  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-violet-600" /> Also shows in
      </h4>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600" title="Home board (fixed)">
          {label(homeChannelId)} · home
        </span>
        {also.map(id => (
          <span key={id} className="inline-flex items-center gap-1 rounded-md bg-violet-50 border border-violet-200 px-2 py-0.5 text-[11px] text-violet-700">
            {label(id)}
            <button
              onClick={() => save(also.filter(x => x !== id))}
              className="text-zinc-400 hover:text-red-600"
              title="Remove from this board"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={pick}
          onChange={e => setPick(e.target.value)}
          className="text-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-700 flex-1 max-w-sm"
        >
          <option value="">Add to another channel…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <Button
          size="sm"
          disabled={!pick}
          onClick={() => { save([...also, pick]); setPick('') }}
          className="h-7 bg-violet-600 hover:bg-violet-500 text-white text-xs"
        >
          <Plus className="w-3 h-3 mr-0.5" /> Add
        </Button>
      </div>
    </div>
  )
}
