"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { BottomSheet } from "@/components/bottom-sheet";
import { ErrorBanner } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORY_EMOJI, CATEGORY_STYLES, type Category } from "@/lib/categorize";
import { cn, formatINR } from "@/lib/utils";

/** Is this running in development? (inlined by Next — used for the OCR debug toggle) */
const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Client-side image resize/compress before OCR — oversized photos both slow
 * down the Gemini call and can degrade OCR accuracy. Max width ~1600px, JPEG.
 */
async function resizeImage(dataUrl: string, maxWidth = 1600): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Could not load image"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxWidth / img.width);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.85);
}

interface GroupOption {
  id: string;

  name: string;

}
interface Member {
  id: string;
  name: string;
}
interface Extracted {
  vendor: string;
  total: number;
  date: string;
  category: Category;
  items: Array<{ label: string; amount: number }>;
  engine: string;
  anomalyPct: number | null;
  needsReview?: boolean;
}
type SplitMode = "equal" | "custom" | "item";

/**
 * Scan Bill screen — camera/file capture → Gemini extraction with animated
 * confirmation card → payer assignment + split editor → save.
 */
export function ScanScreen({ groups }: { groups: GroupOption[] }) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [image, setImage] = React.useState<string | null>(null);
  const [groupId, setGroupId] = React.useState(groups[0]?.id ?? "");
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [extracted, setExtracted] = React.useState<Extracted | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [payers, setPayers] = React.useState<Set<string>>(new Set());
  const [participants, setParticipants] = React.useState<Set<string>>(new Set());
  const [splitMode, setSplitMode] = React.useState<SplitMode>("equal");
  const [customAmounts, setCustomAmounts] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [rawJson, setRawJson] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // Load members when a group is picked
  React.useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/groups/${groupId}/members`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setMembers(data.members ?? []);
          setParticipants(new Set((data.members ?? []).map((m: Member) => m.id)));
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function handleFile(file: File) {
    setScanError(null);
    setExtracted(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const resized = await resizeImage(dataUrl);
      setImage(resized);
      setRawJson(null);
      setScanning(true);
      try {
        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: resized,
            mimeType: "image/jpeg",
            groupId: groupId || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        setExtracted({
          vendor: data.vendor,
          total: data.total,
          date: data.date,
          category: data.category,
          items: data.items ?? [],
          engine: data.engine,
          anomalyPct: data.anomalyPct ?? null,
          needsReview: Boolean(data.needsReview),
        });
        setRawJson(data?.debug?.raw ?? null);
      } catch (e) {
        setScanError(e instanceof Error ? e.message : "Could not scan the bill");
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  }

  const [itemAssignments, setItemAssignments] = React.useState<Record<number, string>>({});

  async function save() {
    if (!extracted || !groupId) return;
    setSaveError(null);
    setSaving(true);

    const participantIds = participants.size > 0 ? [...participants] : members.map((m) => m.id);
    const payerIds = [...payers];
    if (payerIds.length === 0) {
      setSaveError("Tap at least one person who paid");
      setSaving(false);
      return;
    }

    // Compute shares by mode
    let shares: Array<{ userId: string; share: number }> = [];
    if (splitMode === "equal") {
      const each = extracted.total / participantIds.length;
      shares = participantIds.map((id) => ({ userId: id, share: Math.round(each * 100) / 100 }));
    } else if (splitMode === "custom") {
      shares = participantIds.map((id) => ({
        userId: id,
        share: Number(customAmounts[id]) || 0,
      }));
    } else {
      // by item: assigned items go to their assignee, the rest split equally
      const unassignedTotal = extracted.items
        .filter((_, i) => !itemAssignments[i])
        .reduce((a, b) => a + b.amount, 0);
      const each = unassignedTotal / participantIds.length;
      const byUser = new Map<string, number>();
      for (const id of participantIds) byUser.set(id, each);
      for (const [idx, uid] of Object.entries(itemAssignments)) {
        const item = extracted.items[Number(idx)];
        if (item) byUser.set(uid, (byUser.get(uid) ?? 0) + item.amount);
      }
      shares = [...byUser.entries()].map(([userId, share]) => ({
        userId,
        share: Math.round(share * 100) / 100,
      }));
    }

    // Payers split the total evenly among themselves
    const paidEach = extracted.total / payerIds.length;
    const splits = shares.map((s) => ({
      userId: s.userId,
      paid: payerIds.includes(s.userId) ? Math.round(paidEach * 100) / 100 : 0,
      share: s.share,
    }));

    try {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          vendor: extracted.vendor,
          category: extracted.category,
          total: extracted.total,
          billDate: extracted.date,
          items: extracted.items,
          anomalyPct: extracted.anomalyPct,
          splits,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save bill");
      setDone(true);
      setTimeout(() => router.push(`/groups/${groupId}`), 1200);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the bill");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">Scan a bill</h1>

      {groups.length === 0 ? (
        <ErrorBanner message="Create a group first — bills need somewhere to live!" />
      ) : (
        <>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          {!image ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => fileRef.current?.click()}
              className="tap-highlight-none flex h-56 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary/40 bg-accent/50 text-accent-foreground"
            >
              <Camera className="h-10 w-10 text-primary" />
              <span className="font-semibold">Take a photo of the bill</span>
              <span className="text-xs text-muted-foreground">or tap to choose from gallery</span>
            </motion.button>
          ) : (
            <div className="relative overflow-hidden rounded-3xl border shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Bill" className="max-h-56 w-full object-cover" />
              {scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="h-4 w-4" /> AI is reading your bill…
                  </p>
                </div>
              )}
            </div>
          )}

          {scanError && <ErrorBanner message={scanError} />}

          {/* Extracted confirmation card — fields animate in one by one */}
          <AnimatePresence>
            {extracted && !scanning && !done && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 rounded-3xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-bold">Confirm details</h2>
                  <Badge className={CATEGORY_STYLES[extracted.category]}>
                    {CATEGORY_EMOJI[extracted.category]} {extracted.category}
                  </Badge>
                </div>

                {extracted.anomalyPct != null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <b>Unusually high</b> — {extracted.anomalyPct}% above this
                      group&apos;s usual bill. Please double-check before splitting.
                    </span>
                  </motion.div>
                )}

                {(
                  [
                    ["vendor", "Vendor", "text"],
                    ["total", "Total (₹)", "number"],
                    ["date", "Date", "date"],
                  ] as const
                ).map(([key, label, type], i) => (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.15 }}
                  >
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {label}
                    </label>
                    <Input
                      type={type}
                      value={String(extracted[key] ?? "")}
                      onChange={(e) =>
                        setExtracted((x) =>
                          x
                            ? {
                                ...x,
                                [key]:
                                  type === "number" ? Number(e.target.value) : e.target.value,
                              }
                            : x
                        )
                      }
                    />
                  </motion.div>
                ))}

                {(extracted.engine === "fallback" || extracted.needsReview) && (
                  <p className="text-xs font-medium text-warning">
                    AI couldn&apos;t fully read this bill — please fill in totals manually.
                  </p>
                )}

                {IS_DEV && rawJson && (
                  <details className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none font-semibold">
                      🐞 Debug: raw Gemini JSON
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{rawJson}</pre>
                  </details>
                )}

                <PayerPicker
                  members={members}
                  payers={payers}
                  participants={participants}
                  setPayers={setPayers}
                  setParticipants={setParticipants}
                  splitMode={splitMode}
                  setSplitMode={setSplitMode}
                  customAmounts={customAmounts}
                  setCustomAmounts={setCustomAmounts}
                  items={extracted.items}
                  itemAssignments={itemAssignments}
                  setItemAssignments={setItemAssignments}
                />

                {saveError && <ErrorBanner message={saveError} />}

                <Button className="w-full" size="lg" disabled={saving} onClick={save}>
                  {saving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" /> Save & split
                    </>
                  )}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {done && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-2 rounded-3xl bg-success/10 p-8 text-success"
            >
              <CheckCircle2 className="h-12 w-12" />
              <p className="font-bold">Bill saved & split!</p>
              <p className="text-sm">Taking you to the group…</p>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Payer + participant picker with split mode (equal / custom / by item).
 */
function PayerPicker({
  members,
  payers,
  participants,
  setPayers,
  setParticipants,
  splitMode,
  setSplitMode,
  customAmounts,
  setCustomAmounts,
  items,
  itemAssignments,
  setItemAssignments,
}: {
  members: Member[];
  payers: Set<string>;
  participants: Set<string>;
  setPayers: (s: Set<string>) => void;
  setParticipants: (s: Set<string>) => void;
  splitMode: SplitMode;
  setSplitMode: (m: SplitMode) => void;
  customAmounts: Record<string, string>;
  setCustomAmounts: (r: Record<string, string>) => void;
  items: Array<{ label: string; amount: number }>;
  itemAssignments: Record<number, string>;
  setItemAssignments: (r: Record<number, string>) => void;
}) {
  function toggle(
    id: string,
    set: Set<string>,
    setter: (s: Set<string>) => void
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <div className="space-y-3 rounded-2xl bg-secondary/50 p-3">
      <p className="text-xs font-semibold text-muted-foreground">WHO PAID?</p>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => toggle(m.id, payers, setPayers)}
            className={cn(
              "tap-highlight-none flex items-center gap-1.5 rounded-full border py-1.5 pl-1.5 pr-3 text-sm",
              payers.has(m.id)
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "bg-card"
            )}
          >
            <Avatar name={m.name} id={m.id} className="h-6 w-6 text-[9px]" />
            {m.name}
          </button>
        ))}
      </div>

      <p className="text-xs font-semibold text-muted-foreground">SPLIT BETWEEN</p>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => toggle(m.id, participants, setParticipants)}
            className={cn(
              "tap-highlight-none rounded-full border px-3 py-1.5 text-sm",
              participants.has(m.id)
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "bg-card text-muted-foreground line-through"
            )}
          >
            {m.name}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {(["equal", "custom", "item"] as SplitMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setSplitMode(mode)}
            disabled={mode === "item" && items.length === 0}
            className={cn(
              "tap-highlight-none flex-1 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-40",
              splitMode === mode ? "bg-primary text-primary-foreground" : "bg-card"
            )}
          >
            {mode === "equal" ? "Equal" : mode === "custom" ? "Custom" : "By item"}
          </button>
        ))}
      </div>

      {splitMode === "custom" && (
        <div className="space-y-1.5">
          {members
            .filter((m) => participants.has(m.id))
            .map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-20 truncate text-sm">{m.name}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="₹0"
                  value={customAmounts[m.id] ?? ""}
                  onChange={(e) =>
                    setCustomAmounts({ ...customAmounts, [m.id]: e.target.value })
                  }
                  className="h-9 flex-1"
                />
              </div>
            ))}
        </div>
      )}

      {splitMode === "item" && items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-24 truncate text-xs">{item.label}</span>
              <span className="text-xs text-muted-foreground">
                {formatINR(item.amount)}
              </span>
              <select
                value={itemAssignments[idx] ?? ""}
                onChange={(e) =>
                  setItemAssignments({ ...itemAssignments, [idx]: e.target.value })
                }
                className="ml-auto h-8 rounded-lg border border-input bg-card px-2 text-xs"
              >
                <option value="">Split equally</option>
                {members
                  .filter((m) => participants.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
