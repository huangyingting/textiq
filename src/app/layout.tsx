import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import "./slide-fonts.css";
import { HeaderGate } from "@/components/header-gate";
import { MobileViewportSync } from "@/components/mobile-viewport-sync";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { OverlayProvider } from "@/components/ui";
import {
  APP_THEME_COOKIE_KEY,
  normalizeAppThemeMode,
} from "@/lib/app-shell/theme";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { getLocale } from "@/lib/i18n/server";
import { app } from "@/lib/env";

// Design-system font setup: self-host Inter and wire it to --font-sans.
// Serif (Georgia) and mono (Menlo) come from system stacks, so only Inter downloads.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(app.url()),
  title: "TextIQ — Text to Visuals",
  description:
    "Turn plain text into AI-generated, editable visuals: flowcharts, mind maps, infographics, charts, and concept diagrams.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, cookieStore] = await Promise.all([getLocale(), cookies()]);
  const initialThemeMode = normalizeAppThemeMode(
    cookieStore.get(APP_THEME_COOKIE_KEY)?.value,
  );

  return (
    <html
      lang={locale}
      data-theme={initialThemeMode}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} h-full scroll-smooth antialiased motion-reduce:scroll-auto`}
    >
      <body className="min-h-full flex flex-col">
        <MobileViewportSync />
        <ThemeProvider initialMode={initialThemeMode}>
          <LocaleProvider initialLocale={locale}>
            <OverlayProvider>
              <HeaderGate>
                <SiteHeader />
              </HeaderGate>
              {children}
            </OverlayProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
