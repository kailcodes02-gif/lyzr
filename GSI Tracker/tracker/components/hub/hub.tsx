'use client'

// The personal space: everyone's home base, and the page behind their link.
//
//   /u/                  my own page
//   /u/?who=mothilal       Mothilal's page (what his shared link opens)
//   /u/?s=given          tasks I assigned to other people
//   /u/?s=calendar       my calendar
//   /u/?s=people         everyone, with how loaded they are
//
// One layout for all of it. The left rail is always yours (my tasks, assigned
// by me, my calendar, people, the full dashboard); the top bar is your
// notifications in both directions; the centre is the person you are looking
// at. Anyone signed in can open anyone's page and add a task for them.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns'
import {
  Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, LayoutDashboard, Link2, ListTodo, Pencil, Plus, Search, Send, Users, X,
} from 'lucide-react'
import { useCurrentUser, useNotifications, useTasks, useUsers } from '@/lib/hooks/use-data'
import { markAllNotificationsRead, markNotificationsRead, setMyHandle } from '@/lib/actions'
import { PRIORITY_COLORS, STATUS_CONFIG, type Notification, type Task, type TaskPriority, type User } from '@/lib/types/database'
import { askState, awaitingTheirReply, needsMyReply, primaryAssignee, shortDate } from '@/lib/ask'
import { copyText, findPerson, handleOf, personUrl } from '@/lib/person-link'
import { keyFor, usePersisted } from '@/lib/hooks/use-persisted'
import { AskPills, NeedsReplyStrip, PriorityTag } from '@/components/tasks/ask-reply'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'
import { TaskDetailDrawer } from '@/components/tasks/task-detail'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LyzrSail } from '@/components/ui/lyzr-logo'
import { cn } from '@/lib/utils'

type Section = 'tasks' | 'given' | 'calendar' | 'people'
type View = 'priority' | 'calendar' | 'week'

const HIDDEN = new Set(['preview@lyzr.ai', 'preview@lyzr.com'])
const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'cancelled'
const ON_IT = ['primary', 'secondary']
const todayKey = () => format(new Date(), 'yyyy-MM-dd')
const firstName = (u: Pick<User, 'display_name' | 'email'>) => (u.display_name || u.email.split('@')[0]).split(/[ .]/)[0].replace(/^./, c => c.toUpperCase())

// What this person is on a task: assigned to it, contributing, or nothing.
function roleOn(t: Task, u: Pick<User, 'id' | 'email'>): 'assigned' | 'contributing' | null {
  const a = t.assignments?.find(x => x.user_id === u.id)
  if (a) return ON_IT.includes(a.role) ? 'assigned' : 'contributing'
  const p = (t.pending_assignments || []).find(x => !x.resolved_user_id && x.email.toLowerCase() === u.email.toLowerCase())
  if (p) return ON_IT.includes(p.role) ? 'assigned' : 'contributing'
  return null
}

function loadOf(tasks: Task[]) {
  const open = tasks.filter(isOpen)
  const today = todayKey()
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  return {
    open: open.length,
    dueToday: open.filter(t => t.due_date === today).length,
    overdue: open.filter(t => t.due_date && t.due_date < today).length,
    thisWeek: open.filter(t => t.due_date && t.due_date >= today && t.due_date <= weekEnd).length,
    p0: open.filter(t => t.priority === 'P0').length,
    p1: open.filter(t => t.priority === 'P1').length,
    awaiting: open.filter(t => askState(t).awaiting).length,
  }
}

