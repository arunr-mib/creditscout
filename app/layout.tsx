import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NavRail } from "@/components/NavRail";
import { loadNavData } from "@/lib/nav-data";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CreditScout",
  description: "Covenant exception investigation — decision support for credit analysts",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { counts, search } = await loadNavData();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen md:flex">
        <NavRail counts={counts} search={search} />
        <main className="min-w-0 flex-1 px-6 py-8 md:px-10">
          <div className="mx-auto max-w-content">{children}</div>
        </main>
      </body>
    </html>
  );
}
