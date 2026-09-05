import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { ActivityScreen } from "@/components/screens/activity-screen";

export const dynamic = "force-dynamic";

/**
 * Activity tab — server component loads the user's groups for the filter;
 * the feed itself is fetched client-side (and polled) so payments appear live.
 */
export default async function ActivityPage() {
  const user = await requireUser();
  const groups = user
    ? await prisma.membership.findMany({
        where: { userId: user.id },
        select: { group: { select: { id: true, name: true } } },
        orderBy: { joinedAt: "desc" },
      })
    : [];

  return <ActivityScreen groups={groups.map((m) => m.group)} />;
}
