import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { HomeScreen } from "@/components/screens/home-screen";

export const dynamic = "force-dynamic";

/**
 * Home tab — server component loads the user's groups; the client screen
 * renders balance summary, forecast, and quick actions.
 */
export default async function HomePage() {
  const user = await requireUser();
  const groups = user
    ? await prisma.membership.findMany({
        where: { userId: user.id },
        include: { group: { include: { _count: { select: { members: true, bills: true } } } } },
      })
    : [];

  return (
    <HomeScreen
      userName={user?.name ?? "there"}
      groups={groups.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        memberCount: m.group._count.members,
        billCount: m.group._count.bills,
      }))}
    />
  );
}
