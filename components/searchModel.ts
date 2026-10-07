/**
 * The global search index and its matcher, as pure logic (audit 3.9). The server
 * builds the list of searchable things — borrowers, facilities, periods, cases,
 * documents, terms versions, lessons — and the command palette filters it on the
 * client. Keeping the match here means it is tested, not eyeballed.
 */

export type SearchKind = "borrower" | "case" | "document" | "terms" | "lesson" | "page";

export interface SearchItem {
  kind: SearchKind;
  /** What the analyst reads, e.g. "Harbor Logistics". */
  label: string;
  /** Context, e.g. "Q2 2026 · escalate". */
  sublabel?: string;
  href: string;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  borrower: "Borrower",
  case: "Casefile",
  document: "Document",
  terms: "Terms",
  lesson: "Lesson",
  page: "Page",
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Rank items for a query: every whitespace-separated term must appear somewhere
 * in the item's label or sublabel (AND), and a label match outranks a sublabel
 * match. An empty query returns the list unchanged (the palette shows recents).
 */
export function filterSearch(items: readonly SearchItem[], query: string, limit = 8): SearchItem[] {
  const terms = norm(query).split(" ").filter(Boolean);
  if (terms.length === 0) return items.slice(0, limit);

  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    const label = norm(item.label);
    const sub = norm(item.sublabel ?? "");
    let ok = true;
    let score = 0;
    for (const t of terms) {
      const inLabel = label.includes(t);
      const inSub = sub.includes(t);
      if (!inLabel && !inSub) {
        ok = false;
        break;
      }
      score += inLabel ? (label.startsWith(t) ? 3 : 2) : 1;
    }
    if (ok) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
