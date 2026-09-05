import { ScanScreen } from "@/components/screens/scan-screen";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Scan Bill tab — needs the user's groups to pick a destination for the bill.
 */
export default async function ScanPage() {
  const user = await requireUser();
  const groups = user
    ? await prisma.membership.findMany({
        where: { userId: user.id },
        select: { group: { select: { id: true, name: true } } },
      })
    : [];

  return <ScanScreen groups={groups.map((m) => m.group)} />;
}
