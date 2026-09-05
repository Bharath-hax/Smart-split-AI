/**
 * AI layer — Google Gemini primary, OpenAI GPT-4o-mini fallback.
 * Every call is wrapped in try/except and degrades gracefully:
 * the app stays fully functional (with sensible fallbacks) when no key is set.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ExtractedBill {
  vendor: string;
  total: number;
  /** ISO date string */
  date: string;
  category: string;
  items: Array<{ label: string; amount: number }>;
  /** which engine produced this: "gemini" | "openai" | "fallback" */
  engine: string;
}

export interface AiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Treat obvious placeholder values as unset. */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return /xxxx|your_|change_me|placeholder/i.test(v);
}

/** Is any AI provider configured (with a real, non-placeholder key)? */
export function aiAvailable(): boolean {
  if (process.env.GEMINI_API_KEY && !isPlaceholder(process.env.GEMINI_API_KEY)) {
    return true;
  }
  return (
    process.env.USE_OPENAI_FALLBACK === "true" &&
    Boolean(process.env.OPENAI_API_KEY) &&
    !isPlaceholder(process.env.OPENAI_API_KEY)
  );
}

/** Lazily construct the Gemini text/vision model, or null if unconfigured. */
function geminiModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || isPlaceholder(key)) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    });
  } catch {
    return null;
  }
}

/**
 * Parse a JSON object out of a model response that may contain
 * markdown fences or surrounding prose.
 */
function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Call OpenAI chat completions (used only when USE_OPENAI_FALLBACK=true).
 */
