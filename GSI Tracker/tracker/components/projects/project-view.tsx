'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { addDays, format, isBefore, isToday, isTomorrow, parseISO, startOfDay } from 'date-fns'
import {
  CalendarDays, Check, ChevronDown, ChevronRight, ExternalLink, Folder, FolderOpen, Inbox, Plus, Search, Sun,
} from 'lucide-react'
import { useChannels, useCurrentUser, useMyBadges, useTasks } from '@/lib/hooks/use-data'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { createTask, updateTask } from '@/lib/actions'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { PRIORITY_COLORS, STATUS_CONFIG, STATUS_DOT, type Channel, type Task, type TaskPriority } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// Projects: a Todoist-style to-do list. Every channel is a project. Pick one
// on the left (or My tasks / Today), tick tasks off with the round checkbox,
// and add a task with one line. Click a task for its full details.

type ViewId = 'mine' | 'today' | string

const PRIORITY_LABEL: Record<TaskPriority, string> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low', P4: 'Backlog' }
const day = (d: string) => startOfDay(parseISO(d))

function dueLabel(due: string | null) {
  if (!due) return null
  const d = day(due)
  if (isToday(d)) return { text: 'Today', cls: 'text-emerald-700' }
  if (isTomorrow(d)) return { text: 'Tomorrow', cls: 'text-amber-700' }
  if (isBefore(d, startOfDay(new Date()))) return { text: format(d, 'd MMM'), cls: 'text-red-600 font-medium' }
  return { text: format(d, 'd MMM'), cls: 'text-zinc-500' }
}

