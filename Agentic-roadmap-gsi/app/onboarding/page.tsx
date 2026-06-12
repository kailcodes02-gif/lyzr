"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { Logo, Chip, Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  AI_EXPERIENCE,
  BUDGETS,
  COMPANY_SIZES,
  COMPLIANCE,
  DATA_LOCATION,
  DATA_QUALITY,
  DATA_STRUCTURE,
  DEPLOYMENT,
  EXISTING_AI,
  emptyIntake,
  FUNCTIONS,
  GATE_QUESTIONS,
  INDUSTRIES,
  Opt,
  PAINS,
  RISK_APPETITE,
  SKILL_LEVELS,
  SYSTEMS,
  TEAM_SIZES,
  TIMELINES,
} from "@/lib/content";
import type { QuickScan, Tri } from "@/lib/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STEP_META = [
  { label: "Company", sub: "Tell us about your organization" },
  { label: "Use-Case", sub: "What work do you want agents to do?" },
  { label: "Data", sub: "Where your data lives and how clean it is" },
  { label: "Technology", sub: "The systems and tools you run today" },
  { label: "Team", sub: "Capacity, skills, and how you govern AI" },
  { label: "Strategy", sub: "Investment and a quick production reality check" },
];

/* ---- field helpers ---- */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <label className="text-sm font-medium text-fg">{label}</label>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Grid({ children, cols = 3 }: { children: React.ReactNode; cols?: number }) {
  return <div className={cn("grid gap-2.5", cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>{children}</div>;
}

function ChipGroup({ options, value, onChange, cols = 3 }: { options: Opt[]; value: string; onChange: (v: string) => void; cols?: number }) {
  return (
    <Grid cols={cols}>
      {options.map((o) => (
        <Chip key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
          <div className="font-medium text-current">{o.label}</div>
          {o.hint && <div className="mt-0.5 text-xs text-faint">{o.hint}</div>}
        </Chip>
      ))}
    </Grid>
  );
}

function MultiChipGroup({ options, values, onChange, cols = 3 }: { options: Opt[]; values: string[]; onChange: (v: string[]) => void; cols?: number }) {
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <Grid cols={cols}>
      {options.map((o) => (
        <Chip key={o.value} selected={values.includes(o.value)} onClick={() => toggle(o.value)}>
          <span className="font-medium text-current">{o.label}</span>
        </Chip>
      ))}
    </Grid>
  );
}

const TRI: { value: Tri; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "partial", label: "Partial" },
  { value: "no", label: "No" },
];

