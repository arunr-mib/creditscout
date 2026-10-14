"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
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
  { href: "/", label: "Credit Analysis Queue", countKey: "queue" },
  { href: "/documents", label: "Documents", countKey: "documents" },
  { href: "/terms", label: "Covenant terms", countKey: "terms" },
  { href: "/lessons", label: "Lessons", countKey: "lessons" },
  { href: "/governance", label: "Governance" },
];

export function NavRail({ counts, search, user }: { counts: NavCounts; search: SearchItem[]; user: { name: string; role: string } }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/casefiles") : pathname.startsWith(href));

  return (
    // `md:h-screen` alone sized the rail to one viewport but let it scroll away
    // with the page, so `mt-auto` parked Sign out one screen down — mid-page the
    // moment anything scrolled. Sticky pins the rail, so the bottom of the rail
    // is the bottom of the viewport. `overflow-y-auto` keeps it usable if the
    // destinations ever outgrow the screen.
    <nav
      aria-label="Primary"
      className="flex shrink-0 flex-col gap-1 border-b border-night-border bg-sunken px-3 py-4 md:sticky md:top-0 md:h-screen md:w-[224px] md:overflow-y-auto md:border-b-0 md:border-r"
    >
      <div className="mb-4 px-2">
        <Link href="/" aria-label="CreditScout — go to the queue" className="block">
          <Logo className="h-8 w-auto" />
        </Link>
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
                className={`flex items-center justify-between gap-2 rounded-md py-2 pr-3 text-body transition-colors duration-fast ${
                  // A subtle surface step plus a narrow teal marker, rather than
                  // a filled block: selection should be quiet and the accent
                  // should mean the same thing here as everywhere else.
                  active
                    ? "border-l-2 border-model-night bg-night-raised pl-[10px] text-night-text"
                    : "border-l-2 border-transparent pl-[10px] text-night-secondary hover:bg-night-hover hover:text-night-text"
                }`}
              >
                <span>{d.label}</span>
                {count > 0 && (
                  <span className="rounded-sm bg-night-raised px-2 text-badge tabular-nums text-night-muted">{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The signed-in analyst, then the way out. `mt-auto` moves to this pair
          so both sit at the foot of the rail. No "Signed in" label: a name at
          the foot of the rail already says that, and the role is what actually
          tells you something. */}
      <div className="mt-6 border-t border-night-border px-3 pt-4 md:mt-auto">
        <p className="truncate text-body text-night-text" title={user.name}>
          {user.name}
        </p>
        <p className="text-badge text-night-muted">{user.role}</p>
      </div>

      <form action={signOut} className="px-1 pt-1">
        <button
          type="submit"
          className="w-full rounded-md px-3 py-2 text-left text-body text-night-muted transition-colors duration-fast hover:bg-night-hover hover:text-night-text"
        >
          Sign out
        </button>
      </form>
    </nav>
  );
}
