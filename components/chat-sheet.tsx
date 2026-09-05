"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import * as React from "react";
import { BottomSheet } from "@/components/bottom-sheet";
import { ErrorBanner } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "ai";
  text: string;
}

const SUGGESTIONS = [
  "Who's overspending lately?",
  "How much did we spend on food this month?",
  "Who owes the most right now?",
];

/**
 * AI Spending Coach — chat-style bottom sheet grounded in the group's
 * real transaction data.
 */
export function ChatSheet({
  open,
  onClose,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
}) {
  const [messages, setMessages] = React.useState<Msg[]>([
    {
      role: "ai",
      text: "Hi! I'm your spending coach 🤖 Ask me anything about this group's expenses — I only use your real numbers.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The coach is unavailable");
      setMessages((m) => [...m, { role: "ai", text: data.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="AI Spending Coach" className="h-[80vh]">
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "ml-auto rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-secondary text-secondary-foreground"
              )}
            >
              {m.text}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Thinking…
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <div ref={endRef} />
        </div>

        <div className="flex flex-wrap gap-2 pb-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={loading}
              className="tap-highlight-none rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your spending…"
            className="h-12 flex-1 rounded-xl border border-input bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
            aria-label="Send"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      </div>
    </BottomSheet>
  );
}
