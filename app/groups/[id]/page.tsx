import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { notFound, redirect } from "next/navigation";
import { GroupDetailScreen } from "@/components/screens/group-detail-screen";

export const dynamic = "force-dynamic";

/**
 * Group detail page — server loads group, members, bills; the client screen
 * renders balances, settlement, payment links, recap, and the AI coach.
 */
export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) redirect("/login");

  const membership = await prisma.membership.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
  });
  if (!membership) notFound();

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      bills: {
        include: {
          uploader: { select: { name: true } },
          shares: { include: { user: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!group) notFound();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-4 pt-1 safe-bottom">
      <GroupDetailScreen
        group={{ id: group.id, name: group.name, code: group.code }}
        members={group.members.map((m) => m.user)}
        bills={group.bills.map((b) => ({
          id: b.id,
          vendor: b.vendor,
          category: b.category,
          total: b.total,
          date: b.billDate.toISOString(),
          paidBy: b.uploader.name,
          anomalyPct: b.anomalyPct,
          shares: b.shares.map((s) => ({
            userId: s.user.id,
            name: s.user.name,
            paid: s.paid,
            share: s.share,
          })),
        }))}
      />
    </div>
  );
}
