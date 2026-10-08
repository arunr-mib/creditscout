"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { signOut } from "@/app/login/actions";
import type { SearchItem } from "./searchModel";

/**
 * The analyst workspace's primary navigation (audit §2): a slim left rail with
 * the destinations grouped by the object they open, plus a command palette.
 * Counts come from the server layout; a destination with nothing waiting shows
 * no badge rather than a zero.
 */
export interface NavCounts {
  queue: number;
  documents: number;
  terms: number;
  lessons: number;
}

const DESTS: { href: string; label: string; countKey?: keyof NavCounts }[] = [
  { href: "/", label: "Work queue", countKey: "queue" },
  { href: "/documents", label: "Documents", countKey: "documents" },
  { href: "/terms", label: "Terms", countKey: "terms" },
  { href: "/lessons", label: "Lessons", countKey: "lessons" },
  { href: "/governance", label: "Governance" },
];

export function NavRail({ counts, search }: { counts: NavCounts; search: SearchItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/casefiles") : pathname.startsWith(href));

  return (
    <nav aria-label="Primary" className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-4 md:h-screen md:w-56 md:border-b-0 md:border-r">
      <div className="mb-4 px-2">
        <Link href="/" className="text-card text-text">CreditScout</Link>
        <p className="mt-1 text-badge text-text-muted">recommends — a human decides</p>
      </div>

      <div className="mb-3 px-1">
        <CommandPalette items={search} />
      </div>

      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {DESTS.map((d) => {
          const active = isActive(d.href);
          const count = d.countKey ? counts[d.countKey] : 0;
          return (
            <li key={d.href} className="shrink-0">
              <Link
                href={d.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-body transition-colors duration-fast ${
                  active ? "bg-surface-raised text-text" : "text-text-secondary hover:bg-surface hover:text-text"
                }`}
              >
                <span>{d.label}</span>
                {count > 0 && (
                  <span className="rounded-sm bg-surface px-2 font-mono text-badge text-text-muted">{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <form action={signOut} className="px-1 md:mt-auto md:pt-4">
        <button
          type="submit"
          className="w-full rounded-md px-3 py-2 text-left text-body text-text-muted transition-colors duration-fast hover:bg-surface hover:text-text"
        >
          Sign out
        </button>
      </form>
    </nav>
  );
}
