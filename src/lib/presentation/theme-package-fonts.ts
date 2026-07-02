import { buildFontFaceCss } from "@/lib/brand/font-face";

import type { ThemePackageV1 } from "./theme-package-schema";

export function buildThemePackageFontFaceCss(pkg: ThemePackageV1): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const font of Object.values(pkg.assets?.fonts ?? {})) {
    const key = `${font.family}\u0000${font.src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const css = buildFontFaceCss(font.family, font.src);
    if (css) rules.push(css);
  }
  return rules.join("\n");
}

export function injectThemePackageFontFaces(pkg: ThemePackageV1): void {
  if (typeof document === "undefined") return;
  const css = buildThemePackageFontFaceCss(pkg);
  if (!css) return;
  const id = `theme-package-fonts-${pkg.id}-${pkg.version ?? "unversioned"}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
