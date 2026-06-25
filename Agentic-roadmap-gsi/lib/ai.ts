import type { Assessment, Complexity, DimensionId, IntakeData, Priority } from "./types";
import { FUNCTIONS, scoreOpportunity } from "./content";

/**
 * Roadmap enrichment via Claude.
 *
 * Calls Anthropic's Messages REST endpoint directly with fetch. We use raw HTTP
 * here because the @anthropic-ai/sdk client did not complete requests inside the
 * Next.js dev runtime (requests hung past 60s), while the documented REST
 * endpoint responds in ~20s. Same provider, same endpoint — just without the SDK.
 */
const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are Lyzr's Agentic Transformation advisor. A firm has completed an AI-readiness intake. You are given their profile, readiness dimension scores, a free-text description of a process they want to automate, and a list of candidate agent opportunities with deterministic value/readiness already computed.

Your job is to make the assessment specific and credible to THIS firm. Write in clear, direct, executive prose — no hype, no marketing adjectives, no markdown, no emoji.

Return JSON only:
- headline: one or two sentences naming where they are and the single most valuable next move. Concrete, grounded in their answers.
- dimensionInsights: for each dimension id provided, one sentence tailored to their specific answers and industry (what's strong or exactly what to fix). Keep it under ~22 words.
- opportunities: for each opportunity id provided, return: "description" rewritten in one concise sentence tailored to their industry/process; "keyBenefits" (3-4 specific business outcomes for THIS agent); "workflow" (4 short implementation steps specific to this agent); "technologies" (4 concrete capabilities or integrations this agent uses). Make all of these DISTINCT per agent — two agents in the same function must NOT share identical benefits, workflow, or technologies. Return blockers as an empty array.
- newOpportunities: generate ONE tailored agent for EACH item in "customRequests" (keep the same order), plus up to 1 more derived from their free-text process description if it names a distinct process not already covered. Skip only if there is nothing to work from. For each, pick the closest function id from the allowed list, give a specific name, a one-sentence description, a realistic annual value in USD for their company size, and a complexity of Low, Medium, or High.

Allowed function ids: ${FUNCTIONS.map((f) => f.value).join(", ")}.
Do not invent value numbers for existing opportunities — only for newOpportunities. Be conservative and realistic.

Respond with ONLY a single raw JSON object containing the keys: headline, dimensionInsights, opportunities, newOpportunities. No markdown, no code fences, no commentary before or after.`;

interface ClaudeOut {
  headline: string;
  dimensionInsights: { id: string; insight: string }[];
  opportunities: { id: string; description: string; blockers: string[]; keyBenefits?: string[]; workflow?: string[]; technologies?: string[] }[];
  newOpportunities: { func: string; name: string; description: string; annualValueUSD: number; complexity: string }[];
}

function priorityFromValue(value: number): Priority {
  return value >= 800_000 ? "Critical" : value >= 300_000 ? "High" : value >= 120_000 ? "Medium" : "Low";
}

export async function enrichWithClaude(intake: IntakeData, base: Assessment): Promise<Assessment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return base;

  const dims = Object.fromEntries(base.dimensions.map((d) => [d.id, d.score])) as Record<DimensionId, number>;

  const payload = {
    company: intake.quick.company,
    selectedFunctions: intake.quick.functions,
    customRequests: intake.quick.customRequests ?? [],
    priorityPain: intake.quick.priorityPain,
    processFreeText: intake.quick.processFreeText,
    dimensions: base.dimensions.map((d) => ({ id: d.id, label: d.label, score: d.score })),
    maturity: { score: base.maturityScore, stage: base.maturityStage },
    // Keep the per-agent enrichment request lean so it completes well within the
    // timeout (richer per-agent benefits/workflow/tech for the Build Now set).
    opportunities: base.opportunities
      .filter((o) => o.lane === "build_now")
      .slice(0, 6)
      .map((o) => ({ id: o.id, name: o.name, func: o.func, lane: o.lane, description: o.description, value: o.annualValueUSD })),
  };

  let text = "";
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3200,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      console.error("Claude API error", resp.status, await resp.text().catch(() => ""));
      return base;
    }
    const data = (await resp.json()) as { content?: { type: string; text?: string }[] };
    text = data.content?.find((b) => b.type === "text")?.text ?? "";
  } catch (err) {
    console.error("Claude request failed:", err);
    return base;
  }

  // extract the JSON object from the response (tolerant of stray prose/fences)
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const out = parsed as {
    headline?: unknown;
    dimensionInsights?: unknown;
    opportunities?: unknown;
    newOpportunities?: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

  // headline
  const headline = str(out.headline).trim() || base.headline;

  // dimension insights — tolerate [{id,insight}] OR {id: insight}
  const insightMap = new Map<string, string>();
  if (Array.isArray(out.dimensionInsights)) {
    for (const raw of out.dimensionInsights) {
      const d = obj(raw);
      if (typeof d.id === "string" && str(d.insight).trim()) insightMap.set(d.id, str(d.insight).trim());
    }
  } else if (out.dimensionInsights && typeof out.dimensionInsights === "object") {
    for (const [k, v] of Object.entries(out.dimensionInsights as Record<string, unknown>)) {
      if (str(v).trim()) insightMap.set(k, str(v).trim());
    }
  }
  const dimensions = base.dimensions.map((d) =>
    insightMap.has(d.id) ? { ...d, insight: insightMap.get(d.id)! } : d,
  );

  // opportunity prose
  const oppMap = new Map<string, Record<string, unknown>>();
  if (Array.isArray(out.opportunities)) {
    for (const raw of out.opportunities) {
      const o = obj(raw);
      if (typeof o.id === "string") oppMap.set(o.id, o);
    }
  }
  const strArr = (v: unknown, n: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n) : null;
  let opportunities = base.opportunities.map((o) => {
    const e = oppMap.get(o.id);
    if (!e) return o;
    const benefits = strArr(e.keyBenefits, 4);
    const workflow = strArr(e.workflow, 5);
    const technologies = strArr(e.technologies, 6);
    return {
      ...o,
      description: str(e.description).trim() || o.description,
      blockers: o.lane === "build_now" ? [] : strArr(e.blockers, 2) ?? o.blockers,
      keyBenefits: benefits && benefits.length ? benefits : o.keyBenefits,
      workflow: workflow && workflow.length ? workflow : o.workflow,
      technologies: technologies && technologies.length ? technologies : o.technologies,
    };
  });

  // AI-discovered opportunities from the free-text
  const validFuncs = new Set(FUNCTIONS.map((f) => f.value));
  const newList = Array.isArray(out.newOpportunities) ? out.newOpportunities : [];
  const newOpps = newList.slice(0, 8).map((raw, i) => {
    const n = obj(raw);
    const func = typeof n.func === "string" && validFuncs.has(n.func) ? n.func : "operations";
    const complexity: Complexity = n.complexity === "Low" || n.complexity === "High" ? n.complexity : "Medium";
    const rawVal = typeof n.annualValueUSD === "number" ? n.annualValueUSD : 150_000;
    const value = Math.max(20_000, Math.round(rawVal / 5000) * 5000);
    const scored = scoreOpportunity({
      id: `ai-${i}`,
      func,
      name: str(n.name) || "Custom Agent Opportunity",
      description: str(n.description),
      baseValue: value,
      complexity,
      baseReadiness: 0.6,
      timeToValue: "Scoping",
      dims,
      maturity: base.maturityScore,
      q: intake.quick,
      selected: true,
      aiGenerated: true,
    });
    return { ...scored, annualValueUSD: value, priority: priorityFromValue(value) };
  });

  opportunities = [...newOpps, ...opportunities];

  const estAnnualValueUSD = opportunities.reduce((s, o) => s + o.annualValueUSD, 0);
  const functionsCount = new Set(opportunities.map((o) => o.func)).size;

  return { ...base, headline, dimensions, opportunities, estAnnualValueUSD, functionsCount, source: "ai" };
}
