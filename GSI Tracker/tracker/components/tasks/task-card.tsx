'use client'

import { type Task, type TaskStatus, STATUS_CONFIG, PRIORITY_COLORS, GRADE_STAR } from '@/lib/types/database'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Calendar, MessageSquare, CheckSquare, Layers, DollarSign, Target, Repeat, Crown, Link as LinkIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { useAllChannelOwners } from '@/lib/hooks/use-data'
import { updateTask } from '@/lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// ---- Owner resolution with inheritance --------------------------------------
// A task's effective owners: its own assignees (signed-in + pending emails).
// If none: inherit from parent activity; if still none: the sub-channel's
// owners; then the channel's owners.
export type OwnerEntry = { key: string; label: string; avatar?: string | null; primary: boolean; pending: boolean }

export function ownEntries(task: Partial<Task>): OwnerEntry[] {
  const real = (task.assignments || []).map(a => ({
    key: a.user_id, label: a.user?.display_name || a.user?.email?.split('@')[0] || '?',
    avatar: a.user?.avatar_url, primary: a.role === 'primary', pending: false,
  }))
  const pend = (task.pending_assignments || []).filter(p => !p.resolved_user_id).map(p => ({
    key: p.email, label: p.email.split('@')[0], primary: p.role === 'primary', pending: true,
  }))
  return [...real, ...pend].sort((a, b) => Number(b.primary) - Number(a.primary))
}

function OwnerBadges({ entries, inherited, tiny }: { entries: OwnerEntry[]; inherited: boolean; tiny?: boolean }) {
  if (!entries.length) return <span className="text-[10px] text-zinc-400 italic">Unassigned</span>
  const size = tiny ? 'w-5 h-5' : 'w-6 h-6'
  return (
    <div className={cn('flex items-center -space-x-1.5', inherited && 'opacity-70')}
      title={inherited ? 'Inherited from channel owners' : undefined}>
      {entries.slice(0, 4).map(e => (
        <Tooltip key={e.key}>
          <TooltipTrigger>
            <Avatar className={cn(size, 'border-2 border-white', e.primary && 'ring-1 ring-amber-400', inherited && 'border-dashed')}>
              {e.avatar && <AvatarImage src={e.avatar} />}
              <AvatarFallback className={cn('text-[10px] capitalize', e.pending ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-300 text-zinc-800')}>
                {e.label.charAt(0)}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs capitalize">
            {e.label} · {e.primary ? 'primary' : 'secondary'}{e.pending ? ' · not signed in' : ''}{inherited ? ' · via channel' : ''}
          </TooltipContent>
        </Tooltip>
      ))}
      {entries.length > 4 && (
        <div className={cn(size, 'rounded-full bg-zinc-200 border-2 border-white flex items-center justify-center text-[10px] text-zinc-600')}>
          +{entries.length - 4}
        </div>
      )}
    </div>
  )
}

// Inline status action — change status right on the card, no drawer needed
function StatusQuickSelect({ task }: { task: Task }) {
  const queryClient = useQueryClient()
  return (
    <select
      value={task.status}
      onClick={e => e.stopPropagation()}
      onChange={async e => {
        const status = e.target.value as TaskStatus
        try {
          await updateTask(task.id, { status })
          queryClient.invalidateQueries({ queryKey: ['tasks'] })
          toast.success(`Moved to ${STATUS_CONFIG[status].label}`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to update status')
        }
      }}
      className="text-[10px] font-medium rounded-md border border-zinc-300 bg-white px-1 py-0.5 shrink-0 cursor-pointer"
      style={{ color: STATUS_CONFIG[task.status].color }}
    >
      {Object.entries(STATUS_CONFIG).map(([k, c]) => (
        <option key={k} value={k}>{c.label}</option>
      ))}
    </select>
  )
}

interface TaskCardProps {
  task: Task
  onClick?: () => void
  compact?: boolean
  onSubtaskClick?: (sub: Task) => void
}

// GTM blueprint star grade (gold/silver/bronze), stored in planning_fields
function GradeStar({ task }: { task: Task }) {
  const grade = (task.planning_fields as Record<string, unknown> | null)?.grade as string | undefined
  if (!grade || !GRADE_STAR[grade]) return null
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className={cn('text-sm leading-none shrink-0', GRADE_STAR[grade])} aria-label={`${grade} star`}>★</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs capitalize">
        {grade} activity
      </TooltipContent>
    </Tooltip>
  )
}

interface TaskRowProps extends TaskCardProps {
  showChannelColumn?: boolean
  // When provided, renders a leading selection checkbox (bulk operations).
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  // Title of the parent activity, for sub-activity rows
  parentLabel?: string
}

// Budget + KPI-target + frequency chips, on both activity and sub-activity cards
function MetaChips({ task, tiny }: { task: Partial<Task>; tiny?: boolean }) {
  const pf = task.planning_fields as Record<string, unknown> | null
  const targetsArr = pf?.targets as { type: string; value: string }[] | undefined
  const target = targetsArr?.length
    ? `${targetsArr[0].type}: ${targetsArr[0].value}${targetsArr.length > 1 ? `  +${targetsArr.length - 1}` : ''}`
    : (pf?.kpi_target as string | undefined)
  const links = (pf?.links as { label: string; url: string }[] | undefined) || []
  const frequency = pf?.frequency as string | undefined
  const budget = task.budget_allocated
  if (!target && !frequency && budget == null && !links.length) return null
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', tiny ? 'mt-1' : 'mt-2')}>
      {budget != null && (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 text-[10px] font-medium" title="Budget">
          <DollarSign className="w-3 h-3" />{Number(budget).toLocaleString()}
        </span>
      )}
      {target && (
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 border border-sky-200 text-sky-700 px-1.5 py-0.5 text-[10px] font-medium max-w-[220px] truncate" title={`Target: ${target}`}>
          <Target className="w-3 h-3 shrink-0" />{target}
        </span>
      )}
      {frequency && (
        <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 px-1.5 py-0.5 text-[10px] font-medium max-w-[160px] truncate" title={`Frequency: ${frequency}`}>
          <Repeat className="w-3 h-3 shrink-0" />{frequency}
        </span>
      )}
      {links.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium" title={links.map(l => l.url).join('\n')}>
          <LinkIcon className="w-3 h-3" />{links.length}
        </span>
      )}
    </div>
  )
}

