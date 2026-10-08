import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NavRail } from "@/components/NavRail";
import { loadNavData } from "@/lib/nav-data";
import { LANDING_PATH, LOGIN_PATH, demoUser } from "@/lib/auth/gate";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
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

  const { counts, search } = await loadNavData();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen md:flex">
        <NavRail counts={counts} search={search} user={demoUser()} />
        <main className="min-w-0 flex-1 px-6 py-8 md:px-8">
          <div className="mx-auto max-w-content">{children}</div>
        </main>
      </body>
    </html>
  );
}
