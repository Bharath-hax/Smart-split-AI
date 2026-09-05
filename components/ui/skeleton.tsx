import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * Gentle shimmer placeholder used for all loading states — reads as
 * "content is on its way", never as a stuck gray block.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-xl bg-muted", className)}
      {...props}
    />
  );
}
