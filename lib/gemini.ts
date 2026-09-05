/**
 * AI layer — Google Gemini only (free-model chain, graceful degradation).
 * Every call is wrapped in try/catch and degrades gracefully.
 */
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export interface ExtractedItem {
  name: string;
  quantity: string;
  unitPrice: number | null;
  amount: number;
}

export interface ExtractedBill {
  vendor: string;
  total: number;
  currency: string;
  date: string;
  category: string;
  items: ExtractedItem[];
  subtotal: number | null;
  tax: number | null;
  serviceCharge: number | null;
  discount: number | null;
  engine: string;
  needsReview?: boolean;
  raw?: string;
  note?: string;
}

export interface AiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return /xxxx|your_|change_me|placeholder/i.test(v);
}

if (typeof window === "undefined") {
  if (isPlaceholder(process.env.GEMINI_API_KEY)) {
    console.error("[SplitSettle AI] ⚠️ GEMINI_API_KEY missing/empty. OCR/AI fallback mode.");
  } else {
    console.log(`[SplitSettle AI] ✅ Gemini configured (model: ${process.env.GEMINI_MODEL || "gemini-3.6-flash"}, free-model chain).`);
  }
}

export function aiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && !isPlaceholder(process.env.GEMINI_API_KEY));
}

/* ── JSON parser with loose matching ── */
function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned) as T; } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; } }
    return null;
  }
}

/* ── Bill extraction ── */
const OCR_PROMPT = `You are an OCR receipt parser. Parse the bill/receipt in the image and return strict JSON matching this schema:
{"vendor":"...","date":"YYYY-MM-DD","currency":"INR","category":"Food|Travel|Rent|Utilities|Shopping|Other","items":[{"name":"item","quantity":"1","unitPrice":null,"amount":100}],"subtotal":null,"tax":null,"serviceCharge":null,"discount":null,"total":100.0}
If no line items visible, return one item named after vendor. No markdown.`;

const BILL_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    vendor: { type: SchemaType.STRING },
    date: { type: SchemaType.STRING },
    currency: { type: SchemaType.STRING },
    category: { type: SchemaType.STRING },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          quantity: { type: SchemaType.STRING },
          unitPrice: { type: SchemaType.NUMBER, nullable: true },
          amount: { type: SchemaType.NUMBER },
        },
        required: ["name", "quantity", "amount"],
      },
    },
    subtotal: { type: SchemaType.NUMBER, nullable: true },
    tax: { type: SchemaType.NUMBER, nullable: true },
    serviceCharge: { type: SchemaType.NUMBER, nullable: true },
    discount: { type: SchemaType.NUMBER, nullable: true },
    total: { type: SchemaType.NUMBER },
  },
  required: ["vendor", "date", "currency", "items", "total"],
} as const;

/* ── Free-tier Gemini model chain ───────────────────────────────────────────
 * Every AI call walks this list in order — the first free model that answers
 * wins. If ALL Gemini models fail (quota exhausted, 429, outage, bad key) we
 * degrade to local heuristics (never to another provider). Nothing ever
 * throws to the caller. */
const FREE_GEMINI_MODELS: string[] = Array.from(
  new Set(
    [
      process.env.GEMINI_MODEL || "gemini-3.6-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-flash-latest",
    ].filter((m): m is string => Boolean(m))
  )
);

