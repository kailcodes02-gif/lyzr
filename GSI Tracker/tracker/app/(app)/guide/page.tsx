'use client'

import Link from 'next/link'
import {
  BookOpen, Building2, Folder, Layers, GitBranch, ListTodo, CheckSquare, Home, LayoutDashboard, Calendar,
  LineChart, UserCircle, CalendarRange, DollarSign, Upload, History, Workflow, Settings, Crown, ShieldCheck,
  Users, Table2, Filter, Repeat, ArrowRight, Sparkles, Eye, FolderKanban, Columns3, List, Inbox, Rocket, Zap, Target,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { InfoTip } from '@/components/ui/info-tip'
import { LyzrSail } from '@/components/ui/lyzr-logo'
import { STATUS_CONFIG, STATUS_DOT } from '@/lib/types/database'
import { useVertical } from '@/lib/hooks/use-vertical'
import { withVertical } from '@/lib/hooks/use-space-href'
import { HELP } from '@/lib/help-text'
import { startTour } from '@/components/workspace/welcome-tour'

// Product guide: visual, short, complete. Every block links to the real screen.

const LEVELS = [
  { icon: Building2, color: 'text-blue-600 bg-blue-50 border-blue-200', name: 'Vertical', k: 'vertical', eg: 'Lyzr (primary) · GSI' },
  { icon: Folder, color: 'text-zinc-600 bg-zinc-100 border-zinc-200', name: 'Group', k: 'group', eg: 'Paid · Organic · Events' },
  { icon: Layers, color: 'text-blue-700 bg-blue-50 border-blue-200', name: 'Channel (project)', k: 'channel', eg: 'Paid Ads · Email · No channel' },
  { icon: GitBranch, color: 'text-violet-700 bg-violet-50 border-violet-200', name: 'Sub-channel', k: 'sub_channel', eg: 'LinkedIn Ads · Webinar' },
  { icon: ListTodo, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', name: 'Task', k: 'task', eg: 'Run Q4 ABM campaign' },
  { icon: GitBranch, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', name: 'Sub-task', k: 'sub_activity', eg: 'Write the 5-email sequence' },
  { icon: CheckSquare, color: 'text-amber-700 bg-amber-50 border-amber-200', name: 'Checklist', k: 'checklist', eg: 'Draft · Review · Schedule' },
]

const ROLES = [
  { icon: ShieldCheck, name: 'Admin', k: 'admin', can: ['Everything in Workspace settings', 'Give every role on Members', 'Edit any task'], where: 'Members' },
  { icon: Eye, name: 'Leadership', k: 'leadership', can: ['The company view: Company home, All Tasks, Weekly, Owners', 'Read-only unless they press Edit'], where: 'Members' },
  { icon: Crown, name: 'Vertical owner', k: 'vertical_owner', can: ['Channels and sub-channels of their vertical', 'Budgets, task fields, resources', 'Members and channel owners'], where: 'Members · Vertical Settings' },
  { icon: Workflow, name: 'Domain owner', k: 'function_owner', can: ['Default owner of that domain’s channel in every vertical', 'One roll-up view across verticals'], where: 'Members › Domains' },
  { icon: Users, name: 'Channel owner', k: 'channel_owner', can: ['Owns the channel’s tasks', 'Adds sub-channels and sets owners below', 'Unowned tasks on it show under them'], where: 'Members › Channels' },
  { icon: UserCircle, name: 'Member', k: 'vertical_member', can: ['See everything', 'Create tasks in verticals they belong to', 'Edit own tasks; suggest edits on others'], where: 'Members › Verticals' },
]

type View = { icon: React.ComponentType<{ className?: string }>; name: string; k: string; href: string; mode: 'company' | 'vertical' | 'everyone'; text?: string }
const VIEWS: View[] = [
  { icon: FolderKanban, name: 'Projects', k: 'projects', href: '/projects/', mode: 'everyone', text: 'Where work happens: every channel as a project on a Board, Table or List. Opens on Everything — the Lyzr board.' },
  { icon: Sparkles, name: 'My Board', k: 'my_board', href: '/my-board/', mode: 'everyone' },
  { icon: ListTodo, name: 'My Tasks', k: 'member', href: '/my-tasks/', mode: 'everyone', text: 'Everything with your name on it: assigned to you, inherited through your channels, or mentioning you.' },
  { icon: Zap, name: 'Campaigns', k: 'campaign', href: '/campaigns/', mode: 'everyone', text: 'Launches, thunderclaps and big pushes, each with its banner and its tasks.' },
  { icon: Calendar, name: 'Calendar', k: 'calendar', href: '/calendar/', mode: 'everyone' },
  { icon: Home, name: 'Company home', k: 'workspace_home', href: '/', mode: 'company' },
  { icon: Table2, name: 'All Tasks', k: 'tracker', href: '/workspace/tasks/', mode: 'company', text: 'The leadership view: every task in every vertical in one table; the summary tiles filter it.' },
  { icon: GitBranch, name: 'Overview', k: 'overview', href: '/overview/', mode: 'company' },
  { icon: CalendarRange, name: 'Weekly', k: 'weekly', href: '/workspace/weekly/', mode: 'company' },
  { icon: UserCircle, name: 'Owners', k: 'owners', href: '/owners/', mode: 'company' },
  { icon: Workflow, name: 'Domains', k: 'functions_view', href: '/functions/', mode: 'company' },
  { icon: Users, name: 'Members', k: 'people_map', href: '/members/', mode: 'company', text: 'Every person and every role; the people map; owners per vertical, domain and channel.' },
  { icon: History, name: 'History', k: 'history', href: '/history/', mode: 'company' },
  { icon: LayoutDashboard, name: 'Dashboard', k: 'space_dashboard', href: '/dashboard/', mode: 'vertical' },
  { icon: LineChart, name: 'Tracker', k: 'tracker', href: '/tracker/', mode: 'vertical', text: 'Results: tasks that went live or finished, with what they achieved, cost and a proof link.' },
  { icon: CalendarRange, name: 'Weekly Review', k: 'weekly', href: '/weekly/', mode: 'vertical' },
  { icon: DollarSign, name: 'Budgets', k: 'budgets', href: '/budgets/', mode: 'vertical' },
  { icon: Upload, name: 'Leads Pipeline', k: 'leads_pipeline', href: '/leads/', mode: 'vertical' },
  { icon: Settings, name: 'Vertical Settings', k: 'vertical_owner', href: '/settings/', mode: 'vertical', text: 'Owners, channel tree, resources and feature switches for one vertical.' },
]

const MODE_TAG: Record<View['mode'], { label: string; cls: string }> = {
  everyone: { label: 'everyone', cls: 'bg-emerald-50 text-emerald-700' },
  company: { label: 'admins & leadership', cls: 'bg-violet-50 text-violet-700' },
  vertical: { label: 'inside a vertical', cls: 'bg-blue-50 text-blue-700' },
}

function Section({ n, title, tip, children }: { n: number; title: string; tip?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider flex items-center gap-1.5">{n} · {title} {tip && <InfoTip k={tip} />}</h2>
      {children}
    </section>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => <div className="rounded-lg bg-zinc-50 p-3">{children}</div>

export default function GuidePage() {
  const { verticals } = useVertical()
  const lyzrSlug = verticals.find(v => v.slug === 'lyzr')?.slug || 'lyzr'
  const otherSlug = verticals.find(v => v.slug !== 'lyzr')?.slug || 'gsi'
  const linkFor = (v: View) => v.mode === 'vertical' ? withVertical(v.href, lyzrSlug) : v.href

  return (
    <div className="p-4 lg:p-8 space-y-10 max-w-6xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div className="pl-12 lg:pl-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-600" /> How the tracker works
          </h1>
          <p className="text-sm text-zinc-500 mt-1">A five-minute read. Every heading in the product has the same <span className="inline-flex items-center gap-0.5 align-middle"><InfoTip text="Like this one. Hover any info icon for a one-line explanation." /></span> icon you can hover.</p>
        </div>
        <button onClick={startTour}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-2 shadow-sm">
          <Sparkles className="w-3.5 h-3.5" /> Guide walkthrough
        </button>
      </div>

      {/* 1 */}
      <Section n={1} title="One board. Verticals are tags.">
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-600">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><LyzrSail className="w-5 h-3.5" /> Lyzr sees everything</p>
              <p><strong>Every task lives on the Lyzr board</strong> — it is the only board there is. Each task carries a vertical tag (Lyzr = not vertical-specific), and every page here shows all of them.</p>
              <Link href={withVertical('/dashboard/', lyzrSlug)} className="text-blue-600 hover:underline inline-flex items-center gap-1">Open the Lyzr board <ArrowRight className="w-3 h-3" /></Link>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" /> A vertical is a view</p>
              <p>GSI&apos;s board is the Lyzr board <strong>filtered to tasks tagged GSI</strong> — nothing lives only there. Create a task in the GSI view and it&apos;s tagged GSI automatically; tag a task with two verticals and it shows in both views.</p>
              <Link href={withVertical('/dashboard/', otherSlug)} className="text-blue-600 hover:underline inline-flex items-center gap-1">Open the GSI view <ArrowRight className="w-3 h-3" /></Link>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><ListTodo className="w-4 h-4 text-emerald-600" /> Create from anywhere</p>
              <p>Channels are <strong>shared</strong>: any task can sit in any channel, whatever it&apos;s tagged. A channel created from a vertical&apos;s view simply lists first there. Change a task&apos;s tags any time in its drawer, under <strong>Vertical</strong>.</p>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 2 */}
      <Section n={2} title="How work is organised">
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-stretch gap-2">
              {LEVELS.map((l, i) => (
                <div key={l.name} className="flex items-center gap-2">
                  <div className={`rounded-xl border px-3 py-2.5 min-w-[140px] ${l.color}`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold"><l.icon className="w-3.5 h-3.5" /> {l.name} <InfoTip k={l.k} /></div>
                    <p className="text-[11px] opacity-80 mt-0.5">{l.eg}</p>
                  </div>
                  {i < LEVELS.length - 1 && <ArrowRight className="w-4 h-4 text-zinc-300 shrink-0" />}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 text-xs text-zinc-600">
              <Note><strong className="text-zinc-800">Groups are only folders.</strong> Nothing is owned at that level. Channels and sub-channels are where owners, targets and tasks live — in Projects each channel is a project.</Note>
              <Note><strong className="text-zinc-800">&ldquo;No channel&rdquo;.</strong> Every vertical has one built in. A task created without picking a channel lands there, so nothing needs a channel just to be written down.</Note>
              <Note><strong className="text-zinc-800">Domains</strong> tie the same channel across verticals: GSI Content and Lyzr Content roll up to one Content domain owner.</Note>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 3 */}
      <Section n={3} title="Projects: Board, Table and List">
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-zinc-600">
              {[
                { icon: Columns3, t: 'Board', d: 'The Kanban: one column per status. Drag a card to move it along. The default view.' },
                { icon: Table2, t: 'Table', d: 'Every task as a row — owner, due date, priority, status. Tick rows to change many at once.' },
                { icon: List, t: 'List', d: 'A compact to-do list. Tick the round checkbox to finish a task; its colour is the priority.' },
              ].map(x => (
                <Note key={x.t}><p className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5 mb-1"><x.icon className="w-4 h-4 text-blue-600" /> {x.t}</p>{x.d}</Note>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-zinc-600">
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1"><LyzrSail className="w-4 h-3" /> Everything</strong> — the Lyzr board: every task in every vertical. Projects opens here.</Note>
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1"><Inbox className="w-3.5 h-3.5" /> My tasks · Today</strong> — just your work, and what&apos;s due today or overdue.</Note>
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1"><ListTodo className="w-3.5 h-3.5" /> + Add task</strong> — type what needs doing at the top of any view and press Enter. No project picked = Lyzr&apos;s &ldquo;No channel&rdquo;.</Note>
            </div>
            <Link href="/projects/" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Open Projects <ArrowRight className="w-3 h-3" /></Link>
          </CardContent>
        </Card>
      </Section>

      {/* 4 */}
      <Section n={4} title="A task's life" tip="status">
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(['not_started', 'in_progress', 'live', 'done'] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: STATUS_CONFIG[s].bgColor, color: STATUS_CONFIG[s].color }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_DOT[s] }} />{STATUS_CONFIG[s].label}
                  </span>
                  {i < 3 && <ArrowRight className="w-4 h-4 text-zinc-300" />}
                </div>
              ))}
              <span className="text-zinc-300 mx-1">|</span>
              {(['blocked', 'cancelled'] as const).map(s => (
                <span key={s} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: STATUS_CONFIG[s].bgColor, color: STATUS_CONFIG[s].color }}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_DOT[s] }} />{STATUS_CONFIG[s].label}
                </span>
              ))}
            </div>
            <p className="text-xs text-zinc-600"><strong className="text-zinc-800">Traffic light:</strong> green = live or done, yellow = in progress, red = blocked (and red dates are overdue), grey = not started.</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-zinc-600">
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1">Priority <InfoTip k="priority" /></strong><br />Critical, High, Medium, Low, Backlog.</Note>
              <Note><strong className="text-zinc-800">Owners</strong><br />A main owner plus helpers, reviewers or FYI. Sub-tasks have their own owner — new ones start with the parent&apos;s. No owner = the channel&apos;s owners.</Note>
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> Repeat <InfoTip k="recurring" /></strong><br />Every N days, weeks or months; ends never, on a date, or after N times.</Note>
              <Note><strong className="text-zinc-800 inline-flex items-center gap-1">Plan → Results <InfoTip k="tracker_fields" /></strong><br />Plan: how often, importance tier, target. Results (once live): result achieved, money spent, proof link.</Note>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 5 */}
      <Section n={5} title="Who sees what">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="bg-white border-zinc-200"><CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4 text-violet-600" /> Admins and leadership</div>
            <p className="text-xs text-zinc-600">Start on <strong>Company home</strong> — the across-company view — and get the company pages: All Tasks (the leadership view), Overview, Weekly, Owners, Domains, Members, History.</p>
          </CardContent></Card>
          <Card className="bg-white border-zinc-200"><CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4 text-emerald-600" /> Everyone else, vertical owners included</div>
            <p className="text-xs text-zinc-600">Start on <strong>My Board</strong> — just their own work — with a short sidebar: My Board, Projects, My Tasks, Campaigns, Calendar, Guide. The switcher reads &ldquo;My work&rdquo;.</p>
          </CardContent></Card>
        </div>
        <p className="text-[11px] text-zinc-500">Admins can preview any role with <strong>View as</strong> in the account menu at the bottom of the sidebar.</p>
      </Section>

      {/* 6 */}
      <Section n={6} title="Every screen, in one line">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {VIEWS.map(v => (
            <Link key={v.name} href={linkFor(v)} className="block group">
              <Card className="bg-white border-zinc-200 group-hover:border-blue-300 h-full transition-colors">
                <CardContent className="p-4 flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600"><v.icon className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5 flex-wrap">{v.name}
                      <span className={`text-[9px] uppercase tracking-wider font-medium rounded px-1 ${MODE_TAG[v.mode].cls}`}>{MODE_TAG[v.mode].label}</span>
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">{v.text || HELP[v.k]}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      {/* 7 */}
      <Section n={7} title="Roles: who can change what">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-zinc-600">
          <Note><strong className="text-zinc-800">Roles stack.</strong> One person can own a vertical, own a domain and be a plain member somewhere else, all at once.</Note>
          <Note><strong className="text-zinc-800">Everyone can read everything.</strong> Roles only change what you can <em>change</em>. People who haven&apos;t signed in yet can still be named; it attaches on their first Microsoft sign-in.</Note>
          <Note><strong className="text-zinc-800">Editing a task.</strong> Its owners, the channel and vertical owners above it, and admins edit. Everyone else presses &ldquo;Suggest an edit&rdquo;; every change is logged in the task&apos;s History.</Note>
        </div>
      </Section>

      {/* 8 */}
      <Section n={8} title="Campaigns: launches and thunderclaps" tip="campaign">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Rocket, n: 'Launch', d: 'A product or feature release everyone rallies behind. Its tasks, from any channel, show one progress bar.' },
            { icon: Zap, n: 'Thunderclap', d: 'One day, one ask — everyone posts or shares at once. Each person ticks off their part.' },
            { icon: Target, n: 'Campaign', d: 'A multi-week push across several channels or teams.' },
          ].map(x => (
            <Card key={x.n} className="bg-white border-zinc-200"><CardContent className="p-4 space-y-1">
              <div className="text-sm font-semibold flex items-center gap-1.5"><x.icon className="w-4 h-4 text-orange-500" /> {x.n}</div>
              <p className="text-xs text-zinc-600">{x.d}</p>
            </CardContent></Card>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-zinc-600">
          <Note><strong className="text-zinc-800">Who sees the banner.</strong> Everyone in the company, or only one vertical. It shows on their home pages until the campaign ends.</Note>
          <Note><strong className="text-zinc-800">Leads and tasks.</strong> Type names to pick the leads. Add the first tasks while creating it; link more later from any task.</Note>
          <Note><strong className="text-zinc-800">Optional banner button,</strong> e.g. &ldquo;Open the launch doc&rdquo;. <Link href="/campaigns/" className="text-blue-600 hover:underline inline-flex items-center gap-1">Open Campaigns <ArrowRight className="w-3 h-3" /></Link></Note>
        </div>
      </Section>

      {/* 9 */}
      <Section n={9} title="Filters and dates, the same everywhere">
        <Card className="bg-white border-zinc-200">
          <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-600">
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Calendar className="w-4 h-4 text-blue-600" /> Date range <InfoTip k="date_range" /></p><p>Presets (this week, last month, quarter, last 30 days) or two days on the calendar. The arrows step by the same length.</p></div>
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Filter className="w-4 h-4 text-blue-600" /> Filter bar</p><p>Owner (including people not signed in yet, and Unassigned), status, priority, vertical, domain, channel and search.</p></div>
            <div className="space-y-1"><p className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1"><Sparkles className="w-4 h-4 text-blue-600" /> Saved views <InfoTip k="saved_views" /></p><p>On the Tracker, save the current filters and sort under a name and reload them later.</p></div>
          </CardContent>
        </Card>
      </Section>

      {/* 10 */}
      <Section n={10} title="Setting things up (admins)">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { n: 1, t: 'Verticals', d: 'Workspace settings › Verticals. Clone a template for the full channel tree, or start empty. Lyzr is permanent and always first.', k: 'template' },
            { n: 2, t: 'Channels & structure', d: 'Groups, channels and sub-channels per vertical. “No channel” is created automatically.', k: 'channel' },
            { n: 3, t: 'People and roles', d: 'Members page: admins, leadership, vertical, domain and channel owners.', k: 'vertical_owner' },
            { n: 4, t: 'Task fields', d: 'Extra questions a channel’s tasks ask (e.g. Venue, Daily budget). Four steps; drag to reorder.', k: 'feature_flags' },
          ].map(s => (
            <Card key={s.n} className="bg-white border-zinc-200">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">{s.n}</span><span className="text-sm font-semibold text-zinc-900">{s.t}</span><InfoTip k={s.k} /></div>
                <p className="text-xs text-zinc-600">{s.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Link href="/admin/" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Open Workspace settings <ArrowRight className="w-3 h-3" /></Link>
      </Section>

      {/* 11 */}
      <Section n={11} title="The assistant (top right)" tip="assistant">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="bg-white border-zinc-200"><CardContent className="p-4 space-y-1">
            <div className="text-sm font-semibold">“Assign the Q4 ABM email on GSI Email to Anju, due Friday”</div>
            <p className="text-xs text-zinc-600">It opens the normal task form pre-filled with title, channel, owner, due date and priority. You press <strong>Create</strong>.</p>
          </CardContent></Card>
          <Card className="bg-white border-zinc-200"><CardContent className="p-4 space-y-1">
            <div className="text-sm font-semibold">“What is the status of the Accenture webinar task?”</div>
            <p className="text-xs text-zinc-600">It finds the task and answers in one line with status, owner and due date, plus a link to open it.</p>
          </CardContent></Card>
        </div>
        <p className="text-[11px] text-zinc-500">It does nothing else on purpose: no summaries, no edits, no deletes, and never writes without you pressing Create.</p>
      </Section>
    </div>
  )
}
