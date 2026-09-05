import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { PageTransition } from "@/components/page-transition";
import { getCurrentUser } from "@/lib/session";

/**
 * Tab shell — requires a session, renders the mobile width container
 * with page transitions and the bottom tab bar.
 */
export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageTransition>{children}</PageTransition>
      <BottomNav />
    </>
  );
}
