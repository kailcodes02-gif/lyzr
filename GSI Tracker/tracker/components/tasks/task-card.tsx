'use client'

import { type Task, STATUS_CONFIG, PRIORITY_COLORS } from '@/lib/types/database'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Calendar, MessageSquare, CheckSquare, Layers } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

interface TaskCardProps {
  task: Task
  onClick?: () => void
  compact?: boolean
}

interface TaskRowProps extends TaskCardProps {
  showChannelColumn?: boolean
  // When provided, renders a leading selection checkbox (bulk operations).
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
}

export function TaskCard({ task, onClick, compact }: TaskCardProps) {
  const statusConfig = STATUS_CONFIG[task.status]
  const priorityColor = PRIORITY_COLORS[task.priority]
  const assignments = task.assignments || []
  const subtaskCount = task.subtasks?.length || 0
  const checklistCount = (task as unknown as { checklist_items?: unknown[] }).checklist_items?.length || 0

  return (
    <div
      onClick={onClick}
      className={cn(
        'group bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-xl p-4 cursor-pointer transition-all duration-200',
        'hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5',
        compact && 'p-3'
      )}
    >
      {/* Priority dot + Title */}
      <div className="flex items-start gap-2.5">
        <Tooltip>
          <TooltipTrigger>
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
              style={{ backgroundColor: priorityColor }}
            />
          </TooltipTrigger>
          <TooltipContent side="left" className="bg-zinc-800 text-xs">
            {task.priority}
          </TooltipContent>
        </Tooltip>
        <h3 className={cn(
          'font-medium text-white/90 group-hover:text-white leading-snug flex-1',
          compact ? 'text-sm' : 'text-[15px]'
        )}>
          {task.title}
        </h3>
      </div>

      {/* Description preview */}
      {!compact && task.description && (
        <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2 ml-5">
          {task.description}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center justify-between mt-3 ml-5">
        <div className="flex items-center gap-3 text-zinc-500">
          {task.due_date && (
            <span className={cn(
              'flex items-center gap-1 text-xs',
              new Date(task.due_date) < new Date() && task.status !== 'done' && task.status !== 'cancelled'
                ? 'text-red-400'
                : ''
            )}>
              <Calendar className="w-3 h-3" />
              {new Date(task.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {subtaskCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <Layers className="w-3 h-3" />
              {subtaskCount}
            </span>
          )}
        </div>

        {/* Assignees */}
        <div className="flex -space-x-2">
          {assignments.slice(0, 3).map((a) => (
            <Tooltip key={a.user_id}>
              <TooltipTrigger>
                <Avatar className="w-6 h-6 border-2 border-[#0a0a0f]">
                  <AvatarImage src={a.user?.avatar_url || ''} />
                  <AvatarFallback className="bg-zinc-700 text-[10px] text-white">
                    {a.user?.display_name?.charAt(0) || '?'}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-zinc-800 text-xs">
                {a.user?.display_name} ({a.role})
              </TooltipContent>
            </Tooltip>
          ))}
          {assignments.length > 3 && (
            <div className="w-6 h-6 rounded-full bg-zinc-700 border-2 border-[#0a0a0f] flex items-center justify-center text-[10px] text-zinc-300">
              +{assignments.length - 3}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Table row version
export function TaskRow({ task, onClick, selectable, selected, onSelectChange }: TaskRowProps) {
  const statusConfig = STATUS_CONFIG[task.status]
  const priorityColor = PRIORITY_COLORS[task.priority]
  const assignments = task.assignments || []

  return (
    <tr
      onClick={onClick}
      className={cn(
        'group cursor-pointer hover:bg-white/[0.03] transition-colors border-b border-white/5',
        selected && 'bg-blue-500/10 hover:bg-blue-500/[0.15]'
      )}
    >
      {selectable && (
        <td className="py-3 pl-4 pr-0 w-8" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={!!selected}
            onCheckedChange={checked => onSelectChange?.(!!checked)}
            className="border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
            aria-label={`Select task ${task.title}`}
          />
        </td>
      )}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: priorityColor }}
          />
          <span className="text-sm text-white/90 group-hover:text-white">{task.title}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <Badge
          variant="outline"
          className="text-[11px] font-medium border-0"
          style={{
            backgroundColor: statusConfig.bgColor + '20',
            color: statusConfig.color,
          }}
        >
          {statusConfig.label}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <div className="flex -space-x-1.5">
          {assignments.slice(0, 3).map((a) => (
            <Avatar key={a.user_id} className="w-6 h-6 border-2 border-[#0a0a0f]">
              <AvatarImage src={a.user?.avatar_url || ''} />
              <AvatarFallback className="bg-zinc-700 text-[10px]">
                {a.user?.display_name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-zinc-500">
        {task.due_date
          ? new Date(task.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          : '-'}
      </td>
      <td className="py-3 px-4 text-xs text-zinc-500">
        {task.channel?.name || '-'}
      </td>
    </tr>
  )
}