export function Hub() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { data: me } = useCurrentUser()
  const { data: users } = useUsers()
  const { data: tasks, isLoading } = useTasks({ verticalId: 'all' })
  const { data: notifications } = useNotifications()

  const people = useMemo(() => (users || []).filter(u => !HIDDEN.has(u.email.toLowerCase()))
    .sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email)), [users])
  const section = (params.get('s') as Section) || 'tasks'
  const pParam = params.get('who')
  const person = useMemo(() => findPerson(people, pParam) || (pParam ? undefined : me || undefined), [people, pParam, me])
  const isMe = !!person && !!me && person.id === me.id

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [create, setCreate] = useState<null | { forPerson?: { email: string; name: string }; askWho?: boolean; due?: string }>(null)
  const [view, setView] = usePersisted<View>(keyFor(me?.id, 'hub:view'), 'priority')
  const [showDone, setShowDone] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const go = (next: { p?: User | null; s?: Section }) => {
    const qs = new URLSearchParams()
    const target = next.p === null ? null : (next.p || null)
    if (target && target.id !== me?.id) qs.set('who', handleOf(target))
    if (next.s && next.s !== 'tasks') qs.set('s', next.s)
    const str = qs.toString()
    router.push(str ? `/u/?${str}` : '/u/')
    setNotifOpen(false)
  }

  const all = useMemo(() => tasks || [], [tasks])
  const mine = useMemo(() => me ? all.filter(t => roleOn(t, me)) : [], [all, me])
  const needsReply = useMemo(() => all.filter(t => needsMyReply(t, me?.id)), [all, me])
  const given = useMemo(() => me ? all.filter(t => t.created_by === me.id && primaryAssignee(t)?.user_id !== me.id && (t.assignments?.length || (t.pending_assignments || []).some(p => !p.resolved_user_id))) : [], [all, me])
  const awaitingOthers = given.filter(t => awaitingTheirReply(t, me?.id)).length
  const unread = notifications || []

  if (!me || isLoading) {
    return <div className="min-h-screen grid place-items-center bg-zinc-50"><div className="animate-spin w-8 h-8 border-2 border-zinc-300 border-t-violet-500 rounded-full" /></div>
  }

  const openTask = (id: string) => { setSelectedTaskId(id); setNotifOpen(false) }
  const rail: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean; count?: number; tone?: 'amber'; onClick: () => void }[] = [
    { key: 'tasks', label: 'My tasks', icon: ListTodo, active: section === 'tasks' && isMe, count: mine.filter(isOpen).length, onClick: () => go({ p: me }) },
    { key: 'given', label: 'Assigned by me', icon: Send, active: section === 'given', count: awaitingOthers || undefined, tone: 'amber', onClick: () => go({ s: 'given' }) },
    { key: 'calendar', label: 'My calendar', icon: CalendarDays, active: section === 'calendar', onClick: () => go({ s: 'calendar' }) },
    { key: 'people', label: 'People', icon: Users, active: section === 'people' || (section === 'tasks' && !isMe), onClick: () => go({ s: 'people' }) },
  ]

  return (
    <div className="h-screen flex flex-col bg-zinc-50 text-zinc-900 overflow-hidden">
      {/* ---------- top bar: brand + notifications in both directions ---------- */}
      <header className="h-14 shrink-0 flex items-center gap-2 px-3 sm:px-5 bg-white border-b border-zinc-200">
        <LyzrSail className="w-7 h-[18px] shrink-0" />
        <span className="text-sm font-semibold hidden sm:inline">Lyzr Marketing Tracker</span>
        <span className="flex-1" />
        {needsReply.length > 0 && (
          <button onClick={() => go({ p: me })} className="inline-flex items-center gap-1.5 h-8 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-medium px-3 cursor-pointer"
            title="Tasks assigned to you that are waiting for you to accept or propose your own priority and date">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {needsReply.length} need{needsReply.length === 1 ? 's' : ''} your reply
          </button>
        )}
        {awaitingOthers > 0 && (
          <button onClick={() => go({ s: 'given' })} className="hidden sm:inline-flex items-center gap-1.5 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-medium px-3 cursor-pointer"
            title="Tasks you assigned that have not been replied to yet">
            {awaitingOthers} awaiting others
          </button>
        )}
        <div className="relative">
          <button onClick={() => setNotifOpen(o => !o)} aria-label="Notifications"
            className={cn('relative h-9 w-9 grid place-items-center rounded-full hover:bg-zinc-100 cursor-pointer', notifOpen && 'bg-zinc-100')}>
            <Bell className="w-4.5 h-4.5 text-zinc-700" />
            {unread.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-semibold grid place-items-center px-1">{unread.length > 49 ? '49+' : unread.length}</span>}
          </button>
          {notifOpen && (
            <NotificationPanel items={unread} users={users || []} onOpenTask={openTask} onClose={() => setNotifOpen(false)}
              onRead={async ids => { await markNotificationsRead(ids).catch(() => {}); qc.invalidateQueries({ queryKey: ['notifications'] }) }}
              onReadAll={async () => { await markAllNotificationsRead().catch(() => {}); qc.invalidateQueries({ queryKey: ['notifications'] }) }} />
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* ---------- left rail: always yours ---------- */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <div className="px-4 py-4 flex items-center gap-3 border-b border-zinc-100">
            <Avatar className="w-9 h-9"><AvatarImage src={me.avatar_url || ''} /><AvatarFallback className="bg-zinc-900 text-white text-xs">{firstName(me)[0]}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{me.display_name || firstName(me)}</p>
              <p className="text-[11px] text-zinc-500 truncate">My space</p>
            </div>
          </div>
          <nav className="p-2 space-y-0.5">
            {rail.map(r => (
              <button key={r.key} onClick={r.onClick}
                className={cn('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left cursor-pointer transition-colors',
                  r.active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100')}>
                <r.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{r.label}</span>
                {!!r.count && <span className={cn('text-[11px] rounded-full px-1.5 font-medium', r.active ? 'bg-white/20' : r.tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600')}
                  title={r.tone === 'amber' ? 'Awaiting a reply' : 'Open tasks'}>{r.count}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-auto p-3 space-y-2 border-t border-zinc-100">
            <CopyLinkButton person={me} label="Copy my link" full />
            <Link href="/" className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-sm font-medium text-zinc-800">
              <LayoutDashboard className="w-4 h-4" /> Open full dashboard
            </Link>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {/* phone: the rail as a row of tabs */}
          <div className="md:hidden flex gap-1.5 overflow-x-auto px-3 py-2 bg-white border-b border-zinc-200">
            {rail.map(r => (
              <button key={r.key} onClick={r.onClick} className={cn('shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer', r.active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700')}>
                <r.icon className="w-3.5 h-3.5" /> {r.label}{!!r.count && ` · ${r.count}`}
              </button>
            ))}
            <Link href="/" className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-zinc-100 text-zinc-700"><LayoutDashboard className="w-3.5 h-3.5" /> Dashboard</Link>
          </div>

          <div className="max-w-6xl mx-auto p-4 lg:p-8 space-y-5">
            {section === 'people' && <PeopleSection people={people} tasks={all} me={me} onOpen={u => go({ p: u })} />}

            {section === 'given' && (
              <GivenSection tasks={given} people={people} onOpenTask={openTask} onOpenPerson={u => go({ p: u })}
                onNew={() => setCreate({})} />
            )}

            {section === 'calendar' && (
              <>
                <PageTitle title="My calendar" sub="Everything assigned to you, by due date. Click a day to add a task for yourself." />
                <MonthCalendar tasks={mine.filter(t => showDone || isOpen(t))} onOpenTask={openTask} onAdd={due => setCreate({ forPerson: { email: me.email, name: 'me' }, due })} />
              </>
            )}

            {section === 'tasks' && !person && (
              <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
                <p className="text-sm font-medium">Nobody here goes by “{pParam}”.</p>
                <p className="text-xs text-zinc-500 mt-1">The link may be mistyped, or that person has not signed in yet.</p>
                <button onClick={() => go({ s: 'people' })} className="mt-4 h-9 rounded-lg bg-zinc-900 text-white text-sm px-4 cursor-pointer">Find them in People</button>
              </div>
            )}

            {section === 'tasks' && person && (
              <PersonSection key={person.id} person={person} isMe={isMe} me={me} tasks={all} needsReply={isMe ? needsReply : []}
                view={view} setView={setView} showDone={showDone} setShowDone={setShowDone} onOpenTask={openTask}
                onAdd={due => setCreate(isMe ? { askWho: !due, forPerson: due ? { email: me.email, name: 'me' } : undefined, due } : { forPerson: { email: person.email, name: person.display_name || firstName(person) }, due })} />
            )}
          </div>
        </main>
      </div>

      {create && (
        <CreateTaskDialog open onOpenChange={o => { if (!o) setCreate(null) }} forPerson={create.forPerson?.name === 'me' ? undefined : create.forPerson}
          defaultOwnerEmails={create.forPerson?.name === 'me' ? [me.email] : undefined}
          askWho={create.askWho} defaultDueDate={create.due} onSuccess={() => setCreate(null)} />
      )}
      {selectedTaskId && (
        <TaskDetailDrawer taskId={selectedTaskId} open onOpenChange={o => { if (!o) setSelectedTaskId(null) }} onTaskIdChange={setSelectedTaskId} />
      )}
    </div>
  )
}

function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-zinc-500 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function CopyLinkButton({ person, label, full }: { person: User; label: string; full?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={async () => {
      const url = personUrl(person)
      const ok = await copyText(url)
      if (ok) { setDone(true); toast.success('Link copied. Anyone at Lyzr can open it and add a task.'); window.setTimeout(() => setDone(false), 1800) }
      else toast.message('Copy this link', { description: url, duration: 12000 })
    }} className={cn('inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-sm font-medium text-zinc-800 px-3 cursor-pointer', full && 'w-full')}>
      {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {done ? 'Copied' : label}
    </button>
  )
}

// ---------------------------------------------------------------- a person's page

function PersonSection({ person, isMe, me, tasks, needsReply, view, setView, showDone, setShowDone, onOpenTask, onAdd }: {
  person: User; isMe: boolean; me: User; tasks: Task[]; needsReply: Task[]; view: View; setView: (v: View) => void
  showDone: boolean; setShowDone: (b: boolean) => void; onOpenTask: (id: string) => void; onAdd: (due?: string) => void
}) {
  const theirs = useMemo(() => tasks.filter(t => roleOn(t, person)), [tasks, person])
  const shown = theirs.filter(t => showDone || isOpen(t))
  const load = loadOf(theirs)
  const name = firstName(person)
  const [introSeen, setIntroSeen] = usePersisted<boolean>(keyFor(me.id, 'hub:intro-seen'), false)

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="w-14 h-14 border border-zinc-200"><AvatarImage src={person.avatar_url || ''} /><AvatarFallback className="bg-zinc-200 text-zinc-700 text-lg">{name[0]}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight truncate">{isMe ? 'My tasks' : `${person.display_name || name}`}</h1>
          <p className="text-sm text-zinc-500 truncate">{isMe ? 'What is on your plate, and what people are asking of you.' : `What ${name} has on, so you can see where your task would land.`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isMe && <CopyLinkButton person={person} label={`Copy ${name}'s link`} />}
          <button onClick={() => onAdd()} className="inline-flex items-center gap-1.5 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm cursor-pointer">
            <Plus className="w-4 h-4" /> {isMe ? 'New task' : `Add a task for ${name}`}
          </button>
        </div>
      </div>

      {isMe && !introSeen && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-start gap-3">
          <Link2 className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-[14rem]">
            <p className="text-sm font-semibold text-zinc-900">This page has a link you can share</p>
            <p className="text-xs text-zinc-600 mt-0.5">Send it to anyone at Lyzr. They see what you have on and when, and can add a task for you from it. You then accept it or reply with the priority and date that work for you.</p>
            <MyLinkRow me={me} />
          </div>
          <button onClick={() => setIntroSeen(true)} aria-label="Dismiss" className="text-zinc-400 hover:text-zinc-700 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}
      {isMe && introSeen && <MyLinkRow me={me} subtle />}

      <NeedsReplyStrip tasks={needsReply} onOpen={onOpenTask} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat label="Open" value={load.open} />
        <Stat label="Due today" value={load.dueToday} tone={load.dueToday ? 'blue' : undefined} />
        <Stat label="Overdue" value={load.overdue} tone={load.overdue ? 'red' : undefined} />
        <Stat label="This week" value={load.thisWeek} />
        <Stat label="P0 · P1" value={`${load.p0} · ${load.p1}`} tone={load.p0 ? 'red' : undefined} />
        <Stat label="Awaiting reply" value={load.awaiting} tone={load.awaiting ? 'amber' : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
          {([['priority', 'By priority'], ['calendar', 'Calendar'], ['week', 'This week']] as [View, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={cn('px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer', view === k ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900')}>{l}</button>
          ))}
        </div>
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="accent-zinc-900" /> Show finished
        </label>
      </div>

      {view === 'priority' && <PriorityList tasks={shown} person={person} onOpenTask={onOpenTask} empty={isMe ? 'Nothing on your list. Add a task, or wait for someone to send you one.' : `${name} has nothing open. Add the first task.`} />}
      {view === 'calendar' && <MonthCalendar tasks={shown} onOpenTask={onOpenTask} onAdd={onAdd} />}
      {view === 'week' && <WeekBoard tasks={shown} onOpenTask={onOpenTask} onAdd={onAdd} />}
    </>
  )
}

function MyLinkRow({ me, subtle }: { me: User; subtle?: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(handleOf(me))
  const [busy, setBusy] = useState(false)
  const url = personUrl(me)
  const save = async () => {
    setBusy(true)
    try {
      await setMyHandle(val)
      await qc.invalidateQueries({ queryKey: ['currentUser'] }); await qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Link name changed. Your old link no longer works, so share the new one.')
      setEditing(false)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-2', subtle ? 'text-xs' : 'mt-2.5')}>
      {subtle && <span className="text-zinc-500">My link</span>}
      {editing ? (
        <>
          <span className="text-xs text-zinc-500">…/marketing-tracker/?u=</span>
          <input value={val} onChange={e => setVal(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} autoFocus maxLength={30}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            className="h-8 w-40 rounded-md border border-zinc-300 bg-white px-2 text-xs" />
          <button disabled={busy || val.length < 2} onClick={save} className="h-8 rounded-md bg-zinc-900 text-white text-xs px-3 disabled:opacity-50 cursor-pointer">Save</button>
          <button onClick={() => { setEditing(false); setVal(handleOf(me)) }} className="h-8 text-xs text-zinc-600 px-1 cursor-pointer">Cancel</button>
        </>
      ) : (
        <>
          <code className="rounded-md bg-white border border-zinc-200 px-2 py-1 text-xs text-zinc-800 break-all select-all">{url}</code>
          <CopyLinkButton person={me} label="Copy" />
          <button onClick={() => setEditing(true)} title="Change the name at the end of your link" className="inline-flex items-center gap-1 h-9 text-xs text-zinc-600 hover:text-zinc-900 px-1 cursor-pointer"><Pencil className="w-3 h-3" /> Rename</button>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'red' | 'amber' | 'blue' }) {
  return (
    <div className={cn('rounded-xl border bg-white px-3.5 py-3', tone === 'red' ? 'border-red-200' : tone === 'amber' ? 'border-amber-200' : tone === 'blue' ? 'border-blue-200' : 'border-zinc-200')}>
      <p className={cn('text-2xl font-bold leading-none', tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : tone === 'blue' ? 'text-blue-700' : 'text-zinc-900')}>{value}</p>
      <p className="text-[11px] text-zinc-500 mt-1.5">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------- task table: asked vs replied, always

function StatusPill({ t }: { t: Task }) {
  const c = STATUS_CONFIG[t.status]
  return <span className="inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: c.bgColor, color: c.color }}>{c.label}</span>
}

function DueCell({ d, done, diff }: { d: string | null; done?: boolean; diff?: boolean }) {
  const late = !!d && !done && d < todayKey()
  return <span className={cn('text-xs whitespace-nowrap', !d ? 'text-zinc-400' : late ? 'text-red-600 font-medium' : 'text-zinc-800', diff && 'rounded bg-rose-50 px-1 py-0.5')}>{d ? shortDate(d) : '—'}</span>
}

function TaskTable({ tasks, person, onOpenTask, showAssignee }: { tasks: Task[]; person?: User; onOpenTask: (id: string) => void; showAssignee?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
            <th className="font-medium py-2 pl-4 pr-3">Task</th>
            <th className="font-medium py-2 px-3" title="Priority: what was asked, and what the assignee replied">Priority<br /><span className="normal-case tracking-normal text-zinc-400">asked · replied</span></th>
            <th className="font-medium py-2 px-3" title="Due date: what was asked, and what the assignee replied">Due<br /><span className="normal-case tracking-normal text-zinc-400">asked · replied</span></th>
            <th className="font-medium py-2 px-3">Status</th>
            <th className="font-medium py-2 px-3 pr-4">{showAssignee ? 'Assigned to' : 'Assigned by'}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const s = askState(t)
            const role = person ? roleOn(t, person) : null
            const who = showAssignee ? primaryAssignee(t)?.user : t.creator
            const done = !isOpen(t)
            return (
              <tr key={t.id} onClick={() => onOpenTask(t.id)} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 cursor-pointer align-top">
                <td className="py-2.5 pl-4 pr-3">
                  <p className={cn('text-sm font-medium text-zinc-900', done && 'line-through text-zinc-500')}>{t.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <AskPills task={t} />
                    {role === 'contributing' && <span className="rounded-md bg-zinc-100 text-zinc-600 text-[10px] px-1.5 py-0.5">Contributing</span>}
                    {t.channel?.name && t.channel.slug !== 'no-channel' && <span className="text-[11px] text-zinc-500">{t.channel.name}</span>}
                  </div>
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <PriorityTag p={s.askedPriority} muted={s.priorityDiffers} />
                  <span className="text-zinc-300 mx-1.5">·</span>
                  {s.self || !s.tracked ? <PriorityTag p={s.askedPriority} /> : s.replied ? <span className={cn(s.priorityDiffers && 'rounded bg-rose-50 px-1 py-0.5')}><PriorityTag p={s.repliedPriority} /></span> : <span className="text-[11px] text-amber-700">awaiting</span>}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <DueCell d={s.askedDue} done={done} />
                  <span className="text-zinc-300 mx-1.5">·</span>
                  {s.self || !s.tracked ? <DueCell d={s.askedDue} done={done} /> : s.replied ? <DueCell d={s.repliedDue} done={done} diff={s.dueDiffers} /> : <span className="text-[11px] text-amber-700">awaiting</span>}
                </td>
                <td className="py-2.5 px-3"><StatusPill t={t} /></td>
                <td className="py-2.5 px-3 pr-4 text-xs text-zinc-600 whitespace-nowrap">{s.self && !showAssignee ? 'Self-assigned' : who ? firstName(who as User) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const byDue = (a: Task, b: Task) => (a.due_date || '9999').localeCompare(b.due_date || '9999')

function PriorityList({ tasks, person, onOpenTask, empty }: { tasks: Task[]; person: User; onOpenTask: (id: string) => void; empty: string }) {
  if (!tasks.length) return <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">{empty}</div>
  const groups = (['P0', 'P1', 'P2', 'P3', 'P4'] as TaskPriority[]).map(p => ({ p, rows: tasks.filter(t => t.priority === p).sort(byDue) })).filter(g => g.rows.length)
  const names: Record<string, string> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low', P4: 'Backlog' }
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.p} className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-200" style={{ borderLeft: `4px solid ${PRIORITY_COLORS[g.p]}` }}>
            <span className="text-sm font-semibold" style={{ color: PRIORITY_COLORS[g.p] }}>{g.p}</span>
            <span className="text-sm text-zinc-700">{names[g.p]}</span>
            <span className="rounded-full bg-zinc-100 text-zinc-600 text-[11px] font-medium px-1.5">{g.rows.length}</span>
          </header>
          <TaskTable tasks={g.rows} person={person} onOpenTask={onOpenTask} />
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- calendar + week

function Chip({ t, onOpenTask }: { t: Task; onOpenTask: (id: string) => void }) {
  const done = !isOpen(t)
  return (
    <button onClick={e => { e.stopPropagation(); onOpenTask(t.id) }} title={`${t.priority} · ${t.title}`}
      className={cn('w-full flex items-center gap-1.5 rounded-md bg-white border border-zinc-200 hover:border-zinc-400 px-1.5 py-1 text-left cursor-pointer', done && 'opacity-50')}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_COLORS[t.priority] }} />
      <span className="text-[11px] font-semibold shrink-0" style={{ color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
      <span className={cn('text-[11px] text-zinc-800 truncate', done && 'line-through')}>{t.title}</span>
    </button>
  )
}

function MonthCalendar({ tasks, onOpenTask, onAdd }: { tasks: Task[]; onOpenTask: (id: string) => void; onAdd: (due?: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) if (t.due_date) { const k = t.due_date.slice(0, 10); m.set(k, [...(m.get(k) || []), t]) }
    return m
  }, [tasks])
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days: Date[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  const undated = tasks.filter(t => !t.due_date)
  return (
    <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-200">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" className="h-8 w-8 grid place-items-center rounded-md hover:bg-zinc-100 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-sm font-semibold w-36 text-center">{format(month, 'MMMM yyyy')}</h2>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month" className="h-8 w-8 grid place-items-center rounded-md hover:bg-zinc-100 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setMonth(startOfMonth(new Date()))} className="h-8 rounded-md border border-zinc-300 text-xs px-2.5 hover:bg-zinc-50 cursor-pointer">Today</button>
        <span className="flex-1" />
        {undated.length > 0 && <span className="text-xs text-zinc-500">{undated.length} without a date</span>}
      </header>
      <div className="grid grid-cols-7 text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d} className="px-2 py-1.5">{d}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map(d => {
          const k = format(d, 'yyyy-MM-dd'); const list = (byDay.get(k) || []).sort((a, b) => a.priority.localeCompare(b.priority))
          const today = isSameDay(d, new Date())
          return (
            <div key={k} onClick={() => onAdd(k)} title="Click to add a task due this day"
              className={cn('group min-h-[92px] border-b border-r border-zinc-100 p-1.5 space-y-1 cursor-pointer hover:bg-zinc-50', !isSameMonth(d, month) && 'bg-zinc-50/60')}>
              <div className="flex items-center">
                <span className={cn('text-[11px] w-5 h-5 grid place-items-center rounded-full', today ? 'bg-orange-500 text-white font-semibold' : isSameMonth(d, month) ? 'text-zinc-700' : 'text-zinc-400')}>{format(d, 'd')}</span>
                <Plus className="w-3 h-3 text-zinc-400 ml-auto opacity-0 group-hover:opacity-100" />
              </div>
              {list.slice(0, 3).map(t => <Chip key={t.id} t={t} onOpenTask={onOpenTask} />)}
              {list.length > 3 && <p className="text-[10px] text-zinc-500 px-1">+{list.length - 3} more</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function WeekBoard({ tasks, onOpenTask, onAdd }: { tasks: Task[]; onOpenTask: (id: string) => void; onAdd: (due?: string) => void }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  const first = format(anchor, 'yyyy-MM-dd')
  const overdue = tasks.filter(t => isOpen(t) && t.due_date && t.due_date < todayKey() && t.due_date < first).sort(byDue)
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setAnchor(addWeeks(anchor, -1))} aria-label="Previous week" className="h-8 w-8 grid place-items-center rounded-md bg-white border border-zinc-200 hover:bg-zinc-100 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-sm font-semibold">{format(anchor, 'd MMM')} to {format(addDays(anchor, 6), 'd MMM')}</h2>
        <button onClick={() => setAnchor(addWeeks(anchor, 1))} aria-label="Next week" className="h-8 w-8 grid place-items-center rounded-md bg-white border border-zinc-200 hover:bg-zinc-100 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="h-8 rounded-md border border-zinc-300 bg-white text-xs px-2.5 hover:bg-zinc-50 cursor-pointer">This week</button>
      </div>
      {overdue.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-white p-3">
          <p className="text-xs font-semibold text-red-700 mb-2">Overdue from earlier · {overdue.length}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">{overdue.map(t => <Chip key={t.id} t={t} onOpenTask={onOpenTask} />)}</div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
        {days.map(d => {
          const k = format(d, 'yyyy-MM-dd'); const list = tasks.filter(t => t.due_date?.slice(0, 10) === k).sort((a, b) => a.priority.localeCompare(b.priority))
          const today = isSameDay(d, new Date())
          return (
            <div key={k} className={cn('rounded-xl border bg-white p-2 min-h-[140px] flex flex-col', today ? 'border-orange-300' : 'border-zinc-200')}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={cn('text-xs font-semibold', today ? 'text-orange-600' : 'text-zinc-800')}>{format(d, 'EEE d')}</span>
                {list.length > 0 && <span className="text-[10px] rounded-full bg-zinc-100 text-zinc-600 px-1.5">{list.length}</span>}
                <button onClick={() => onAdd(k)} aria-label={`Add a task due ${format(d, 'EEEE')}`} className="ml-auto text-zinc-400 hover:text-zinc-900 cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
              </div>
              <div className="space-y-1">{list.map(t => <Chip key={t.id} t={t} onOpenTask={onOpenTask} />)}</div>
              {!list.length && <p className="text-[11px] text-zinc-400 m-auto">Free</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- assigned by me

function GivenSection({ tasks, people, onOpenTask, onOpenPerson, onNew }: {
  tasks: Task[]; people: User[]; onOpenTask: (id: string) => void; onOpenPerson: (u: User) => void; onNew: () => void
}) {
  const [filter, setFilter] = useState<'open' | 'awaiting' | 'differs' | 'all'>('open')
  const rows = tasks.filter(t => filter === 'all' ? true : filter === 'awaiting' ? askState(t).awaiting : filter === 'differs' ? isOpen(t) && askState(t).differs : isOpen(t))
  const groups = useMemo(() => {
    const m = new Map<string, { user?: User; label: string; rows: Task[] }>()
    for (const t of rows) {
      const p = primaryAssignee(t)
      const pend = (t.pending_assignments || []).find(x => !x.resolved_user_id)
      const key = p?.user_id || pend?.email || 'none'
      const user = p ? people.find(u => u.id === p.user_id) : undefined
      const label = user ? (user.display_name || firstName(user)) : pend ? `${pend.email.split('@')[0]} (not signed in yet)` : 'Nobody yet'
      if (!m.has(key)) m.set(key, { user, label, rows: [] })
      m.get(key)!.rows.push(t)
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, people])
  const n = (f: typeof filter) => tasks.filter(t => f === 'all' ? true : f === 'awaiting' ? askState(t).awaiting : f === 'differs' ? isOpen(t) && askState(t).differs : isOpen(t)).length
  return (
    <>
      <PageTitle title="Assigned by me" sub="Tasks you gave to other people, and what they came back with."
        right={<button onClick={onNew} className="inline-flex items-center gap-1.5 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm cursor-pointer"><Plus className="w-4 h-4" /> Assign a task</button>} />
      <div className="inline-flex flex-wrap rounded-lg bg-zinc-100 p-0.5">
        {([['open', 'Open'], ['awaiting', 'Awaiting reply'], ['differs', 'Needs alignment'], ['all', 'All']] as [typeof filter, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer', filter === k ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900')}>{l} <span className="text-zinc-400">{n(k)}</span></button>
        ))}
      </div>
      {!groups.length && <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">Nothing here. Open someone’s page from People and add a task for them.</div>}
      <div className="space-y-4">
        {groups.map(g => (
          <section key={g.label} className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
            <header className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-200">
              <span className="text-sm font-semibold">{g.label}</span>
              <span className="rounded-full bg-zinc-100 text-zinc-600 text-[11px] font-medium px-1.5">{g.rows.length}</span>
              {g.user && <button onClick={() => onOpenPerson(g.user!)} className="ml-auto text-xs text-blue-600 hover:underline cursor-pointer">Open their page</button>}
            </header>
            <TaskTable tasks={g.rows.sort(byDue)} onOpenTask={onOpenTask} showAssignee />
          </section>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- people

function PeopleSection({ people, tasks, me, onOpen }: { people: User[]; tasks: Task[]; me: User; onOpen: (u: User) => void }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => people
    .filter(u => !q.trim() || (u.display_name || '').toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()))
    .map(u => ({ u, load: loadOf(tasks.filter(t => roleOn(t, u) === 'assigned')) })), [people, tasks, q])
  return (
    <>
      <PageTitle title="People" sub="Open anyone’s page to see what they have on, then add a task for them."
        right={
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" autoFocus
              className="h-10 w-56 rounded-lg border border-zinc-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-zinc-900" />
          </div>
        } />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map(({ u, load }) => (
          <button key={u.id} onClick={() => onOpen(u)} className="text-left rounded-xl border border-zinc-200 bg-white hover:border-zinc-400 hover:shadow-sm p-4 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10"><AvatarImage src={u.avatar_url || ''} /><AvatarFallback className="bg-zinc-200 text-zinc-700 text-sm">{firstName(u)[0]}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.display_name || firstName(u)}{u.id === me.id && <span className="text-zinc-400 font-normal"> (me)</span>}</p>
                <p className="text-[11px] text-zinc-500 truncate">{u.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
              <span className="rounded-md bg-zinc-100 text-zinc-700 px-1.5 py-0.5">{load.open} open</span>
              {load.dueToday > 0 && <span className="rounded-md bg-blue-50 text-blue-700 px-1.5 py-0.5">{load.dueToday} due today</span>}
              {load.overdue > 0 && <span className="rounded-md bg-red-50 text-red-700 px-1.5 py-0.5">{load.overdue} overdue</span>}
              {load.p0 > 0 && <span className="rounded-md bg-red-50 text-red-700 px-1.5 py-0.5">{load.p0} P0</span>}
              {load.open === 0 && <span className="text-zinc-400 py-0.5">Nothing open</span>}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- notifications

function describe(n: Notification, users: User[]): { text: string; detail?: string } {
  const p = (n.payload || {}) as Record<string, unknown>
  const actorId = (p.actor_id || p.assigned_by || p.commented_by || p.mentioned_by || p.changed_by) as string | undefined
  const who = users.find(u => u.id === actorId)
  const actor = who ? firstName(who) : 'Someone'
  const title = (p.task_title as string) || n.task?.title || 'a task'
  switch (n.type as string) {
    case 'task_reply': {
      if (p.accepted) return { text: `${actor} accepted “${title}”`, detail: `${p.replied_priority}, due ${shortDate(p.replied_due_date as string)}, as asked` }
      const bits = [
        p.requested_priority !== p.replied_priority ? `priority ${p.requested_priority} asked, ${p.replied_priority} replied` : null,
        p.requested_due_date !== p.replied_due_date ? `due ${shortDate(p.requested_due_date as string)} asked, ${shortDate(p.replied_due_date as string)} replied` : null,
      ].filter(Boolean).join(' · ')
      return { text: `${actor} replied on “${title}”`, detail: [bits, p.note ? `“${p.note}”` : null].filter(Boolean).join(' · ') }
    }
    case 'assigned': return { text: `${actor} assigned you “${title}”`, detail: p.role === 'primary' ? 'Accept it, or reply with your own priority and date' : p.role === 'secondary' ? 'You are on it alongside the primary person' : 'You are a contributor' }
    case 'comment': return { text: `${actor} wrote on “${title}”`, detail: p.comment_body ? String(p.comment_body) : undefined }
    case 'mentioned': return { text: `${actor} mentioned you on “${title}”` }
    case 'task_edited': return { text: `${actor} changed “${title}”`, detail: Array.isArray(p.fields) ? (p.fields as string[]).map(f => f.replace(/_/g, ' ')).join(', ') : undefined }
    case 'status_change': return { text: `“${title}” moved to ${String(p.to_status || '').replace(/_/g, ' ')}`, detail: p.from_status ? `from ${String(p.from_status).replace(/_/g, ' ')}` : undefined }
    case 'subtask_added': return { text: `${actor} added a sub-task to “${title}”`, detail: p.subtask_title as string | undefined }
    case 'task_created': return { text: `${actor} created “${title}” on a channel you head` }
    case 'checklist': return { text: `${actor} updated the checklist on “${title}”`, detail: p.item as string | undefined }
    case 'suggestion': return { text: `${actor} suggested a change to “${title}”` }
    case 'suggestion_resolved': return { text: `Your suggestion on “${title}” was ${p.result}` }
    case 'campaign_ask': return { text: `You are on ${p.campaign_name || 'a campaign'}`, detail: p.ask as string | undefined }
    case 'overdue': return { text: `“${title}” is overdue` }
    default: return { text: `Update on “${title}”` }
  }
}

function NotificationPanel({ items, users, onOpenTask, onClose, onRead, onReadAll }: {
  items: Notification[]; users: User[]; onOpenTask: (id: string) => void; onClose: () => void
  onRead: (ids: string[]) => void; onReadAll: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-11 z-50 w-[min(92vw,26rem)] rounded-xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center px-4 py-2.5 border-b border-zinc-200">
          <p className="text-sm font-semibold flex-1">Notifications</p>
          {items.length > 0 && <button onClick={onReadAll} className="text-xs text-blue-600 hover:underline cursor-pointer">Mark all read</button>}
        </div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-zinc-100">
          {!items.length && <p className="px-4 py-10 text-center text-sm text-zinc-500">You are all caught up.</p>}
          {items.map(n => {
            const d = describe(n, users)
            return (
              <button key={n.id} onClick={() => { onRead([n.id]); if (n.task_id) onOpenTask(n.task_id) }} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 cursor-pointer">
                <p className="text-sm text-zinc-900">{d.text}</p>
                {d.detail && <p className="text-xs text-zinc-600 mt-0.5 line-clamp-2">{d.detail}</p>}
                <p className="text-[10px] text-zinc-400 mt-1">{format(new Date(n.created_at), 'd MMM, h:mm a')}</p>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
