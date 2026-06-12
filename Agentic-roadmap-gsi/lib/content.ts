import type {
  Assessment,
  Complexity,
  DimensionId,
  DimensionScore,
  DimStatus,
  IntakeData,
  Lane,
  Opportunity,
  Priority,
  QuickScan,
  Tri,
} from "./types";

/* ------------------------------------------------------------------ */
/* Option sets (intake)                                               */
/* ------------------------------------------------------------------ */

export interface Opt {
  value: string;
  label: string;
  hint?: string;
}

export const INDUSTRIES: Opt[] = [
  { value: "professional_services", label: "Professional Services" },
  { value: "financial_services", label: "Financial Services" },
  { value: "technology", label: "Technology" },
  { value: "healthcare", label: "Healthcare" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "retail", label: "Retail & E-commerce" },
  { value: "energy", label: "Energy & Utilities" },
  { value: "public_sector", label: "Public Sector" },
  { value: "media", label: "Media & Entertainment" },
  { value: "other", label: "Other" },
];

export const COMPANY_SIZES: Opt[] = [
  { value: "1_50", label: "1–50" },
  { value: "51_200", label: "51–200" },
  { value: "201_1000", label: "201–1,000" },
  { value: "1001_5000", label: "1,001–5,000" },
  { value: "5000_plus", label: "5,000+" },
];

export const FUNCTIONS: Opt[] = [
  { value: "finance", label: "Finance & Billing" },
  { value: "sales", label: "Sales & BD" },
  { value: "marketing", label: "Marketing" },
  { value: "customer", label: "Customer Service" },
  { value: "operations", label: "Operations" },
  { value: "knowledge", label: "Research & Knowledge" },
  { value: "hr", label: "HR & Talent" },
  { value: "it", label: "IT" },
  { value: "legal", label: "Legal & Compliance" },
  { value: "procurement", label: "Procurement" },
];

export const PAINS: Opt[] = [
  { value: "manual", label: "High-volume manual work" },
  { value: "turnaround", label: "Slow turnaround times" },
  { value: "knowledge", label: "Knowledge trapped in docs/people" },
  { value: "cost", label: "Cost-to-serve too high" },
  { value: "quality", label: "Inconsistent quality / errors" },
  { value: "scale", label: "Can't scale without headcount" },
];

export const DATA_LOCATION: Opt[] = [
  { value: "warehouse", label: "Central warehouse / lake" },
  { value: "saas", label: "Across SaaS apps" },
  { value: "mixed", label: "Mix of systems & files" },
  { value: "scattered", label: "Scattered / on local drives" },
];
export const DATA_STRUCTURE: Opt[] = [
  { value: "structured", label: "Mostly structured" },
  { value: "mixed", label: "Mixed" },
  { value: "unstructured", label: "Mostly docs / unstructured" },
];
export const DATA_QUALITY: Opt[] = [
  { value: "high", label: "Clean & trusted" },
  { value: "medium", label: "Usable, some gaps" },
  { value: "low", label: "Messy / unreliable" },
];