// Sub-activities rendered as nested mini-cards inside the activity card.
// Owner rule: a sub-activity without its own owners inherits the activity's.
function SubtaskCards({ task, parentOwners, onSubtaskClick }: {
  task: Task
  parentOwners: OwnerEntry[]
  onSubtaskClick?: (sub: Task) => void
}) {
  const subs = task.subtasks || []
  if (!subs.length) return null
  return (
    <div className="mt-3 ml-1 space-y-1.5 border-l-2 border-zinc-200 pl-2.5">
      {subs.map(sub => {
        const own = ownEntries(sub)
        const entries = own.length ? own : parentOwners
        return (
          <div
            key={sub.id}
            onClick={(e) => { e.stopPropagation(); onSubtaskClick?.(sub as Task) }}
            className="rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 px-2.5 py-2 cursor-pointer transition-colors"
          >
            <div className="flex items-start gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                style={{ backgroundColor: STATUS_CONFIG[sub.status]?.color }}
                title={STATUS_CONFIG[sub.status]?.label}
              />
              <p className="text-xs text-zinc-800 leading-snug flex-1">{sub.title}</p>
              <span
                className="text-[9px] font-bold px-1 rounded shrink-0"
                style={{ color: PRIORITY_COLORS[sub.priority] }}
              >
                {sub.priority}
              </span>
            </div>
            {sub.description && (
              <p className="mt-0.5 ml-3 text-[11px] text-zinc-500 line-clamp-2">{sub.description}</p>
            )}
            <div className="ml-3 flex items-end justify-between gap-2">
              <MetaChips task={sub} tiny />
              <div className="mt-1"><OwnerBadges entries={entries} inherited={!own.length} tiny /></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TaskCard({ task, onClick, compact, onSubtaskClick }: TaskCardProps) {
  const priorityColor = PRIORITY_COLORS[task.priority]
  const { data: allChannelOwners } = useAllChannelOwners()

  // Effective owners with inheritance: task -> sub-channel -> channel
  const own = ownEntries(task)
  let entries = own
  let inherited = false
  if (!entries.length && allChannelOwners) {
    const fromChannel = (chId?: string | null) =>
      allChannelOwners.filter(o => o.channel_id === chId)
        .map(o => ({ key: o.email, label: o.email.split('@')[0], primary: o.sort_order <= 0, pending: !o.user_id }))
    entries = fromChannel(task.channel_id)
    if (!entries.length && task.channel?.parent_channel_id) entries = fromChannel(task.channel.parent_channel_id)
    inherited = entries.length > 0
  }

  const overdue = task.due_date && new Date(task.due_date) < new Date()
    && task.status !== 'done' && task.status !== 'cancelled'

  return (
    <div
      onClick={onClick}
      className={cn(
        'group bg-white hover:bg-zinc-50 border border-zinc-200 hover:border-zinc-300 rounded-xl p-3.5 cursor-pointer transition-all duration-200',
        'hover:shadow-lg hover:shadow-zinc-400/30 hover:-translate-y-0.5'
      )}
    >
      {/* Priority pill + star + status action */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
          style={{ backgroundColor: priorityColor + '22', color: priorityColor }}
        >
          {task.priority}
        </span>
        <GradeStar task={task} />
        <span className="flex-1" />
        <StatusQuickSelect task={task} />
      </div>

      {/* Title */}
      <h3 className={cn('font-semibold text-zinc-900 leading-snug', compact ? 'text-sm' : 'text-[15px]')}>
        {task.title}
      </h3>

      {/* Description */}
      {task.description && (
        <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{task.description}</p>
      )}

      {/* Budget / target / frequency chips */}
      <MetaChips task={task} />

      {/* Footer: due date + owners */}
      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-3 text-zinc-500">
          {task.due_date && (
            <span className={cn('flex items-center gap-1 text-xs', overdue && 'text-red-600 font-medium')}>
              <Calendar className="w-3 h-3" />
              {new Date(task.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {(task.subtasks?.length || 0) > 0 && (
            <span className="flex items-center gap-1 text-xs" title="Sub-activities">
              <Layers className="w-3 h-3" />
              {task.subtasks!.length}
            </span>
          )}
        </div>
        <OwnerBadges entries={entries} inherited={inherited} />
      </div>

      {/* Nested sub-activities */}
      <SubtaskCards task={task} parentOwners={entries} onSubtaskClick={onSubtaskClick} />
    </div>
  )
}

// Table row version
export function TaskRow({ task, onClick, selectable, selected, onSelectChange, parentLabel }: TaskRowProps) {
  const statusConfig = STATUS_CONFIG[task.status]
  const priorityColor = PRIORITY_COLORS[task.priority]
  const assignments = task.assignments || []

  return (
    <tr
      onClick={onClick}
      className={cn(
        'group cursor-pointer hover:bg-zinc-100/60 transition-colors border-b border-zinc-200',
        selected && 'bg-blue-50 hover:bg-blue-100'
      )}
    >
      {selectable && (
        <td className="py-3 pl-4 pr-0 w-8" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={!!selected}
            onCheckedChange={checked => onSelectChange?.(!!checked)}
            className="border-zinc-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
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
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-900">{task.title}</span>
              <GradeStar task={task} />
              <Badge variant="outline" className={cn(
                'text-[9px] px-1 py-0 shrink-0',
                task.parent_task_id
                  ? 'border-violet-300 bg-violet-50 text-violet-700'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-500'
              )}>
                {task.parent_task_id ? 'Sub-activity' : 'Activity'}
              </Badge>
            </div>
            {task.parent_task_id && parentLabel && (
              <p className="text-[11px] text-zinc-500 truncate mt-0.5">↳ under {parentLabel}</p>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <Badge
          variant="outline"
          className="text-[11px] font-medium border-0"
          style={{
            backgroundColor: statusConfig.bgColor,
            color: statusConfig.color,
          }}
        >
          {statusConfig.label}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <OwnerBadges entries={ownEntries(task)} inherited={false} tiny />
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
