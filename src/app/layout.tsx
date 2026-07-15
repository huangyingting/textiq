import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./slide-fonts.css";
import { HeaderGate } from "@/components/header-gate";
import { MobileViewportSync } from "@/components/mobile-viewport-sync";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { OverlayProvider } from "@/components/ui";
import {
  APP_THEME_MODES,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_MODE,
} from "@/lib/app-shell/theme";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { getLocale } from "@/lib/i18n/server";

// Design-system font setup: self-host Inter and wire it to --font-sans.
// Serif (Georgia) and mono (Menlo) come from system stacks, so only Inter downloads.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const themeInitScript = `(() => {
  const storageKey = ${JSON.stringify(APP_THEME_STORAGE_KEY)};
  const modes = ${JSON.stringify(APP_THEME_MODES)};
  let mode = ${JSON.stringify(DEFAULT_APP_THEME_MODE)};
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (typeof stored === "string" && modes.includes(stored)) mode = stored;
  } catch {}
  const root = document.documentElement;
  root.dataset.theme = mode;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  root.style.colorScheme = mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
})();`;

export const metadata: Metadata = {
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
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_APP_THEME_MODE}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} h-full scroll-smooth antialiased motion-reduce:scroll-auto`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <MobileViewportSync />
        <ThemeProvider>
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
