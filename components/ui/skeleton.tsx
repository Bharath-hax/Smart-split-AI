import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * Pulsing placeholder block used for all loading states.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-muted", className)}
      {...props}
    />
  );
}
