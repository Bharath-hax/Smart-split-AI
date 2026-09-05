"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, LogIn, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BottomSheet } from "@/components/bottom-sheet";
import { EmptyState, ErrorBanner } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";

interface GroupItem {
  id: string;
  name: string;
  code: string;
  memberCount: number;
  billCount: number;
}

/**
 * Groups tab: list + create/join bottom sheets.
 */
export function GroupsScreen({ groups }: { groups: GroupItem[] }) {
  const [sheet, setSheet] = React.useState<"create" | "join" | null>(null);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [list, setList] = React.useState(groups);
  const router = useRouter();

  async function createGroup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create group");
      setSheet(null);
      setName("");
      router.push(`/groups/${data.group.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join group");
      setSheet(null);
      setCode("");
      router.push(`/groups/${data.group.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Groups</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSheet("join")}>
            <LogIn className="h-4 w-4" /> Join
          </Button>
          <Button size="sm" onClick={() => setSheet("create")}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed">
          <EmptyState
            icon={Users}
            title="No groups yet"
            subtitle="Create one for your trip or flat, or join a friend's with their code."
          />
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((g) => (
            <div key={g.id}>
              <Link href={`/groups/${g.id}`} className="tap-highlight-none block">
                <motion.div
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.memberCount} member{g.memberCount !== 1 ? "s" : ""} · {g.billCount} bill{g.billCount !== 1 ? "s" : ""} · code {g.code}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </motion.div>
              </Link>
              {g.billCount === 0 && (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    No bills yet — scan your first one
                  </p>
                  <Link
                    href={`/scan?groupId=${g.id}`}
                    className="tap-highlight-none shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors active:bg-primary/20"
                  >
                    Scan
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BottomSheet open={sheet === "create"} onClose={() => setSheet(null)} title="Create a group">
        <div className="space-y-3">
          <Input
            placeholder="Group name (e.g. Goa Trip)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <ErrorBanner message={error} />}
          <Button className="w-full" disabled={busy || !name.trim()} onClick={createGroup}>
            Create group
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You&apos;ll get a 6-character code to share with friends.
          </p>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "join"} onClose={() => setSheet(null)} title="Join a group">
        <div className="space-y-3">
          <Input
            placeholder="Group code (e.g. GX4K2P)"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="text-center text-lg font-bold tracking-widest"
          />
          {error && <ErrorBanner message={error} />}
          <Button className="w-full" disabled={busy || code.length < 4} onClick={joinGroup}>
            Join group
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
