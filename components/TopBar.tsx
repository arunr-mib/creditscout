"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { TABS, activeTab } from "./railModel";
import type { SearchItem } from "./searchModel";
import { signOut } from "@/app/login/actions";
import type { NavCounts } from "@/lib/nav-data";

/** Which badge count, if any, a tab carries. Lessons and Exceptions only show one when it is above zero. */
const COUNT_KEY: Record<string, keyof NavCounts | undefined> = {
  "/": "queue",
  "/documents": "documents",
  "/terms": "terms",
  "/lessons": "lessons",
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

// Mint rings against the forest band; the global ring colours assume a white page.
const HEADER_RING = "focus-visible:ring-mint focus-visible:ring-offset-brand";

/**
 * The forest header band: wordmark, section tabs, global search and the signed-in
 * analyst's menu. The contour lines are decoration only, drawn behind the content.
 */
export function TopBar({
  counts,
  search,
  user,
  contourUri,
}: {
  counts: NavCounts;
  search: SearchItem[];
  user: { name: string; role: string };
  contourUri: string;
}) {
  const pathname = usePathname();
  const current = activeTab(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="relative h-header shrink-0 bg-brand">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${contourUri}")` }}
      />
      <div className="relative flex h-full items-center gap-4 px-4 md:gap-6 md:px-6">
        <Link
          href="/"
          aria-label="CreditScout, Bank of Stoic — go to Exceptions"
          className={`flex shrink-0 items-baseline gap-2 rounded-md ${HEADER_RING}`}
        >
          <span className="font-brand text-wordmark text-brand-on">CreditScout</span>
          <span className="hidden text-label text-brand-on-2 sm:inline">Bank of Stoic</span>
        </Link>

        <nav aria-label="Sections" className="min-w-0 flex-1 overflow-x-auto">
          <ul className="flex w-max items-center gap-1">
            {TABS.map((tab) => {
              const active = tab.href === current;
              const key = COUNT_KEY[tab.href];
              const count = key ? counts[key] : 0;
              return (
                <li key={tab.href} className="shrink-0">
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-full px-3 py-1 text-body transition-colors duration-fast ${HEADER_RING} ${
                      active ? "bg-mint font-semibold text-text" : "text-brand-on-2 hover:text-brand-on"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span
                        className={`rounded-full px-1 text-badge tabular-nums ${
                          active ? "bg-brand/15 text-text" : "bg-brand-on/15 text-brand-on-2"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <CommandPalette items={search} />

          <div ref={menuRef} className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="account-panel"
              aria-label={`Account menu, ${user.name}`}
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-mint text-label font-semibold text-text transition-colors duration-fast hover:bg-mint-hover ${HEADER_RING}`}
            >
              {initials(user.name)}
            </button>
            {menuOpen && (
              <div
                id="account-panel"
                className="absolute right-0 top-full z-30 mt-2 w-menu rounded-xl border border-border bg-surface p-2 shadow-raised"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-body font-semibold text-text" title={user.name}>
                    {user.name}
                  </p>
                  <p className="text-label text-text-muted">{user.role}</p>
                </div>
                <form action={signOut} className="border-t border-border pt-1">
                  <button
                    type="submit"
                    className="w-full rounded-md px-3 py-2 text-left text-body text-text-secondary transition-colors duration-fast hover:bg-surface-raised hover:text-text"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
