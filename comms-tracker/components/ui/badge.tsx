import { cn } from "@/lib/utils";

// shadcn-style badge (rounded-md, bordered, xs) with the app's semantic
// color set kept so source/status colors stay consistent everywhere.
export type BadgeColor = "zinc" | "emerald" | "amber" | "red" | "blue" | "violet" | "cyan" | "orange";

const COLOR_CLASSES: Record<BadgeColor, string> = {
  zinc: "border-transparent bg-secondary text-secondary-foreground",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
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
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap w-fit [&>svg]:size-3",
        COLOR_CLASSES[color],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

// Consistent source-system badge across the app — same colors everywhere
// so the eye learns them, and a human label instead of the raw enum value.
const SOURCE_COLOR: Record<string, BadgeColor> = {
  cortex: "violet",
  hubspot: "orange",
  instantly: "cyan",
  hubspot_engagement: "orange",
  app: "blue",
  gmail: "red",
  outlook: "blue",
  lyzr_blog: "zinc",
  slack: "violet",
  drive: "emerald",
  onedrive: "blue",
  internal_email: "amber",
  meeting_notes: "cyan",
  yours: "emerald",
};

const SOURCE_LABEL: Record<string, string> = {
  cortex: "Cortex",
  hubspot: "HubSpot",
  instantly: "Instantly",
  hubspot_engagement: "HubSpot",
  app: "Sent via app",
  gmail: "Gmail",
  outlook: "Outlook",
  lyzr_blog: "lyzr.ai",
  slack: "Slack",
  drive: "Google Drive",
  onedrive: "OneDrive / SharePoint",
  internal_email: "Internal email",
  meeting_notes: "Meeting notes",
  yours: "Your topic",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge color={SOURCE_COLOR[source] ?? "zinc"} dot>
      {SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}
