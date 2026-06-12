import type { DimensionId, DimStatus, Lane } from "./types";

export const LANE_META: Record<Lane, { label: string; cssVar: string; blurb: string }> = {
  build_now: { label: "Build Now", cssVar: "var(--color-build)", blurb: "Ready to start — value with the fewest blockers." },
  fix_first: { label: "Fix First", cssVar: "var(--color-fix)", blurb: "High potential, but close a gap before building." },
  not_now: { label: "Not Now", cssVar: "var(--color-hold)", blurb: "Park until readiness or priorities shift." },
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
