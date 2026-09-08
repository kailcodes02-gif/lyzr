import { cn } from "@/lib/utils";
import { goingDarkClassName, goingDarkLabel, type GoingDarkBucket } from "@/lib/going-dark";

// The 4-shade going-dark indicator used on tracker rows, project rows and
// page headers. Shape matches Badge; color comes from lib/going-dark.
export function GoingDarkPill({ bucket, days }: { bucket: GoingDarkBucket; days: number | null }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums", goingDarkClassName(bucket))}>
      {goingDarkLabel(days)}
    </span>
  );
}
