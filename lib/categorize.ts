/**
 * Bill categorization.
 * The AI (Gemini) tags the category at scan time; this module provides the
 * canonical category list, colors, and a keyword-based fallback classifier
 * used when no AI key is configured.
 */

export const CATEGORIES = [
  "Food",
  "Travel",
  "Rent",
  "Utilities",
  "Shopping",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Tailwind classes per category chip (works in light + dark mode). */
export const CATEGORY_STYLES: Record<Category, string> = {
  Food: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  Travel: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Rent: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  Utilities: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Shopping: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  Other: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

/** Emoji per category, used in recaps and feed items. */
export const CATEGORY_EMOJI: Record<Category, string> = {
  Food: "🍜",
  Travel: "🚕",
  Rent: "🏠",
  Utilities: "💡",
  Shopping: "🛍️",
  Other: "🧾",
};

/**
 * Validate an AI-returned category, falling back to "Other".
 */
export function safeCategory(raw: string | undefined | null): Category {
  if (!raw) return "Other";
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === raw.trim().toLowerCase()
  );
  return match ?? "Other";
}

const KEYWORDS: Array<{ category: Category; words: string[] }> = [
  { category: "Food", words: ["restaurant", "cafe", "pizza", "hotel", "dinner", "lunch", "breakfast", "swiggy", "zomato", "bakery", "food", "kitchen", "grill", "coffee", "juice"] },
  { category: "Travel", words: ["uber", "ola", "cab", "taxi", "metro", "train", "flight", "indigo", "petrol", "fuel", "gas station", "toll", "parking", "irctc"] },
  { category: "Rent", words: ["rent", "landlord", "lease", "maintenance", "society"] },
  { category: "Utilities", words: ["electricity", "water", "bill payment", "broadband", "wifi", "internet", "airtel", "jio", "vodafone", "gas agency", "mobile recharge"] },
  { category: "Shopping", words: ["amazon", "flipkart", "mall", "store", "market", "supermarket", "dmart", "big bazaar", "clothing", "shopping"] },
];

/**
 * Keyword-based fallback categorizer for vendor names / item labels
 * (used when no AI key is configured — keeps the app fully functional).
 */
export function categorizeFromText(vendor: string, items: Array<{ label: string }> = []): Category {
  const text = (
    vendor +
    " " +
    items.map((i) => i.label).join(" ")
  ).toLowerCase();
  for (const { category, words } of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return category;
  }
  return "Other";
}
