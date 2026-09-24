'use client'

import Link from 'next/link'
import {
  BookOpen, Building2, Folder, Layers, GitBranch, ListTodo, CheckSquare, Home, LayoutDashboard, Calendar,
  LineChart, UserCircle, CalendarRange, DollarSign, Upload, History, Workflow, Settings, Crown, ShieldCheck,
  Users, Table2, Filter, Repeat, ArrowRight, Sparkles,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { STATUS_CONFIG } from '@/lib/types/database'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'

// Product guide: visual, short, complete. Every block links to the real screen.

const LEVELS = [
  { icon: Building2, color: 'text-blue-600 bg-blue-50 border-blue-200', name: 'Vertical', k: 'vertical', eg: 'GSI · Lyzr · a product' },
  { icon: Folder, color: 'text-zinc-600 bg-zinc-100 border-zinc-200', name: 'Category', k: 'category', eg: 'Paid · Organic · Events' },
  { icon: Layers, color: 'text-blue-700 bg-blue-50 border-blue-200', name: 'Channel', k: 'channel', eg: 'Paid Ads · Email · Content' },
  { icon: GitBranch, color: 'text-violet-700 bg-violet-50 border-violet-200', name: 'Sub-channel', k: 'sub_channel', eg: 'LinkedIn Ads · Webinar' },
  { icon: ListTodo, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', name: 'Task', k: 'task', eg: 'Run Q4 ABM campaign' },
  { icon: GitBranch, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', name: 'Sub-activity', k: 'sub_activity', eg: 'Write the 5-email sequence' },
  { icon: CheckSquare, color: 'text-amber-700 bg-amber-50 border-amber-200', name: 'Checklist', k: 'checklist', eg: 'Draft · Review · Schedule' },
]

const ROLES = [
  { icon: ShieldCheck, name: 'Admin', k: 'admin', can: ['Create verticals and functions', 'Manage users and roles', 'Edit anything, anywhere'], where: 'Admin' },
  { icon: Crown, name: 'Vertical owner', k: 'vertical_owner', can: ['Channels and sub-channels of their vertical', 'Budgets, custom fields, resources', 'Channel owners'], where: 'Vertical Settings' },
  { icon: Workflow, name: 'Function owner', k: 'function_owner', can: ['Default owner of that function’s channels in every vertical', 'One roll-up view across verticals'], where: 'Functions' },
  { icon: Users, name: 'Channel owner', k: 'channel_owner', can: ['Owns the channel’s tasks', 'Tasks with no owner inherit the channel owners'], where: 'Channel page' },
  { icon: UserCircle, name: 'Member', k: 'member', can: ['See everything', 'Create and update tasks, comments, checklists'], where: 'Everywhere' },
]

const VIEWS = [
  { icon: Home, name: 'Workspace Home', k: 'workspace_home', href: '/', mode: 'workspace' },
  { icon: Table2, name: 'All Tasks', k: 'tracker', href: '/workspace/tasks/', mode: 'workspace', text: 'Every task in every vertical, with every filter.' },
  { icon: CalendarRange, name: 'Weekly (workspace)', k: 'weekly', href: '/workspace/weekly/', mode: 'workspace' },
  { icon: Workflow, name: 'Functions', k: 'functions_view', href: '/functions/', mode: 'workspace' },
  { icon: LayoutDashboard, name: 'Dashboard', k: 'space_dashboard', href: '/dashboard/', mode: 'space' },
  { icon: Calendar, name: 'Calendar', k: 'calendar', href: '/calendar/', mode: 'both' },
  { icon: ListTodo, name: 'My Tasks', k: 'member', href: '/my-tasks/', mode: 'both', text: 'Assigned to you, inherited through your channels, or mentioning you.' },
  { icon: LineChart, name: 'Tracker', k: 'tracker', href: '/tracker/', mode: 'space' },
  { icon: UserCircle, name: 'Owners', k: 'owners', href: '/owners/', mode: 'both' },
  { icon: CalendarRange, name: 'Weekly Review', k: 'weekly', href: '/weekly/', mode: 'space' },
  { icon: DollarSign, name: 'Budgets', k: 'budgets', href: '/budgets/', mode: 'space' },
  { icon: Upload, name: 'Leads Pipeline', k: 'leads_pipeline', href: '/leads/', mode: 'space' },
  { icon: History, name: 'History', k: 'history', href: '/history/', mode: 'both' },
  { icon: Settings, name: 'Vertical Settings', k: 'vertical_owner', href: '/settings/', mode: 'space', text: 'Owners, taxonomy tree, resources and feature switches for this vertical.' },
]

import { HELP } from '@/lib/help-text'

export default function GuidePage() {
  const { slug, mode } = useVertical()
  const spaceSlug = slug === 'all' ? 'gsi' : slug
  const linkFor = (v: typeof VIEWS[number]) =>
    v.mode === 'workspace' ? (v.href === '/' ? '/' : v.href) : withVertical(v.href, v.mode === 'both' && mode === 'workspace' ? 'all' : spaceSlug)

  return (
    <div className="p-4 lg:p-8 space-y-10 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-600" /> How the tracker works
        </h1>
        <p className="text-sm text-zinc-500 mt-1">A five-minute tour. Every heading in the product has the same <span className="inline-flex items-center gap-0.5 align-middle"><InfoTip text="Like this one. Hover any info icon for a one-line explanation." /></span> icon you can hover.</p>
      </div>

      {/* 1. Hierarchy */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">1 · The hierarchy</h2>
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-stretch gap-2">
              {LEVELS.map((l, i) => (
                <div key={l.name} className="flex items-center gap-2">
                  <div className={`rounded-xl border px-3 py-2.5 min-w-[150px] ${l.color}`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold"><l.icon className="w-3.5 h-3.5" /> {l.name} <InfoTip k={l.k} /></div>
                    <p className="text-[11px] opacity-80 mt-0.5">{l.eg}</p>
                  </div>
                  {i < LEVELS.length - 1 && <ArrowRight className="w-4 h-4 text-zinc-300 shrink-0" />}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 text-xs text-zinc-600">
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800">Verticals</strong> are separate spaces with their own channel tree, budgets and reports. <strong>Lyzr</strong> is the company-wide one.</div>
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800">Categories</strong> only group channels. Nothing is assigned to them. Channels and sub-channels are where owners, targets and tasks live.</div>
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800">Functions</strong> tie the same channel across verticals: GSI Content, Lyzr Content and any future one roll up to the Content owner.</div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 2. Two modes */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">2 · Two ways to look at it</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-white border-zinc-200">
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2 text-base font-semibold"><Home className="w-5 h-5 text-violet-600" /> Workspace</div>
              <p className="text-xs text-zinc-600">Everything, all verticals. For founders and function owners. The switcher at the top of the sidebar says <em>Workspace</em>.</p>
              <ul className="text-xs text-zinc-700 space-y-1 list-disc pl-4">
                <li>Vertical cards with open, overdue, live and this week&apos;s done vs not done</li>
                <li>All Tasks table, Calendar and Weekly across verticals</li>
                <li>Functions: one discipline everywhere it runs</li>
              </ul>
              <Link href="/" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Open Workspace Home <ArrowRight className="w-3 h-3" /></Link>
            </CardContent>
          </Card>
          <Card className="bg-white border-zinc-200">
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2 text-base font-semibold"><Building2 className="w-5 h-5 text-blue-600" /> A vertical&apos;s space</div>
              <p className="text-xs text-zinc-600">Click a vertical card or pick one in the switcher. The sidebar shows that vertical&apos;s channels and pages only; the URL carries <code className="text-[10px] bg-zinc-100 px-1 rounded">?v=</code> so links stay in the space.</p>
              <ul className="text-xs text-zinc-700 space-y-1 list-disc pl-4">
                <li>Dashboard, Calendar, Tracker, Weekly Review, Budgets for that vertical</li>
                <li>Channel pages with kanban, tracker, budget, targets and resources</li>
                <li>Optional modules (Leads Pipeline, Resources) if switched on</li>
              </ul>
              <Link href={withVertical('/dashboard/', spaceSlug)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Open a vertical <ArrowRight className="w-3 h-3" /></Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 3. Roles */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">3 · Who can do what</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {ROLES.map(r => (
            <Card key={r.name} className="bg-white border-zinc-200">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><r.icon className="w-4 h-4 text-blue-600" /> {r.name} <InfoTip k={r.k} /></div>
                <ul className="text-[11px] text-zinc-600 space-y-1">
                  {r.can.map(c => <li key={c} className="flex gap-1.5"><CheckSquare className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" /> {c}</li>)}
                </ul>
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Set in: {r.where}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-zinc-500">Everyone can read everything. Roles only change what you can <em>change</em>. People who have not signed in yet can still be named as owners; it attaches on their first Google sign-in.</p>
      </section>

      {/* 4. Quick start */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">4 · A channel owner&apos;s week</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { n: 1, t: 'Open your vertical', d: 'Pick it in the sidebar switcher. Your channels are listed underneath.', icon: Building2 },
            { n: 2, t: 'Open your channel', d: 'Kanban of activities. Owners, targets, budget and resources at the top.', icon: Layers },
            { n: 3, t: 'Create or update tasks', d: 'New Task: title, owners, due date, checklist, links, budget, repeat. Drag cards between statuses.', icon: ListTodo },
            { n: 4, t: 'Close the loop', d: 'Mark Live or Done, fill Tracker fields (KPI actual, spend, evidence). Weekly Review shows done vs not done.', icon: CalendarRange },
          ].map(s => (
            <Card key={s.n} className="bg-white border-zinc-200">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{s.n}</span><s.icon className="w-4 h-4 text-zinc-500" /></div>
                <p className="text-sm font-semibold text-zinc-900">{s.t}</p>
                <p className="text-xs text-zinc-600">{s.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 5. Task lifecycle */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">5 · A task&apos;s life</h2>
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              {(['not_started', 'in_progress', 'live', 'done'] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="rounded-full px-3 py-1 text-xs font-medium border" style={{ backgroundColor: STATUS_CONFIG[s].bgColor, color: STATUS_CONFIG[s].color, borderColor: STATUS_CONFIG[s].color + '40' }}>{STATUS_CONFIG[s].label}</span>
                  {i < 3 && <ArrowRight className="w-4 h-4 text-zinc-300" />}
                </div>
              ))}
              <span className="text-zinc-300 mx-1">|</span>
              <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: STATUS_CONFIG.blocked.bgColor, color: STATUS_CONFIG.blocked.color }}>Blocked</span>
              <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: STATUS_CONFIG.cancelled.bgColor, color: STATUS_CONFIG.cancelled.color }}>Cancelled</span>
              <InfoTip k="status" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 text-xs text-zinc-600">
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800 inline-flex items-center gap-1">Priority <InfoTip k="priority" /></strong><br />P0 critical to P4 backlog.</div>
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800 inline-flex items-center gap-1">Owners</strong><br />Primary (crown) plus secondary. No owner = inherits the channel&apos;s.</div>
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800 inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> Repeat <InfoTip k="recurring" /></strong><br />Every N days, weeks, months; ends never, on a date, or after N times.</div>
              <div className="rounded-lg bg-zinc-50 p-3"><strong className="text-zinc-800 inline-flex items-center gap-1">Tracker fields <InfoTip k="tracker_fields" /></strong><br />Results once Live or Done. Lock after 45 days.</div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 6. Views */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">6 · Every screen, in one line</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {VIEWS.map(v => (
            <Link key={v.name} href={linkFor(v)} className="block group">
              <Card className="bg-white border-zinc-200 group-hover:border-blue-300 h-full transition-colors">
                <CardContent className="p-4 flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600"><v.icon className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">{v.name}
                      <span className={`text-[9px] uppercase tracking-wider font-medium rounded px-1 ${v.mode === 'workspace' ? 'bg-violet-50 text-violet-700' : v.mode === 'space' ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-600'}`}>{v.mode}</span>
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">{v.text || HELP[v.k]}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* 7. Filters and dates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">7 · Filters and dates, the same everywhere</h2>
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-600">
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Calendar className="w-4 h-4 text-blue-600" /> Date range <InfoTip k="date_range" /></p><p>Presets (this week, last month, quarter, last 30 days) or pick two days on the calendar. The arrows step forward and back by the same length: week on week, month on month.</p></div>
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Filter className="w-4 h-4 text-blue-600" /> Filter bar</p><p>Owner (including people not signed in yet, and Unassigned), status, priority, vertical, function, channel and search. The date field selector chooses due, completed, created or went-live.</p></div>
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Sparkles className="w-4 h-4 text-blue-600" /> Saved views <InfoTip k="saved_views" /></p><p>On the Tracker, save the current filters and sort under a name and reload them later.</p></div>
          </CardContent>
        </Card>
      </section>

      {/* 8. Admin setup */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">8 · Setting up a new vertical (admins)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { n: 1, t: 'Create it', d: 'Admin › Verticals › New vertical. Clone the GSI Standard template for the full channel tree, or start empty.', k: 'template' },
            { n: 2, t: 'Name the owners', d: 'Add vertical owners by email. They can then shape the taxonomy themselves in Vertical Settings.', k: 'vertical_owner' },
            { n: 3, t: 'Link functions', d: 'Admin › Functions: map each channel to its function so it rolls up across verticals and inherits default owners.', k: 'function' },
            { n: 4, t: 'Switch on modules', d: 'Feature switches per vertical: Leads Pipeline, Report builder, Resources, HubSpot tab.', k: 'feature_flags' },
          ].map(s => (
            <Card key={s.n} className="bg-white border-zinc-200">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">{s.n}</span><span className="text-sm font-semibold text-zinc-900">{s.t}</span><InfoTip k={s.k} /></div>
                <p className="text-xs text-zinc-600">{s.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
