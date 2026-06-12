import Link from "next/link";
import { ArrowRight, Building2, Compass, Sparkles, Target } from "lucide-react";
import { Logo, Eyebrow, Card, Pill } from "@/components/ui";

const ctaPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[0.95rem] font-semibold text-white transition-all hover:bg-[#3a322c] shadow-[0_10px_24px_-14px_rgba(38,33,28,0.6)]";
const ctaGhost =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-strong px-6 text-[0.95rem] font-medium text-fg transition-all hover:border-accent/60 hover:text-accent";

const STEPS = [
  {
    icon: Building2,
    n: "01",
    title: "Profile your firm",
    body: "Tell us your industry, the work you do, the systems you run, and the processes you'd love to automate.",
  },
  {
    icon: Compass,
    n: "02",
    title: "Score your readiness",
    body: "We assess six dimensions — use-case clarity, data, technology, team, governance, and sponsorship.",
  },
  {
    icon: Target,
    n: "03",
    title: "Get your agent roadmap",
    body: "A prioritized portfolio of agent opportunities, sorted into Build Now, Fix First, and Not Now.",
  },
];

const LANES = [
  { label: "Build Now", tone: "build" as const, items: ["Customer Support Agent", "Sales Development", "Billing Reconciliation"] },
  { label: "Fix First", tone: "fix" as const, items: ["Content & Campaigns", "Document Intelligence", "Contract Review"] },
  { label: "Not Now", tone: "hold" as const, items: ["Voice Triage", "Compliance Monitoring"] },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-5 pb-24">
      {/* nav */}
      <header className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">Agentic Roadmap</span>
          <Link href="/onboarding" className="text-sm font-medium text-muted transition-colors hover:text-fg">
            Talk to Lyzr
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="grid items-center gap-10 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
        <div className="animate-fade-up">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/70 px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-medium text-muted">AI Readiness · Agentic Roadmap</span>
          </div>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
            Map your firm&apos;s path to an{" "}
            <span className="font-serif italic font-medium text-accent">autonomous enterprise</span>.
          </h1>
          <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-muted">
            A consultative AI-readiness assessment for mid-to-large firms. Answer a few questions about your
            business and walk away with a scored readiness diagnosis and a prioritized roadmap of the agents
            worth building first.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/onboarding" className={ctaPrimary}>
              Build your roadmap
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#how" className={ctaGhost}>
              See how it works
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-faint">
            <span>~3 minute quick scan</span>
            <span className="h-1 w-1 rounded-full bg-border-strong" />
            <span>6-dimension readiness score</span>
            <span className="h-1 w-1 rounded-full bg-border-strong" />
            <span>No sign-up to start</span>
          </div>
        </div>

        {/* hero preview */}
        <Card className="animate-fade-up p-5 lg:p-6" style={{ animationDelay: "0.1s" }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-faint">Agent Portfolio</div>
              <div className="font-display text-lg font-semibold text-fg">12 opportunities</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-faint">Est. annual value</div>
              <div className="num font-display text-lg font-semibold text-accent">$4.3M</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {LANES.map((lane) => (
              <div key={lane.label} className="rounded-xl border border-border bg-surface-2/60 p-2.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        lane.tone === "build"
                          ? "var(--color-build)"
                          : lane.tone === "fix"
                            ? "var(--color-fix)"
                            : "var(--color-hold)",
                    }}
                  />
                  <span className="text-[0.7rem] font-medium text-muted">{lane.label}</span>
                </div>
                <div className="space-y-1.5">
                  {lane.items.map((it) => (
                    <div key={it} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[0.68rem] leading-tight text-muted">
                      {it}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[0.7rem] text-faint">Illustrative — your roadmap is generated from your answers.</p>
        </Card>
      </section>

      {/* how it works */}
      <section id="how" className="pt-24 lg:pt-32">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-3 max-w-2xl font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          From a few honest answers to a roadmap you can act on.
        </h2>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.n} className="p-6">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-border-strong bg-surface-2 text-accent">
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="num font-display text-sm text-faint">{s.n}</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* dimensions strip */}
      <section className="pt-20">
        <Card className="flex flex-col items-start justify-between gap-6 p-7 sm:flex-row sm:items-center">
          <div>
            <Eyebrow>What we measure</Eyebrow>
            <p className="mt-2 max-w-md text-sm text-muted">
              Six readiness dimensions decide which agents are worth building — and which gaps to close first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Use-Case Clarity", "Strategy", "Data Readiness", "Technology", "Team & Skills", "Governance"].map((d) => (
              <Pill key={d} tone="accent">
                {d}
              </Pill>
            ))}
          </div>
        </Card>
      </section>

      {/* footer */}
      <footer className="mt-24 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 text-sm text-faint sm:flex-row">
        <Logo />
        <span>Agentic Roadmap · a Lyzr lead assessment</span>
      </footer>
    </main>
  );
}
