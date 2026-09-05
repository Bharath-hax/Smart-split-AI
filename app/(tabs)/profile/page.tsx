import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ProfileScreen } from "@/components/screens/profile-screen";
import { isMailerConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * Profile tab — user info + stats + email-reminder status + theme/settings.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const [groupCount, billCount] = user
    ? await Promise.all([
        prisma.membership.count({ where: { userId: user.id } }),
        prisma.billShare.count({ where: { userId: user.id } }),
      ])
    : [0, 0];

  return (
    <ProfileScreen
      name={user?.name ?? ""}
      phone={user?.phone ?? ""}
      groupCount={groupCount}
      billCount={billCount}
      notificationsConfigured={isMailerConfigured}
      notificationEmail={process.env.NOTIFICATION_EMAIL ?? null}
    />
  );
}
