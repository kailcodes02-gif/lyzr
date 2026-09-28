'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Calendar, CalendarRange, DollarSign, GitBranch, History, Home, LayoutDashboard, LineChart,
  ListTodo, Settings, Sparkles, Table2, Upload, UserCircle, Users, Workflow, X, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startTour, useTourActive } from '@/components/workspace/welcome-tour'
import { useCurrentUser } from '@/lib/hooks/use-data'

// First-visit page intros. The first time someone opens a page on this
// browser, a centered modal runs through the page's main features — what each
// thing on the page is and does. Closed with "Got it" or X, it never comes
// back for that page. Quiet while the guided walkthrough runs — its steps
// mark the pages they explain as seen, so nobody gets the same modal twice.

const SEEN_PREFIX = 'gsi:intro:v1:'
export function markIntroSeen(key: string) {
  try { window.localStorage.setItem(SEEN_PREFIX + key, '1') } catch { /* session only */ }
}
const seen = (key: string) => {
  try { return window.localStorage.getItem(SEEN_PREFIX + key) === '1' } catch { return true }
}

type Feature = { name: string; what: string }

type Intro = {
  key: string
  // Longest prefixes first at lookup; '/' matches only exactly.
  path: string
  icon: React.ReactNode
  title: string
  lead: string
  features: Feature[]
}

