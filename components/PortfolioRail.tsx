"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { PortfolioRow } from "./portfolioModel";
import {
  RAIL_PREF_KEY,
  isRailToggleKey,
  railDefaultCollapsed,
  railItems,
  readRailPref,
  selectedFacility,
  type RailDot,
} from "./railModel";

const DOT: Record<RailDot, string> = {
  breach: "bg-danger",
  pass: "bg-success",
  decided: "bg-text-muted",
  terms: "bg-code",
  untested: "ring-1 ring-text-muted",
};
// On the selected (forest) item the same states need a light-on-dark treatment.
const DOT_SELECTED: Record<RailDot, string> = {
  breach: "bg-brand-danger",
  pass: "bg-success ring-1 ring-brand-on",
  decided: "bg-brand-on-3",
  terms: "bg-brand-on-2",
  untested: "ring-1 ring-brand-on-3",
};

const FILTER_TAB = /^\/(documents|terms)(\/|$)/;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writePref(collapsed: boolean): void {
  try {
    storage()?.setItem(RAIL_PREF_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage can be blocked or full; the rail simply will not remember.
  }
}

/**
 * The portfolio rail: every loan with its status and DSCR, one click to its
 * casefile or setup. Collapsible to a strip of status dots; `[` toggles it and
 * the choice is remembered. Below `md` the rail is always the strip.
 */
export function PortfolioRail({ rows, periodLabel }: { rows: PortfolioRow[]; periodLabel: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Server and first client render agree on the pathname default; a stored
  // choice, which only the browser can read, takes over right after mount and
  // again when the route changes (so Lessons opens collapsed unless the analyst
  // has said otherwise).
  const [collapsed, setCollapsed] = useState(() => railDefaultCollapsed(pathname));

  useEffect(() => {
    setCollapsed(readRailPref(storage()) ?? railDefaultCollapsed(pathname));
  }, [pathname]);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
    writePref(!collapsed);
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        isRailToggleKey({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          targetTag: target?.tagName,
          targetEditable: target?.isContentEditable,
        })
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const filterPath = (FILTER_TAB.exec(pathname)?.[0].replace(/\/$/, "") ?? null) as "/documents" | "/terms" | null;
  const items = railItems(rows, filterPath ? { filterPath } : undefined);
  const selected = selectedFacility(pathname, searchParams.get("loan"), rows);
  const loanCount = `${rows.length} ${rows.length === 1 ? "loan" : "loans"}`;

  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-controls="portfolio-rail"
      aria-label={collapsed ? "Expand portfolio rail" : "Collapse portfolio rail"}
      title={`${collapsed ? "Expand" : "Collapse"} (press [ )`}
      className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface hover:text-text md:flex"
    >
      <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
    </button>
  );

  return (
    <aside
      id="portfolio-rail"
      aria-label="Portfolio"
      className={`shrink-0 border-r border-border bg-surface-raised ${collapsed ? "w-rail-collapsed" : "w-rail-collapsed md:w-rail"}`}
    >
      <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto">
        {/* Expanded: hidden below md, where the strip below stands in for it. */}
        <div className={collapsed ? "hidden" : "hidden flex-col md:flex"}>
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
            <div className="min-w-0">
              <p className="truncate text-label uppercase text-text-muted">Portfolio · {periodLabel}</p>
              <p className="text-label uppercase text-text-muted">{loanCount}</p>
            </div>
            {toggleButton}
          </div>

          <ul className="flex flex-col gap-1 px-2 pb-2">
            {filterPath && (
              <li>
                <Link
                  href={filterPath}
                  aria-current={selected === null ? "true" : undefined}
                  className={`block rounded-xl px-3 py-2 text-body transition-colors duration-fast ${
                    selected === null ? "bg-brand font-semibold text-brand-on" : "text-text hover:bg-surface"
                  }`}
                >
                  All loans
                </Link>
              </li>
            )}
            {items.map((item) => {
              const isSelected = item.facilityId === selected;
              return (
                <li key={item.facilityId}>
                  <Link
                    href={item.href}
                    aria-current={isSelected ? "true" : undefined}
                    className={`block rounded-xl px-3 py-2 transition-colors duration-fast ${
                      isSelected ? "bg-brand text-brand-on" : "text-text hover:bg-surface"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${(isSelected ? DOT_SELECTED : DOT)[item.dot]}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-body font-semibold" title={item.borrower}>
                        {item.borrower}
                      </span>
                      <span
                        className={`shrink-0 text-num tabular-nums ${
                          item.belowMinimum ? (isSelected ? "text-brand-danger" : "text-danger") : ""
                        }`}
                      >
                        {item.dscrText}
                      </span>
                    </span>
                    <span className={`block truncate pl-4 text-label ${isSelected ? "text-brand-on-3" : "text-text-muted"}`}>
                      {item.subline}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 border-t border-border px-2 py-2">
            <Link
              href="/borrowers/new"
              className="block rounded-xl px-3 py-2 text-body font-semibold text-text transition-colors duration-fast hover:bg-surface"
            >
              + New borrower
            </Link>
          </div>
        </div>

        {/* Collapsed strip: dots only. Shown whenever collapsed, and always below md. */}
        <div className={collapsed ? "flex flex-col items-center gap-1 py-2" : "flex flex-col items-center gap-1 py-2 md:hidden"}>
          {toggleButton}
          {items.map((item) => {
            const isSelected = item.facilityId === selected;
            return (
              <Link
                key={item.facilityId}
                href={item.href}
                title={`${item.borrower} · ${item.dscrText}`}
                aria-label={`${item.borrower}, ${item.dscrText}`}
                aria-current={isSelected ? "true" : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors duration-fast ${
                  isSelected ? "bg-brand" : "hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${(isSelected ? DOT_SELECTED : DOT)[item.dot]}`}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
