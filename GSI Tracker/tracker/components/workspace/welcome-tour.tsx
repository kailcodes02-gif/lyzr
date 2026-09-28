'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Eye, Layers, ListTodo, Sparkles, Table2, Users, Zap,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { LyzrSail } from '@/components/ui/lyzr-logo'
import { useCurrentUser } from '@/lib/hooks/use-data'
import { cn } from '@/lib/utils'

// First-run walkthrough. Opens automatically the first time someone signs in
// on this browser, and can be replayed from the account menu ("Replay the
// welcome tour"). Pure explanation — it never writes anything.

const DONE_KEY = 'gsi:tour:v1'

let openFn: (() => void) | null = null
export function startTour() { openFn?.() }

type Step = {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
  go?: { href: string; label: string }
}

const STEPS: Step[] = [
  {
    icon: <LyzrSail className="w-10 h-6" />,
    title: 'Welcome to the Lyzr Marketing Tracker',
    body: (
      <>This is where the marketing team plans, runs and reports its work — tasks, channels,
      campaigns and budgets, in one place. This short tour explains what each part of the
      dashboard is for. You can replay it any time from your account menu at the bottom left.</>
    ),
  },
  {
    icon: <Building2 className="w-6 h-6 text-blue-600" />,
    title: 'Verticals, and the Lyzr company view',
    body: (
      <><strong>A vertical is a business line</strong> — GSI is one, and more can be added.
      Each vertical has its own dashboard, channels and tasks. <strong>Lyzr</strong> is special:
      it is the company-wide, across-workspace view that is always there and can never be
      removed. Switch between “Company” and a vertical with the switcher at the top of the
      sidebar.</>
    ),
  },
  {
    icon: <Layers className="w-6 h-6 text-blue-600" />,
    title: 'How work is organised',
    body: (
      <>Work lives in a tree: <strong>Group → Channel → Sub-channel → Task</strong>.
      A channel is a marketing motion (Events, ABM, Paid…); every channel has an owner.
      The <strong>Overview</strong> page draws this whole tree so you can see how everything
      hangs together.</>
    ),
    go: { href: '/overview/?v=all', label: 'Open Overview' },
  },
  {
    icon: <ListTodo className="w-6 h-6 text-emerald-600" />,
    title: 'Your own pages: My Board and My Tasks',
    body: (
      <><strong>My Board</strong> is your personal home — just the tasks assigned to you,
      grouped by when they are due. <strong>My Tasks</strong> is the full list of everything
      with your name on it, across all verticals. If you mainly execute tasks, these two pages
      are most of what you need.</>
    ),
    go: { href: '/my-board/', label: 'Open My Board' },
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
    go: { href: '/campaigns/', label: 'Open Campaigns' },
  },
  {
    icon: <Table2 className="w-6 h-6 text-blue-600" />,
    title: 'The leadership view: All Tasks',
    body: (
      <><strong>All Tasks</strong> is the leadership view — every task in every vertical in one
      table. The summary tiles at the top (Done, Not done, Live, Blocked, Overdue, Critical)
      filter the table when clicked. <strong>Weekly</strong> shows the same work week by week:
      planned, done, carried over.</>
    ),
    go: { href: '/workspace/tasks/', label: 'Open All Tasks' },
  },
  {
    icon: <Users className="w-6 h-6 text-blue-600" />,
    title: 'People and roles',
    body: (
      <>The <strong>Members</strong> page shows who is who: admins, leadership, vertical owners,
      channel owners. Admins can assign any role there; vertical owners manage their vertical;
      channel owners assign owners below themselves.</>
    ),
    go: { href: '/members/', label: 'Open Members' },
  },
  {
    icon: <Eye className="w-6 h-6 text-violet-600" />,
    title: 'See it through anyone’s eyes',
    body: (
      <>Admins can switch <strong>“View as”</strong> in the account menu at the bottom of the
      sidebar — Leadership, Vertical owner, Channel owner or Member — to preview exactly how the
      tracker looks and navigates for that role. That’s everything: enjoy!</>
    ),
  },
]

export function WelcomeTour() {
  const { data: user } = useCurrentUser()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    openFn = () => { setStep(0); setOpen(true) }
    return () => { openFn = null }
  }, [])

  // First run on this browser: show once the user has loaded.
  useEffect(() => {
    if (!user) return
    try {
      if (window.localStorage.getItem(DONE_KEY) !== '1') { setStep(0); setOpen(true) }
    } catch { /* storage unavailable — skip auto-open */ }
  }, [user])

  const finish = () => {
    setOpen(false)
    try { window.localStorage.setItem(DONE_KEY, '1') } catch { /* session only */ }
  }

  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) finish() }}>
      <DialogContent className="max-w-md bg-white p-0 overflow-hidden">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            {s.icon}
            <DialogTitle className="text-base font-semibold text-zinc-900">{s.title}</DialogTitle>
          </div>
          <div className="text-sm leading-relaxed text-zinc-700">{s.body}</div>
          {s.go && (
            <button
              onClick={() => { finish(); router.push(s.go!.href) }}
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" /> {s.go.label} now
            </button>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-3">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`}
                className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-orange-500' : 'w-1.5 bg-zinc-300 hover:bg-zinc-400')} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!last && <Button variant="ghost" size="sm" className="text-xs text-zinc-500" onClick={finish}>Skip</Button>}
            {step > 0 && <Button variant="outline" size="sm" className="text-xs border-zinc-300" onClick={() => setStep(step - 1)}>Back</Button>}
            {last
              ? <Button size="sm" className="text-xs bg-orange-500 hover:bg-orange-600 text-white" onClick={finish}>Done</Button>
              : <Button size="sm" className="text-xs" onClick={() => setStep(step + 1)}>Next · {step + 1}/{STEPS.length}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
