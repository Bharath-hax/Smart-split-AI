import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ProfileScreen } from "@/components/screens/profile-screen";
import { googleOAuthConfigured } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

/**
 * Profile tab — user info + stats + Gmail connection + theme/settings.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const user = await requireUser();
  const { gmail: gmailStatus } = await searchParams;
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
      gmailConnected={Boolean(user?.gmailSendGranted)}
      gmailEmail={user?.googleEmail ?? null}
      googleConfigured={googleOAuthConfigured()}
      gmailStatus={gmailStatus ?? null}
    />
  );
}
