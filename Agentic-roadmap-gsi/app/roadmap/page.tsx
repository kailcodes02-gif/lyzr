"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Loader2, Sparkles, TrendingUp, CircleCheck, X } from "lucide-react";
import { Logo, Card, Eyebrow, Ring, Pill, Bar } from "@/components/ui";
import { Radar, type RadarPoint } from "@/components/radar";
import { OpportunityDrawer, OpportunityBlueprint, PathToAE, DevBoardTab, DemandTab } from "@/components/result-extras";
import { cn, formatUSD } from "@/lib/utils";
import { buildAssessment, DEEPEN, DIMENSIONS } from "@/lib/content";
import { LANE_META, SHORT, dimColor } from "@/lib/display";
import type { Assessment, DimensionId, IntakeData, Lane, Opportunity } from "@/lib/types";

const TABS = ["Scorecard", "Roadmap", "Development Board", "Path to AE", "Opportunity Map", "Demand Intelligence"] as const;
type Tab = (typeof TABS)[number];

export default function RoadmapPage() {
  const router = useRouter();
  const [intake, setIntake] = useState<IntakeData | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [tab, setTab] = useState<Tab>("Scorecard");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [blueprintOpp, setBlueprintOpp] = useState<Opportunity | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  // User's manual roadmap arrangement (oppId -> lane), persisted per session.
  const [laneOverrides, setLaneOverrides] = useState<Record<string, Lane>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem("agentic_intake");
    const sid = sessionStorage.getItem("agentic_session");
    if (raw && sid) {
      const it = JSON.parse(raw) as IntakeData;
      setSessionId(sid);
      setIntake(it);
      setAssessment(buildAssessment(it));
      refetch(it, sid);
      return;
    }
    // resume a saved assessment (returning visitor / new tab)
    const params = new URLSearchParams(window.location.search);
    const resumeId = params.get("s") || localStorage.getItem("agentic_last_session");
    if (resumeId) {
      fetch(`/api/roadmap?session=${encodeURIComponent(resumeId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.assessment && d?.intake) {
            setSessionId(resumeId);
            setIntake(d.intake);
            setAssessment(d.assessment);
          } else {
            router.replace("/onboarding");
          }
        })
        .catch(() => router.replace("/onboarding"));
      return;
    }
    router.replace("/onboarding");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refetch(it: IntakeData, sid: string | null) {
    setEnriching(true);
    try {
      const r = await fetch("/api/roadmap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intake: it, sessionId: sid }),
      });
      if (r.ok) setAssessment(await r.json());
    } catch {
      /* keep deterministic */
    } finally {
      setEnriching(false);
    }
  }

  // Load the saved roadmap arrangement once we know the session.
  useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(`agentic_roadmap_plan_${sessionId}`);
      if (raw) setLaneOverrides(JSON.parse(raw) as Record<string, Lane>);
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const moveOpp = useCallback(
    (id: string, lane: Lane) => {
      setLaneOverrides((prev) => {
        if (prev[id] === lane) return prev;
        const next = { ...prev, [id]: lane };
        if (sessionId) {
          try {
            localStorage.setItem(`agentic_roadmap_plan_${sessionId}`, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    },
    [sessionId],
  );

  function applyDeepen(dim: DimensionId, answers: Record<string, string>) {
    setIntake((prev) => {
      if (!prev) return prev;
      const completedDeepen = prev.completedDeepen.includes(dim) ? prev.completedDeepen : [...prev.completedDeepen, dim];
      const updated: IntakeData = { ...prev, deepen: { ...prev.deepen, [dim]: answers }, completedDeepen };
      setAssessment(buildAssessment(updated));
      refetch(updated, sessionId);
      return updated;
    });
  }

  if (!assessment || !intake) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          Building your roadmap…
        </div>
      </main>
    );
  }

  // Effective assessment with the user's manual lane arrangement applied.
  const a: Assessment = Object.keys(laneOverrides).length
    ? {
        ...assessment,
        opportunities: assessment.opportunities.map((o) =>
          laneOverrides[o.id] ? { ...o, lane: laneOverrides[o.id] } : o,
        ),
      }
    : assessment;
  const name = intake.quick.company.name?.trim() || "Your";
  const counts: Record<Lane, number> = {
    build_now: a.opportunities.filter((o) => o.lane === "build_now").length,
    fix_first: a.opportunities.filter((o) => o.lane === "fix_first").length,
    not_now: a.opportunities.filter((o) => o.lane === "not_now").length,
  };
  // Lead with credible near-term value (Build Now + Fix First); the full
  // catalog is shown separately as a longer-horizon range, not the headline.
  const nearTermValue = a.opportunities
    .filter((o) => o.lane !== "not_now")
    .reduce((s, o) => s + o.annualValueUSD, 0);

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24">
      {/* top bar */}
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <span className="hidden font-display text-sm font-medium text-muted sm:block">Agent Roadmap</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex",
              enriching ? "border-accent/40 text-accent" : a.source === "ai" ? "border-accent/30 text-accent" : "border-border-strong text-faint",
            )}
          >
            {enriching ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Tailoring with Lyzr AI…
              </>
            ) : a.source === "ai" ? (
              <>
                <Sparkles className="h-3 w-3" /> Tailored by Lyzr AI
              </>
            ) : (
              <>Rule-based estimate</>
            )}
          </span>
          <button
            onClick={() => setDemoOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-white transition-all hover:bg-[#3a322c]"
          >
            Book a demo
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* hero summary */}
      <section className="animate-fade-up">
        <Eyebrow>
          {a.maturityStage} stage · AI readiness {a.maturityScore}/100
        </Eyebrow>
        <h1 className="mt-2 max-w-3xl font-display text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-[1.8rem]">
          {name}
          {name.endsWith("s") ? "'" : "'s"} Agent Portfolio
        </h1>
        <p className="mt-2 max-w-3xl text-[0.98rem] leading-relaxed text-muted">{a.headline}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Near-term value" value={formatUSD(nearTermValue)} sub="Build Now + Fix First" accent />
          <Stat label="Ready to build" value={`${counts.build_now}`} />
          <Stat label="Functions" value={`${a.functionsCount}`} />
          <Stat label="Opportunities" value={`${a.opportunities.length}`} />
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-faint">
          Full catalog potential: up to {formatUSD(a.estAnnualValueUSD)} across all {a.opportunities.length} opportunities over a multi-year horizon.
        </p>
      </section>

      {/* lane counters */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {(Object.keys(LANE_META) as Lane[]).map((lane) => (
          <button
            key={lane}
            onClick={() => setTab("Roadmap")}
            className="flex items-center justify-between rounded-xl border border-border bg-surface/70 px-4 py-3 text-left transition-colors hover:border-border-strong"
          >
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANE_META[lane].cssVar }} />
              <span className="text-sm font-medium text-fg">{LANE_META[lane].label}</span>
            </span>
            <span className="num font-display text-lg font-semibold text-fg">{counts[lane]}</span>
          </button>
        ))}
      </div>

      {blueprintOpp ? (
        <OpportunityBlueprint opp={blueprintOpp} onBack={() => setBlueprintOpp(null)} onBookDemo={() => setDemoOpen(true)} />
      ) : (
        <>
          {/* tabs */}
          <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors",
                  tab === t ? "text-fg" : "text-faint hover:text-muted",
                )}
              >
                {t}
                {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>

          <div className="mt-7">
            {tab === "Scorecard" && <Scorecard a={a} intake={intake} onDeepen={applyDeepen} />}
            {tab === "Roadmap" && <RoadmapTab a={a} onSelect={setSelected} onMove={moveOpp} />}
            {tab === "Development Board" && <DevBoardTab a={a} onSelect={setSelected} />}
            {tab === "Path to AE" && <PathToAE a={a} />}
            {tab === "Opportunity Map" && <MapTab a={a} onSelect={setSelected} />}
            {tab === "Demand Intelligence" && <DemandTab a={a} onSelect={setSelected} />}
          </div>
        </>
      )}

      <OpportunityDrawer
        opp={selected}
        onClose={() => setSelected(null)}
        onViewBlueprint={() => {
          setBlueprintOpp(selected);
          setSelected(null);
        }}
      />
      <BookDemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Stat                                                               */
/* ------------------------------------------------------------------ */

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-faint">{label}</div>
      <div className={cn("num mt-1 font-display text-xl font-semibold", accent ? "text-accent" : "text-fg")}>{value}</div>
      {sub && <div className="mt-0.5 text-[0.62rem] uppercase tracking-wide text-faint">{sub}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Scorecard tab                                                      */
/* ------------------------------------------------------------------ */

function Scorecard({
  a,
  intake,
  onDeepen,
}: {
  a: Assessment;
  intake: IntakeData;
  onDeepen: (dim: DimensionId, answers: Record<string, string>) => void;
}) {
  const radarPoints: RadarPoint[] = a.dimensions.map((d) => ({ label: SHORT[d.id], score: d.score, color: dimColor(d.status) }));
  const dimsByScore = [...a.dimensions].sort((x, y) => y.score - x.score);
  const toFix = [...a.dimensions].sort((x, y) => x.score - y.score).filter((d) => d.status !== "strong").slice(0, 3);

  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>Readiness scorecard</Eyebrow>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num font-display text-3xl font-semibold text-fg">{a.maturityScore}</span>
              <span className="text-sm text-faint">/100 · {a.maturityStage}</span>
            </div>
          </div>
          <Ring value={a.maturityScore} size={72} color="var(--color-accent)" />
        </div>
        <div className="mx-auto mt-2 aspect-square w-full max-w-[340px]">
          <Radar points={radarPoints} />
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-faint">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-build" />Strong</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-fix" />Developing</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-critical" />Gap</span>
        </div>
      </Card>

      <div className="space-y-5">
        <Card className="p-6">
          <div className="mb-1 flex items-center justify-between">
            <Eyebrow>Dimension breakdown</Eyebrow>
            <span className="text-xs text-faint">
              Confidence <span className="num font-medium text-muted">{a.confidence}%</span>
            </span>
          </div>
          <div className="mt-4 space-y-4">
            {dimsByScore.map((d) => (
              <div key={d.id}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{d.label}</span>
                  <span className="num text-sm text-muted">{d.score}</span>
                </div>
                <Bar value={d.score} color={dimColor(d.status)} />
                <p className="mt-1.5 text-xs leading-relaxed text-faint">{d.insight}</p>
              </div>
            ))}
          </div>
        </Card>

        {toFix.length > 0 && (
          <Card className="border-fix/25 bg-fix/[0.04] p-6">
            <Eyebrow className="text-fix">Close these first</Eyebrow>
            <ul className="mt-3 space-y-2">
              {toFix.map((d) => (
                <li key={d.id} className="flex gap-2.5 text-sm text-muted">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dimColor(d.status) }} />
                  <span>
                    <span className="font-medium text-fg">{d.label}.</span> {d.insight}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <DeepenPanel intake={intake} onDeepen={onDeepen} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deepen panel                                                       */
/* ------------------------------------------------------------------ */

function DeepenPanel({ intake, onDeepen }: { intake: IntakeData; onDeepen: (dim: DimensionId, answers: Record<string, string>) => void }) {
  const [open, setOpen] = useState<DimensionId | null>(null);
  const remaining = DIMENSIONS.filter((d) => !intake.completedDeepen.includes(d.id));

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow>Strengthen your assessment</Eyebrow>
          <p className="mt-1 text-xs text-muted">
            Add detail to raise confidence and sharpen your roadmap. {intake.completedDeepen.length}/6 done.
          </p>
        </div>
        <TrendingUp className="h-5 w-5 text-accent" />
      </div>

      <div className="mt-4 space-y-2">
        {DIMENSIONS.map((d) => {
          const done = intake.completedDeepen.includes(d.id);
          const isOpen = open === d.id;
          return (
            <div key={d.id} className="rounded-xl border border-border bg-surface-2/40">
              <button onClick={() => setOpen(isOpen ? null : d.id)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="flex items-center gap-2.5">
                  {done ? (
                    <CircleCheck className="h-4 w-4 text-build" />
                  ) : (
                    <span className="grid h-4 w-4 place-items-center rounded-full border border-border-strong text-[0.6rem] text-faint">+</span>
                  )}
                  <span className={cn("text-sm font-medium", done ? "text-muted" : "text-fg")}>{d.label}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!done && <span className="text-xs text-accent">+6% confidence</span>}
                  <ChevronDown className={cn("h-4 w-4 text-faint transition-transform", isOpen && "rotate-180")} />
                </span>
              </button>
              {isOpen && (
                <DeepenForm
                  dim={d.id}
                  initial={intake.deepen[d.id] ?? {}}
                  onSubmit={(ans) => {
                    onDeepen(d.id, ans);
                    setOpen(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {remaining.length === 0 && (
        <p className="mt-4 text-center text-xs text-build">All dimensions strengthened — your roadmap is at peak confidence.</p>
      )}
    </Card>
  );
}

function DeepenForm({
  dim,
  initial,
  onSubmit,
}: {
  dim: DimensionId;
  initial: Record<string, string>;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const questions = DEEPEN[dim];
  const complete = questions.every((q) => answers[q.id]);

  return (
    <div className="space-y-4 border-t border-border px-4 py-4">
      {questions.map((q) => (
        <div key={q.id}>
          <div className="mb-2 text-xs font-medium text-muted">{q.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <button
                key={o.value}
                onClick={() => setAnswers((p) => ({ ...p, [q.id]: o.value }))}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs transition-all",
                  answers[q.id] === o.value ? "border-accent/60 bg-accent/10 text-fg" : "border-border-strong text-muted hover:text-fg",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={() => onSubmit(answers)}
        disabled={!complete}
        className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-xs font-semibold text-white transition-all hover:bg-[#3a322c] disabled:pointer-events-none disabled:opacity-40"
      >
        Apply &amp; recompute
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roadmap tab                                                        */
/* ------------------------------------------------------------------ */

function RoadmapTab({ a, onSelect, onMove }: { a: Assessment; onSelect: (o: Opportunity) => void; onMove: (id: string, lane: Lane) => void }) {
  const lanes: Lane[] = ["build_now", "fix_first", "not_now"];
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<Lane | null>(null);

  return (
    <div>
      <p className="mb-3 px-1 text-xs text-faint">Drag a card between lanes to shape your own plan — your arrangement is saved to this session.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        {lanes.map((lane) => {
          const items = a.opportunities.filter((o) => o.lane === lane);
          const meta = LANE_META[lane];
          const isOver = overLane === lane;
          return (
            <div
              key={lane}
              onDragOver={(e) => {
                e.preventDefault();
                if (overLane !== lane) setOverLane(lane);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setOverLane(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) onMove(dragId, lane);
                setDragId(null);
                setOverLane(null);
              }}
              className={cn("space-y-3 rounded-2xl p-1.5 transition-colors", isOver && "bg-accent/[0.06] ring-1 ring-accent/30")}
            >
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface/70 px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.cssVar }} />
                  <span className="font-display text-sm font-semibold text-fg">{meta.label}</span>
                </span>
                <span className="num text-sm text-faint">{items.length}</span>
              </div>
              <p className="px-1 text-xs text-faint">{meta.blurb}</p>
              <div className="space-y-2.5">
                {items.map((o) => (
                  <CompactOppCard
                    key={o.id}
                    o={o}
                    onSelect={onSelect}
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverLane(null);
                    }}
                    dragging={dragId === o.id}
                  />
                ))}
                {items.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-faint">
                    {isOver ? "Drop here" : "Nothing here yet."}
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

function CompactOppCard({
  o,
  onSelect,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  o: Opportunity;
  onSelect: (o: Opportunity) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const priorityTone = o.priority === "Critical" ? "critical" : o.priority === "High" ? "fix" : "muted";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(o)}
      className={cn(
        "group cursor-grab rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent/40 active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[0.7rem] text-faint">{o.funcLabel}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {o.aiGenerated && (
            <Pill tone="accent">
              <Sparkles className="mr-1 h-2.5 w-2.5" /> AI
            </Pill>
          )}
          <Pill tone={priorityTone as "critical" | "fix" | "muted"}>{o.priority}</Pill>
        </div>
      </div>
      <h4 className="mt-1.5 font-display text-[0.9rem] font-semibold leading-snug text-fg">{o.name}</h4>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="num font-display text-base font-semibold text-accent">{formatUSD(o.annualValueUSD)}</span>
        <div className="flex items-center gap-2 text-[0.7rem] text-faint">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full" style={{ width: `${o.readinessScore}%`, backgroundColor: LANE_META[o.lane].cssVar }} />
          </span>
          <span className="num">{o.readinessScore}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Opportunity Map tab                                                */
/* ------------------------------------------------------------------ */

function MapTab({ a, onSelect }: { a: Assessment; onSelect: (o: Opportunity) => void }) {
  const values = a.opportunities.map((o) => o.annualValueUSD);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const yOf = (v: number) => (max === min ? 50 : 12 + 76 * (1 - (v - min) / (max - min)));

  const quadrants = useMemo(
    () => [
      { label: "Build Now", sub: "high value · ready", pos: "right-3 top-3 text-right", tone: "text-build" },
      { label: "Quick experiments", sub: "lower value · ready", pos: "right-3 bottom-3 text-right", tone: "text-muted" },
      { label: "Strategic bets", sub: "high value · not ready", pos: "left-3 top-3", tone: "text-fix" },
      { label: "Park", sub: "lower value · not ready", pos: "left-3 bottom-3", tone: "text-hold" },
    ],
    [],
  );

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Eyebrow>Opportunity map</Eyebrow>
          <p className="mt-1 text-xs text-muted">Annual value against readiness. Top-right is where to start. Click a dot for detail.</p>
        </div>
      </div>

      <div className="relative mx-auto h-[260px] w-full max-w-2xl rounded-xl border border-border bg-surface-2/30 sm:h-[300px]">
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {quadrants.map((qd) => (
          <div key={qd.label} className={cn("absolute max-w-[40%]", qd.pos)}>
            <div className={cn("text-[0.72rem] font-medium", qd.tone)}>{qd.label}</div>
            <div className="text-[0.62rem] text-faint">{qd.sub}</div>
          </div>
        ))}
        {a.opportunities.map((o) => (
          <button
            key={o.id}
            onClick={() => onSelect(o)}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${6 + o.readinessScore * 0.88}%`, top: `${yOf(o.annualValueUSD)}%` }}
          >
            <span
              className="block rounded-full ring-2 ring-surface transition-transform group-hover:scale-125"
              style={{
                width: 10 + Math.min(14, o.annualValueUSD / 120000),
                height: 10 + Math.min(14, o.annualValueUSD / 120000),
                backgroundColor: LANE_META[o.lane].cssVar,
              }}
            />
            <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border-strong bg-surface px-2 py-1 text-[0.66rem] text-fg shadow-lg group-hover:block">
              {o.name} · {formatUSD(o.annualValueUSD)}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[0.66rem] text-faint">
        <span>← lower readiness</span>
        <span>higher readiness →</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-4 text-xs text-faint">
        {(Object.keys(LANE_META) as Lane[]).map((lane) => (
          <span key={lane} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANE_META[lane].cssVar }} />
            {LANE_META[lane].label}
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Book a Demo modal (same iframe as lyzr.ai)                         */
/* ------------------------------------------------------------------ */

function BookDemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const iframeRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      if (!node || !open) return;
      // Once loaded, tell the iframe to open with UTM attribution
      const onLoad = () => {
        node.contentWindow?.postMessage(
          {
            type: "OPEN_DEMO_MODAL",
            email: "",
            source: window.location.href,
            utmSource: "agentic-roadmap",
            utmMedium: "product",
            utmCampaign: "ai-readiness-assessment",
            firstTouchUrl: window.location.href,
            lastTouchPage: window.location.href,
            referrer: document.referrer || "",
          },
          "*",
        );
      };
      node.addEventListener("load", onLoad);
      return () => node.removeEventListener("load", onLoad);
    },
    [open],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "CLOSE_DEMO_MODAL") onClose();
      if (e.data?.type === "OPEN_BOOKING_LINK" && e.data.url) {
        window.open(e.data.url, "_blank");
        onClose();
      }
    };
    window.addEventListener("message", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("message", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-surface/80 text-fg transition-colors hover:bg-surface-2"
      >
        <X className="h-5 w-5" />
      </button>
      <iframe
        ref={iframeRef}
        src="https://lead-scoring-agent-by-lyzr.vercel.app/book-demo-modal?page=agentic-roadmap&utm_source=agentic-roadmap&utm_medium=product&utm_campaign=ai-readiness-assessment"
        className="h-full w-full max-w-2xl rounded-2xl border-0"
        style={{ maxHeight: "90vh" }}
        allow="clipboard-write"
      />
    </div>
  );
}
