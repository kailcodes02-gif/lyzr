import { cn } from "@/lib/utils";

export type BadgeColor =
  | "zinc"
  | "emerald"
  | "amber"
  | "red"
  | "blue"
  | "violet"
  | "cyan"
  | "orange";

const COLOR_CLASSES: Record<BadgeColor, string> = {
  zinc: "bg-zinc-100 text-zinc-600",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
  cyan: "bg-cyan-100 text-cyan-700",
  orange: "bg-orange-100 text-orange-700",
};

export function Badge({
  children,
  color = "zinc",
  className,
  dot,
  title,
}: {
  children: React.ReactNode;
  color?: BadgeColor;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        COLOR_CLASSES[color],
        className
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

// Consistent source-system badge across the app (sync provenance, comm
// event origin, etc.) — same colors everywhere so the eye learns them, and a
// human label instead of the raw enum value (a reader shouldn't have to know
// that HubSpot emails are stored as "hubspot_engagement").
const SOURCE_COLOR: Record<string, BadgeColor> = {
  cortex: "violet",
  hubspot: "orange",
  instantly: "cyan",
  hubspot_engagement: "orange",
  app: "blue",
  gmail: "red",
  outlook: "blue",
};

const SOURCE_LABEL: Record<string, string> = {
  cortex: "Cortex",
  hubspot: "HubSpot",
  instantly: "Instantly",
  hubspot_engagement: "HubSpot",
  app: "Email (sent via app)",
  gmail: "Gmail",
  outlook: "Outlook",
};

export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge color={SOURCE_COLOR[source] ?? "zinc"} dot>
      {SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}
