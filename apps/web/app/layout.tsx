import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeBoot } from "@/components/ds/ThemeBoot";
import { THEME_BOOT_SCRIPT } from "@/components/ds/preferences";
import "./globals.css";

// Barlow / Barlow Condensed: SIL Open Font License 1.1, same families as the phone app.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "GroundTruth", template: "%s · GroundTruth" },
  description: "A bounty board for reality — verified, research-grade field observations.",
  applicationName: "GroundTruth",
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <ThemeBoot />
        {children}
      </body>
    </html>
  );
}
