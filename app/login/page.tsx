"use client";

import { motion } from "framer-motion";
import { Loader2, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/empty-state";
import { Input } from "@/components/ui/input";

/**
 * Quick login — name + phone, no OTP (demo speed).
 */
export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError("Please enter a valid email address — it's used to send payment reminders.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email: cleanEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/30">
            <ScanLine className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">SplitSettle AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan bills with AI. Settle in the fewest payments.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={40}
          />
          <Input
            placeholder="Phone number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <Input
            placeholder="Email (for payment reminders)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <ErrorBanner message={error} />}
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          No password needed — just name, phone & email for the demo.
        </p>
      </motion.div>
    </div>
  );
}
