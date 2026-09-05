import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * Small pill label (categories, statuses, anomaly warnings).
 */
export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className
      )}
      {...props}
    />
  );
}
