import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, value))
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-4 w-full overflow-hidden rounded-full bg-zinc-200/80",
          className
        )}
        {...props}
      >
        <div
          className={cn("h-full w-full flex-1 transition-all", indicatorClassName || "bg-blue-600")}
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress }
