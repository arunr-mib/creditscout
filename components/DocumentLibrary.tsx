"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MIXED_DATE_HEADING, NOT_BOARDED_TOOLTIP, TERMS_INCLUDED, TERMS_PENDING, dateLabel, longDate } from "@/lib/terms-labels";

export interface DocumentRowView {
  id: string;
  title: string;
  borrower: string;
  facilityId: string;
  docType: string;
  docTypeLabel: string;
  effectiveDate: string | null;
  /** "not_boarded" | "boarded" | "not_applicable", decided on the server. */
  boarding: string;
}

/**
 * The document library with its own filters: borrower, document type, and a
 * title search.
 *
 * A client component only to hold the filter state. The boarding state of every
 * row is decided on the server by `boardingState`; nothing here re-derives
 * whether an amendment is reflected in approved terms.
 */
export function DocumentLibrary({ rows }: { rows: DocumentRowView[] }) {
  const [borrower, setBorrower] = useState("all");
  const [docType, setDocType] = useState("all");
  const [query, setQuery] = useState("");

  // Built from the rows on screen, so a filter can never offer an option that
  // matches nothing.
  const borrowers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.borrower))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.docType, r.docTypeLabel);
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (borrower === "all" || r.borrower === borrower) &&
        (docType === "all" || r.docType === docType) &&
        (q === "" || r.title.toLowerCase().includes(q)),
    );
  }, [rows, borrower, docType, query]);

  const filtered = shown.length !== rows.length;
  const field = "rounded-xl border border-border-strong bg-surface px-3 py-2 text-body text-text";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* The rail already narrows the page to one loan; a borrower menu of
            one entry would only repeat it. */}
        {borrowers.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Filter by borrower</span>
            <select value={borrower} onChange={(e) => setBorrower(e.target.value)} className={field}>
              <option value="all">All borrowers</option>
              {borrowers.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <span className="sr-only">Filter by document type</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={field}>
            <option value="all">All document types</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">Search documents</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className={`${field} w-64 placeholder:text-text-muted`}
          />
        </label>

        <span className="text-label text-text-muted">
          {/* Says what is hidden, so a filtered table is never mistaken for the
              whole library. */}
          {filtered ? `${shown.length} of ${rows.length} documents` : `${rows.length} documents`}
        </span>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setBorrower("all");
              setDocType("all");
              setQuery("");
            }}
            className="text-label text-text-secondary underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-raised">
            <tr className="border-b border-border">
              <th className="whitespace-nowrap px-4 py-2 text-label uppercase tracking-wide text-text-muted">Document</th>
              <th className="whitespace-nowrap px-4 py-2 text-label uppercase tracking-wide text-text-muted">Borrower</th>
              <th className="whitespace-nowrap px-4 py-2 text-label uppercase tracking-wide text-text-muted">Document type</th>
              <th className="whitespace-nowrap px-4 py-2 text-label uppercase tracking-wide text-text-muted">{MIXED_DATE_HEADING}</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">
                Covenant terms
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-body text-text-muted">
                  No documents match those filters.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="h-12 border-b border-border last:border-b-0 hover:bg-surface-raised">
                <td className="px-4 align-middle text-body text-text">
                  {/* The title is the way in. A document row that could not be
                      opened made the library a list of things the analyst had
                      to take on trust. */}
                  <Link href={`/documents/${r.id}`} className="text-text underline decoration-border-strong underline-offset-2 hover:decoration-text">
                    {r.title}
                  </Link>
                  {/* A waiver REQUEST is not a granted waiver. The title alone
                      carried that distinction; on a row among executed
                      documents it needs to be a state, not a reading exercise.
                      This is the F3 twist: an unexecuted request on file,
                      dated after the period, unsigned by the lender. */}
                  {r.docType === "waiver" && /unexecuted|request/i.test(r.title) && (
                    <span className="ml-2 rounded bg-code-bg px-2 py-px text-badge text-code">Unexecuted</span>
                  )}
                </td>
                <td className="px-4 align-middle text-body text-text-secondary">{r.borrower}</td>
                <td className="px-4 align-middle text-label text-text-muted">{r.docTypeLabel}</td>
                {/* The heading is generic because the table mixes types; each
                    row says which KIND of date it is holding. An agreement's
                    date takes terms into force; a financial statement's is the
                    end of the period reported. */}
                <td className="whitespace-nowrap px-4 align-middle text-text-secondary">
                  {r.effectiveDate ? (
                    <>
                      <span className="text-num tabular-nums">{r.effectiveDate}</span>
                      <span className="ml-2 text-label text-text-muted">{dateLabel(r.docType)}</span>
                    </>
                  ) : (
                    <span className="text-text-muted">Not recorded</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right align-middle">
                  {r.boarding === "not_boarded" ? (
                    <span className="rounded-sm bg-code-bg px-2 py-px text-badge text-code-bright" title={NOT_BOARDED_TOOLTIP}>
                      {TERMS_PENDING}
                    </span>
                  ) : r.boarding === "boarded" ? (
                    <span className="text-label text-text-secondary">{TERMS_INCLUDED}</span>
                  ) : (
                    /* Not an amendment, so it can never board terms. `—` is this
                       project's mark for "no value exists", never 0. */
                    <span className="text-label text-text-muted" title="Only amendments can change approved covenant terms.">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Exported so the server page and the table agree on one wording. */
export { longDate };
