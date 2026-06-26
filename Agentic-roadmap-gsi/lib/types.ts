export type Tri = "yes" | "partial" | "no";

export type DimensionId =
  | "strategy"
  | "useCase"
  | "data"
  | "technology"
  | "team"
  | "governance";

/** The short, lead-magnet-friendly core intake. */
export interface QuickScan {
  /** Work email — the account key for saved state and rate limiting. */
  email: string;
  company: { name: string; industry: string; industryOther: string; size: string };
  /** Detected market (browser IP geo / email TLD) — scales the labor-cost estimate. */
  market?: { country: string; countryName: string; mult: number };
  /** Practice areas / functions they want to automate. */
  functions: string[];
  /** Extra areas the user asks to generate agents for, added on demand from the roadmap. */
  customRequests: string[];
  /** Catalog use-case ids the user added to their board from the Use-case catalog tab. */
  extraUseCases: string[];
  /** Free-text problem scoping — parsed by Claude into tailored opportunities. */
  processFreeText: string;
  priorityPain: string;
  /** Where data lives — multi-select (a firm usually spans more than one). */
  data: { location: string[]; structure: string; quality: string };
  tech: { systems: string[]; deployment: string; existingAI: string };
  team: { size: string; skill: string; aiExperience: string };
  strategy: { timeline: string; budget: string };
  /** Production reality gates. */
  gates: {
    champion: Tri;
    useCase: Tri;
    dataSources: Tri;
    successMetric: Tri;
  };
  governance: { compliance: string };
}

/** Optional "Deepen this dimension" answers: dimensionId -> questionId -> value. */
export type DeepenAnswers = Partial<Record<DimensionId, Record<string, string>>>;

export interface IntakeData {
  quick: QuickScan;
  deepen: DeepenAnswers;
  completedDeepen: DimensionId[];
}

/** Lightweight first-party usage tracking (no external analytics). */
export interface Activity {
  screens: string[]; // deduped screens/tabs visited over the user's lifetime
  blueprints: string[]; // deduped agent names whose blueprint was opened
  utm: Record<string, string>; // first-touch UTM / click ids from the landing URL
  referrer?: string; // first-touch document.referrer
  firstSeen: number;
  lastSeen: number;
}

export type DimStatus = "strong" | "developing" | "gap";

export interface DimensionScore {
  id: DimensionId;
  label: string;
  score: number; // 0-100
  status: DimStatus;
  insight: string;
}

export type Lane = "build_now" | "fix_first" | "not_now";

export type Priority = "Critical" | "High" | "Medium" | "Low";
export type Complexity = "Low" | "Medium" | "High";

export interface OrgFit {
  budgetAligned: boolean;
  teamSkillFit: boolean;
  championAssigned: boolean;
  dataAvailable: boolean;
}

export interface Opportunity {
  id: string;
  func: string; // function id
  funcLabel: string;
  name: string;
  description: string;
  priority: Priority;
  annualValueUSD: number; // "money saved / yr" — labor cost avoided
  effectiveFTEs: number; // full-time-equivalents of manual work automated
  loadedCostPerPerson: number; // fully-loaded annual cost per person in this market
  readinessScore: number; // 0-100
  impactScore: number; // 0-100
  complexityScore: number; // 0-100
  riskLevel: "Low" | "Medium" | "High";
  lane: Lane;
  readinessLabel: string; // "Ready" | "2/4 Ready" | "Not Ready"
  blockers: string[];
  keyBenefits: string[];
  technologies: string[];
  workflow: string[];
  fit: OrgFit;
  complexity: Complexity;
  timeToValue: string;
  aiGenerated?: boolean;
}

export interface Assessment {
  headline: string;
  maturityScore: number; // 0-100
  maturityStage: string; // Exploring | Emerging | Scaling | Leading
  confidence: number; // 0-100, rises with Deepen
  estAnnualValueUSD: number;
  appsAnalyzed: number;
  functionsCount: number;
  dimensions: DimensionScore[];
  opportunities: Opportunity[];
  source: "ai" | "deterministic";
}
