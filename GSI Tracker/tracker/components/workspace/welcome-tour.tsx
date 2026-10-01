'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen, FolderKanban, ListTodo, Table2, Users, X, Zap,
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

const DONE_KEY = 'gsi:tour:v3'
const STEP_KEY = 'gsi:tour:v3:step' // present = walkthrough in progress (survives reloads)

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
      campaigns and budgets, in one place. This walkthrough goes <strong>page by page</strong>:
      every “Next” opens the page it talks about. Close it any time — restart it from the Guide
      page or your account menu.</>
    ),
  },
  {
    icon: <LyzrSail className="w-8 h-5" />,
    title: 'One board — verticals are tags',
    body: (
      <>This is <strong>Lyzr</strong> — the one board where <strong>every task lives</strong>. Each
      task carries a vertical tag; <strong>GSI</strong> and the others are just this board filtered
      to their tag. Create a task in a vertical’s view and it’s tagged for you; it still shows here.
      Channels are shared by everyone. Switch views at the top of the sidebar.</>
    ),
    href: '/dashboard/?v=lyzr',
    place: 'Lyzr',
    introKey: 'space_dashboard',
  },
  {
    icon: <FolderKanban className="w-6 h-6 text-orange-500" />,
    title: 'Projects: where work happens',
    body: (
      <>Every channel is a <strong>project</strong>. It opens on <strong>Everything</strong> — the Lyzr
      board with every task. Pick a project on the left and see its work as a <strong>Board</strong>
      (drag cards between columns), a <strong>Table</strong>, or a compact <strong>List</strong>.
      Colours tell you where things stand: <strong>green</strong> live or done, <strong>yellow</strong>
      in progress, <strong>red</strong> blocked or overdue.</>
    ),
    href: '/projects/',
    place: 'Projects',
    introKey: 'projects',
  },
  {
    icon: <ListTodo className="w-6 h-6 text-emerald-600" />,
    title: 'Adding a task',
    body: (
      <>Type what needs doing in <strong>+ Add task</strong> at the top and press Enter — that’s it.
      For more detail use <strong>New task</strong>: pick the vertical and channel (or leave it on
      <strong> No channel</strong>), the owner (you by default), due date and priority. Sub-tasks get
      their own owner, starting with the parent task’s.</>
    ),
  },
  {
    icon: <ListTodo className="w-6 h-6 text-emerald-600" />,
    title: 'My Board: your own page',
    body: (
      <><strong>My Board</strong> is your personal home — just the tasks assigned to you, grouped by
      when they’re due. <strong>My Tasks</strong> is the full list of everything with your name on it.
      Most people start their day here.</>
    ),
    href: '/my-board/',
    place: 'My Board',
    introKey: 'my_board',
  },
  {
    icon: <Zap className="w-6 h-6 text-orange-500" />,
    title: 'Campaigns: launches and thunderclaps',
    body: (
      <>A <strong>launch</strong> is a release everyone rallies behind, a <strong>thunderclap</strong>
      is one day where everyone posts at once, and a <strong>campaign</strong> is a multi-week push.
      Each shows as a banner on home pages — for the whole company or one vertical — and groups the
      tasks that make it happen.</>
    ),
    href: '/campaigns/',
    place: 'Campaigns',
    introKey: 'campaign',
  },
  {
    icon: <Table2 className="w-6 h-6 text-blue-600" />,
    title: 'For admins and leadership: the company view',
    body: (
      <>Admins and leadership start on <strong>Company home</strong> and get the company pages.
      <strong> All Tasks</strong> is the leadership view: every task in every vertical in one table;
      the tiles on top (Done, Not done, Live, Blocked, Overdue, Critical) filter it. Everyone else
      starts on My Board with a shorter sidebar.</>
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
      domain and channel owners. Admins assign any role here; vertical owners manage their vertical;
      channel owners assign owners below themselves.</>
    ),
    href: '/members/',
    place: 'Members',
    introKey: 'people_map',
  },
  {
    icon: <BookOpen className="w-6 h-6 text-violet-600" />,
    title: 'The Guide — and seeing it as anyone',
    body: (
      <>This <strong>Guide</strong> covers everything in five minutes, and its “Guide walkthrough”
      button restarts this tour. Admins can switch <strong>“View as”</strong> in the account menu
      (bottom left) to see the tracker exactly as leadership, a vertical owner, a channel owner or a
      member does. That’s everything — enjoy!</>
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
