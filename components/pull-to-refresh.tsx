"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native-feeling pull-to-refresh wrapper: pull down at the top of the
 * scroll area to trigger a refresh callback.
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  onRefresh: () => Promise<unknown> | void;
  children: React.ReactNode;
  className?: string;
}) {
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (window.scrollY <= 0) startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null || refreshing) return;
    const distance = e.touches[0].clientY - startY.current;
    if (distance > 0 && window.scrollY <= 0) {
      setPull(Math.min(distance * 0.5, 80));
    }
  }

  async function onTouchEnd() {
    startY.current = null;
    if (pull > 50 && !refreshing) {
      setRefreshing(true);
      setPull(56);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }

  return (
    <div
      className={cn("touch-pan-y", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] text-muted-foreground"
        style={{ height: pull }}
      >
        <Loader2
          className={cn("h-5 w-5", refreshing ? "animate-spin" : "")}
          style={{ transform: `rotate(${pull * 4}deg)` }}
        />
      </div>
      {children}
    </div>
  );
}