async function geminiGenerate(
  parts: unknown[],
  generationConfig: Record<string, unknown>
): Promise<{ text: string; model: string } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || isPlaceholder(key)) return null;
  let genAI: GoogleGenerativeAI;
  try {
    genAI = new GoogleGenerativeAI(key);
  } catch (e) {
    console.error("[Gemini] Init failed:", e instanceof Error ? e.message : e);
    return null;
  }
  for (const model of FREE_GEMINI_MODELS) {
    try {
      const m = genAI.getGenerativeModel({
        model,
        generationConfig: generationConfig as never,
      });
      const result = await m.generateContent(parts as never);
      const text = result.response.text().trim();
      if (text) return { text, model };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Gemini] ${model} failed → trying next: ${msg.slice(0, 140)}`);
    }
  }
  console.error("[Gemini] All free models failed.");
  return null;
}

async function geminiText(
  prompt: string,
  temperature = 0
): Promise<{ text: string; model: string } | null> {
  return geminiGenerate([{ text: prompt }], { temperature });
}

function parseArrayLoose(text: string): unknown[] | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const j = JSON.parse(cleaned);
    return Array.isArray(j) ? j : null;
  } catch {
    /* fall through to bracket scan */
  }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  }
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* Normalize any AI's raw JSON into our ExtractedBill shape. */
function normalizeBill(parsed: any, engine: string, model: string): ExtractedBill {
  const items = (Array.isArray(parsed?.items) ? parsed.items : [])
    .filter((it: any) => it && typeof it.name === "string")
    .map((it: any) => ({
      name: String(it.name),
      quantity: String(it.quantity ?? "1"),
      unitPrice: num(it.unitPrice),
      amount: num(it.amount) ?? 0,
    }));
  return {
    vendor: String(parsed?.vendor ?? ""),
    total: Number(parsed?.total) || 0,
    currency: String(parsed?.currency ?? "INR"),
    date: String(parsed?.date ?? ""),
    category: String(parsed?.category ?? ""),
    items,
    subtotal: num(parsed?.subtotal),
    tax: num(parsed?.tax),
    serviceCharge: num(parsed?.serviceCharge),
    discount: num(parsed?.discount),
    engine: `${engine}(${model})`,
  };
}

const FALLBACK_BILL: ExtractedBill = {
  vendor: "",
  total: 0,
  currency: "INR",
  date: "",
  category: "",
  items: [],
  subtotal: null,
  tax: null,
  serviceCharge: null,
  discount: null,
  engine: "fallback",
  needsReview: true,
  note: "All AI engines unavailable — please enter the bill manually.",
};

/**
 * Scan a receipt image. Engine order:
 *   1. Gemini vision — walks every free model in FREE_GEMINI_MODELS
 *   2. Local "fallback" placeholder → UI asks for manual entry
 */
export async function extractBillFromImage(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ExtractedBill> {
  const parts = [
    { inlineData: { data: imageBase64, mimeType } },
    { text: OCR_PROMPT },
  ];
  const config = {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: BILL_SCHEMA,
  };

  // 1 ─ Gemini (every free model, in order)
  const gem = await geminiGenerate(parts, config);
  if (gem) {
    const parsed = parseJsonLoose<any>(gem.text);
    if (parsed && parsed.items?.length && Number(parsed.total) > 0) {
      console.log(`[OCR] ✅ extracted via Gemini ${gem.model}`);
      return normalizeBill(parsed, "gemini", gem.model);
    }
  }
  // 1b ─ retry Gemini without responseSchema (newer models may reject it)
  const gem2 = await geminiGenerate(parts, {
    temperature: 0,
    responseMimeType: "application/json",
  });
  if (gem2) {
    const parsed = parseJsonLoose<any>(gem2.text);
    if (parsed && parsed.items?.length && Number(parsed.total) > 0) {
      console.log(`[OCR] ✅ extracted via Gemini ${gem2.model} (no-schema mode)`);
      return normalizeBill(parsed, "gemini", gem2.model);
    }
  }

  // 2 ─ Local fallback (manual entry)
  console.error("[OCR] ⚠️ All Gemini models failed → manual-entry fallback.");
  return { ...FALLBACK_BILL };
}

/**
 * AI Spending Coach — answer a question using ONLY the grounded group data.
 * Gemini (all free models) → graceful error.
 */
export async function answerGroupQuestion(
  question: string,
  context: string
): Promise<AiResult<string>> {
  const prompt = `You are a friendly expense-splitting coach for a group app.
Answer the user's question using ONLY the data below — never invent numbers.
Keep the answer under 120 words, plain text, no markdown.

DATA:
${context}

QUESTION: ${question}`;
  const gem = await geminiText(prompt, 0.3);
  if (gem) return { ok: true, data: gem.text };
  return { ok: false, error: "The AI coach is unavailable right now — please try again later." };
}

/**
 * AI insights. Returns [] when no AI is reachable (the route still shows the
 * deterministic recap regardless).
 */
export async function generateInsights(context: string): Promise<AiResult<string[]>> {
  const prompt = `Based on this spending data, give 2-3 short actionable insights (1 sentence each). Be specific with numbers.
Data: ${context}
Format as a JSON array of strings.`;
  const gem = await geminiText(prompt, 0.4);
  if (gem) {
    const arr = parseArrayLoose(gem.text);
    if (arr) return { ok: true, data: arr.map(String) };
    return { ok: true, data: [gem.text] };
  }
  return { ok: true, data: [] };
}

/**
 * Smart payment-reminder message. Tone scales with how overdue it is.
 * Gemini → deterministic template (never fails).
 */
export async function generateReminderMessage(
  debtorName: string,
  creditorName: string,
  groupName: string,
  amount: number,
  daysOverdue: number
): Promise<AiResult<string>> {
  const tone =
    daysOverdue >= 5
      ? "firm but polite"
      : daysOverdue >= 2
        ? "friendly nudge"
        : "very gentle, casual";
  const prompt = `Write a short payment reminder message (1-2 sentences) reminding ${debtorName} to pay ${amount.toFixed(0)} to ${creditorName} for "${groupName}". ${daysOverdue} days since the split. Tone: ${tone}. Return ONLY the message.`;
  const gem = await geminiText(prompt, 0.5);
  if (gem) return { ok: true, data: gem.text };
  const lead =
    daysOverdue >= 5
      ? "Please settle"
      : daysOverdue >= 2
        ? "Quick reminder:"
        : "Hi! Gentle nudge:";
  return {
    ok: true,
    data: `${lead} you owe ${amount.toFixed(0)} to ${creditorName} in ${groupName}. Thanks!`,
  };
}