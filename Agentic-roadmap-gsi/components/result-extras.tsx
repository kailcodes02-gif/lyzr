"use client";

import { useEffect, useState } from "react";
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
import { Card, Eyebrow, InfoTip, Pill } from "@/components/ui";
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

/** Lowest number in a "3–5 weeks" string (first-value estimate). */
function weeksOf(timeToValue: string): number {
  const m = timeToValue.match(/\d+/);
  return m ? Number(m[0]) : 8;
}

/**
 * A stat shown against an illustrative global benchmark: a bar for the actual
 * value, a tick for the benchmark, a one-word verdict, and an (i) with the math.
 * `good` is computed by the caller (since "lower is better" for some metrics).
 */
function StatGauge({
  icon: Icon,
  label,
  value,
  pct,
  benchmark,
  good,
  info,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  pct?: number;
  benchmark?: number;
  good?: boolean;
  info: string;
}) {
  const color = good ? "var(--color-build)" : "var(--color-fix)";
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-3">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-faint" />
        <InfoTip text={info} />
      </div>
      <div className="num mt-1 font-display text-base font-semibold text-fg">{value}</div>
      <div className="text-[0.6rem] uppercase tracking-wide text-faint">{label}</div>
      {pct != null && (
        <>
          <div className="relative mt-2 h-1.5 w-full rounded-full bg-surface">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, pct))}%`, backgroundColor: color }} />
            {benchmark != null && (
              <span
                className="absolute -top-[3px] h-[12px] w-px bg-fg/45"
                style={{ left: `${Math.max(0, Math.min(100, benchmark))}%` }}
                title="global benchmark"
              />
            )}
          </div>
          {good != null && (
            <div className="mt-1 text-[0.6rem] font-medium" style={{ color }}>
              {good ? "Better than typical" : "Below typical"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One stack-specific question per function — its answer tailors the blueprint. */
const FUNC_QUESTIONS: Record<string, { q: string; key: string; options: string[] }> = {
  hr: { q: "Which ATS / HRIS do you run?", key: "hr-sys", options: ["Workday", "Greenhouse", "SuccessFactors", "Other"] },
  sales: { q: "Which CRM do you use?", key: "sales-crm", options: ["Salesforce", "HubSpot", "Pipedrive", "Other"] },
  marketing: { q: "Where do you run campaigns?", key: "mkt-sys", options: ["HubSpot", "Marketo", "Mailchimp", "Other"] },
  finance: { q: "Which ERP / finance system?", key: "fin-erp", options: ["SAP", "Oracle", "NetSuite", "Other"] },
  customer: { q: "Which support desk?", key: "cs-desk", options: ["Zendesk", "Intercom", "Freshdesk", "Other"] },
  operations: { q: "Where do your workflows live?", key: "ops-sys", options: ["SAP", "ServiceNow", "Custom", "Other"] },
  it: { q: "Which ITSM tool?", key: "it-itsm", options: ["ServiceNow", "Jira SM", "Zendesk", "Other"] },
  legal: { q: "Where are contracts stored?", key: "legal-clm", options: ["Ironclad", "DocuSign CLM", "SharePoint", "Other"] },
  knowledge: { q: "Where does knowledge live?", key: "know-kb", options: ["Confluence", "SharePoint", "Notion", "Other"] },
  procurement: { q: "Which procurement system?", key: "proc-sys", options: ["Coupa", "SAP Ariba", "Custom", "Other"] },
};

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
  // Per-function "tailor this" answer (e.g. which ATS) — persisted, applies to the function.
  const question = opp ? FUNC_QUESTIONS[opp.func] : undefined;
  const [tailor, setTailor] = useState<string | null>(null);
  useEffect(() => {
    if (!question) return setTailor(null);
    try {
      setTailor(localStorage.getItem(`agentic_tailor_${question.key}`));
    } catch {
      setTailor(null);
    }
  }, [question?.key]);
  const chooseTailor = (v: string) => {
    if (!question) return;
    setTailor(v);
    try {
      localStorage.setItem(`agentic_tailor_${question.key}`, v);
    } catch {
      /* ignore */
    }
  };

  if (!opp) return null;
  const meta = LANE_META[opp.lane];
  const priorityTone = opp.priority === "Critical" ? "critical" : opp.priority === "High" ? "fix" : "muted";
  const named = tailor && tailor !== "Other" ? tailor : null;
  const workflowSteps = named ? [`Connect your ${named}`, ...opp.workflow] : opp.workflow;

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

          {/* stat gauges — actual vs an illustrative global benchmark */}
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatGauge
              icon={TrendingUp}
              label="Money saved / yr"
              value={formatUSD(opp.annualValueUSD)}
              info={`Labor cost avoided ≈ ${opp.effectiveFTEs} full-time-equivalents of manual work × ~${formatUSD(opp.loadedCostPerPerson)}/yr fully-loaded cost per person in your market = ${formatUSD(opp.annualValueUSD)}/yr. Directional, not a quote.`}
            />
            <StatGauge
              icon={Gauge}
              label="Impact"
              value={`${opp.impactScore}/100`}
              pct={opp.impactScore}
              benchmark={60}
              good={opp.impactScore >= 60}
              info="Impact = how much value this agent moves, derived from its readiness and money saved. Typical agent ≈ 60/100; higher is better."
            />
            <StatGauge
              icon={Gauge}
              label="Complexity"
              value={`${opp.complexityScore}/100`}
              pct={opp.complexityScore}
              benchmark={60}
              good={opp.complexityScore <= 60}
              info="Complexity = build effort and delivery risk. Typical agent ≈ 60/100; LOWER is better — simpler to ship."
            />
            <StatGauge
              icon={Clock}
              label="Timeline"
              value={opp.timeToValue}
              pct={(weeksOf(opp.timeToValue) / 16) * 100}
              benchmark={50}
              good={weeksOf(opp.timeToValue) <= 8}
              info="Estimated time to first value. Typical agent ≈ 8 weeks (the benchmark tick); sooner is better."
            />
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

          {/* tailor-this — one stack question per function, woven into the workflow */}
          {question && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.04] p-4">
              <div className="text-sm font-medium text-fg">Tailor this for your stack</div>
              <div className="mt-0.5 text-xs text-faint">{question.q}</div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {question.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => chooseTailor(opt)}
                    className={cn(
                      "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-all",
                      tailor === opt
                        ? "border-accent bg-accent text-white"
                        : "border-border-strong bg-surface text-muted hover:border-accent/50 hover:text-fg",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {named && (
                <div className="mt-2 text-xs text-muted">
                  We&apos;ll wire this agent into your <span className="font-medium text-fg">{named}</span> — see step 1 below.
                </div>
              )}
            </div>
          )}

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
              {workflowSteps.map((step, i) => (
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
          <StatGauge icon={TrendingUp} label="Money saved / yr" value={formatUSD(opp.annualValueUSD)}
            info={`Labor cost avoided ≈ ${opp.effectiveFTEs} full-time-equivalents × ~${formatUSD(opp.loadedCostPerPerson)}/yr fully-loaded cost per person in your market. Directional, not a quote.`} />
          <StatGauge icon={Gauge} label="Impact" value={`${opp.impactScore}/100`} pct={opp.impactScore} benchmark={60} good={opp.impactScore >= 60}
            info="Impact = value moved, from readiness and money saved. Typical ≈ 60/100; higher is better." />
          <StatGauge icon={Gauge} label="Complexity" value={`${opp.complexityScore}/100`} pct={opp.complexityScore} benchmark={60} good={opp.complexityScore <= 60}
            info="Build effort & risk. Typical ≈ 60/100; lower is better." />
          <StatGauge icon={Clock} label="Timeline" value={opp.timeToValue} pct={(weeksOf(opp.timeToValue) / 16) * 100} benchmark={50} good={weeksOf(opp.timeToValue) <= 8}
            info="Time to first value. Typical ≈ 8 weeks; sooner is better." />
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
/* Development Board — kanban by delivery stage                        */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: string; lane: Lane | null; hint: string; info: string }[] = [
  { key: "Backlog", lane: "not_now", hint: "Ideas parked for later", info: "Agents to revisit once your readiness or priorities shift." },
  { key: "Planned", lane: "fix_first", hint: "Queued — close a gap first", info: "On the plan, but close one readiness gap (data, sponsorship, a clearer use case) before building." },
  { key: "In progress", lane: "build_now", hint: "Ready / building now", info: "Ready to build — start these first." },
  { key: "Live", lane: null, hint: "Shipped to production", info: "Agents you've shipped. Drag a card here when it goes live." },
];

const PRIO: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

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

  const itemsFor = (col: { lane: Lane | null }) => {
    const base =
      col.lane === null
        ? a.opportunities.filter((o) => shipped[o.id])
        : a.opportunities.filter((o) => o.lane === col.lane && !shipped[o.id]);
    // Priority-ordered so the most important agents sit at the top of each column.
    return [...base].sort((x, y) => (PRIO[x.priority] - PRIO[y.priority]) || y.annualValueUSD - x.annualValueUSD);
  };

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
        <Eyebrow>Your planning board</Eyebrow>
        <p className="mt-1 text-sm text-muted">
          Plan and sequence your agentic rollout — drag agents across stages as you go, and drop one in Live when it ships. Cards are ordered by priority; click any card for the full blueprint.
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
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-sm font-semibold text-fg">{col.key}</span>
                    <InfoTip text={col.info} />
                  </span>
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
