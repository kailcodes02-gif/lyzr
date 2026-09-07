// Going-dark severity: a project (or, rolled up, an account) with no matched
// communication in the last 15 days is flagged, with 4 increasingly dark red
// shades the further past that threshold it drifts. A project never
// contacted at all is the worst case (bucket 4), same as anything 36+ days
// stale -- the UI callers can still special-case the exact "Never" label.
export const GOING_DARK_THRESHOLD_DAYS = 15;
const BUCKET_STEP_DAYS = 7;

export type GoingDarkBucket = 0 | 1 | 2 | 3 | 4;

export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// bucket 0 = not going dark (within threshold); 1-4 = increasingly stale.
export function getGoingDarkBucket(days: number | null): GoingDarkBucket {
  if (days === null) return 4;
  if (days <= GOING_DARK_THRESHOLD_DAYS) return 0;
  const overBy = days - GOING_DARK_THRESHOLD_DAYS;
  const step = Math.min(4, Math.ceil(overBy / BUCKET_STEP_DAYS));
  return step as GoingDarkBucket;
}

// Tuned for readable text at every step -- bg-red-500 needs white text,
// the lighter three don't.
const BUCKET_CLASSES: Record<GoingDarkBucket, string> = {
  0: "bg-emerald-100 text-emerald-700",
  1: "bg-red-100 text-red-600",
  2: "bg-red-200 text-red-700",
  3: "bg-red-300 text-red-900",
  4: "bg-red-500 text-white",
};

export function goingDarkClassName(bucket: GoingDarkBucket): string {
  return BUCKET_CLASSES[bucket];
}

export function goingDarkLabel(days: number | null): string {
  if (days === null) return "Never";
  return `${days}d ago`;
}

// Account rows show whichever of their projects is furthest past the
// threshold -- worst-case, not average, since one silently dropped project
// is exactly the failure mode this feature exists to surface.
export function worstBucket(buckets: GoingDarkBucket[]): GoingDarkBucket {
  return buckets.reduce((worst, b) => (b > worst ? b : worst), 0 as GoingDarkBucket);
}
