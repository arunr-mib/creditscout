"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NOT_BOARDED_TOOLTIP, TERMS_PENDING, TERMS_STATUS_LABEL, longDate } from "@/lib/terms-labels";

export interface TermsVersionView {
  version: number;
  status: string;
  effectiveFrom: string;
}

export interface TermsCard {
  facilityId: string;
  borrower: string;
  /** The version in force, or null when nothing has been approved yet. */
  approvedVersion: number | null;
  /** Amendments on file that the approved version does not carry. */
  unboarded: string[];
  versions: TermsVersionView[];
}

/**
 * One card per loan: what governs today, what is waiting, and the version
 * history behind both.
 *
 * A client component only so the loan filter works. Every figure is computed on
 * the server and passed in; nothing here derives covenant state.
 */
export function TermsList({ cards }: { cards: TermsCard[] }) {
  const [loan, setLoan] = useState("all");

  const shown = useMemo(() => (loan === "all" ? cards : cards.filter((c) => c.facilityId === loan)), [cards, loan]);
  const pending = cards.filter((c) => c.unboarded.length > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <label className="sr-only" htmlFor="loan-filter">
          Filter by loan
        </label>
        <select
          id="loan-filter"
          value={loan}
          onChange={(e) => setLoan(e.target.value)}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text"
        >
          <option value="all">All loans</option>
          {cards.map((c) => (
            <option key={c.facilityId} value={c.facilityId}>
              {c.borrower}
            </option>
          ))}
        </select>
        {pending > 0 && (
          <span className="inline-flex items-center gap-2 text-body text-text-secondary">
            <span aria-hidden="true" className="text-code-bright">
              ●
            </span>
            Updates pending · {pending}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {shown.map((c) => (
          <Card key={c.facilityId} card={c} />
        ))}
      </div>
    </div>
  );
}

function Card({ card }: { card: TermsCard }) {
  const setupHref = `/facilities/${card.facilityId}/covenant-setup`;
  const hasTerms = card.versions.length > 0;

  return (
    <article className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-card text-text">{card.borrower}</h2>
          {card.approvedVersion != null && (
            <span className="text-label text-text-muted">
              Approved terms · <span className="font-mono">v{card.approvedVersion}</span>
            </span>
          )}
        </div>
        {card.unboarded.length > 0 && (
          <span
            className="inline-flex items-center gap-2 rounded-full border border-code bg-code-bg px-3 py-1 text-label text-code-bright"
            title={NOT_BOARDED_TOOLTIP}
          >
            <span aria-hidden="true">●</span> {TERMS_PENDING}
          </span>
        )}
      </header>

      {card.unboarded.length > 0 && (
        <div
          role="note"
          className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-l-2 border-l-code bg-surface-raised px-4 py-3"
        >
          <div>
            <p className="text-body text-text">
              {card.unboarded.join(", ")} {card.unboarded.length === 1 ? "is" : "are"} not reflected in approved terms.
            </p>
            <p className="mt-1 text-label text-text-muted">Review its impact before using updated terms in a test.</p>
          </div>
          <Link
            href={setupHref}
            className="shrink-0 rounded-md border border-border-strong bg-human px-3 py-1 text-body font-medium leading-5 text-bg hover:bg-text"
          >
            Review update
          </Link>
        </div>
      )}

      {hasTerms ? (
        <div className="px-4 pb-4">
          <h3 className="mb-2 text-label text-text-muted">Terms history</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-raised">
                <tr className="text-label text-text-muted">
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Effective from</th>
                </tr>
              </thead>
              <tbody>
                {card.versions.map((v) => (
                  <tr key={v.version} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-num text-text">v{v.version}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={v.status} />
                    </td>
                    <td className="px-3 py-2 text-body text-text-secondary">
                      {v.status === "proposed" && <span className="text-text-muted">Proposed · </span>}
                      {longDate(v.effectiveFrom)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
          <p className="text-body text-text-muted">No approved terms</p>
          <Link
            href={setupHref}
            className="rounded-md border border-border-strong px-3 py-1 text-body text-text hover:bg-surface-raised"
          >
            View terms
          </Link>
        </div>
      )}
    </article>
  );
}

/** Green reads *compliant* in this product, so only an approved version earns it. */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "border-success bg-success-bg text-success"
      : status === "proposed"
        ? "border-code bg-code-bg text-code-bright"
        : "border-border-strong text-text-muted";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-px text-label ${tone}`}>
      <span aria-hidden="true">●</span> {TERMS_STATUS_LABEL[status] ?? status}
    </span>
  );
}