const INTROS: Intro[] = [
  {
    key: 'workspace_home', path: '/', icon: <Home className="w-5 h-5 text-blue-600" />,
    title: 'Home — the company at a glance',
    lead: 'The across-workspace view: everything the marketing team is doing, in every vertical.',
    features: [
      { name: 'KPI tiles', what: 'Open, overdue, live and this-week counts across the whole company.' },
      { name: 'Campaign banner', what: 'Pinned campaigns and thunderclaps show here until they are done.' },
      { name: 'Domains grid', what: 'Each discipline (Content, Social, Paid…) with its load, across verticals.' },
      { name: 'Vertical cards', what: 'One card per vertical — its owners and progress; click to open its own dashboard.' },
      { name: 'My Day & Inbox', what: 'What you personally owe today, and everything waiting on you.' },
      { name: 'Recent activity', what: 'The latest changes anyone made, newest first.' },
    ],
  },
  {
    key: 'overview', path: '/overview', icon: <GitBranch className="w-5 h-5 text-blue-600" />,
    title: 'Overview — the whole tree of work',
    lead: 'How everything is organised, drawn as one picture.',
    features: [
      { name: 'The tree', what: 'Company → vertical → group → channel → sub-channel, with task counts at every level.' },
      { name: 'Nodes', what: 'Every node is clickable and opens that channel or group’s page.' },
      { name: 'Owners', what: 'Each card shows who owns that piece of the tree.' },
    ],
  },
  {
    key: 'my_board', path: '/my-board', icon: <ListTodo className="w-5 h-5 text-emerald-600" />,
    title: 'My Board — your personal home',
    lead: 'Just your work, nothing else. If you mainly execute tasks, this page is home.',
    features: [
      { name: 'Due buckets', what: 'Your tasks grouped by overdue, today, this week and later.' },
      { name: 'My channels', what: 'Every channel you own or belong to, across all verticals.' },
      { name: 'Inbox', what: 'Mentions, assignments and asks waiting on you.' },
      { name: 'New task', what: 'The orange button creates a task in any of your channels.' },
    ],
  },
  {
    key: 'my_tasks', path: '/my-tasks', icon: <ListTodo className="w-5 h-5 text-emerald-600" />,
    title: 'My Tasks — everything with your name on it',
    lead: 'The full list: assigned to you, inherited through your channels, or mentioning you.',
    features: [
      { name: 'Filters', what: 'Narrow by status, date, vertical or search; the count updates live.' },
      { name: 'Views', what: 'Board, table or list — pick whichever reads best; it is remembered.' },
      { name: 'Task drawer', what: 'Click any task to open it in place: comments, checklist, history.' },
    ],
  },
  {
    key: 'campaign', path: '/campaigns', icon: <Zap className="w-5 h-5 text-orange-500" />,
    title: 'Campaigns — the big pushes',
    lead: 'Launches, events and cross-channel pushes, each linking tasks from anywhere.',
    features: [
      { name: 'Campaign', what: 'A big push spanning channels or verticals, with its own page and progress.' },
      { name: 'Thunderclap', what: 'A one-day blast where everyone posts at once and ticks their own row.' },
      { name: 'Pinning', what: 'A pinned campaign shows as a banner on every home page until it is done.' },
      { name: 'Status groups', what: 'Campaigns are grouped by upcoming, live and finished.' },
    ],
  },
  {
    key: 'tracker_all', path: '/workspace/tasks', icon: <Table2 className="w-5 h-5 text-blue-600" />,
    title: 'All Tasks — the leadership view',
    lead: 'Every task in every vertical, in one table.',
    features: [
      { name: 'Summary tiles', what: 'Done, Not done, Live, Blocked, Overdue, Critical — click one to filter the table to just those.' },
      { name: 'Filter bar', what: 'Date, vertical, domain, owner, status, priority and search, combinable.' },
      { name: 'Tag columns', what: 'Every row is tagged by vertical, domain, channel and sub-channel.' },
      { name: 'Task drawer', what: 'Click any row to open the full task without leaving the table.' },
    ],
  },
  {
    key: 'weekly', path: '/workspace/weekly', icon: <CalendarRange className="w-5 h-5 text-blue-600" />,
    title: 'Weekly — planned versus delivered',
    lead: 'The week-by-week review across every vertical.',
    features: [
      { name: 'Period picker', what: 'Step week by week or pick any range.' },
      { name: 'Buckets', what: 'Everything due in the period, split into done, not done, and overdue carried in.' },
      { name: 'Group by', what: 'Slice the same week by vertical, channel or owner.' },
    ],
  },
  {
    key: 'weekly', path: '/weekly', icon: <CalendarRange className="w-5 h-5 text-blue-600" />,
    title: 'Weekly — planned versus delivered',
    lead: 'This vertical’s week-by-week review.',
    features: [
      { name: 'Week picker', what: 'Pick any past ISO week to see the world as it stood then.' },
      { name: 'Buckets', what: 'Planned, done, and overdue carried in from earlier weeks.' },
      { name: 'By owner', what: 'Who delivered what in the week.' },
    ],
  },
  {
    key: 'people_map', path: '/members', icon: <Users className="w-5 h-5 text-blue-600" />,
    title: 'Members — people, roles and the people map',
    lead: 'Who is who, and who owns what, everywhere.',
    features: [
      { name: 'People', what: 'One row per person with every badge: Admin, Leadership, vertical owner, channel owner.' },
      { name: 'People map', what: 'Domains and channels as rows, verticals as columns, people in the cells; dimmed names are inherited.' },
      { name: 'Verticals tab', what: 'Assign vertical owners and members.' },
      { name: 'Domains & Channels tabs', what: 'Assign domain owners and channel owners — scoped to what you may manage.' },
    ],
  },
  {
    key: 'space_dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-5 h-5 text-blue-600" />,
    title: 'Dashboard — this vertical only',
    lead: 'One vertical’s own home. Lyzr is the company-wide space; each vertical gets a page like this.',
    features: [
      { name: 'KPIs', what: 'Your open tasks, going live this week, overdue and budget for this vertical.' },
      { name: 'Channels', what: 'This vertical’s channel tree lives in the sidebar under Channels.' },
      { name: 'Recent activity', what: 'The latest changes inside this vertical.' },
    ],
  },
  {
    key: 'calendar', path: '/calendar', icon: <Calendar className="w-5 h-5 text-blue-600" />,
    title: 'Calendar — tasks by due date',
    lead: 'Every dated task on a grid, so crunch weeks are visible before they happen.',
    features: [
      { name: 'Week / Month', what: 'Two zoom levels; arrows step through time.' },
      { name: 'Filters', what: 'Narrow by owner, channel and status.' },
      { name: 'Quick add', what: 'Click a day to create a task due that day.' },
    ],
  },
  {
    key: 'tracker_results', path: '/tracker', icon: <LineChart className="w-5 h-5 text-blue-600" />,
    title: 'Tracker — results, not plans',
    lead: 'The backward-looking side: what actually ran and what it did.',
    features: [
      { name: 'Live & done', what: 'Tasks that went live or finished, with KPI actuals, spend and evidence.' },
      { name: 'Locking', what: 'Tracker fields lock 45 days after completion; admins can override.' },
    ],
  },
  {
    key: 'owners', path: '/owners', icon: <UserCircle className="w-5 h-5 text-blue-600" />,
    title: 'Owners — each person’s load',
    lead: 'Tasks grouped by the person carrying them.',
    features: [
      { name: 'Load counts', what: 'Everyone with open, overdue and live counts side by side.' },
      { name: 'Person view', what: 'Click through for one person’s tasks, mentions and calendar.' },
    ],
  },
  {
    key: 'budgets', path: '/budgets', icon: <DollarSign className="w-5 h-5 text-emerald-600" />,
    title: 'Budgets — periods and allocations',
    lead: 'Monthly budgets at any level of the channel tree.',
    features: [
      { name: 'Periods', what: 'Budgets are set per month, at vertical, group or channel level.' },
      { name: 'Roll-up', what: 'Spend recorded on tasks rolls up against the right budget automatically.' },
    ],
  },
  {
    key: 'leads_pipeline', path: '/leads', icon: <Upload className="w-5 h-5 text-blue-600" />,
    title: 'Leads Pipeline — the HubSpot pull',
    lead: 'Read-only lead data pulled from HubSpot, plus CSV imports.',
    features: [
      { name: 'HubSpot pull', what: 'Companies and contacts, refreshed on demand — never written back.' },
      { name: 'Outreach tracking', what: 'Per-lead notes on who reached out and what happened.' },
    ],
  },
  {
    key: 'functions_view', path: '/functions', icon: <Workflow className="w-5 h-5 text-blue-600" />,
    title: 'Domains — one discipline across verticals',
    lead: 'The same discipline (Content, Social, Paid…) seen everywhere it runs.',
    features: [
      { name: 'Domain cards', what: 'Each domain with its owner and the channels linked to it in every vertical.' },
      { name: 'Domain page', what: 'Open one for its tasks and weekly results across the company.' },
    ],
  },
  {
    key: 'history', path: '/history', icon: <History className="w-5 h-5 text-zinc-600" />,
    title: 'History — every logged change',
    lead: 'The audit trail. Nothing is ever silently changed.',
    features: [
      { name: 'The log', what: 'Who changed what, from what to what, and when — newest first.' },
      { name: 'Filters', what: 'Narrow by person and date range.' },
    ],
  },
  {
    key: 'settings', path: '/settings', icon: <Settings className="w-5 h-5 text-zinc-600" />,
    title: 'Vertical Settings',
    lead: 'Everything that shapes this vertical.',
    features: [
      { name: 'Owners', what: 'Who runs this vertical.' },
      { name: 'Taxonomy', what: 'Its groups, channels, sub-channels and custom fields.' },
      { name: 'Features', what: 'Switches for leads pipeline, resources and more.' },
    ],
  },
]

