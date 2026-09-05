"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/dark mode provider (next-themes, class strategy).
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
