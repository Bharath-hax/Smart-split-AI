import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

/**
 * Root — send logged-in users to Home, everyone else to Login.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/home" : "/login");
}
