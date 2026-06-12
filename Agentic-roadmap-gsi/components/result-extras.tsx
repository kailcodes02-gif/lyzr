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
            <StatTile icon={TrendingUp} value={formatUSD(opp.annualValueUSD)} label="Est. value" />
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
          <StatTile icon={TrendingUp} value={formatUSD(opp.annualValueUSD)} label="Est. value" />
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
          Talk to Us About This Agent
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

function JourneyChart({ start }: { start: number }) {
  const W = 720;
  const H = 240;
  const padL = 44;
  const padR = 20;
  const padT = 16;
  const padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const ys = [start, Math.max(35, start + 6), 56, 76, 89, 95];
  const n = ys.length;
  const x = (i: number) => padL + (i * chartW) / (n - 1);
  const y = (v: number) => padT + (1 - v / 100) * chartH;
  const pts = ys.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${padL},${padT + chartH} ${pts} ${padL + chartW},${padT + chartH}`;
  const xLabels = ["Start", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      <defs>
        <linearGradient id="journey" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-build)" />
          <stop offset="60%" stopColor="var(--color-fix)" />
          <stop offset="100%" stopColor="var(--color-build)" />
        </linearGradient>
        <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(62,156,114,0.16)" />
          <stop offset="100%" stopColor="rgba(62,156,114,0)" />
        </linearGradient>
      </defs>
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
        <circle key={i} cx={x(i)} cy={y(v)} r={5} fill="var(--color-surface)" stroke={i >= 3 ? "var(--color-fix)" : "var(--color-build)"} strokeWidth={2.5} />
      ))}
      {xLabels.map((l, i) => (
        <text key={l} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
          {l}
        </text>
      ))}
    </svg>
  );
}

export function PathToAE({ a }: { a: Assessment }) {
  const byLane = (lane: Lane) => a.opportunities.filter((o) => o.lane === lane);
  const buildNow = byLane("build_now");
  const fixFirst = byLane("fix_first");
  const notNow = byLane("not_now");
  const sum = (arr: Opportunity[]) => arr.reduce((s, o) => s + o.annualValueUSD, 0);
  const vB = sum(buildNow);
  const vF = sum(fixFirst);

  const phases = [
    { key: "Foundation", auto: Math.max(25, a.maturityScore), agents: buildNow, cumulative: vB, tone: "build" as const },
    { key: "Expansion", auto: 55, agents: fixFirst, cumulative: vB + vF, tone: "fix" as const },
    { key: "Optimization", auto: 78, agents: notNow, cumulative: a.estAnnualValueUSD, tone: "fix" as const },
    { key: "Autonomous Enterprise", auto: 95, agents: a.opportunities, cumulative: a.estAnnualValueUSD, tone: "build" as const },
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
            <Sparkles className="h-3 w-3 text-accent" /> Target: 95% automation
          </span>
        </div>
        <div className="aspect-[16/6] w-full">
          <JourneyChart start={a.maturityScore} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {phases.map((p, i) => (
          <Card key={p.key} className="p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-muted">
                {i === 3 ? <Sparkles className="h-4 w-4 text-accent" /> : `Y${i + 1}`}
              </span>
              <Pill tone={p.tone}>{p.key.split(" ")[0]}</Pill>
            </div>
            <div className="num mt-3 font-display text-2xl font-semibold text-build">{formatUSD(p.cumulative)}</div>
            <div className="text-xs text-faint">cumulative value · {p.auto}% automation</div>
            <div className="mt-3 text-xs text-faint">
              {p.agents.length} agent{p.agents.length === 1 ? "" : "s"} in this phase:
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.agents.slice(0, 2).map((o) => (
                <span key={o.id} className="rounded-lg border border-border bg-surface-2/60 px-2 py-1 text-[0.66rem] text-muted">
                  {o.name.split(" ").slice(0, 2).join(" ")}
                </span>
              ))}
              {p.agents.length > 2 && <span className="px-1 py-1 text-[0.66rem] text-faint">+{p.agents.length - 2}</span>}
            </div>
          </Card>
        ))}
      </div>
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

export function DevBoardTab({ a, onSelect }: { a: Assessment; onSelect: (o: Opportunity) => void }) {
  return (
    <div>
      <div className="mb-4">
        <Eyebrow>Development board</Eyebrow>
        <p className="mt-1 text-sm text-muted">Your agent portfolio as a delivery pipeline. Click a card for the full blueprint.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = col.lane ? a.opportunities.filter((o) => o.lane === col.lane) : [];
          return (
            <div key={col.key} className="space-y-3">
              <div className="rounded-xl border border-border bg-surface/70 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-fg">{col.key}</span>
                  <span className="num text-sm text-faint">{items.length}</span>
                </div>
                <div className="text-[0.7rem] text-faint">{col.hint}</div>
              </div>
              <div className="space-y-2.5">
                {items.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => onSelect(o)}
                    className="w-full rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[0.7rem] text-faint">{o.funcLabel}</span>
                      <span className="num text-xs text-accent">{formatUSD(o.annualValueUSD)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium leading-snug text-fg">{o.name}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${o.readinessScore}%`, backgroundColor: LANE_META[o.lane].cssVar }}
                        />
                      </span>
                      <span className="num text-[0.7rem] text-faint">{o.readinessScore}</span>
                    </div>
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-faint">
                    Fills as you ship.
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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function DemandTab({ a, onSelect }: { a: Assessment; onSelect: (o: Opportunity) => void }) {
  const [open, setOpen] = useState<string | null>(THEMES[0].id);
  const total = a.opportunities.reduce((s, o) => s + o.annualValueUSD, 0) || 1;

  const groups = THEMES.map((t) => {
    const items = a.opportunities.filter((o) => t.funcs.includes(o.func));
    const value = items.reduce((s, o) => s + o.annualValueUSD, 0);
    const share = (value / total) * 100;
    const apps = 30 + (hashStr(t.id) % 36);
    return { ...t, items, share, apps };
  }).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="mb-4">
        <Eyebrow>Demand intelligence</Eyebrow>
        <p className="mt-1 text-sm text-muted">What teams like yours are already asking for — explore the related agents.</p>
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
                      <span className="num text-xs text-accent">{g.share.toFixed(1)}%</span>
                    </div>
                    <p className="mt-0.5 max-w-xl text-xs text-muted">{g.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="num text-sm font-medium text-fg">{g.apps} apps</div>
                    <div className="text-[0.7rem] text-faint">{g.items.length} agents</div>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-faint transition-transform", isOpen && "rotate-180")} />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border px-5 py-4">
                  <div className="mb-3 text-[0.7rem] text-faint">Top requests from teams:</div>
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
