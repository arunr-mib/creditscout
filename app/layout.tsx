import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CreditScout",
  description: "Covenant exception investigation — decision support for credit analysts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-content flex-wrap items-baseline gap-3 px-6 py-4">
            <a href="/" className="text-card text-text">
              CreditScout
            </a>
            <span className="text-label text-text-muted">
              recommends — a human analyst always decides
            </span>
            <nav className="ml-auto flex items-baseline gap-4 text-label">
              <a href="/" className="text-text-secondary hover:text-text">
                Portfolio
              </a>
              <a href="/governance" className="text-text-secondary hover:text-text">
                Governance
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-content px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
