'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Building2, Layers, ListTodo, Table2, Users, X, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LyzrSail } from '@/components/ui/lyzr-logo'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { markIntroSeen } from '@/components/workspace/page-intro'
import { cn } from '@/lib/utils'

// Guided walkthrough. A centered modal over a dimmed page: each step
// NAVIGATES to the page it explains (visible behind the dim), and the modal
// survives navigation and reloads until Done or Close. Opens automatically on
// first sign-in on this browser; restarts from the account menu ("Replay the
// welcome tour") or the Guide page's "Guide walkthrough" button. Pure
// explanation — it never writes anything.

const DONE_KEY = 'gsi:tour:v2'
const STEP_KEY = 'gsi:tour:v2:step' // present = walkthrough in progress (survives reloads)

let openFn: (() => void) | null = null
export function startTour() { openFn?.() }

// Page intros stay quiet while the walkthrough runs (two cards would fight).
const active = { now: false, listeners: new Set<() => void>() }
function setActive(v: boolean) {
  active.now = v
  active.listeners.forEach(fn => fn())
}
export function useTourActive(): boolean {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force(x => x + 1)
    active.listeners.add(fn)
    return () => { active.listeners.delete(fn) }
  }, [])
  return active.now
}

type Step = {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
  // The page this step explains: Next lands here, then the card talks about it.
  href?: string
  place?: string // short name shown on the Next button ("Next · Overview")
  introKey?: string // the page intro this step replaces (marked as seen)
}

const STEPS: Step[] = [
  {
    icon: <LyzrSail className="w-10 h-6" />,
    title: 'Welcome to the Lyzr Marketing Tracker',
    body: (
      <>This is where the marketing team plans, runs and reports its work — tasks, channels,
      campaigns and budgets, in one place. This walkthrough takes you <strong>page by page</strong>:
      every “Next” opens the page it talks about, so you see each one as it&apos;s explained. Close
      it any time — you can restart it from the Guide page or your account menu.</>
    ),
  },
  {
    icon: <Building2 className="w-6 h-6 text-blue-600" />,
    title: 'Home: verticals, and the Lyzr company view',
    body: (
      <>You are on the <strong>Company Home</strong>. <strong>A vertical is a business line</strong> —
      GSI is one, and more can be added. Each vertical has its own dashboard, channels and tasks.
      <strong> Lyzr</strong> is the company-wide view that is always there. Switch between “Company”
      and a vertical with the switcher at the top of the sidebar.</>
    ),
    href: '/',
    place: 'Home',
    introKey: 'workspace_home',
  },
  {
    icon: <Layers className="w-6 h-6 text-blue-600" />,
    title: 'Overview: how work is organised',
    body: (
      <>This is the <strong>Overview</strong> — the whole tree of work drawn as one picture:
      <strong> Group → Channel → Sub-channel → Task</strong>. A channel is a marketing motion
      (Events, ABM, Paid…); every channel has an owner. After the tour, click any node here to
      open its page.</>
    ),
    href: '/overview/?v=all',
    place: 'Overview',
    introKey: 'overview',
  },
  {
    icon: <ListTodo className="w-6 h-6 text-emerald-600" />,
    title: 'My Board: your own page',
    body: (
      <><strong>My Board</strong> is your personal home — just the tasks assigned to you, grouped
      by when they are due. Its sibling <strong>My Tasks</strong> is the full list of everything
      with your name on it, across all verticals. If you mainly execute tasks, these two pages
      are most of what you need.</>
    ),
    href: '/my-board/',
    place: 'My Board',
    introKey: 'my_board',
  },
  {
    icon: <Zap className="w-6 h-6 text-orange-500" />,
    title: 'Campaigns and Thunderclaps',
    body: (
      <>A <strong>campaign</strong> is a big push that spans channels or verticals — a launch,
      an event, a report. A <strong>thunderclap</strong> is a one-day coordinated blast where
      many people post at once. A pinned campaign shows as a banner on home pages so nobody
      misses it.</>
    ),
    href: '/campaigns/',
    place: 'Campaigns',
    introKey: 'campaign',
  },
  {
    icon: <Table2 className="w-6 h-6 text-blue-600" />,
    title: 'All Tasks: the leadership view',
    body: (
      <><strong>All Tasks</strong> is every task in every vertical in one table. The summary tiles
      at the top (Done, Not done, Live, Blocked, Overdue, Critical) filter the table when
      clicked. <strong>Weekly</strong> shows the same work week by week: planned, done,
      carried over.</>
    ),
    href: '/workspace/tasks/',
    place: 'All Tasks',
    introKey: 'tracker_all',
  },
  {
    icon: <Users className="w-6 h-6 text-blue-600" />,
    title: 'Members: people and roles',
    body: (
      <>The <strong>Members</strong> page shows who is who: admins, leadership, vertical owners,
      channel owners — and the people map of who owns what, where. Admins assign any role here;
      vertical owners manage their vertical; channel owners assign owners below themselves.</>
    ),
    href: '/members/',
    place: 'Members',
    introKey: 'people_map',
  },
  {
    icon: <BookOpen className="w-6 h-6 text-violet-600" />,
    title: 'The Guide — and seeing it as anyone',
    body: (
      <>This <strong>Guide</strong> page repeats everything in five minutes, and the
      “Guide walkthrough” button at the top restarts this walkthrough whenever anyone needs it.
      One last trick: admins can switch <strong>“View as”</strong> in the account menu (bottom
      left) to preview the tracker exactly as Leadership, a vertical owner, a channel owner or a
      member sees it. That’s everything — enjoy!</>
    ),
    href: '/guide/',
    place: 'Guide',
  },
]