export function ProjectView() {
  const router = useRouter()
  const params = useSearchParams()
  const view: ViewId = params.get('p') || 'mine'
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const { verticals } = useVertical()
  const badges = useMyBadges()
  const { data: channels } = useChannels('all')
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showDone, setShowDone] = useState(false)

  const go = (p: ViewId) => router.replace(`/projects/?p=${encodeURIComponent(p)}`)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] })

  const active = (channels || []).filter(c => c.is_active)
  const byId = useMemo(() => new Map(active.map(c => [c.id, c])), [active])
  const project = view !== 'mine' && view !== 'today' ? byId.get(view) : undefined
  const topLevel = (t: Task) => !t.parent_task_id
  const isMine = (t: Task) => !!me && (t.assignments?.some(a => a.user_id === me.id) ||
    !!t.pending_assignments?.some(p => p.email.toLowerCase() === me.email.toLowerCase()))
  // A parent project's count includes its sub-projects' open tasks.
  const openCount = (chId: string) => {
    const ids = new Set([chId, ...active.filter(c => c.parent_channel_id === chId).map(c => c.id)])
    return (tasks || []).filter(t => topLevel(t) && ids.has(t.channel_id) && t.status !== 'done' && t.status !== 'cancelled').length
  }

  const list = useMemo(() => {
    const all = (tasks || []).filter(t => topLevel(t) && t.status !== 'cancelled')
    if (view === 'mine') return all.filter(isMine)
    if (view === 'today') return all.filter(t => isMine(t) && t.due_date && !isBefore(startOfDay(new Date()), day(t.due_date)))
    return all.filter(t => t.channel_id === view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, view, me])

  const open = list.filter(t => t.status !== 'done')
  const done = list.filter(t => t.status === 'done')

  // Sections: a project groups by status; My tasks/Today group by due date.
  const sections: { key: string; title: string; tone?: string; items: Task[] }[] = useMemo(() => {
    const sortDue = (a: Task, b: Task) => (a.due_date || '9999').localeCompare(b.due_date || '9999')
    if (project) {
      return [
        { key: 'blocked', title: 'Blocked', tone: 'text-red-600', items: open.filter(t => t.status === 'blocked').sort(sortDue) },
        { key: 'doing', title: 'In progress', tone: 'text-amber-700', items: open.filter(t => t.status === 'in_progress' || t.status === 'live').sort(sortDue) },
        { key: 'todo', title: 'To do', items: open.filter(t => t.status === 'not_started').sort(sortDue) },
      ]
    }
    const today = startOfDay(new Date())
    return [
      { key: 'overdue', title: 'Overdue', tone: 'text-red-600', items: open.filter(t => t.due_date && isBefore(day(t.due_date), today)).sort(sortDue) },
      { key: 'today', title: 'Today', tone: 'text-emerald-700', items: open.filter(t => t.due_date && isToday(day(t.due_date))) },
      { key: 'soon', title: 'Next 7 days', items: open.filter(t => t.due_date && isBefore(today, day(t.due_date)) && isBefore(day(t.due_date), addDays(today, 8))).sort(sortDue) },
      { key: 'later', title: 'Later', items: open.filter(t => t.due_date && !isBefore(day(t.due_date), addDays(today, 8))).sort(sortDue) },
      { key: 'nodate', title: 'No due date', items: open.filter(t => !t.due_date) },
    ]
  }, [open, project])

  const toggleDone = async (t: Task) => {
    try {
      await updateTask(t.id, { status: t.status === 'done' ? 'not_started' : 'done' })
      refresh()
      if (t.status !== 'done') toast.success(`Done: ${t.title}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update the task') }
  }

  const chPath = (c: Channel) => {
    const parent = c.parent_channel_id ? byId.get(c.parent_channel_id) : null
    return `${verticals.find(v => v.id === c.vertical_id)?.name || ''}${parent ? ` › ${parent.name}` : ''}`
  }

  // ---------- left: project list ----------
  const q = search.trim().toLowerCase()
  const mineProjects = active.filter(c => badges.effectiveChannelIds.has(c.id))
  const tree = verticals.map(v => ({
    v, tops: active.filter(c => c.vertical_id === v.id && !c.parent_channel_id).sort((a, b) => a.sort_order - b.sort_order),
  })).filter(g => g.tops.length)
  const matchesSearch = (c: Channel) => !q || c.name.toLowerCase().includes(q)

  const ProjectLink = ({ c, depth = 0 }: { c: Channel; depth?: number }) => {
    const subs = active.filter(s => s.parent_channel_id === c.id).sort((a, b) => a.sort_order - b.sort_order)
    const isOpen = expanded[c.id] || subs.some(s => s.id === view) || !!q
    const n = openCount(c.id)
    return (
      <div>
        <div className={cn('group flex items-center rounded-md', view === c.id ? 'bg-white ring-1 ring-zinc-200' : 'hover:bg-zinc-100')} style={{ paddingLeft: depth * 14 }}>
          {subs.length ? (
            <button onClick={() => setExpanded(x => ({ ...x, [c.id]: !isOpen }))} className="p-1 text-zinc-400 hover:text-zinc-700" aria-label={isOpen ? 'Collapse' : 'Expand'}>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : <span className="w-[22px]" />}
          <button onClick={() => go(c.id)} className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pr-2 text-left">
            {view === c.id ? <FolderOpen className="w-3.5 h-3.5 text-orange-500 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
            <span className={cn('truncate text-[13px]', view === c.id ? 'text-zinc-900 font-medium' : 'text-zinc-700')}>{c.name}</span>
            {n > 0 && <span className="ml-auto text-[11px] text-zinc-400">{n}</span>}
          </button>
        </div>
        {isOpen && subs.filter(s => matchesSearch(s) || matchesSearch(c)).map(s => <ProjectLink key={s.id} c={s} depth={depth + 1} />)}
      </div>
    )
  }

  const title = view === 'mine' ? 'My tasks' : view === 'today' ? 'Today' : project?.name || 'Project'
  const subtitle = view === 'mine' ? 'Everything assigned to you, across every project.'
    : view === 'today' ? 'What’s due today, plus anything overdue.'
    : project ? chPath(project) : ''

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-white">
      <aside className="hidden md:flex w-80 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
        <div className="p-3 space-y-0.5 border-b border-zinc-200">
          {([['mine', 'My tasks', Inbox], ['today', 'Today', Sun]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => go(id)}
              className={cn('w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', view === id ? 'bg-white ring-1 ring-zinc-200 text-zinc-900 font-medium' : 'text-zinc-700 hover:bg-zinc-100')}>
              <Icon className={cn('w-4 h-4', id === 'today' ? 'text-emerald-600' : 'text-blue-600')} /> {label}
              <span className="ml-auto text-[11px] text-zinc-400">
                {(tasks || []).filter(t => topLevel(t) && isMine(t) && t.status !== 'done' && t.status !== 'cancelled' && (id === 'mine' || (t.due_date && !isBefore(startOfDay(new Date()), day(t.due_date))))).length || ''}
              </span>
            </button>
          ))}
        </div>
        <div className="p-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a project"
              className="w-full h-8 rounded-md border border-zinc-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-orange-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-5">
          {mineProjects.length > 0 && !q && (
            <div>
              <p className="brand-label text-zinc-500 px-2 mb-1">My projects</p>
              {mineProjects.map(c => (
                <button key={c.id} onClick={() => go(c.id)} className={cn('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left', view === c.id ? 'bg-white ring-1 ring-zinc-200' : 'hover:bg-zinc-100')}>
                  <Folder className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="truncate text-[13px] text-zinc-800">{c.name}</span>
                  <span className="ml-auto text-[11px] text-zinc-400 truncate max-w-[40%]">{chPath(c)}</span>
                </button>
              ))}
            </div>
          )}
          {tree.map(({ v, tops }) => {
            const shown = tops.filter(c => matchesSearch(c) || active.some(s => s.parent_channel_id === c.id && matchesSearch(s)))
            if (!shown.length) return null
            return (
              <div key={v.id}>
                <p className="brand-label text-zinc-500 px-2 mb-1">{v.name}</p>
                {shown.map(c => <ProjectLink key={c.id} c={c} />)}
              </div>
            )
          })}
          {!tree.length && <p className="px-2 text-xs text-zinc-500">No projects yet. Admins add channels in Workspace settings › Channels &amp; structure.</p>}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8 pl-16 md:pl-10">
          {/* Mobile project picker */}
          <select value={view} onChange={e => go(e.target.value)} className="md:hidden mb-4 h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm">
            <option value="mine">My tasks</option>
            <option value="today">Today</option>
            {active.map(c => <option key={c.id} value={c.id}>{chPath(c)} › {c.name}</option>)}
          </select>

          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
              <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p>
            </div>
            {project && (
              <Link href={withVertical('/channel/', verticals.find(v => v.id === project.vertical_id)?.slug || 'all', { id: project.id })}
                className="shrink-0 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 mt-2">
                <ExternalLink className="w-3.5 h-3.5" /> Channel details
              </Link>
            )}
          </div>

          <div className="mt-6">
            <QuickAdd projectId={project?.id} projects={active} chPath={chPath} meId={me?.id} onAdded={refresh} key={view} />
          </div>

          {isLoading ? (
            <div className="mt-8 space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-10 rounded-md bg-zinc-100 animate-pulse" />)}</div>
          ) : (
            <div className="mt-6 space-y-7">
              {sections.filter(s => s.items.length).map(s => (
                <section key={s.key}>
                  <h2 className={cn('text-sm font-semibold border-b border-zinc-200 pb-1.5 mb-1', s.tone || 'text-zinc-900')}>
                    {s.title} <span className="font-normal text-zinc-400 ml-1">{s.items.length}</span>
                  </h2>
                  <div className="divide-y divide-zinc-100">
                    {s.items.map(t => <TaskRow key={t.id} t={t} showProject={!project} chPath={chPath} byId={byId} onToggle={toggleDone} onOpen={setOpenTaskId} />)}
                  </div>
                </section>
              ))}
              {!open.length && (
                <div className="py-14 text-center">
                  <Check className="w-10 h-10 mx-auto text-emerald-500" />
                  <p className="mt-3 text-sm font-medium text-zinc-900">{list.length ? 'All done here.' : 'Nothing here yet.'}</p>
                  <p className="text-sm text-zinc-500">Add a task above — just type what needs doing and press Enter.</p>
                </div>
              )}
              {done.length > 0 && (
                <section>
                  <button onClick={() => setShowDone(s => !s)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
                    {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Completed <span className="text-zinc-400">{done.length}</span>
                  </button>
                  {showDone && (
                    <div className="mt-1 divide-y divide-zinc-100">
                      {done.slice(0, 50).map(t => <TaskRow key={t.id} t={t} showProject={!project} chPath={chPath} byId={byId} onToggle={toggleDone} onOpen={setOpenTaskId} />)}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      {openTaskId && (
        <TaskDetailDrawer taskId={openTaskId} open={!!openTaskId}
          onOpenChange={o => { if (!o) setOpenTaskId(null) }} onTaskIdChange={setOpenTaskId} />
      )}
    </div>
  )
}

function TaskRow({ t, showProject, chPath, byId, onToggle, onOpen }: {
  t: Task
  showProject: boolean
  chPath: (c: Channel) => string
  byId: Map<string, Channel>
  onToggle: (t: Task) => void
  onOpen: (id: string) => void
}) {
  const done = t.status === 'done'
  const due = dueLabel(t.due_date)
  const color = PRIORITY_COLORS[t.priority] || '#8A857C'
  const owner = t.assignments?.find(a => a.role === 'primary')?.user || t.assignments?.[0]?.user
  const ch = byId.get(t.channel_id)
  return (
    <div className="group flex items-start gap-3 py-2.5 cursor-pointer" onClick={() => onOpen(t.id)}>
      <button
        onClick={e => { e.stopPropagation(); onToggle(t) }}
        aria-label={done ? `Mark “${t.title}” not done` : `Complete “${t.title}”`}
        title={`${PRIORITY_LABEL[t.priority]} priority — click to ${done ? 'reopen' : 'complete'}`}
        className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
        style={{ borderColor: color, backgroundColor: done ? color : `${color}14` }}
      >
        <Check className={cn('w-3 h-3', done ? 'text-white' : 'opacity-0 group-hover:opacity-60')} style={done ? undefined : { color }} />
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm leading-snug', done ? 'text-zinc-400 line-through' : 'text-zinc-900')}>{t.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          {due && <span className={cn('inline-flex items-center gap-1', done ? 'text-zinc-400' : due.cls)}><CalendarDays className="w-3 h-3" /> {due.text}</span>}
          {!done && (
            <span className="inline-flex items-center gap-1.5 text-zinc-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_DOT[t.status] }} /> {STATUS_CONFIG[t.status].label}
            </span>
          )}
          {showProject && ch && <span className="inline-flex items-center gap-1 text-zinc-400"><Folder className="w-3 h-3" /> {ch.name} <span className="hidden sm:inline">· {chPath(ch)}</span></span>}
        </div>
      </div>
      {owner && (
        <span title={owner.display_name || owner.email} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-medium text-white">
          {(owner.display_name || owner.email).charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}

function QuickAdd({ projectId, projects, chPath, meId, onAdded }: {
  projectId?: string
  projects: Channel[]
  chPath: (c: Channel) => string
  meId?: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('P2')
  const [target, setTarget] = useState(projectId || '')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!title.trim()) return
    const channel = projectId || target
    if (!channel) { toast.error('Pick which project this task goes in'); return }
    setBusy(true)
    try {
      await createTask({ channel_id: channel, title: title.trim(), priority, due_date: due || undefined, assignments: meId ? [{ user_id: meId, role: 'primary' }] : [] })
      setTitle(''); setDue(''); setPriority('P2')
      onAdded()
      inputRef.current?.focus()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add the task') }
    finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
        className="group flex w-full items-center gap-3 py-1.5 text-sm text-zinc-500 hover:text-orange-600">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-orange-500 group-hover:bg-orange-500 group-hover:text-white"><Plus className="w-4 h-4" /></span>
        Add task
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-3 shadow-sm focus-within:border-zinc-400">
      <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } if (e.key === 'Escape') setOpen(false) }}
        placeholder="What needs doing? Press Enter to add" className="w-full border-0 bg-transparent text-sm font-medium outline-none placeholder:text-zinc-400" />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 h-7 text-xs text-zinc-600">
          <CalendarDays className="w-3.5 h-3.5" />
          <input type="date" value={due} onChange={e => setDue(e.target.value)} className="bg-transparent outline-none text-xs" aria-label="Due date" />
        </label>
        <div className="inline-flex rounded-md border border-zinc-200 overflow-hidden">
          {(['P0', 'P1', 'P2', 'P3'] as const).map(p => (
            <button key={p} type="button" onClick={() => setPriority(p)} title={`${PRIORITY_LABEL[p]} priority`}
              className={cn('h-7 px-2 text-xs inline-flex items-center gap-1', priority === p ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-50')}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] }} /> {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
        {!projectId && (
          <select value={target} onChange={e => setTarget(e.target.value)} className="h-7 max-w-[14rem] rounded-md border border-zinc-200 bg-white px-1.5 text-xs text-zinc-700">
            <option value="">Which project?</option>
            {projects.map(c => <option key={c.id} value={c.id}>{c.name} · {chPath(c)}</option>)}
          </select>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2 border-t border-zinc-100 pt-2.5">
        <button onClick={() => { setOpen(false); setTitle('') }} className="h-8 rounded-md px-3 text-xs text-zinc-600 hover:bg-zinc-100">Cancel</button>
        <button onClick={submit} disabled={busy || !title.trim()} className="h-8 rounded-md bg-orange-500 px-3 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">Add task</button>
      </div>
    </div>
  )
}
