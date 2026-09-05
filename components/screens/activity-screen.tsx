"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity as ActivityIcon, Receipt, Sparkles, UserPlus, Wallet } from "lucide-react";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorBanner } from "@/components/empty-state";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface GroupOption {
  id: string;
  name: string;
}

interface FeedItem {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  actor?: { id: string; name: string } | null;
}

const TYPE_META: Record<string, { icon: typeof Receipt; className: string }> = {
  bill: { icon: Receipt, className: "bg-primary/10 text-primary" },
  settlement: { icon: Wallet, className: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  payment: { icon: Wallet, className: "bg-success/10 text-success" },
  join: { icon: UserPlus, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  group: { icon: Sparkles, className: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

/**
 * Activity tab: live transaction feed with group filter, pull-to-refresh,
 * and 8s polling for webhook-driven updates.
 */
export function ActivityScreen({ groups }: { groups: GroupOption[] }) {
  const [activeGroup, setActiveGroup] = React.useState(groups[0]?.id ?? "");
  const [items, setItems] = React.useState<FeedItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!activeGroup) return;
    try {
      const res = await fetch(`/api/activity?groupId=${activeGroup}&limit=50`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load activity");
      setItems(data.activities);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }, [activeGroup]);

  React.useEffect(() => {
    setItems(null);
    load();
    const timer = setInterval(load, 8000); // live-ish updates
    return () => clearInterval(timer);
  }, [load]);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed">
        <EmptyState
          icon={ActivityIcon}
          title="Nothing here yet"
          subtitle="Join or create a group — every bill, settlement, and payment shows up in this feed."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">Activity</h1>

      {/* Group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveGroup(g.id)}
            className={cn(
              "tap-highlight-none shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              activeGroup === g.id
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground"
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <PullToRefresh onRefresh={load}>
        {items === null ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed">
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              subtitle="Scan the first bill and watch this feed come alive."
            />
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const meta = TYPE_META[item.type] ?? TYPE_META.bill;
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-3 rounded-2xl border bg-card p-3.5 shadow-sm"
                  >
                    {item.actor ? (
                      <Avatar name={item.actor.name} id={item.actor.id} />
                    ) : (
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", meta.className)}>
                        <Icon className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{item.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {timeAgo(item.createdAt)}
                      </p>
                    </div>
                    <div className={cn("rounded-lg p-1.5", meta.className)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}

/**
 * Human-friendly relative time, e.g. "2h ago".
 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
