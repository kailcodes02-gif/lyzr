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
// browser, a sticky card explains what the page is for and what is on it.
// It stays until closed ("Got it" or X) and never comes back for that page.
// Quiet while the guided walkthrough runs — its steps mark the pages they
// explain as seen, so nobody gets the same card twice.

const SEEN_PREFIX = 'gsi:intro:v1:'
export function markIntroSeen(key: string) {
  try { window.localStorage.setItem(SEEN_PREFIX + key, '1') } catch { /* session only */ }
}
const seen = (key: string) => {
  try { return window.localStorage.getItem(SEEN_PREFIX + key) === '1' } catch { return true }
}

type Intro = {
  key: string
  // Longest prefixes first at lookup; '/' matches only exactly.
  path: string
  icon: React.ReactNode
  title: string
  points: string[]
}

const INTROS: Intro[] = [
  {
    key: 'workspace_home', path: '/', icon: <Home className="w-5 h-5 text-blue-600" />,
    title: 'Home — the company at a glance',
    points: [
      'Every vertical and domain, the hero campaigns, who is where, your day, and recent activity.',
      'Switch between “Company” and a vertical with the switcher at the top of the sidebar.',
    ],
  },
  {
    key: 'overview', path: '/overview', icon: <GitBranch className="w-5 h-5 text-blue-600" />,
    title: 'Overview — the whole tree of work',
    points: [
      'Group → Channel → Sub-channel → Task, drawn as one picture per vertical and for the company.',
      'Click any node to open its page; owners and counts show on each card.',
    ],
  },
  {
    key: 'my_board', path: '/my-board', icon: <ListTodo className="w-5 h-5 text-emerald-600" />,
    title: 'My Board — your personal home',
    points: [
      'The hero banner, your channels across every vertical, and what you owe this week. Nothing else.',
      'Mainly executing tasks? This page and My Tasks are most of what you need.',
    ],
  },
  {
    key: 'my_tasks', path: '/my-tasks', icon: <ListTodo className="w-5 h-5 text-emerald-600" />,
    title: 'My Tasks — everything with your name on it',
    points: [
      'Assigned to you, inherited through your channels, or mentioning you — across all verticals.',
      'Filter by status, date and vertical; save the view once you like it.',
    ],
  },
  {
    key: 'campaign', path: '/campaigns', icon: <Zap className="w-5 h-5 text-orange-500" />,
    title: 'Campaigns — the big pushes',
    points: [
      'A campaign is a launch, an event or a big push spanning channels; it links tasks from anywhere.',
      'A thunderclap is a one-day blast where everyone posts at once and ticks their own row.',
      'A pinned campaign shows as a banner on every home page.',
    ],
  },
  {
    key: 'tracker_all', path: '/workspace/tasks', icon: <Table2 className="w-5 h-5 text-blue-600" />,
    title: 'All Tasks — every task in every vertical',
    points: [
      'One table with every filter; the leadership view of the whole company.',
      'The tiles on top (Done, Not done, Live, Blocked, Overdue, Critical) filter the table when clicked.',
    ],
  },
  {
    key: 'weekly', path: '/workspace/weekly', icon: <CalendarRange className="w-5 h-5 text-blue-600" />,
    title: 'Weekly — planned versus delivered',
    points: [
      'Everything due in the period, split into done, not done and overdue carried in from earlier.',
      'Step week by week with the arrows, or pick any range.',
    ],
  },
  {
    key: 'weekly', path: '/weekly', icon: <CalendarRange className="w-5 h-5 text-blue-600" />,
    title: 'Weekly — planned versus delivered',
    points: [
      'Everything due in the period, split into done, not done and overdue carried in from earlier.',
      'Step week by week with the arrows, or pick any range.',
    ],
  },
  {
    key: 'people_map', path: '/members', icon: <Users className="w-5 h-5 text-blue-600" />,
    title: 'Members — people, roles and the people map',
    points: [
      'Every person and every badge: admins, leadership, vertical owners, channel owners.',
      'The people map shows who owns what in every vertical; dimmed names are inherited from the domain.',
    ],
  },
  {
    key: 'space_dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-5 h-5 text-blue-600" />,
    title: 'Dashboard — this vertical only',
    points: [
      'Your tasks here, what goes live this week, budget and recent activity for this vertical.',
    ],
  },
  {
    key: 'calendar', path: '/calendar', icon: <Calendar className="w-5 h-5 text-blue-600" />,
    title: 'Calendar — tasks by due date',
    points: [
      'Use the arrows or pick any range; filter by owner, channel and status.',
    ],
  },
  {
    key: 'tracker_results', path: '/tracker', icon: <LineChart className="w-5 h-5 text-blue-600" />,
    title: 'Tracker — results, not plans',
    points: [
      'Tasks that went live or finished, with their tracker fields: KPI actual, spend, evidence.',
      'Tracker fields lock 45 days after completion; admins can override.',
    ],
  },
  {
    key: 'owners', path: '/owners', icon: <UserCircle className="w-5 h-5 text-blue-600" />,
    title: 'Owners — each person’s load',
    points: [
      'Everyone with open, overdue and live counts; click through for their tasks, mentions and calendar.',
    ],
  },
  {
    key: 'budgets', path: '/budgets', icon: <DollarSign className="w-5 h-5 text-emerald-600" />,
    title: 'Budgets — periods and allocations',
    points: [
      'Budget periods at vertical, group or channel level, and how much tasks have allocated against each.',
    ],
  },
  {
    key: 'leads_pipeline', path: '/leads', icon: <Upload className="w-5 h-5 text-blue-600" />,
    title: 'Leads Pipeline — the HubSpot pull',
    points: [
      'Read-only HubSpot lead pull, email-interaction CSVs and lead imports, with per-lead outreach tracking.',
    ],
  },
  {
    key: 'functions_view', path: '/functions', icon: <Workflow className="w-5 h-5 text-blue-600" />,
    title: 'Domains — one discipline across verticals',
    points: [
      'A domain (Content, Social, Paid…) shown everywhere it runs: its channels, tasks and weekly results.',
    ],
  },
  {
    key: 'history', path: '/history', icon: <History className="w-5 h-5 text-zinc-600" />,
    title: 'History — every logged change',
    points: ['Who changed what, from what to what, and when.'],
  },
  {
    key: 'settings', path: '/settings', icon: <Settings className="w-5 h-5 text-zinc-600" />,
    title: 'Vertical Settings',
    points: [
      'Owners, the taxonomy tree, resources and feature switches for this vertical.',
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

  // `dismissed` only forces the re-render that hides the card right away;
  // persistence is markIntroSeen, and each page has its own key, so nothing
  // needs resetting on navigation.
  const intro = introFor(pathname ?? '/')
  const show = !!user && !touring && !!intro && !seen(intro.key) && dismissed !== intro.key

  if (!show || !intro) return null
  const close = () => { markIntroSeen(intro.key); setDismissed(intro.key) }

  return (
    <div
      role="dialog"
      aria-label={`About this page: ${intro.title}`}
      className="fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10 overflow-hidden"
    >
      <div className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">{intro.icon}</div>
          <h2 className="text-sm font-semibold text-zinc-900 flex-1">{intro.title}</h2>
          <button
            onClick={close}
            aria-label="Close this explanation"
            className="shrink-0 -mt-1 -mr-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-zinc-700 list-disc pl-4">
          {intro.points.map(p => <li key={p}>{p}</li>)}
        </ul>
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
  )
}
