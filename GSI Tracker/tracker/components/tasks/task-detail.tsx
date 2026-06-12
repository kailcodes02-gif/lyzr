'use client'

import { useState, useTransition } from 'react'
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
  AlertTriangle,
} from 'lucide-react'
import { useTask, useUsers, useTasks, useCurrentUser } from '@/lib/hooks/use-data'
import {
  updateTask, deleteTask, addChecklistItem, toggleChecklistItem,
  deleteChecklistItem, addComment, updateAssignments, uploadResultFile,
  addTaskDependency, removeTaskDependency,
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
  const [createSubtaskOpen, setCreateSubtaskOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

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

  const handleAddComment = () => {
    if (!newComment.trim()) return
    startTransition(async () => {
      try {
        await addComment(taskId!, newComment.trim())
        setNewComment('')
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
        <SheetContent className="bg-[#0c0c12] border-white/5 text-white w-full sm:max-w-2xl overflow-y-auto p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
          ) : task ? (
            <div className="p-6">
              <SheetHeader className="mb-4">
                {/* Status + Priority */}
                <div className="flex items-center gap-2 mb-3">
                  <Select value={task.status} onValueChange={(val) => { if (val) handleStatusChange(val as TaskStatus) }}>
                    <SelectTrigger className="w-auto bg-transparent border-0 p-0 h-auto">
                      <Badge
                        className="text-xs font-medium border-0 cursor-pointer"
                        style={{
                          backgroundColor: STATUS_CONFIG[task.status].bgColor + '30',
                          color: STATUS_CONFIG[task.status].color,
                        }}
                      >
                        {STATUS_CONFIG[task.status].label}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-white/10">
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
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
                        {task.priority}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-white/10">
                      {(['P0', 'P1', 'P2', 'P3'] as TaskPriority[]).map(p => (
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
                      className="bg-white/5 border-white/10 text-lg font-semibold"
                    />
                    <Textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      className="bg-white/5 border-white/10 min-h-[60px]"
                      placeholder="Description..."
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white">Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="text-zinc-400">Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <SheetTitle
                      className="text-xl font-semibold text-white cursor-pointer hover:text-blue-300"
                      onClick={() => { setEditTitle(task.title); setEditDescription(task.description || ''); setIsEditing(true) }}
                    >
                      {task.title}
                    </SheetTitle>
                    {task.description && (
                      <p className="text-sm text-zinc-400 mt-1">{task.description}</p>
                    )}
                  </div>
                )}
              </SheetHeader>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-4 py-4 border-y border-white/5 my-4">
                <div>
                  <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">Due Date</p>
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
                    className="bg-white/5 border-white/10 text-sm h-8"
                  />
                </div>
                <div>
                  <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">Result URL</p>
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
                    className="bg-white/5 border-white/10 text-sm h-8"
                  />
                </div>
                <div>
                  <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">Created</p>
                  <p className="text-sm text-zinc-300">{formatDate(task.created_at)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">Result File</p>
                  <label className="flex items-center gap-2 text-sm text-blue-400 cursor-pointer hover:text-blue-300">
                    <Upload className="w-3.5 h-3.5" />
                    {task.result_file_path ? 'Replace file' : 'Upload (2MB max)'}
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>

              {/* Owners */}
              <div className="mb-4">
                <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-2">Owners</p>
                <div className="flex flex-wrap gap-2">
                  {task.assignments?.map(a => (
                    <div key={a.user_id} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                      <Avatar className="w-5 h-5">
                        <AvatarImage src={a.user?.avatar_url || ''} />
                        <AvatarFallback className="bg-zinc-700 text-[9px]">{a.user?.display_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-zinc-300">{a.user?.display_name}</span>
                      <Badge variant="outline" className="text-[9px] border-white/10 text-zinc-500">{a.role}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <Tabs defaultValue="details" className="mt-4">
                <TabsList className="bg-white/5 border border-white/5">
                  <TabsTrigger value="details" className="text-xs data-[state=active]:bg-white/10">Details</TabsTrigger>
                  <TabsTrigger value="dependencies" className="text-xs data-[state=active]:bg-white/10">Dependencies</TabsTrigger>
                  <TabsTrigger value="subtasks" className="text-xs data-[state=active]:bg-white/10">
                    Subtasks {task.subtasks?.length ? `(${task.subtasks.length})` : ''}
                  </TabsTrigger>
                  <TabsTrigger value="checklist" className="text-xs data-[state=active]:bg-white/10">
                    Checklist {(task as any).checklist_items?.length ? `(${(task as any).checklist_items.length})` : ''}
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="text-xs data-[state=active]:bg-white/10">
                    Comments {(task as any).comments?.length ? `(${(task as any).comments.length})` : ''}
                  </TabsTrigger>
                </TabsList>

                {/* Details / Channel Fields */}
                <TabsContent value="details" className="mt-4 space-y-4">
                  {isFrozen && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg flex items-center justify-between text-xs mb-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span>This tracker has been frozen (45 days elapsed since campaign went live).</span>
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAdminOverride(!adminOverride)}
                          className="border-red-500/30 hover:bg-red-500/20 text-red-400 h-7"
                        >
                          {adminOverride ? 'Disable Override' : 'Admin Override'}
                        </Button>
                      )}
                    </div>
                  )}

                  {incompleteDeps.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-lg flex items-start gap-2.5 text-xs mb-4">
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

                  {/* Planning Fields */}
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Planning Fields</h4>
                    <ChannelFields
                      channelSlug={task.channel?.slug || ''}
                      parentChannelSlug={(task.channel as any)?.parent_channel?.slug}
                      surface="planning"
                      values={task.planning_fields}
                      onChange={(fields: Record<string, unknown>) => handleFieldUpdate('planning_fields', fields)}
                    />
                  </div>

                  {/* Tracker Fields */}
                  {showTrackerFields && (
                    <div>
                      <Separator className="bg-white/5 my-4" />
                      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Tracker Fields</h4>
                      <ChannelFields
                        channelSlug={task.channel?.slug || ''}
                        parentChannelSlug={(task.channel as any)?.parent_channel?.slug}
                        surface="tracker"
                        values={task.tracker_fields}
                        onChange={(fields: Record<string, unknown>) => handleFieldUpdate('tracker_fields', fields)}
                        disabled={isFieldDisabled}
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
                          <div key={dep.id} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[dep.depends_on_task?.priority as TaskPriority] || '#3b82f6' }} />
                              <div className="text-sm">
                                {onTaskIdChange ? (
                                  <button
                                    onClick={() => onTaskIdChange(dep.depends_on_task_id)}
                                    className="text-zinc-300 font-medium hover:underline hover:text-blue-400 text-left"
                                  >
                                    {dep.depends_on_task?.title}
                                  </button>
                                ) : (
                                  <span className="text-zinc-300 font-medium">{dep.depends_on_task?.title}</span>
                                )}
                                <Badge className="ml-2 text-[9px] border-0" style={{
                                  backgroundColor: STATUS_CONFIG[dep.depends_on_task?.status as TaskStatus]?.bgColor + '20',
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
                              className="text-zinc-500 hover:text-red-400 p-1 h-auto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">No task dependencies defined</p>
                      )}
                    </div>

                    <Separator className="bg-white/5 my-4" />

                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Blocks (Successors)</h4>
                    <div className="space-y-2 mb-4">
                      {blocks && blocks.length > 0 ? (
                        blocks.map(block => (
                          <div key={block.id} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[block.blocked_task?.priority as TaskPriority] || '#3b82f6' }} />
                              <div className="text-sm">
                                {onTaskIdChange ? (
                                  <button
                                    onClick={() => onTaskIdChange(block.task_id)}
                                    className="text-zinc-300 font-medium hover:underline hover:text-blue-400 text-left"
                                  >
                                    {block.blocked_task?.title}
                                  </button>
                                ) : (
                                  <span className="text-zinc-300 font-medium">{block.blocked_task?.title}</span>
                                )}
                                <Badge className="ml-2 text-[9px] border-0" style={{
                                  backgroundColor: STATUS_CONFIG[block.blocked_task?.status as TaskStatus]?.bgColor + '20',
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

                    <Separator className="bg-white/5 my-4" />

                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Add Dependency</h4>
                    <div className="space-y-2">
                      <Input
                        value={depSearch}
                        onChange={e => setDepSearch(e.target.value)}
                        placeholder="Search tasks by title..."
                        className="bg-white/5 border-white/10 text-sm h-9"
                      />
                      {depSearch.trim() && eligibleTasks.length > 0 && (
                        <div className="bg-[#12121a] border border-white/10 rounded-lg overflow-hidden divide-y divide-white/5 max-h-48 overflow-y-auto">
                          {eligibleTasks.map(t => (
                            <div
                              key={t.id}
                              onClick={() => { handleAddDependency(t.id); setDepSearch('') }}
                              className="flex items-center justify-between px-3 py-2 hover:bg-white/5 cursor-pointer text-xs transition-colors"
                            >
                              <span className="text-zinc-300 truncate mr-2">{t.title}</span>
                              <Badge variant="outline" className="text-[9px] border-white/10 text-zinc-500 shrink-0">
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
                <TabsContent value="subtasks" className="mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCreateSubtaskOpen(true)}
                    className="mb-3 border-white/10 text-zinc-300 hover:bg-white/5"
                    disabled={task.nesting_level >= 2}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Subtask
                  </Button>
                  {task.nesting_level >= 2 && (
                    <p className="text-xs text-zinc-600 mb-2">Max nesting depth (3 levels) reached</p>
                  )}
                  <div className="space-y-2">
                    {task.subtasks?.map(sub => (
                      <div key={sub.id} className="flex items-center gap-3 bg-white/[0.03] rounded-lg px-3 py-2.5 border border-white/5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[sub.priority] }} />
                        {onTaskIdChange ? (
                          <button
                            onClick={() => onTaskIdChange(sub.id)}
                            className="text-sm text-zinc-300 flex-1 text-left hover:text-blue-400 hover:underline truncate"
                          >
                            {sub.title}
                          </button>
                        ) : (
                          <span className="text-sm text-zinc-300 flex-1 truncate">{sub.title}</span>
                        )}
                        <Badge
                          className="text-[10px] border-0"
                          style={{
                            backgroundColor: STATUS_CONFIG[sub.status].bgColor + '30',
                            color: STATUS_CONFIG[sub.status].color,
                          }}
                        >
                          {STATUS_CONFIG[sub.status].label}
                        </Badge>
                      </div>
                    ))}
                    {(!task.subtasks || task.subtasks.length === 0) && (
                      <p className="text-sm text-zinc-600 py-4 text-center">No subtasks yet</p>
                    )}
                  </div>
                </TabsContent>

                {/* Checklist */}
                <TabsContent value="checklist" className="mt-4">
                  <div className="space-y-2 mb-3">
                    {((task as any).checklist_items || []).map((item: any) => (
                      <div key={item.id} className="flex items-center gap-3 group">
                        <Checkbox
                          checked={item.is_done}
                          onCheckedChange={(checked) => handleToggleChecklist(item.id, !!checked)}
                          className="border-white/20 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                        />
                        <span className={cn(
                          'text-sm flex-1',
                          item.is_done ? 'text-zinc-600 line-through' : 'text-zinc-300'
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
                          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity"
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
                      className="bg-white/5 border-white/10 text-sm"
                      onKeyDown={e => e.key === 'Enter' && handleAddChecklist()}
                    />
                    <Button size="sm" onClick={handleAddChecklist} disabled={isPending} className="bg-white/10 hover:bg-white/15 text-white shrink-0">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </TabsContent>

                {/* Comments */}
                <TabsContent value="comments" className="mt-4">
                  <div className="space-y-4 mb-4 max-h-64 overflow-y-auto">
                    {((task as any).comments || []).map((comment: any) => (
                      <div key={comment.id} className="flex gap-3">
                        <Avatar className="w-7 h-7 shrink-0">
                          <AvatarImage src={comment.user?.avatar_url || ''} />
                          <AvatarFallback className="bg-zinc-700 text-[10px]">{comment.user?.display_name?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-zinc-300">{comment.user?.display_name}</span>
                            <span className="text-[11px] text-zinc-600">{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}</span>
                          </div>
                          <p className="text-sm text-zinc-400 mt-0.5">{comment.body}</p>
                        </div>
                      </div>
                    ))}
                    {(!(task as any).comments || (task as any).comments.length === 0) && (
                      <p className="text-sm text-zinc-600 py-4 text-center">No comments yet</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      placeholder="Add a comment... (use @email to mention)"
                      className="bg-white/5 border-white/10 text-sm min-h-[60px]"
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
              <div className="mt-8 pt-4 border-t border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Delete Task
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
