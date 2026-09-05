import { NextResponse, type NextRequest } from "next/server";
import { authGuard, isMember, jsonError } from "@/lib/api";
import { extractBillFromImage } from "@/lib/gemini";
import { computeAnomalyPct } from "@/lib/insights";
import { categorizeFromText, safeCategory } from "@/lib/categorize";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/ocr — scan a receipt image.
 * Body: { imageBase64, mimeType, groupId? }
 * Runs Gemini Vision, auto-categorizes, and computes an
 * anomaly % vs. the group's historical bill average.
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard();
  if ("response" in auth) return auth.response;
  try {
    const { imageBase64, mimeType, groupId } = await req.json();
    if (!imageBase64) return jsonError("imageBase64 is required");

    // Strip data-URL prefix if the client sent one
    const base64 = String(imageBase64).includes(",")
      ? String(imageBase64).split(",")[1]
      : String(imageBase64);

        const extracted = await extractBillFromImage(base64, mimeType || "image/jpeg");

    // If the AI was unavailable, at least run the keyword categorizer
    if (extracted.engine === "fallback" && extracted.vendor) {
      extracted.category = categorizeFromText(extracted.vendor, extracted.items.map((it) => ({ label: it.name })));
    } else {
      extracted.category = safeCategory(extracted.category);
    }

    // Anomaly detection vs. group history
    let anomalyPct: number | null = null;
    if (groupId && extracted.total > 0 && (await isMember(auth.user.id, groupId))) {
      const past = await prisma.bill.findMany({
        where: { groupId },
        select: { total: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      anomalyPct = computeAnomalyPct(
        extracted.total,
        past.map((p) => p.total)
      );
    }

    const { raw, needsReview, ...rest } = extracted;
    return NextResponse.json({
      ...rest,
      anomalyPct,
      needsReview: Boolean(needsReview),
      ...(raw ? { debug: { raw } } : {}),
    });
  } catch (e) {
    return jsonError(
      `OCR failed: ${e instanceof Error ? e.message : "unknown"}`,
      500
    );
  }
}
