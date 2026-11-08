import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { PortfolioRail } from "@/components/PortfolioRail";
import { TopBar } from "@/components/TopBar";
import { loadNavData } from "@/lib/nav-data";
import { loadPortfolio } from "@/lib/portfolio-data";
import { contourDataUri } from "@/lib/ui/contours";
import { LANDING_PATH, LOGIN_PATH, demoUser } from "@/lib/auth/gate";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// One font everywhere: the workspace carried Bricolage Grotesque as a second
// "display" face through the Forest redesign; dropped 2026-11-08, owner's
// call, so every screen — including /welcome and /login — reads as Inter.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CreditScout",
  description: "Covenant exception investigation — decision support for credit analysts",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The landing and login pages render full-bleed, without the app nav. The
  // pathname arrives from middleware as `x-pathname`.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const bare = pathname === LANDING_PATH || pathname === LOGIN_PATH;

  if (bare) {
    return (
      <html lang="en" className={`${inter.variable} ${mono.variable}`}>
        <body className="min-h-screen">{children}</body>
      </html>
    );
  }

  // The rail degrades to empty on a read failure, as the tab counts do, rather
  // than taking every page down with it.
  const [{ counts, search }, portfolio] = await Promise.all([
    loadNavData(),
    loadPortfolio().catch(() => null),
  ]);
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="theme-forest flex min-h-screen flex-col">
        <TopBar counts={counts} search={search} user={demoUser()} contourUri={contourDataUri()} />
        <div className="flex flex-1">
          <PortfolioRail rows={portfolio?.rows ?? []} periodLabel={portfolio?.targetLabel ?? ""} />
          <main className="min-w-0 flex-1 px-6 py-8 md:px-8">
            <div className="mx-auto max-w-content">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