const save = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* session only */ } }
const drop = (k: string) => { try { window.localStorage.removeItem(k) } catch { /* nothing to drop */ } }
const load = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }

export function WelcomeTour() {
  const { data: user } = useCurrentUser()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  // Entering a step: remember it (a reload or redirect resumes here), open
  // the page it explains, and stand in for that page's first-visit intro.
  const goTo = (i: number, navigate = true) => {
    const s = STEPS[i]
    setStep(i)
    save(STEP_KEY, String(i))
    if (s.introKey) markIntroSeen(s.introKey)
    if (navigate && s.href) router.push(s.href)
  }

  const begin = () => { setOpen(true); setActive(true); goTo(0) }

  useEffect(() => {
    openFn = begin
    return () => { openFn = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On load: resume a walkthrough that was in progress (the card must survive
  // any redirect or reload), else auto-start on this browser's first sign-in.
  // Deferred a tick: this reads localStorage after the user query resolves,
  // an external store the lint cannot see, so the sync-setState rule is moot.
  useEffect(() => {
    if (!user || open) return
    const t = window.setTimeout(() => {
      const resume = load(STEP_KEY)
      if (resume !== null) {
        const i = Math.min(Math.max(0, Number(resume) || 0), STEPS.length - 1)
        setOpen(true)
        setActive(true)
        goTo(i, false) // stay on whatever page they are on until they press Next
        return
      }
      if (load(DONE_KEY) !== '1') begin()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const finish = () => {
    setOpen(false)
    setActive(false)
    save(DONE_KEY, '1')
    drop(STEP_KEY)
  }

  if (!open) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const next = STEPS[step + 1]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Walkthrough step ${step + 1} of ${STEPS.length}: ${s.title}`}
        className="relative w-[min(480px,100%)] rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20 overflow-hidden"
      >
      <div className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">{s.icon}</div>
          <h2 className="text-sm font-semibold text-zinc-900 flex-1">{s.title}</h2>
          <button
            onClick={finish}
            aria-label="Close the walkthrough"
            className="shrink-0 -mt-1 -mr-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[13px] leading-relaxed text-zinc-700">{s.body}</div>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-3">
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} aria-label={`Step ${i + 1}`}
              className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-orange-500' : 'w-1.5 bg-zinc-300 hover:bg-zinc-400')} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="outline" size="sm" className="text-xs border-zinc-300" onClick={() => goTo(step - 1)}>
              Back
            </Button>
          )}
          {last
            ? <Button size="sm" className="text-xs bg-orange-500 hover:bg-orange-600 text-white" onClick={finish}>Done</Button>
            : (
              <Button size="sm" className="text-xs" onClick={() => goTo(step + 1)}>
                Next{next?.place ? ` · ${next.place}` : ''} · {step + 2}/{STEPS.length}
              </Button>
            )}
        </div>
      </div>
      </div>
    </div>
  )
}