async function openaiChat(
  messages: Array<{ role: string; content: unknown }>,
  jsonMode = false
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.4,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * OCR a receipt image with Gemini Vision (OpenAI fallback).
 * Returns extracted vendor/total/date/category/items, or a safe fallback
 * result (empty fields, engine "fallback") if AI is unavailable or fails.
 */
export async function extractBillFromImage(
  base64: string,
  mimeType: string
): Promise<AiResult<ExtractedBill>> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are a receipt-parsing engine. Extract data from this receipt photo and respond with ONLY a JSON object, no prose:
{"vendor":"store name","total":number,"date":"YYYY-MM-DD","category":"Food|Travel|Rent|Utilities|Shopping|Other","items":[{"label":"item","amount":number}]}
Rules: total = final amount paid. date defaults to ${today}. items = only visible itemized lines (empty array if none). If the image is not a receipt, return vendor "Unknown" and total 0.`;

  // 1) Gemini Vision
  const model = geminiModel();
  if (model) {
    try {
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } },
      ]);
      const parsed = parseJsonLoose<ExtractedBill>(result.response.text());
      if (parsed && typeof parsed.total === "number") {
        return { ok: true, data: normalize(parsed, "gemini", today) };
      }
    } catch {
      // fall through to OpenAI / fallback
    }
  }

  // 2) OpenAI vision fallback
  if (process.env.USE_OPENAI_FALLBACK === "true" && process.env.OPENAI_API_KEY) {
    const text = await openaiChat(
      [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      true
    );
    const parsed = text ? parseJsonLoose<ExtractedBill>(text) : null;
    if (parsed && typeof parsed.total === "number") {
      return { ok: true, data: normalize(parsed, "openai", today) };
    }
  }

  // 3) Graceful fallback — user fills the card manually
  return {
    ok: true,
    data: {
      vendor: "",
      total: 0,
      date: today,
      category: "Other",
      items: [],
      engine: "fallback",
    },
    error: aiAvailable()
      ? "AI could not read this image clearly — please fill in the details."
      : "No AI key configured — please fill in the details manually.",
  };
}

/**
 * Coerce a parsed bill object into a well-formed ExtractedBill.
 */
function normalize(
  parsed: Partial<ExtractedBill>,
  engine: string,
  today: string
): ExtractedBill {
  return {
    vendor: parsed.vendor || "Unknown",
    total: Number(parsed.total) || 0,
    date: parsed.date || today,
    category: parsed.category || "Other",
    items: Array.isArray(parsed.items) ? parsed.items : [],
    engine,
  };
}

/** Shared text-completion helper: Gemini first, then OpenAI; null if neither. */
async function aiText(prompt: string, jsonMode: boolean): Promise<string | null> {
  const model = geminiModel();
  if (model) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (text) return text;
    } catch {
      // fall through
    }
  }
  if (process.env.USE_OPENAI_FALLBACK === "true" && process.env.OPENAI_API_KEY) {
    return openaiChat([{ role: "user", content: prompt }], jsonMode);
  }
  return null;
}

/**
 * Generate 2-3 natural-language spending insights from a serialized
 * group context string. Falls back to simple template insights.
 */
export async function generateInsights(context: string): Promise<AiResult<string[]>> {
  const prompt = `You are a spending coach for a group splitting expenses.
Below is the group's real transaction data as JSON. Use ONLY these numbers — never invent amounts.

${context}

Return ONLY a JSON object: {"insights":["...","...","..."]}
Each insight is 1-2 sentences, specific (name people, categories, amounts), and actionable.`;

  const text = await aiText(prompt, true);
  if (text) {
    const parsed = parseJsonLoose<{ insights: string[] }>(text);
    if (parsed?.insights?.length) return { ok: true, data: parsed.insights.slice(0, 3) };
  }
  return {
    ok: true,
    data: [
      "Add more bills to unlock personalized AI insights for this group.",
      "Tip: scan receipts right after paying so nothing gets forgotten at settlement time.",
    ],
  };
}

/**
 * Answer a natural-language question about the group using its real data
 * as grounding context. The model is explicitly instructed to use only the
 * provided numbers.
 */
export async function answerGroupQuestion(
  question: string,
  context: string
): Promise<AiResult<string>> {
  const prompt = `You are SplitSettle AI, a friendly spending coach inside a bill-splitting app.
Answer the user's question about their group using ONLY the JSON data below.
Never invent numbers — if the data doesn't contain the answer, say so honestly.
Keep the answer under 120 words, conversational, use ₹ for amounts.

DATA:
${context}

QUESTION: ${question}`;

  const text = await aiText(prompt, false);
  if (text) return { ok: true, data: text.trim() };

  return {
    ok: true,
    data: "AI chat needs a GEMINI_API_KEY in your environment. Everything else in the app works without it — add the key to unlock the coach.",
  };
}

/**
 * Generate a short, friendly, personalized payment reminder. Tone scales
 * with how overdue the debt is: gentle on day 1, firmer by day 5+.
 */
export async function generateReminderMessage(
  debtorName: string,
  creditorName: string,
  groupName: string,
  amount: number,
  daysOverdue: number
): Promise<AiResult<string>> {
  const tone =
    daysOverdue <= 1
      ? "gentle and casual"
      : daysOverdue <= 3
        ? "friendly but nudging"
        : "firm but still polite";
  const prompt = `Write a short WhatsApp-style payment reminder (max 2 sentences, no subject line, sign off as "— ${creditorName} via SplitSettle AI").
Tone: ${tone}. The debt is ${daysOverdue} day(s) old.
Debtor: ${debtorName}. Group: ${groupName}. Amount: ₹${amount.toFixed(2)}.
Respond with ONLY JSON: {"message":"..."}`;

  const text = await aiText(prompt, true);
  if (text) {
    const parsed = parseJsonLoose<{ message: string }>(text);
    if (parsed?.message) return { ok: true, data: parsed.message };
  }

  // Template fallback (no AI key needed)
  const emoji = daysOverdue <= 1 ? "👋" : daysOverdue <= 3 ? "🙂" : "⏰";
  return {
    ok: true,
    data: `${emoji} Hey ${debtorName}! Small reminder — you owe ₹${amount.toFixed(
      2
    )} in ${groupName}${daysOverdue > 1 ? ` (${daysOverdue} days now)` : ""}. Could you settle up when you get a chance? — ${creditorName} via SplitSettle AI`,
  };
}
