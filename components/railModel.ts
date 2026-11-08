/**
 * The portfolio rail and the section tabs, as pure functions. No React, no
 * Next, no I/O: the client components only draw what this decides, and
 * `node --test` can exercise every rule here.
 */

import type { PortfolioRow, PortfolioStatus } from "./portfolioModel.ts";

// ------------------------------------------------------------------- items

export type RailDot = "breach" | "pass" | "decided" | "terms" | "untested";

export interface RailItem {
  facilityId: string;
  borrower: string;
  /** "1.12x", or "—" when there is no computed figure. Never "0.00x". */
  dscrText: string;
  /** Our computed DSCR is under the loan's own minimum. */
  belowMinimum: boolean;
  dot: RailDot;
  subline: string;
  href: string;
}

/** Statuses that are an open breach: the analyst still has something to do. */
const OPEN_BREACH: ReadonlySet<PortfolioStatus> = new Set<PortfolioStatus>([
  "breach_investigate",
  "in_review",
  "investigating",
  "investigation_paused",
  "awaiting_docs",
]);

const fmt = (n: number): string => `${n.toFixed(2)}x`;

function dotAndSubline(row: PortfolioRow): { dot: RailDot; subline: string } {
  const min = row.required == null ? null : fmt(row.required);
  const withMin = (word: string): string => (min ? `${word} · min ${min}` : word);
  if (OPEN_BREACH.has(row.status)) return { dot: "breach", subline: withMin("Breach") };
  if (row.status === "decided") return { dot: "decided", subline: "Breach · decided" };
  if (row.status === "compliant") return { dot: "pass", subline: withMin("Pass") };
  if (!row.hasApprovedTerms) return { dot: "terms", subline: "Terms awaiting approval" };
  return { dot: "untested", subline: withMin("Not tested") };
}

/** One rail entry per loan, in the order given. `filterPath` turns the link into a `?loan=` filter on that tab. */
export function railItems(rows: PortfolioRow[], opts?: { filterPath?: "/documents" | "/terms" }): RailItem[] {
  return rows.map((row) => {
    const { dot, subline } = dotAndSubline(row);
    const href = opts?.filterPath
      ? `${opts.filterPath}?loan=${encodeURIComponent(row.facilityId)}`
      : row.casefileId
        ? `/casefiles/${row.casefileId}`
        : `/facilities/${row.facilityId}/covenant-setup`;
    return {
      facilityId: row.facilityId,
      borrower: row.borrower,
      dscrText: row.ours == null ? "—" : fmt(row.ours),
      belowMinimum: row.ours != null && row.required != null && row.ours < row.required,
      dot,
      subline,
      href,
    };
  });
}

// -------------------------------------------------------------------- tabs

export const TABS: readonly { href: string; label: string }[] = [
  { href: "/", label: "Exceptions" },
  { href: "/documents", label: "Documents" },
  { href: "/terms", label: "Covenant terms" },
  { href: "/lessons", label: "Lessons" },
  { href: "/governance", label: "Governance" },
];

const under = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);

/** The tab a route belongs to. Casefiles and borrower onboarding live under Exceptions; covenant setup under Covenant terms. */
export function activeTab(pathname: string): string {
  if (under(pathname, "/documents")) return "/documents";
  if (under(pathname, "/terms") || pathname.startsWith("/facilities/")) return "/terms";
  if (under(pathname, "/lessons")) return "/lessons";
  if (under(pathname, "/governance")) return "/governance";
  return "/";
}

// --------------------------------------------------------------- selection

/** The loan the current route is about, so the rail can mark it. Null when the route is not about one loan. */
export function selectedFacility(pathname: string, loanParam: string | null, rows: PortfolioRow[]): string | null {
  const casefile = /^\/casefiles\/([^/]+)/.exec(pathname);
  if (casefile) return rows.find((r) => r.casefileId === casefile[1])?.facilityId ?? null;
  const setup = /^\/facilities\/([^/]+)/.exec(pathname);
  if (setup) {
    try {
      return decodeURIComponent(setup[1]);
    } catch {
      return null; // a malformed escape in the URL must not take the layout down
    }
  }
  if (under(pathname, "/documents") || under(pathname, "/terms")) return loanParam || null;
  return null;
}

// ---------------------------------------------------------------- collapse

/** Lessons and Governance are reading screens: the rail starts collapsed there. */
export function railDefaultCollapsed(pathname: string): boolean {
  const tab = activeTab(pathname);
  return tab === "/lessons" || tab === "/governance";
}

export const RAIL_PREF_KEY = "cs.rail.collapsed";

/** The remembered choice: true collapsed, false open, null when nothing was stored or storage is unavailable. */
export function readRailPref(storage: { getItem(k: string): string | null } | null | undefined): boolean | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(RAIL_PREF_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/** A bare `[` pressed outside a text field. */
export function isRailToggleKey(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  targetTag?: string;
  targetEditable?: boolean;
}): boolean {
  if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || e.targetEditable) return false;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(e.targetTag ?? "");
}