function introFor(pathname: string): Intro | undefined {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/') return INTROS.find(i => i.path === '/')
  // Longest matching prefix wins ('/workspace/tasks' before a bare '/workspace').
  return [...INTROS]
    .filter(i => i.path !== '/' && (p === i.path || p.startsWith(i.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

export function PageIntro() {
  const pathname = usePathname()
  const { data: user } = useCurrentUser()
  const touring = useTourActive()
  const [dismissed, setDismissed] = useState<string | null>(null)

  // `dismissed` only forces the re-render that hides the modal right away;
  // persistence is markIntroSeen, and each page has its own key, so nothing
  // needs resetting on navigation.
  const intro = introFor(pathname ?? '/')
  const show = !!user && !touring && !!intro && !seen(intro.key) && dismissed !== intro.key

  if (!show || !intro) return null
  const close = () => { markIntroSeen(intro.key); setDismissed(intro.key) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]" aria-hidden onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`About this page: ${intro.title}`}
        className="relative w-[min(480px,100%)] max-h-[85vh] flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20 overflow-hidden"
      >
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">{intro.icon}</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-zinc-900">{intro.title}</h2>
              <p className="text-[13px] text-zinc-600 mt-0.5">{intro.lead}</p>
            </div>
            <button
              onClick={close}
              aria-label="Close this explanation"
              className="shrink-0 -mt-1 -mr-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
            {intro.features.map(f => (
              <div key={f.name} className="px-3.5 py-2.5 flex gap-3 text-[13px] leading-snug">
                <span className="shrink-0 w-28 font-medium text-zinc-900">{f.name}</span>
                <span className="text-zinc-600">{f.what}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-3">
          <button
            onClick={() => { close(); startTour() }}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" /> Full walkthrough
          </button>
          <Button size="sm" className="text-xs" onClick={close}>Got it</Button>
        </div>
      </div>
    </div>
  )
}
