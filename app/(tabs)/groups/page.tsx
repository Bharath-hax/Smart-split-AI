import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { GroupsScreen } from "@/components/screens/groups-screen";

export const dynamic = "force-dynamic";

/**
 * Groups tab — server component loads the user's groups.
 */
export default async function GroupsPage() {
  const user = await requireUser();
  const groups = user
    ? await prisma.membership.findMany({
        where: { userId: user.id },
        include: { group: { include: { _count: { select: { members: true, bills: true } } } } },
      })
    : [];

  return (
    <GroupsScreen
      groups={groups.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        code: m.group.code,
        memberCount: m.group._count.members,
        billCount: m.group._count.bills,
      }))}
    />
  );
}
