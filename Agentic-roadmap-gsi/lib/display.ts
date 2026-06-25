import type { DimensionId, DimStatus, Lane } from "./types";

export const LANE_META: Record<Lane, { label: string; cssVar: string; blurb: string; info: string }> = {
  build_now: {
    label: "Build Now",
    cssVar: "var(--color-build)",
    blurb: "Ready to start — value with the fewest blockers.",
    info: "Ready to start now — strong readiness on the dimensions this agent needs, with the fewest blockers. Begin here.",
  },
  fix_first: {
    label: "Fix Next",
    cssVar: "var(--color-fix)",
    blurb: "High potential — close one readiness gap first.",
    info: "High potential, but close one readiness gap first (e.g. data access, an executive sponsor, or a clearer use case) before it's build-ready.",
  },
  not_now: {
    label: "Not Now",
    cssVar: "var(--color-hold)",
    blurb: "Park until readiness or priorities shift.",
    info: "Park this for later — it needs several readiness gaps closed, or it's lower priority than the rest. Revisit as your readiness or priorities shift.",
  },
};

export const SHORT: Record<DimensionId, string> = {
  useCase: "Use-Case",
  strategy: "Strategy",
  data: "Data",
  technology: "Technology",
  team: "Team",
  governance: "Governance",
};

export const dimColor = (s: DimStatus) =>
  s === "strong" ? "var(--color-build)" : s === "developing" ? "var(--color-fix)" : "var(--color-critical)";

export const laneTone = (lane: Lane): "build" | "fix" | "hold" =>
  lane === "build_now" ? "build" : lane === "fix_first" ? "fix" : "hold";
