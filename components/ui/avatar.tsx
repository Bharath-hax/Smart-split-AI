import { avatarColor, initials } from "@/lib/utils";
import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * Initials avatar with a deterministic pastel color per person.
 */
export function Avatar({
  name,
  id,
  className,
}: {
  name: string;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
        className
      )}
      style={{ backgroundColor: avatarColor(id ?? name) }}
      aria-label={name}
    >
      {initials(name) || "?"}
    </div>
  );
}