export const SYSTEMS: Opt[] = [
  { value: "crm", label: "CRM" },
  { value: "erp", label: "ERP / Finance" },
  { value: "docs", label: "Doc / Knowledge mgmt" },
  { value: "ticketing", label: "Ticketing / ITSM" },
  { value: "datawarehouse", label: "Data warehouse" },
  { value: "collab", label: "Collaboration suite" },
];
export const DEPLOYMENT: Opt[] = [
  { value: "cloud", label: "Cloud-first" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onprem", label: "On-premise / regulated" },
];
export const EXISTING_AI: Opt[] = [
  { value: "mature", label: "Running AI in production" },
  { value: "piloting", label: "Piloting / experimenting" },
  { value: "none", label: "Not started" },
];

export const TEAM_SIZES: Opt[] = [
  { value: "1_3", label: "1–3 people" },
  { value: "4_8", label: "4–8 people" },
  { value: "8_plus", label: "8+ people" },
];
export const SKILL_LEVELS: Opt[] = [
  { value: "business", label: "Mostly business / no-code" },
  { value: "mixed", label: "Mixed business + technical" },
  { value: "engineers", label: "Strong engineers" },
];
export const AI_EXPERIENCE: Opt[] = [
  { value: "none", label: "New to AI" },
  { value: "some", label: "Some hands-on" },
  { value: "deep", label: "Deep AI/ML experience" },
];

export const TIMELINES: Opt[] = [
  { value: "2_weeks", label: "2 weeks", hint: "Quick win" },
  { value: "30_days", label: "30 days", hint: "Short-term initiative" },
  { value: "90_days", label: "90 days", hint: "Quarterly plan" },
];
export const BUDGETS: Opt[] = [
  { value: "under_25k", label: "Under $25K", hint: "Pilot / POC" },
  { value: "25_100k", label: "$25K–$100K", hint: "Department initiative" },
  { value: "100_250k", label: "$100K–$250K", hint: "Cross-functional" },
  { value: "250k_plus", label: "$250K+", hint: "Enterprise transformation" },
];

export const COMPLIANCE: Opt[] = [
  { value: "light", label: "Light-touch" },
  { value: "defined", label: "Defined policies in place" },
  { value: "regulated", label: "Heavily regulated" },
];
export const RISK_APPETITE: Opt[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Move fast" },
];

export const GATE_QUESTIONS: { id: keyof QuickScan["gates"]; label: string; hint: string }[] = [
  { id: "champion", label: "Executive champion identified?", hint: "Someone owns success" },
  { id: "budgetOwner", label: "Budget owner aligned?", hint: "Funding is secured" },
  { id: "useCase", label: "Clear business use case?", hint: "Problem is defined" },
  { id: "dataSources", label: "Data sources identified?", hint: "You know where data lives" },
  { id: "successMetric", label: "Success metric defined?", hint: "You can measure impact" },
];

/* ------------------------------------------------------------------ */
/* Dimension metadata                                                 */
/* ------------------------------------------------------------------ */

export const DIMENSIONS: { id: DimensionId; label: string; weight: number; blurb: string }[] = [
  { id: "useCase", label: "Use-Case Clarity", weight: 0.22, blurb: "How well-scoped the work to automate is" },
  { id: "strategy", label: "Strategy & Sponsorship", weight: 0.18, blurb: "Executive backing, budget, success metrics" },
  { id: "data", label: "Data Readiness", weight: 0.18, blurb: "Where data lives, structure, quality" },
  { id: "technology", label: "Technology & Integration", weight: 0.16, blurb: "Systems, deployment, existing AI" },
  { id: "team", label: "Team & Skills", weight: 0.14, blurb: "Capacity and technical depth" },
  { id: "governance", label: "Governance & Risk", weight: 0.12, blurb: "Compliance posture and risk appetite" },
];

/* ------------------------------------------------------------------ */
/* "Deepen this dimension" — optional confidence-raising questions     */
/* ------------------------------------------------------------------ */

export interface DeepenQuestion {
  id: string;
  label: string;
  options: { value: string; label: string; w: number }[];
}

export const DEEPEN: Record<DimensionId, DeepenQuestion[]> = {
  useCase: [
    {
      id: "volume",
      label: "How repeatable is the target process?",
      options: [
        { value: "high", label: "Runs hundreds+ of times a month", w: 1 },
        { value: "med", label: "Regular but variable", w: 0.6 },
        { value: "low", label: "Ad-hoc / one-off", w: 0.3 },
      ],
    },
    {
      id: "documented",
      label: "Is the process documented (SOPs)?",
      options: [
        { value: "yes", label: "Documented end-to-end", w: 1 },
        { value: "partial", label: "Partially", w: 0.55 },
        { value: "no", label: "Lives in people's heads", w: 0.25 },
      ],
    },
  ],
  strategy: [
    {
      id: "mandate",
      label: "Is there a board / C-suite AI mandate?",
      options: [
        { value: "yes", label: "Explicit mandate", w: 1 },
        { value: "interest", label: "Interest, no mandate", w: 0.55 },
        { value: "no", label: "Bottom-up only", w: 0.3 },
      ],
    },
    {
      id: "kpi",
      label: "Is ROI tied to a tracked KPI?",
      options: [
        { value: "yes", label: "Owned KPI with baseline", w: 1 },
        { value: "soft", label: "Soft target", w: 0.5 },
        { value: "no", label: "Not yet", w: 0.25 },
      ],
    },
  ],
  data: [
    {
      id: "access",
      label: "Can teams get programmatic data access?",
      options: [
        { value: "api", label: "APIs available", w: 1 },
        { value: "exports", label: "Exports / manual", w: 0.55 },
        { value: "locked", label: "Locked down", w: 0.25 },
      ],
    },
    {
      id: "pii",
      label: "Is sensitive / PII data handling defined?",
      options: [
        { value: "yes", label: "Clear policy", w: 1 },
        { value: "partial", label: "Some controls", w: 0.55 },
        { value: "no", label: "Undefined", w: 0.3 },
      ],
    },
  ],
  technology: [
    {
      id: "integration",
      label: "How integrated are core systems?",
      options: [
        { value: "high", label: "Well-integrated", w: 1 },
        { value: "some", label: "Some integration", w: 0.55 },
        { value: "siloed", label: "Siloed", w: 0.25 },
      ],
    },
    {
      id: "platform",
      label: "Is there an agent/automation platform?",
      options: [
        { value: "yes", label: "In place", w: 1 },
        { value: "evaluating", label: "Evaluating", w: 0.55 },
        { value: "no", label: "None", w: 0.3 },
      ],
    },
  ],
  team: [
    {
      id: "capacity",
      label: "Is there dedicated capacity for delivery?",
      options: [
        { value: "yes", label: "Dedicated squad", w: 1 },
        { value: "partial", label: "Part-time", w: 0.55 },
        { value: "no", label: "No capacity", w: 0.3 },
      ],
    },
    {
      id: "change",
      label: "How strong is change management?",
      options: [
        { value: "strong", label: "Proven adoption muscle", w: 1 },
        { value: "ok", label: "Mixed track record", w: 0.55 },
        { value: "weak", label: "Adoption struggles", w: 0.3 },
      ],
    },
  ],
  governance: [
    {
      id: "review",
      label: "Is there an AI review / approval path?",
      options: [
        { value: "yes", label: "Defined path", w: 1 },
        { value: "forming", label: "Forming", w: 0.55 },
        { value: "no", label: "None", w: 0.3 },
      ],
    },
    {
      id: "tolerance",
      label: "Tolerance for human-in-the-loop pilots?",
      options: [
        { value: "high", label: "Comfortable piloting", w: 1 },
        { value: "med", label: "With guardrails", w: 0.6 },
        { value: "low", label: "Risk-averse", w: 0.3 },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Opportunity library                                                */
/* ------------------------------------------------------------------ */

interface LibItem {
  id: string;
  func: string;
  name: string;
  description: string;
  baseValue: number; // at the 201–1000 size baseline
  complexity: Complexity;
  baseReadiness: number; // 0-1
  timeToValue: string;
}

export const LIBRARY: LibItem[] = [
  { id: "fin-risk", func: "finance", name: "Intelligent Financial Processing & Risk Automation", description: "Agents that ingest invoices, statements, and exposure data to automate processing, reconciliation, and risk flagging.", baseValue: 1_200_000, complexity: "High", baseReadiness: 0.74, timeToValue: "6–10 weeks" },
  { id: "fin-billing", func: "finance", name: "Automated Billing & Revenue Reconciliation", description: "Close the gap between delivery and billing with agents that reconcile time, contracts, and invoices.", baseValue: 380_000, complexity: "Medium", baseReadiness: 0.8, timeToValue: "4–6 weeks" },
  { id: "cs-support", func: "customer", name: "AI-Powered Customer Support Agent", description: "A grounded support agent that resolves tier-1 tickets across chat and email using your knowledge base.", baseValue: 380_000, complexity: "Medium", baseReadiness: 0.82, timeToValue: "3–5 weeks" },
  { id: "cs-voice", func: "customer", name: "Voice AI Triage & Routing", description: "Voice agents that triage inbound calls, capture intent, and route or resolve.", baseValue: 210_000, complexity: "High", baseReadiness: 0.58, timeToValue: "8–12 weeks" },
  { id: "sales-sdr", func: "sales", name: "Automated Sales Development & Lead Enrichment", description: "Agents that research accounts, enrich leads, and draft tailored outreach.", baseValue: 520_000, complexity: "Medium", baseReadiness: 0.78, timeToValue: "4–6 weeks" },
  { id: "sales-rfp", func: "sales", name: "Proposal & RFP Response Generation", description: "Generate first-draft proposals and RFP responses from your past wins and capability library.", baseValue: 295_000, complexity: "Medium", baseReadiness: 0.7, timeToValue: "5–8 weeks" },
  { id: "mkt-content", func: "marketing", name: "Multi-Agent Content & Campaign Engine", description: "Coordinated agents that plan, draft, and adapt campaign content on-brand at scale.", baseValue: 425_000, complexity: "High", baseReadiness: 0.64, timeToValue: "6–10 weeks" },
  { id: "mkt-web", func: "marketing", name: "Website Personalization & Engagement", description: "Agents that personalize web journeys and qualify visitors in real time.", baseValue: 245_000, complexity: "Medium", baseReadiness: 0.6, timeToValue: "5–8 weeks" },
  { id: "ops-docs", func: "operations", name: "Enterprise Document Intelligence", description: "Extract, classify, and route information from contracts, forms, and reports at scale.", baseValue: 285_000, complexity: "Medium", baseReadiness: 0.7, timeToValue: "5–8 weeks" },
  { id: "ops-process", func: "operations", name: "Process Mining & Workflow Automation", description: "Discover high-friction workflows and deploy agents to automate the repetitive path.", baseValue: 340_000, complexity: "High", baseReadiness: 0.58, timeToValue: "8–12 weeks" },
  { id: "know-research", func: "knowledge", name: "Research & Knowledge Synthesis Agent", description: "Agents that synthesize internal knowledge and external research into client-ready briefs.", baseValue: 410_000, complexity: "Medium", baseReadiness: 0.7, timeToValue: "5–8 weeks" },
  { id: "hr-screen", func: "hr", name: "Talent Screening & Onboarding Assistant", description: "Screen candidates, schedule, and guide structured onboarding with an agent in the loop.", baseValue: 180_000, complexity: "Low", baseReadiness: 0.72, timeToValue: "3–5 weeks" },
  { id: "hr-learn", func: "hr", name: "Adaptive L&D & Knowledge Quiz Generator", description: "Generate role-specific learning paths and assessments from your internal material.", baseValue: 95_000, complexity: "Low", baseReadiness: 0.55, timeToValue: "4–6 weeks" },
  { id: "it-ops", func: "it", name: "IT Operations & Incident Copilot", description: "Agents that triage incidents, draft runbooks, and resolve common requests.", baseValue: 310_000, complexity: "Medium", baseReadiness: 0.62, timeToValue: "6–9 weeks" },
  { id: "it-compliance", func: "it", name: "Compliance & Infrastructure Monitoring", description: "Continuous agents that monitor posture and flag drift against policy.", baseValue: 260_000, complexity: "High", baseReadiness: 0.55, timeToValue: "8–12 weeks" },
  { id: "legal-contract", func: "legal", name: "Contract Review & Clause Intelligence", description: "Agents that review contracts, surface risky clauses, and compare against your playbook.", baseValue: 330_000, complexity: "High", baseReadiness: 0.6, timeToValue: "6–10 weeks" },
  { id: "proc-vendor", func: "procurement", name: "Procurement & Vendor Intelligence", description: "Automate vendor research, spend analysis, and sourcing recommendations.", baseValue: 220_000, complexity: "Medium", baseReadiness: 0.62, timeToValue: "5–8 weeks" },
];

/** Which dimensions most affect each function's readiness. */
const FUNC_DIMS: Record<string, DimensionId[]> = {
  finance: ["data", "strategy"],
  customer: ["technology", "data"],
  sales: ["strategy", "useCase"],
  marketing: ["useCase", "technology"],
  operations: ["data", "technology"],
  knowledge: ["data", "useCase"],
  hr: ["team", "useCase"],
  it: ["technology", "governance"],
  legal: ["governance", "data"],
  procurement: ["data", "technology"],
};

/** Per-function templates for the opportunity detail drawer. */
interface FuncTemplate {
  technologies: string[];
  workflow: string[];
  benefits: string[];
}

const FUNC_TEMPLATES: Record<string, FuncTemplate> = {
  finance: {
    technologies: ["Document AI", "Risk Scoring", "ERP Integration", "Reconciliation Engine"],
    workflow: ["Connect financial systems", "Configure extraction & rules", "Validate against ledgers", "Deploy with human review"],
    benefits: ["Cut processing time by ~60%", "Reduce reconciliation errors", "Flag risk exposure in real time", "Free finance team for analysis"],
  },
  sales: {
    technologies: ["CRM Integration", "Lead Enrichment", "Outreach Engine", "Intent Signals"],
    workflow: ["Connect CRM & data sources", "Define ICP & enrichment rules", "Draft & route outreach", "Measure pipeline impact"],
    benefits: ["Enrich every lead automatically", "Lift qualified pipeline", "Cut SDR busywork", "Personalize at scale"],
  },
  marketing: {
    technologies: ["Content Generation", "Brand Guardrails", "Campaign Orchestration", "Analytics"],
    workflow: ["Ingest brand & assets", "Configure content workflows", "Generate & adapt campaigns", "Track performance"],
    benefits: ["Ship campaigns faster", "Stay on-brand at scale", "Repurpose content automatically", "Free creators for strategy"],
  },
  customer: {
    technologies: ["Knowledge-Base RAG", "Conversation Engine", "Ticketing Integration", "Escalation Routing"],
    workflow: ["Connect knowledge sources", "Train on past tickets", "Pilot on tier-1 queries", "Expand with guardrails"],
    benefits: ["Resolve tier-1 instantly", "Cut response times", "Deflect repetitive tickets", "Improve CSAT"],
  },
  operations: {
    technologies: ["Document Intelligence", "Process Mining", "Workflow Automation", "System Integrations"],
    workflow: ["Map the target process", "Connect systems & data", "Automate the repetitive path", "Monitor & optimize"],
    benefits: ["Remove manual handoffs", "Speed up turnaround", "Reduce errors", "Scale without headcount"],
  },
  knowledge: {
    technologies: ["Retrieval (RAG)", "Synthesis Engine", "Source Connectors", "Citation Layer"],
    workflow: ["Connect knowledge sources", "Define brief templates", "Generate cited drafts", "Review & refine"],
    benefits: ["Synthesize research in minutes", "Surface internal knowledge", "Standardize client briefs", "Free analysts for insight"],
  },
  hr: {
    technologies: ["Resume Parsing", "Screening Engine", "Scheduling", "Onboarding Flows"],
    workflow: ["Connect ATS & HRIS", "Configure screening criteria", "Automate scheduling", "Guide structured onboarding"],
    benefits: ["Screen candidates faster", "Reduce time-to-hire", "Standardize onboarding", "Improve candidate experience"],
  },
  it: {
    technologies: ["Incident Triage", "Runbook Automation", "Monitoring", "ITSM Integration"],
    workflow: ["Connect ITSM & logs", "Train on past incidents", "Automate common requests", "Add oversight & guardrails"],
    benefits: ["Resolve incidents faster", "Deflect repetitive tickets", "Reduce MTTR", "Free IT for strategic work"],
  },
  legal: {
    technologies: ["Clause Extraction", "Playbook Matching", "Risk Scoring", "Document Integration"],
    workflow: ["Load contract playbook", "Connect document store", "Review & flag clauses", "Route exceptions to counsel"],
    benefits: ["Speed up contract review", "Surface risky clauses", "Standardize positions", "Reduce legal bottlenecks"],
  },
  procurement: {
    technologies: ["Vendor Research", "Spend Analysis", "Sourcing Engine", "ERP Integration"],
    workflow: ["Connect spend & vendor data", "Configure sourcing rules", "Generate recommendations", "Review & approve"],
    benefits: ["Automate vendor research", "Surface savings", "Speed up sourcing", "Improve compliance"],
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const triVal = (t: Tri) => (t === "yes" ? 1 : t === "partial" ? 0.5 : 0);

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const W = {
  size: { "1_50": 0.35, "51_200": 0.6, "201_1000": 1, "1001_5000": 1.7, "5000_plus": 2.6 } as Record<string, number>,
  budget: { under_25k: 0.4, "25_100k": 0.6, "100_250k": 0.82, "250k_plus": 1 } as Record<string, number>,
  timeline: { "2_weeks": 0.6, "30_days": 0.8, "90_days": 1 } as Record<string, number>,
  dataLoc: { warehouse: 1, saas: 0.75, mixed: 0.55, scattered: 0.3 } as Record<string, number>,
  dataStruct: { structured: 1, mixed: 0.65, unstructured: 0.4 } as Record<string, number>,
  dataQual: { high: 1, medium: 0.6, low: 0.3 } as Record<string, number>,
  deploy: { cloud: 1, hybrid: 0.8, onprem: 0.55 } as Record<string, number>,
  existingAI: { mature: 1, piloting: 0.6, none: 0.3 } as Record<string, number>,
  teamSize: { "1_3": 0.55, "4_8": 0.82, "8_plus": 1 } as Record<string, number>,
  skill: { business: 0.45, mixed: 0.72, engineers: 1 } as Record<string, number>,
  aiExp: { none: 0.3, some: 0.65, deep: 1 } as Record<string, number>,
  compliance: { light: 0.6, defined: 1, regulated: 0.72 } as Record<string, number>,
  risk: { conservative: 0.55, balanced: 0.85, aggressive: 0.7 } as Record<string, number>,
};

const w = (map: Record<string, number>, key: string, fallback = 0.5) =>
  map[key] ?? fallback;

const sizeMult = (size: string) => w(W.size, size, 1);

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/* ------------------------------------------------------------------ */
/* Dimension scoring                                                  */
/* ------------------------------------------------------------------ */

function deepenScore(intake: IntakeData, dim: DimensionId): number | null {
  const ans = intake.deepen[dim];
  const qs = DEEPEN[dim];
  if (!ans) return null;
  const vals: number[] = [];
  for (const q of qs) {
    const v = ans[q.id];
    const opt = q.options.find((o) => o.value === v);
    if (opt) vals.push(opt.w);
  }
  if (!vals.length) return null;
  return avg(vals) * 100;
}

function quickDimScore(q: QuickScan, dim: DimensionId): number {
  switch (dim) {
    case "useCase": {
      const coverage = Math.min(1, q.functions.length / 3);
      const ft = q.processFreeText.trim().length;
      const ftScore = ft > 40 ? 1 : ft > 0 ? 0.5 : 0;
      const pain = q.priorityPain ? 1 : 0.4;
      return avg([coverage, ftScore, pain, triVal(q.gates.useCase)]) * 100;
    }
    case "strategy":
      return (
        avg([
          triVal(q.gates.champion),
          triVal(q.gates.budgetOwner),
          triVal(q.gates.successMetric),
          w(W.budget, q.strategy.budget),
          w(W.timeline, q.strategy.timeline),
        ]) * 100
      );
    case "data":
      return (
        avg([
          w(W.dataLoc, q.data.location),
          w(W.dataStruct, q.data.structure),
          w(W.dataQual, q.data.quality),
          triVal(q.gates.dataSources),
        ]) * 100
      );
    case "technology":
      return (
        avg([
          Math.min(1, q.tech.systems.length / 4),
          w(W.deploy, q.tech.deployment),
          w(W.existingAI, q.tech.existingAI),
        ]) * 100
      );
    case "team":
      return (
        avg([
          w(W.teamSize, q.team.size),
          w(W.skill, q.team.skill),
          w(W.aiExp, q.team.aiExperience),
        ]) * 100
      );
    case "governance":
      return (
        avg([w(W.compliance, q.governance.compliance), w(W.risk, q.governance.riskAppetite)]) * 100
      );
  }
}

const statusOf = (score: number): DimStatus =>
  score >= 70 ? "strong" : score >= 45 ? "developing" : "gap";

const INSIGHTS: Record<DimensionId, Record<DimStatus, string>> = {
  useCase: {
    strong: "Targets are well-scoped — repeatable, defined processes agents can own.",
    developing: "Promising targets, but tighten scope and pick the highest-volume process first.",
    gap: "Start by naming one concrete, high-volume process — vague scope stalls AI programs.",
  },
  strategy: {
    strong: "Strong executive backing and funding — you can move to delivery.",
    developing: "Sponsorship is forming; lock a champion, budget owner, and a tracked KPI.",
    gap: "Secure an executive champion and a measurable success metric before building.",
  },
  data: {
    strong: "Data is accessible and trustworthy enough to ground agents reliably.",
    developing: "Workable data, but expect prep on access and quality for some use cases.",
    gap: "Data access and quality are the gating risk — map sources and a clean path first.",
  },
  technology: {
    strong: "Modern, integrated stack — agents can plug into your systems quickly.",
    developing: "Some integration work needed; a unifying agent platform will accelerate you.",
    gap: "Siloed systems and no platform will slow delivery — stand up an agent foundation.",
  },
  team: {
    strong: "You have the capacity and skills to deliver and drive adoption.",
    developing: "Capable but stretched — a focused squad or partner will de-risk delivery.",
    gap: "Limited capacity is a real constraint — start small or bring in delivery support.",
  },
  governance: {
    strong: "Clear governance lets you pilot confidently with the right guardrails.",
    developing: "Governance is forming — define an AI review path to unblock pilots.",
    gap: "Undefined oversight will block production — establish a lightweight review path.",
  },
};

/* ------------------------------------------------------------------ */
/* Opportunity readiness                                              */
/* ------------------------------------------------------------------ */

export function scoreOpportunity(args: {
  id: string;
  func: string;
  name: string;
  description: string;
  baseValue: number;
  complexity: Complexity;
  baseReadiness: number;
  timeToValue: string;
  dims: Record<DimensionId, number>;
  maturity: number;
  q: QuickScan;
  selected: boolean;
  aiGenerated?: boolean;
}): Opportunity {
  const { id, func, complexity, baseReadiness, dims, maturity, q, selected } = args;
  const relDims = FUNC_DIMS[func] ?? ["technology", "data"];
  const relAvg = avg(relDims.map((d) => dims[d] / 100));
  const penalty = complexity === "High" ? 0.07 : complexity === "Medium" ? 0.03 : 0;
  const jitter = ((hash(id) % 9) - 4) / 100; // ±0.04 deterministic
  const readiness01 = clamp01(
    0.34 * baseReadiness + 0.46 * relAvg + 0.2 * (maturity / 100) - penalty + jitter,
  );
  const readinessScore = Math.round(readiness01 * 100);
  const lane: Lane = readinessScore >= 70 ? "build_now" : readinessScore >= 48 ? "fix_first" : "not_now";

  const value = Math.round((args.baseValue * sizeMult(q.company.size) * (selected ? 1.15 : 1)) / 5000) * 5000;

  const priority: Priority =
    value >= 800_000 ? "Critical" : value >= 300_000 ? "High" : value >= 120_000 ? "Medium" : "Low";

  // readiness label
  const yesCount = [q.gates.champion, q.gates.budgetOwner, q.gates.useCase, q.gates.dataSources].filter(
    (t) => t === "yes",
  ).length;
  const readinessLabel =
    lane === "build_now" ? "Ready" : lane === "not_now" ? "Not Ready" : `${Math.min(3, Math.max(1, yesCount))}/4 Ready`;

  // blockers
  const blockers: string[] = [];
  if (lane !== "build_now") {
    if (q.gates.useCase !== "yes" && (relDims.includes("useCase") || func === "marketing"))
      blockers.push("Define the target business use case");
    if (q.gates.dataSources !== "yes" && relDims.includes("data")) blockers.push("Map and connect data sources");
    if (q.data.quality === "low" && relDims.includes("data")) blockers.push("Improve data quality & coverage");
    if (q.tech.existingAI === "none" && relDims.includes("technology")) blockers.push("Stand up an agent platform");
    if (q.gates.champion !== "yes") blockers.push("Secure an executive champion");
    if ((func === "legal" || func === "it") && q.governance.riskAppetite === "conservative")
      blockers.push("Complete a security & compliance review");
    if (complexity === "High") blockers.push("Scope a phased pilot");
  }

  // drawer enrichment
  const impactScore = Math.round(
    Math.max(40, Math.min(96, 62 + (readiness01 - 0.6) * 45 + ((hash(id + "i") % 11) - 5))),
  );
  const complexityBase = complexity === "High" ? 80 : complexity === "Medium" ? 60 : 34;
  const complexityScore = Math.max(20, Math.min(95, complexityBase + ((hash(id + "c") % 9) - 4)));
  const riskLevel: "Low" | "Medium" | "High" =
    complexity === "High" ? "High" : complexity === "Medium" ? "Medium" : "Low";

  const tpl = FUNC_TEMPLATES[func] ?? FUNC_TEMPLATES.operations;
  const fit = {
    budgetAligned:
      q.gates.budgetOwner === "yes" || q.strategy.budget === "250k_plus" || q.strategy.budget === "100_250k",
    teamSkillFit: dims.team >= 58 && (q.team.skill === "mixed" || q.team.skill === "engineers"),
    championAssigned: q.gates.champion === "yes",
    dataAvailable: q.gates.dataSources === "yes" && dims.data >= 55,
  };

  return {
    id,
    func,
    funcLabel: FUNCTIONS.find((f) => f.value === func)?.label ?? func,
    name: args.name,
    description: args.description,
    priority,
    annualValueUSD: value,
    readinessScore,
    impactScore,
    complexityScore,
    riskLevel,
    lane,
    readinessLabel,
    blockers: blockers.slice(0, 2),
    keyBenefits: tpl.benefits.slice(0, 4),
    technologies: tpl.technologies,
    workflow: tpl.workflow,
    fit,
    complexity,
    timeToValue: args.timeToValue,
    aiGenerated: args.aiGenerated,
  };
}

/* ------------------------------------------------------------------ */
/* Full assessment (deterministic)                                    */
/* ------------------------------------------------------------------ */

const STAGES: [number, string][] = [
  [75, "Leading"],
  [58, "Scaling"],
  [40, "Emerging"],
  [0, "Exploring"],
];
const stageOf = (m: number) => STAGES.find(([t]) => m >= t)![1];

export function buildAssessment(intake: IntakeData): Assessment {
  const q = intake.quick;

  // dimension scores (blend quick + deepen when present)
  const dimScores = {} as Record<DimensionId, number>;
  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const quick = quickDimScore(q, d.id);
    const deep = deepenScore(intake, d.id);
    const score = Math.round(deep == null ? quick : 0.55 * quick + 0.45 * deep);
    dimScores[d.id] = score;
    const status = statusOf(score);
    return { id: d.id, label: d.label, score, status, insight: INSIGHTS[d.id][status] };
  });

  const maturity = Math.round(DIMENSIONS.reduce((sum, d) => sum + dimScores[d.id] * d.weight, 0));
  const stage = stageOf(maturity);

  // opportunities — selected functions first & boosted, but full library shown
  const selectedSet = new Set(q.functions);
  const items = [...LIBRARY].sort((a, b) => {
    const sa = selectedSet.has(a.func) ? 0 : 1;
    const sb = selectedSet.has(b.func) ? 0 : 1;
    return sa - sb;
  });
  const opportunities = items.map((it) =>
    scoreOpportunity({
      ...it,
      dims: dimScores,
      maturity,
      q,
      selected: selectedSet.has(it.func),
    }),
  );

  const estAnnualValueUSD = opportunities.reduce((s, o) => s + o.annualValueUSD, 0);
  const functionsCount = new Set(opportunities.map((o) => o.func)).size;
  const appsAnalyzed = 200 + (hash(q.company.name || "firm") % 130);

  // confidence rises with deepen completion
  const baseConf = 50 + (q.processFreeText.trim().length > 40 ? 5 : 0) + Math.min(8, q.functions.length * 2);
  const confidence = Math.min(96, baseConf + intake.completedDeepen.length * 6);

  const buildNow = opportunities.filter((o) => o.lane === "build_now");
  const buildValue = buildNow.reduce((s, o) => s + o.annualValueUSD, 0);
  const name = q.company.name?.trim() || "Your firm";
  const headline =
    buildNow.length > 0
      ? `${name} is at the ${stage} stage — ${buildNow.length} agent${buildNow.length === 1 ? "" : "s"} ${buildNow.length === 1 ? "is" : "are"} ready to build now, unlocking ~${fmt(buildValue)} in annual value.`
      : `${name} is at the ${stage} stage — close a few readiness gaps to unlock your first wave of agents.`;

  return {
    headline,
    maturityScore: maturity,
    maturityStage: stage,
    confidence,
    estAnnualValueUSD,
    appsAnalyzed,
    functionsCount,
    dimensions,
    opportunities,
    source: "deterministic",
  };
}

function fmt(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/* default intake (used to seed the wizard) */
export function emptyIntake(): IntakeData {
  return {
    quick: {
      email: "",
      company: { name: "", industry: "", size: "" },
      functions: [],
      processFreeText: "",
      priorityPain: "",
      data: { location: "", structure: "", quality: "" },
      tech: { systems: [], deployment: "", existingAI: "" },
      team: { size: "", skill: "", aiExperience: "" },
      strategy: { timeline: "", budget: "" },
      gates: { champion: "partial", budgetOwner: "partial", useCase: "partial", dataSources: "partial", successMetric: "partial" },
      governance: { compliance: "", riskAppetite: "" },
    },
    deepen: {},
    completedDeepen: [],
  };
}
