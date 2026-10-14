"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Fragment } from "react";

import { NOT_BOARDED_TOOLTIP, TERMS_PENDING, TERMS_STATUS_LABEL, countPendingUpdates, longDate, summariseTerms } from "@/lib/terms-labels";

export interface TermsVersionView {
  version: number;
  status: string;
  effectiveFrom: string;
  /** The stored covenant, so the screen can show what the version actually SAYS. */
  terms?: unknown;
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
  const pending = countPendingUpdates(cards);

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

      {/* ONE TABLE, one row per loan. Repeated cards — each with a header, a
          pending banner and its own version table — gave a six-loan book six
          screens of chrome to say what fits on six lines. The detail is one
          click away, per row, rather than always expanded for everyone. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-raised">
            <tr className="text-label uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2 font-medium">Borrower</th>
              <th className="px-4 py-2 font-medium">Approved version</th>
              <th className="px-4 py-2 font-medium">Effective from</th>
              <th className="px-4 py-2 font-medium">Pending update</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <TermsRow key={c.facilityId} card={c} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One loan, one row. The version history and the terms themselves open
 * underneath, so the detail is reachable without being imposed on everyone.
 */
function TermsRow({ card }: { card: TermsCard }) {
  const setupHref = `/facilities/${card.facilityId}/covenant-setup`;
  const approved = card.versions.find((v) => v.version === card.approvedVersion) ?? null;
  const proposed = card.versions.find((v) => v.status === "proposed") ?? null;

  return (
    <>
      <tr className="border-t border-border align-middle">
        <td className="px-4 py-3 text-body text-text">{card.borrower}</td>
        <td className="px-4 py-3 font-mono text-num text-text-secondary">
          {card.approvedVersion != null ? `v${card.approvedVersion}` : <span className="font-sans text-text-muted">None approved</span>}
        </td>
        <td className="px-4 py-3 text-body text-text-secondary">
          {approved ? longDate(approved.effectiveFrom) : "—"}
        </td>
        <td className="px-4 py-3">
          {proposed ? (
            <span className="text-label text-code">v{proposed.version} awaiting approval</span>
          ) : card.unboarded.length > 0 ? (
            <span className="text-label text-code" title={NOT_BOARDED_TOOLTIP}>
              {card.unboarded.join(", ")} not incorporated
            </span>
          ) : (
            <span className="text-label text-text-muted">None</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <Link
            href={setupHref}
            className="rounded-md border border-border-strong bg-surface px-3 py-1 text-body font-medium leading-5 text-text shadow-card hover:bg-surface-raised"
          >
            {proposed || card.unboarded.length > 0 ? "Review update" : "View terms"}
          </Link>
        </td>
      </tr>
      <tr className="border-t border-border">
        <td colSpan={5} className="px-4 pb-3">
          <details>
            <summary className="cursor-pointer list-none text-label text-model underline-offset-2 hover:underline marker:content-['']">
              Version history and terms
            </summary>
            <div className="mt-2">
              <Card card={card} bare />
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function Card({ card, bare = false }: { card: TermsCard; bare?: boolean }) {
  const setupHref = `/facilities/${card.facilityId}/covenant-setup`;
  const hasTerms = card.versions.length > 0;

  return (
    <article className={bare ? "" : "overflow-hidden rounded-lg border border-border bg-surface shadow-card"}>
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
            className="inline-flex items-center gap-2 rounded border border-code bg-code-bg px-3 py-1 text-label text-code-bright"
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
            className="shrink-0 rounded-md border border-border-strong bg-surface px-3 py-1 text-body font-medium leading-5 text-text shadow-card hover:bg-surface-raised"
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
                <tr className="text-label uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Effective from</th>
                </tr>
              </thead>
              <tbody>
                {card.versions.map((v) => {
                  const lines = summariseTerms(v.terms);
                  return (
                    <Fragment key={v.version}>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-num text-text">v{v.version}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={v.status} />
                        </td>
                        <td className="px-3 py-2 text-body text-text-secondary">
                          {v.status === "proposed" && <span className="text-text-muted">Proposed · </span>}
                          {longDate(v.effectiveFrom)}
                        </td>
                      </tr>
                      {/* WHAT THE VERSION SAYS. The page is called "Covenant
                          terms" and showed only facts ABOUT each version — the
                          minimum, the add-backs and their caps were a screen
                          away. */}
                      {lines.length > 0 && (
                        <tr className="border-t border-border">
                          <td colSpan={3} className="px-3 pb-3">
                            <details>
                              <summary className="cursor-pointer list-none text-label text-model underline-offset-2 hover:underline marker:content-['']">
                                View the terms in v{v.version}
                              </summary>
                              <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
                                {lines.map((l, i) => (
                                  <Fragment key={`${l.label}-${i}`}>
                                    <dt className="text-label text-text-muted">{l.label}</dt>
                                    <dd className="text-body text-text">
                                      {l.value}
                                      {l.citation && (
                                        <span className="ml-2 font-mono text-label text-text-muted">{l.citation}</span>
                                      )}
                                    </dd>
                                  </Fragment>
                                ))}
                              </dl>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
    <span className={`inline-flex items-center gap-2 rounded border px-3 py-px text-label ${tone}`}>
      <span aria-hidden="true">●</span> {TERMS_STATUS_LABEL[status] ?? status}
    </span>
  );
}