function TriRow({ label, hint, value, onChange }: { label: string; hint: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="text-xs text-faint">{hint}</div>
      </div>
      <div className="flex gap-1.5">
        {TRI.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-medium transition-all",
              value === t.value
                ? t.value === "yes"
                  ? "border-build/50 bg-build/10 text-build"
                  : t.value === "no"
                    ? "border-critical/50 bg-critical/10 text-critical"
                    : "border-fix/50 bg-fix/10 text-fix"
                : "border-border-strong text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- wizard ---- */

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState<QuickScan>(emptyIntake().quick);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof QuickScan>(key: K, value: QuickScan[K]) => setQ((prev) => ({ ...prev, [key]: value }));

  const canContinue = (() => {
    switch (step) {
      case 0:
        return EMAIL_RE.test(q.email) && !!q.company.industry && !!q.company.size;
      case 1:
        return q.functions.length > 0;
      case 2:
        return !!q.data.location && !!q.data.structure && !!q.data.quality;
      case 3:
        return !!q.tech.deployment && !!q.tech.existingAI;
      case 4:
        return !!q.team.size && !!q.team.skill && !!q.team.aiExperience && !!q.governance.compliance && !!q.governance.riskAppetite;
      case 5:
        return !!q.strategy.timeline && !!q.strategy.budget;
      default:
        return false;
    }
  })();

  const next = async () => {
    if (step < 5) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setError(null);
    setSubmitting(true);
    const intake = { quick: q, deepen: {}, completedDeepen: [] };
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: q.email, intake }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      sessionStorage.setItem("agentic_intake", JSON.stringify(intake));
      sessionStorage.setItem("agentic_session", data.sessionId);
      try {
        localStorage.setItem("agentic_last_session", data.sessionId);
      } catch {}
      router.push("/roadmap");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <Link href="/" className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <X className="h-4 w-4" />
        </Link>
      </header>

      <div className="mb-8 flex items-center gap-1.5">
        {STEP_META.map((m, i) => (
          <div key={m.label} className="flex flex-1 flex-col gap-1.5">
            <div className={cn("h-1 rounded-full transition-colors", i < step ? "bg-accent" : i === step ? "bg-accent/60" : "bg-surface-2")} />
            <span className={cn("hidden text-[0.68rem] sm:block", i === step ? "text-fg" : "text-faint")}>{m.label}</span>
          </div>
        ))}
      </div>

      <div key={step} className="animate-fade-up flex-1">
        <Eyebrow>
          Step {step + 1} of 6 · {STEP_META[step].label}
        </Eyebrow>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg">{STEP_META[step].sub}</h1>

        <div className="mt-7 space-y-7">
          {step === 0 && (
            <>
              <Field label="Work email" hint="we save your assessment here">
                <input
                  value={q.email}
                  onChange={(e) => set("email", e.target.value)}
                  type="email"
                  placeholder="you@company.com"
                  className="h-11 w-full rounded-xl border border-border-strong bg-surface-2 px-3.5 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
                />
              </Field>
              <Field label="Company name" hint="optional">
                <input
                  value={q.company.name}
                  onChange={(e) => set("company", { ...q.company, name: e.target.value })}
                  placeholder="Acme Advisory"
                  className="h-11 w-full rounded-xl border border-border-strong bg-surface-2 px-3.5 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
                />
              </Field>
              <Field label="Industry">
                <ChipGroup options={INDUSTRIES} value={q.company.industry} onChange={(v) => set("company", { ...q.company, industry: v })} />
              </Field>
              <Field label="Company size" hint="employees">
                <ChipGroup options={COMPANY_SIZES} value={q.company.size} onChange={(v) => set("company", { ...q.company, size: v })} />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field label="Which functions do you want agents to help with?" hint="select all that apply">
                <MultiChipGroup options={FUNCTIONS} values={q.functions} onChange={(v) => set("functions", v)} />
              </Field>
              <Field label="What's the biggest pain you'd fix first?">
                <ChipGroup options={PAINS} value={q.priorityPain} onChange={(v) => set("priorityPain", v)} cols={2} />
              </Field>
              <Field label="Describe one process you'd love to automate" hint="we tailor your roadmap to this">
                <textarea
                  value={q.processFreeText}
                  onChange={(e) => set("processFreeText", e.target.value)}
                  rows={3}
                  placeholder="e.g. Our analysts spend days pulling research and drafting client briefs from scattered reports..."
                  className="w-full resize-none rounded-xl border border-border-strong bg-surface-2 p-3.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
                />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Where does most of your data live?">
                <ChipGroup options={DATA_LOCATION} value={q.data.location} onChange={(v) => set("data", { ...q.data, location: v })} cols={2} />
              </Field>
              <Field label="How is it structured?">
                <ChipGroup options={DATA_STRUCTURE} value={q.data.structure} onChange={(v) => set("data", { ...q.data, structure: v })} />
              </Field>
              <Field label="How would you rate data quality?">
                <ChipGroup options={DATA_QUALITY} value={q.data.quality} onChange={(v) => set("data", { ...q.data, quality: v })} />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field label="Which core systems do you run?" hint="select all that apply">
                <MultiChipGroup options={SYSTEMS} values={q.tech.systems} onChange={(v) => set("tech", { ...q.tech, systems: v })} />
              </Field>
              <Field label="How do you deploy software?">
                <ChipGroup options={DEPLOYMENT} value={q.tech.deployment} onChange={(v) => set("tech", { ...q.tech, deployment: v })} />
              </Field>
              <Field label="Where are you with AI today?">
                <ChipGroup options={EXISTING_AI} value={q.tech.existingAI} onChange={(v) => set("tech", { ...q.tech, existingAI: v })} />
              </Field>
            </>
          )}

          {step === 4 && (
            <>
              <Field label="Team available to deliver">
                <ChipGroup options={TEAM_SIZES} value={q.team.size} onChange={(v) => set("team", { ...q.team, size: v })} />
              </Field>
              <Field label="Skill mix">
                <ChipGroup options={SKILL_LEVELS} value={q.team.skill} onChange={(v) => set("team", { ...q.team, skill: v })} />
              </Field>
              <Field label="AI experience">
                <ChipGroup options={AI_EXPERIENCE} value={q.team.aiExperience} onChange={(v) => set("team", { ...q.team, aiExperience: v })} />
              </Field>
              <Field label="Compliance posture">
                <ChipGroup options={COMPLIANCE} value={q.governance.compliance} onChange={(v) => set("governance", { ...q.governance, compliance: v })} />
              </Field>
              <Field label="Risk appetite">
                <ChipGroup options={RISK_APPETITE} value={q.governance.riskAppetite} onChange={(v) => set("governance", { ...q.governance, riskAppetite: v })} />
              </Field>
            </>
          )}

          {step === 5 && (
            <>
              <Field label="Target win window">
                <ChipGroup options={TIMELINES} value={q.strategy.timeline} onChange={(v) => set("strategy", { ...q.strategy, timeline: v })} />
              </Field>
              <Field label="AI investment budget">
                <ChipGroup options={BUDGETS} value={q.strategy.budget} onChange={(v) => set("strategy", { ...q.strategy, budget: v })} cols={2} />
              </Field>
              <Field label="Production reality check" hint="be honest — this sharpens your roadmap">
                <div className="space-y-2.5">
                  {GATE_QUESTIONS.map((g) => (
                    <TriRow key={g.id} label={g.label} hint={g.hint} value={q.gates[g.id]} onChange={(v) => set("gates", { ...q.gates, [g.id]: v })} />
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-critical/30 bg-critical/[0.06] px-4 py-3 text-sm text-critical">{error}</div>
      )}

      <div className="sticky bottom-0 mt-4 flex items-center justify-between border-t border-border bg-canvas/80 py-4 backdrop-blur">
        <button
          onClick={() => (step === 0 ? router.push("/") : (setError(null), setStep((s) => s - 1)))}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={next}
          disabled={!canContinue || submitting}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-white transition-all hover:bg-[#3a322c] disabled:pointer-events-none disabled:opacity-40 shadow-[0_10px_24px_-14px_rgba(38,33,28,0.6)]"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              {step === 5 ? "Generate my roadmap" : "Continue"}
              {step === 5 ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            </>
          )}
        </button>
      </div>
    </main>
  );
}
