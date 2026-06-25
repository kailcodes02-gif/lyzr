"use client";

import { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Download,
  FileText,
  Gauge,
  ListChecks,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { Card, Eyebrow, Pill } from "@/components/ui";
import { useValuesShown } from "@/components/value-context";
import { cn, formatUSD } from "@/lib/utils";
import { LANE_META, laneTone } from "@/lib/display";
import type { Assessment, Lane, Opportunity } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Opportunity detail drawer                                          */
/* ------------------------------------------------------------------ */

function exportOpp(o: Opportunity) {
  const blob = new Blob([JSON.stringify(o, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = `${o.id}-blueprint.json`;
  el.click();
  URL.revokeObjectURL(url);
}

function StatTile({ icon: Icon, value, label }: { icon: React.ElementType; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-center">
      <Icon className="mx-auto h-4 w-4 text-faint" />
      <div className="num mt-1.5 font-display text-base font-semibold text-fg">{value}</div>
      <div className="mt-0.5 text-[0.6rem] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

const FIT_LABELS: { key: keyof Opportunity["fit"]; label: string }[] = [
  { key: "budgetAligned", label: "Budget aligned" },
  { key: "teamSkillFit", label: "Team skill fit" },
  { key: "championAssigned", label: "Champion assigned" },
  { key: "dataAvailable", label: "Data available" },
];

export function OpportunityDrawer({
  opp,
  onClose,
  onViewBlueprint,
}: {
  opp: Opportunity | null;
  onClose: () => void;
  onViewBlueprint: () => void;
}) {
  const shown = useValuesShown();
  if (!opp) return null;
  const meta = LANE_META[opp.lane];
  const priorityTone = opp.priority === "Critical" ? "critical" : opp.priority === "High" ? "fix" : "muted";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-slide-in absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" style={{ color: meta.cssVar }}>
              {meta.label}
            </span>
            <Pill tone={priorityTone as "critical" | "fix" | "muted"}>{opp.priority}</Pill>
            {opp.aiGenerated && (
              <Pill tone="accent">
                <Sparkles className="mr-1 h-2.5 w-2.5" /> AI
              </Pill>
            )}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h2 className="font-display text-xl font-semibold leading-snug text-fg">{opp.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{opp.description}</p>

          {/* stat tiles */}
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {shown && <StatTile icon={TrendingUp} value={formatUSD(opp.annualValueUSD)} label="Est. value" />}
            <StatTile icon={Gauge} value={`${opp.impactScore}`} label="Impact" />
            <StatTile icon={Gauge} value={`${opp.complexityScore}`} label="Complexity" />
            <StatTile icon={Clock} value={opp.timeToValue} label="Timeline" />
          </div>

          {/* department + risk */}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-border p-3">
              <div className="text-[0.6rem] uppercase tracking-wide text-faint">Department</div>
              <div className="mt-0.5 text-sm font-medium text-fg">{opp.funcLabel}</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-[0.6rem] uppercase tracking-wide text-faint">Risk level</div>
              <div
                className="mt-0.5 text-sm font-medium"
                style={{ color: opp.riskLevel === "High" ? "var(--color-critical)" : opp.riskLevel === "Medium" ? "var(--color-fix)" : "var(--color-build)" }}
              >
                {opp.riskLevel}
              </div>
            </div>
          </div>

          {/* business outcomes */}
          <Section title="Business outcomes" icon={Sparkles}>
            <ul className="space-y-2">
              {opp.keyBenefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-muted">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  {b}
                </li>
              ))}
            </ul>
          </Section>

          {/* implementation */}
          <Section title="Technologies" icon={FileText}>
            <div className="flex flex-wrap gap-1.5">
              {opp.technologies.map((t) => (
                <span key={t} className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-1 text-xs text-muted">
                  {t}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Implementation workflow" icon={ListChecks}>
            <ol className="space-y-2.5">
              {opp.workflow.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-sm text-muted">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong text-[0.65rem] text-faint">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Section>

          {/* fit */}
          <Section title="Fit for your organization" icon={CircleCheck}>
            <div className="grid grid-cols-2 gap-2.5">
              {FIT_LABELS.map((f) => {
                const ok = opp.fit[f.key];
                return (
                  <div key={f.key} className="flex items-center gap-2 text-sm">
                    {ok ? <CircleCheck className="h-4 w-4 text-build" /> : <CircleX className="h-4 w-4 text-critical" />}
                    <span className={ok ? "text-fg" : "text-muted"}>{f.label}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* blockers */}
          {opp.blockers.length > 0 && (
            <div className="mt-5 rounded-xl border border-fix/30 bg-fix/[0.05] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-fix">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-fix/20 text-[0.65rem]">!</span>
                Blockers to resolve
              </div>
              <ul className="mt-2 space-y-1">
                {opp.blockers.map((b) => (
                  <li key={b} className="text-sm text-muted">
                    • {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center gap-2.5 border-t border-border bg-surface px-6 py-4">
          <button
            onClick={onViewBlueprint}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink text-sm font-semibold text-white transition-all hover:bg-[#3a322c]"
          >
            View Full Blueprint
          </button>
          <button
            onClick={() => exportOpp(opp)}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border-strong px-4 text-sm font-medium text-fg transition-all hover:border-accent/50 hover:text-accent"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>
    </div>
  );
}

export function OpportunityBlueprint({ opp, onBack, onBookDemo }: { opp: Opportunity; onBack: () => void; onBookDemo: () => void }) {
  const shown = useValuesShown();
  const meta = LANE_META[opp.lane];
  const priorityTone = opp.priority === "Critical" ? "critical" : opp.priority === "High" ? "fix" : "muted";

  return (
    <div className="animate-fade-up mt-8">
      {/* back nav */}
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        <ArrowRight className="h-4 w-4 rotate-180" />
        Back to roadmap
      </button>

      {/* hero */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium" style={{ color: meta.cssVar }}>
            {meta.label}
          </span>
          <Pill tone={priorityTone as "critical" | "fix" | "muted"}>{opp.priority}</Pill>
          {opp.aiGenerated && (
            <Pill tone="accent">
              <Sparkles className="mr-1 h-2.5 w-2.5" /> AI
            </Pill>
          )}
        </div>
        <h2 className="mt-3 font-display text-2xl font-semibold leading-snug text-fg sm:text-[1.7rem]">{opp.name}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{opp.description}</p>

        {/* stat tiles */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {shown && <StatTile icon={TrendingUp} value={formatUSD(opp.annualValueUSD)} label="Est. value" />}
          <StatTile icon={Gauge} value={`${opp.impactScore}`} label="Impact" />
          <StatTile icon={Gauge} value={`${opp.complexityScore}`} label="Complexity" />
          <StatTile icon={Clock} value={opp.timeToValue} label="Timeline" />
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-center">
            <FileText className="mx-auto h-4 w-4 text-faint" />
            <div className="mt-1.5 text-sm font-medium text-fg">{opp.funcLabel}</div>
            <div className="mt-0.5 text-[0.6rem] uppercase tracking-wide text-faint">Department</div>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-center">
            <Gauge className="mx-auto h-4 w-4 text-faint" />
            <div
              className="mt-1.5 text-sm font-medium"
              style={{ color: opp.riskLevel === "High" ? "var(--color-critical)" : opp.riskLevel === "Medium" ? "var(--color-fix)" : "var(--color-build)" }}
            >
              {opp.riskLevel}
            </div>
            <div className="mt-0.5 text-[0.6rem] uppercase tracking-wide text-faint">Risk level</div>
          </div>
        </div>
      </div>

      {/* 2-column detail grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* left column */}
        <div className="space-y-6">
          {/* business outcomes */}
          <Card className="p-6">
            <Section title="Business outcomes" icon={Sparkles}>
              <ul className="space-y-2.5">
                {opp.keyBenefits.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-muted">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    {b}
                  </li>
                ))}
              </ul>
            </Section>
          </Card>

          {/* implementation workflow */}
          <Card className="p-6">
            <Section title="Implementation workflow" icon={ListChecks}>
              <ol className="space-y-3">
                {opp.workflow.map((step, i) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-muted">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-medium text-faint">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </Section>
          </Card>
        </div>

        {/* right column */}
        <div className="space-y-6">
          {/* technologies */}
          <Card className="p-6">
            <Section title="Technologies" icon={FileText}>
              <div className="flex flex-wrap gap-2">
                {opp.technologies.map((t) => (
                  <span key={t} className="rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-xs text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          </Card>

          {/* organization fit */}
          <Card className="p-6">
            <Section title="Fit for your organization" icon={CircleCheck}>
              <div className="grid grid-cols-2 gap-3">
                {FIT_LABELS.map((f) => {
                  const ok = opp.fit[f.key];
                  return (
                    <div key={f.key} className="flex items-center gap-2.5 text-sm">
                      {ok ? <CircleCheck className="h-4 w-4 text-build" /> : <CircleX className="h-4 w-4 text-critical" />}
                      <span className={ok ? "text-fg" : "text-muted"}>{f.label}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          </Card>

          {/* blockers */}
          {opp.blockers.length > 0 && (
            <div className="rounded-xl border border-fix/30 bg-fix/[0.05] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-fix">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-fix/20 text-xs">!</span>
                Blockers to resolve
              </div>
              <ul className="mt-3 space-y-1.5">
                {opp.blockers.map((b) => (
                  <li key={b} className="text-sm text-muted">
                    • {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* footer actions */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          onClick={onBookDemo}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-all hover:bg-[#3a322c]"
        >
          Build this with Lyzr
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => exportOpp(opp)}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-border-strong px-5 text-sm font-medium text-fg transition-all hover:border-accent/50 hover:text-accent"
        >
          <Download className="h-4 w-4" /> Export Blueprint
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Path to AE — journey curve + phase cards                           */
/* ------------------------------------------------------------------ */

function JourneyChart({ start, target }: { start: number; target: number }) {
  const W = 720;
  const H = 240;
  const padL = 58;
  const padR = 24;
  const padT = 26;
  const padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // A monotonic climb from today's readiness to the automation target —
  // the path never regresses year over year.
  const n = 6;
  const ys = Array.from({ length: n }, (_, i) => Math.round(start + ((target - start) * i) / (n - 1)));
  const x = (i: number) => padL + (i * chartW) / (n - 1);
  const y = (v: number) => padT + (1 - v / 100) * chartH;
  const pts = ys.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${padL},${padT + chartH} ${pts} ${padL + chartW},${padT + chartH}`;
  const xLabels = ["Today", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      <defs>
        <linearGradient id="journey" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-build)" />
          <stop offset="100%" stopColor="var(--color-fix)" />
        </linearGradient>
        <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(62,156,114,0.16)" />
          <stop offset="100%" stopColor="rgba(62,156,114,0)" />
        </linearGradient>
      </defs>
      {/* y-axis title */}
      <text
        transform={`translate(15 ${padT + chartH / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={10}
        fill="var(--color-faint)"
      >
        % of operations automated
      </text>
      {/* gridlines */}
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={padL} y1={y(g)} x2={padL + chartW} y2={y(g)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={padL - 8} y={y(g)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--color-faint)">
            {g}%
          </text>
        </g>
      ))}
      <polygon points={area} fill="url(#journeyFill)" />
      <polyline points={pts} fill="none" stroke="url(#journey)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {ys.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={5} fill="var(--color-surface)" stroke={i === n - 1 ? "var(--color-fix)" : "var(--color-build)"} strokeWidth={2.5} />
      ))}
      {/* endpoint value callouts: where you are today vs. the target */}
      <text x={x(0)} y={y(ys[0]) - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-build)">
        {ys[0]}%
      </text>
      <text x={x(n - 1)} y={y(ys[n - 1]) - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-fix)">
        {ys[n - 1]}%
      </text>
      {xLabels.map((l, i) => (
        <text key={l} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
          {l}
        </text>
      ))}
    </svg>
  );
}

const PHASE_NARRATIVE: Record<string, string> = {
  Foundation:
    "The agents that are ready now — lowest blockers, fastest payback. Shipping these proves value and frees up budget for the next wave.",
  Expansion:
    "Agents that needed a readiness gap closed first. With the foundation live and your data and processes in place, these now come online.",
  Optimization:
    "Higher-complexity or lower-priority agents. By now your platform, data, and governance are mature enough to take them on.",
  "Autonomous Enterprise":
    "Every function has agents running with people supervising rather than doing the work — the compounding end state where the value across all phases is live at once.",
};

type Phase = { key: string; auto: number; agents: Opportunity[]; cumulative: number };

function PhaseDetail({ phase, start, shown }: { phase: Phase; start: number; shown: boolean }) {
  const added = phase.agents.reduce((s, o) => s + o.annualValueUSD, 0);
  return (
    <Card className="animate-fade p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-base font-semibold text-fg">{phase.key} — what gets you here</h4>
        <span className="text-xs text-muted">
          Automation {start}% → <span className="font-semibold text-fg">{phase.auto}%</span>
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{PHASE_NARRATIVE[phase.key]}</p>
      {shown && phase.agents.length > 0 && (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Building {phase.agents.length} agent{phase.agents.length === 1 ? "" : "s"} here adds about{" "}
          <span className="num font-semibold text-accent">{formatUSD(added)}/yr</span> — for a cumulative{" "}
          <span className="num font-semibold text-build">{formatUSD(phase.cumulative)}/yr</span> once it&apos;s live.
        </p>
      )}
      <div className="mt-3 space-y-1.5">
        {phase.agents.length === 0 ? (
          <p className="text-xs text-faint">No agents in this phase for your current selection.</p>
        ) : (
          phase.agents.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
              <span className="truncate text-sm text-fg">{o.name}</span>
              <span className="flex shrink-0 items-center gap-2.5 text-xs text-faint">
                <span className="hidden sm:inline">{o.funcLabel}</span>
                {shown && <span className="num font-semibold text-accent">{formatUSD(o.annualValueUSD)}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function PathToAE({ a }: { a: Assessment }) {
  const shown = useValuesShown();
  const [open, setOpen] = useState<number | null>(0);
  const byLane = (lane: Lane) => a.opportunities.filter((o) => o.lane === lane);
  const buildNow = byLane("build_now");
  const fixFirst = byLane("fix_first");
  const notNow = byLane("not_now");
  const sum = (arr: Opportunity[]) => arr.reduce((s, o) => s + o.annualValueUSD, 0);
  const vB = sum(buildNow);
  const vF = sum(fixFirst);

  // Climb from today's readiness to the automation target — shared by the
  // curve and the phase cards so the story stays consistent.
  const start = a.maturityScore;
  const target = start >= 90 ? Math.min(100, start + 4) : 95;
  const lerp = (t: number) => Math.round(start + (target - start) * t);

  const phases = [
    { key: "Foundation", auto: lerp(0), agents: buildNow, cumulative: vB, tone: "build" as const },
    { key: "Expansion", auto: lerp(0.45), agents: fixFirst, cumulative: vB + vF, tone: "fix" as const },
    { key: "Optimization", auto: lerp(0.75), agents: notNow, cumulative: a.estAnnualValueUSD, tone: "fix" as const },
    { key: "Autonomous Enterprise", auto: lerp(1), agents: a.opportunities, cumulative: a.estAnnualValueUSD, tone: "build" as const },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Path to autonomous enterprise</Eyebrow>
        <p className="mt-1 text-sm text-muted">Your strategic roadmap to AI-powered operations across every function.</p>
      </div>

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-fg">Journey to Autonomous Enterprise</h3>
            <p className="text-xs text-faint">5-year progression from foundation to full automation</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-border-strong px-3 py-1 text-xs text-muted sm:inline-flex">
            <Sparkles className="h-3 w-3 text-accent" /> Target: {target}% automation
          </span>
        </div>
        <div className="aspect-[16/6] w-full">
          <JourneyChart start={start} target={target} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The curve is your projected automation level climbing from {start}% today to {target}% as each wave of agents goes
          live. Tap a year below to see exactly which agents get you there and what they&apos;re worth.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, i) => {
          const isOpen = open === i;
          return (
            <button key={p.key} type="button" onClick={() => setOpen(isOpen ? null : i)} className="text-left">
              <Card className={cn("h-full p-5 transition-all hover:border-accent/40", isOpen && "ring-1 ring-accent/40")}>
                <div className="flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-muted">
                    {i === 3 ? <Sparkles className="h-4 w-4 text-accent" /> : `Y${i + 1}`}
                  </span>
                  <Pill tone={p.tone}>{p.key.split(" ")[0]}</Pill>
                </div>
                {shown ? (
                  <>
                    <div className="num mt-3 font-display text-2xl font-semibold text-build">{formatUSD(p.cumulative)}</div>
                    <div className="text-xs text-faint">cumulative value · {p.auto}% automation</div>
                  </>
                ) : (
                  <>
                    <div className="num mt-3 font-display text-2xl font-semibold text-build">{p.auto}%</div>
                    <div className="text-xs text-faint">projected automation</div>
                  </>
                )}
                <div className="mt-3 flex items-center gap-1 text-[0.72rem] font-medium text-accent">
                  {isOpen ? "Hide details" : "What gets you here"}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      {open !== null && <PhaseDetail phase={phases[open]} start={start} shown={shown} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Development Board — kanban by delivery stage                        */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: string; lane: Lane | null; hint: string }[] = [
  { key: "Backlog", lane: "not_now", hint: "Parked until ready" },
  { key: "Scoped", lane: "fix_first", hint: "Gaps to close first" },
  { key: "Building", lane: "build_now", hint: "Ready to ship" },
  { key: "Live", lane: null, hint: "Shipped to production" },
];

export function DevBoardTab({
  a,
  onSelect,
  shipped,
  onMove,
  onShip,
}: {
  a: Assessment;
  onSelect: (o: Opportunity) => void;
  shipped: Record<string, true>;
  onMove: (id: string, lane: Lane) => void;
  onShip: (id: string, shipped: boolean) => void;
}) {
  const shown = useValuesShown();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const itemsFor = (col: { lane: Lane | null }) =>
    col.lane === null
      ? a.opportunities.filter((o) => shipped[o.id])
      : a.opportunities.filter((o) => o.lane === col.lane && !shipped[o.id]);

  const drop = (col: { lane: Lane | null }) => {
    if (!dragId) return;
    if (col.lane === null) onShip(dragId, true);
    else onMove(dragId, col.lane); // parent un-ships on a lane move
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div>
      <div className="mb-4">
        <Eyebrow>Development board</Eyebrow>
        <p className="mt-1 text-sm text-muted">
          Your agent portfolio as a delivery pipeline. Drag a card across stages — drop it in Live when it ships. Click a card for the full blueprint.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = itemsFor(col);
          const isOver = overCol === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.key) setOverCol(col.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(col);
              }}
              className={cn("space-y-3 rounded-2xl p-1.5 transition-colors", isOver && "bg-accent/[0.06] ring-1 ring-accent/30")}
            >
              <div className="rounded-xl border border-border bg-surface/70 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-fg">{col.key}</span>
                  <span className="num text-sm text-faint">{items.length}</span>
                </div>
                <div className="text-[0.7rem] text-faint">{col.hint}</div>
              </div>
              <div className="space-y-2.5">
                {items.map((o) => (
                  <div
                    key={o.id}
                    draggable
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    onClick={() => onSelect(o)}
                    className={cn(
                      "cursor-grab rounded-xl border border-border bg-surface p-3 text-left transition-all hover:border-accent/40 active:cursor-grabbing",
                      dragId === o.id && "opacity-40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[0.7rem] text-faint">{o.funcLabel}</span>
                      {shown && <span className="num text-xs text-accent">{formatUSD(o.annualValueUSD)}</span>}
                    </div>
                    <div className="mt-1 text-sm font-medium leading-snug text-fg">{o.name}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${o.readinessScore}%`, backgroundColor: col.lane === null ? "var(--color-build)" : LANE_META[o.lane].cssVar }}
                        />
                      </span>
                      <span className="num text-[0.7rem] text-faint">{o.readinessScore}</span>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-faint">
                    {isOver ? "Drop here" : col.key === "Live" ? "Drag here when shipped." : "Nothing here yet."}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Demand Intelligence                                                */
/* ------------------------------------------------------------------ */

const THEMES: { id: string; label: string; funcs: string[]; desc: string; requests: string[] }[] = [
  {
    id: "content",
    label: "Content & Marketing Automation",
    funcs: ["marketing", "sales"],
    desc: "Multi-agent applications for content generation, campaigns, and competitive intelligence.",
    requests: ['"Build an end-to-end app with 5+ agents for marketing"', '"Build an agent that researches content ideas"'],
  },
  {
    id: "finance",
    label: "Financial Processing & Compliance",
    funcs: ["finance", "legal", "procurement"],
    desc: "Intelligent agents for processing, reconciliation, KYC compliance, and risk detection.",
    requests: ['"Automate invoice and statement processing"', '"Flag risk exposure across our portfolio"'],
  },
  {
    id: "support",
    label: "Customer Support Enhancement",
    funcs: ["customer", "it"],
    desc: "AI-driven support for chat, ticket resolution, and incident triage.",
    requests: ['"Resolve tier-1 tickets automatically"', '"Triage and route inbound requests"'],
  },
  {
    id: "knowledge",
    label: "Knowledge & Operations",
    funcs: ["knowledge", "operations", "hr"],
    desc: "Research synthesis, document intelligence, and process automation across teams.",
    requests: ['"Draft client briefs from our research"', '"Automate our document-heavy workflows"'],
  },
];

export function DemandTab({ a, onSelect }: { a: Assessment; onSelect: (o: Opportunity) => void }) {
  const [open, setOpen] = useState<string | null>(THEMES[0].id);

  const groups = THEMES.map((t) => {
    const items = a.opportunities.filter((o) => t.funcs.includes(o.func));
    return { ...t, items };
  }).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Eyebrow>Demand intelligence</Eyebrow>
          <Pill tone="muted">Illustrative</Pill>
        </div>
        <p className="mt-1 text-sm text-muted">
          Common agent patterns we see across teams like yours, grouped by theme — explore the agents mapped to each.
        </p>
      </div>

      <div className="space-y-3">
        {groups.map((g) => {
          const isOpen = open === g.id;
          return (
            <Card key={g.id} className="overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : g.id)} className="flex w-full items-start justify-between gap-4 p-5 text-left">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold text-fg">{g.label}</span>
                    </div>
                    <p className="mt-0.5 max-w-xl text-xs text-muted">{g.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="num text-sm font-medium text-fg">{g.items.length}</div>
                    <div className="text-[0.7rem] text-faint">agent{g.items.length === 1 ? "" : "s"}</div>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-faint transition-transform", isOpen && "rotate-180")} />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border px-5 py-4">
                  <div className="mb-3 text-[0.7rem] text-faint">Example requests these agents handle:</div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {g.requests.map((r) => (
                      <span key={r} className="rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 text-xs text-muted">
                        {r}
                      </span>
                    ))}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface-2/50 text-[0.7rem] uppercase tracking-wide text-faint">
                        <tr>
                          <th className="px-3 py-2 font-medium">Agent</th>
                          <th className="hidden px-3 py-2 font-medium sm:table-cell">Department</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Impact</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((o) => (
                          <tr
                            key={o.id}
                            onClick={() => onSelect(o)}
                            className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2/40"
                          >
                            <td className="px-3 py-2.5 font-medium text-fg">{o.name}</td>
                            <td className="hidden px-3 py-2.5 text-muted sm:table-cell">{o.funcLabel}</td>
                            <td className="px-3 py-2.5">
                              <Pill tone={laneTone(o.lane)}>{LANE_META[o.lane].label}</Pill>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                                  <span className="block h-full rounded-full bg-ink" style={{ width: `${o.impactScore}%` }} />
                                </span>
                                <span className="num text-xs text-muted">{o.impactScore}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
