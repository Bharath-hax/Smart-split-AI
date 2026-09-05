"use client";

import { motion } from "framer-motion";
import { ArrowRight, Plus, ScanLine, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { Forecast } from "@/lib/insights";
import { formatINRShort } from "@/lib/utils";

interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  billCount: number;
}

/**
 * Home screen: greeting, quick actions, groups, and the fair-split
 * forecast for the first active group.
 */
export function HomeScreen({
  userName,
  groups,
}: {
  userName: string;
  groups: GroupSummary[];
}) {
  const [forecast, setForecast] = React.useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = React.useState(groups.length > 0);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (groups.length === 0) return;
      try {
        const res = await fetch(`/api/insights?groupId=${groups[0].id}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          const mine = data.forecasts?.[0];
          if (mine) setForecast(mine);
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setForecastLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <HomeBody userName={userName} groups={groups} forecast={forecast} forecastLoading={forecastLoading} />;
}

function HomeBody({
  userName,
  groups,
  forecast,
  forecastLoading,
}: {
  userName: string;
  groups: GroupSummary[];
  forecast: Forecast | null;
  forecastLoading: boolean;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">{greeting} 👋</p>
        <h1 className="text-2xl font-extrabold tracking-tight">{userName}</h1>
      </div>
      {groups.length > 0 && (
        <ForecastCard
          groupName={groups[0].name}
          forecast={forecast}
          loading={forecastLoading}
        />
      )}
      <QuickActions />
      <GroupList groups={groups} />
    </div>
  );
}

/**
 * Fair-split forecast card — "at this rate you'll owe ~₹X by month end".
 */
function ForecastCard({
  groupName,
  forecast,
  loading,
}: {
  groupName: string;
  forecast: Forecast | null;
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <TrendingUp className="h-4 w-4 text-primary" />
        Fair-split forecast · {groupName}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-6 w-3/4" />
      ) : forecast ? (
        <p className="mt-2 text-sm leading-relaxed">
          At this rate you&apos;ll likely owe{" "}
          <span className="font-bold text-primary">
            ~{formatINRShort(forecast.projectedOwe)}
          </span>{" "}
          by month end{" "}
          <span className="text-muted-foreground">
            ({forecast.trend === "rising"
              ? "📈 rising"
              : forecast.trend === "falling"
                ? "📉 falling"
                : "➡️ steady"}
            , {formatINRShort(forecast.dailyRate)}/day)
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Add a few bills and I&apos;ll start projecting your month.
        </p>
      )}
    </motion.div>
  );
}

/**
 * Three quick-action tiles.
 */
function QuickActions() {
  const tiles = [
    {
      href: "/scan",
      label: "Scan bill",
      icon: ScanLine,
      primary: true,
    },
    { href: "/groups", label: "New group", icon: Plus },
    { href: "/activity", label: "Activity", icon: Users },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <Link key={t.href} href={t.href} className="tap-highlight-none">
          <motion.div
            whileTap={{ scale: 0.96 }}
            className={
              t.primary
                ? "flex flex-col items-center gap-2 rounded-2xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/25"
                : "flex flex-col items-center gap-2 rounded-2xl border bg-card p-4"
            }
          >
            <t.icon className={t.primary ? "h-6 w-6" : "h-6 w-6 text-primary"} />
            <span className="text-xs font-semibold">{t.label}</span>
          </motion.div>
        </Link>
      ))}
    </div>
  );
}

/**
 * Group list with empty state.
 */
function GroupList({ groups }: { groups: GroupSummary[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Your groups</h2>
        <Link href="/groups" className="flex items-center gap-1 text-xs text-primary">
          All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed">
          <EmptyState
            icon={Users}
            title="No groups yet"
            subtitle="Create a group for your trip, flat, or squad and scan your first bill."
            action={
              <Link href="/groups">
                <span className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  Create a group
                </span>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="tap-highlight-none block">
              <motion.div
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-sm"
              >
                <div>
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.memberCount} members · {g.billCount} bills
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </motion.div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
