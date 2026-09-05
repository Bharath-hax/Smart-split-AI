import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Pluralize a count + noun, e.g. plural(1, "member") -> "1 member",
 * plural(3, "bill") -> "3 bills". Pass a custom plural form when needed.
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * Merge Tailwind class names, resolving conflicts (shadcn convention).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Indian Rupees, e.g. 42350.5 -> "₹42,350.50".
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Short-format large INR amounts, e.g. 42350 -> "₹42.3k".
 */
export function formatINRShort(amount: number): string {
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${Math.round(amount)}`;
}

/**
 * Generate a random 6-character uppercase alphanumeric group code.
 */
export function generateGroupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/**
 * Derive a stable pastel avatar background color from any string (name/id).
 */
export function avatarColor(seed: string): string {
  const colors = [
    "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626",
    "#2563eb", "#c026d3", "#65a30d", "#ea580c", "#0d9488",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

/**
 * Get initials from a name, e.g. "Priya Sharma" -> "PS".
 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
