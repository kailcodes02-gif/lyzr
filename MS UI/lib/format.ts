import { format, isSameYear, isToday, isYesterday, formatDistanceToNowStrict } from "date-fns";

// Gmail list column: time today, "Sep 12" this year, otherwise a short date.
export function formatMailDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "h:mm a");
  if (isSameYear(d, new Date())) return format(d, "MMM d");
  return format(d, "dd/MM/yyyy");
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return `Today, ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, "h:mm a")}`;
  return format(d, "EEE, MMM d, yyyy, h:mm a");
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function initials(name?: string | null): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
