import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";

// Page-level building blocks so every screen shares the same rhythm:
// header (title + optional tip + description + actions), stat tile,
// section heading, empty state, loading state.
export function PageHeader({
  title,
  description,
  tip,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  tip?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          {title}
          {tip && <InfoTip>{tip}</InfoTip>}
        </h1>
        {description && <p className="text-muted-foreground text-sm max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  count,
  tip,
  actions,
  className,
}: {
  title: React.ReactNode;
  count?: number;
  tip?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-sm font-semibold flex items-center gap-1.5">
        {title}
        {count !== undefined && <span className="text-muted-foreground font-normal">({count})</span>}
        {tip && <InfoTip>{tip}</InfoTip>}
      </h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tip,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tip?: React.ReactNode;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div className="bg-card rounded-xl border px-4 py-3 shadow-xs">
      <div className="text-muted-foreground text-xs font-medium flex items-center gap-1">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-red-600",
          tone === "success" && "text-emerald-600"
        )}
      >
        {value}
      </div>
      {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-muted-foreground text-sm max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded-md", className)} />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
