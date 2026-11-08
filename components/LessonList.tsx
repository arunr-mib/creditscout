"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  PATTERN_LABEL,
  RECORD_KIND_LABEL,
  RECORD_KIND_NOTE,
  SOURCE_LABEL,
  isReusablePrecedent,
  recordCounts,
  recordKind,
  groupLessons,
  outcomeLabel,
  patternLabel,
  type LessonRow,
  type LessonSource,
} from "@/lib/lessons";

/**
 * Prior cases, as records rather than as advice.
 *
 * The hard rule on this screen: it may not read as accumulated lender judgement
 * unless that is what the row holds. An eval-generated lesson is labelled as
 * one, and a record whose only text is a system summary says so instead of
 * dressing the summary up as an analyst's reasoning.
 *
 * Colour follows meaning, quietly: indigo for patterns and the selected filter,
 * slate for where a record came from, and green or rose ONLY for an outcome
 * someone actually recorded.
 */

const SOURCE_TONE: Record<LessonSource, string> = {
  approved: "border-border-strong text-text-secondary",
  override: "border-border-strong text-text-secondary",
  evaluation: "border-border-strong text-text-muted",
};

const OUTCOME_TONE: Record<string, string> = {
  resolve: "border-success/40 bg-success-bg text-success",
  escalate: "border-danger/40 bg-danger-bg text-danger",
};

type SourceFilter = "all" | LessonSource;

export function LessonList({ rows }: { rows: LessonRow[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [pattern, setPattern] = useState("all");

  const patterns = useMemo(
    () => Array.from(new Set(rows.map((r) => r.patternTag).filter((t): t is string => t != null))).sort(),
    [rows],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (source === "all" || r.source === source) &&
        (pattern === "all" || r.patternTag === pattern) &&
        (q === "" ||
          r.borrower.toLowerCase().includes(q) ||
          (r.analystReasoning ?? "").toLowerCase().includes(q) ||
          (r.storedText ?? "").toLowerCase().includes(q)),
    );
    return groupLessons(filtered);
  }, [rows, query, source, pattern]);

  const shown = groups.reduce((n, g) => n + g.records.length, 0);
  const counts = recordCounts(rows);
  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text";

  return (
    <div className="space-y-4">
      {/* ----------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search prior cases</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search borrowers, findings, or reasoning…"
            className={`${field} w-full placeholder:text-text-muted`}
          />
        </label>
        <label>
          <span className="sr-only">Filter by record source</span>
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className={field}>
            <option value="all">All sources</option>
            <option value="approved">{SOURCE_LABEL.approved}</option>
            <option value="override">{SOURCE_LABEL.override}</option>
            <option value="evaluation">{SOURCE_LABEL.evaluation}</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by pattern</span>
          <select value={pattern} onChange={(e) => setPattern(e.target.value)} className={field}>
            <option value="all">All case categories</option>
            {patterns.map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-label text-text-muted">
        {/* The count must reconcile with what is on screen AND say how much of
            it is actually precedent — 17 records reads as 17 lessons, when most
            carry no analyst reasoning at all. */}
        {shown === rows.length ? `${groups.length} case groups · ${rows.length} records` : `${shown} of ${rows.length} records`}
        {counts.analystLessons > 0 && (
          <span className="text-text-muted">
            {" · "}{counts.analystLessons} with analyst reasoning
          </span>
        )}
      </p>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface shadow-card p-6 text-body text-text-muted">
          No prior cases match those filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-xl border border-border bg-surface shadow-card">
              <Record row={g.records[0]} borrower={g.borrower} period={g.period} />
              {g.records.length > 1 && (
                <details className="border-t border-border-strong">
                  <summary className="cursor-pointer list-none px-4 py-3 text-label text-text marker:content-['']">
                    Related records · {g.records.length - 1} more for this borrower and quarter
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {g.records.slice(1).map((r) => (
                      <li key={r.id}>
                        <Record row={r} borrower={g.borrower} period={g.period} nested />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fig({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-label text-text-muted">{label}</dt>
      <dd className="text-num tabular-nums text-text">{value == null ? "—" : `${value.toFixed(2)}x`}</dd>
    </div>
  );
}

function Record({ row, borrower, period, nested }: { row: LessonRow; borrower: string; period: string; nested?: boolean }) {
  const outcome = outcomeLabel(row.outcome);
  const pattern = patternLabel(row.patternTag);

  return (
    <div className="p-4">
      {!nested && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-card text-text">{borrower}</h2>
          <span className="text-label tabular-nums text-text-muted">{period}</span>
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-2 ${nested ? "" : "mt-2"}`}>
        {pattern && (
          <span className="rounded-md border border-text bg-surface-raised px-3 py-px text-label text-text">{pattern}</span>
        )}
        <span className={`rounded-md border px-3 py-px text-label ${SOURCE_TONE[row.source]}`}>
          {SOURCE_LABEL[row.source]}
        </span>
        {/* What this record IS. An approval with no written reasoning records
            what was decided and nothing about why; calling it a lesson
            overstates it, and an analyst scanning for precedent learns nothing
            from it. */}
        <span
          title={RECORD_KIND_NOTE[recordKind(row.source, row.analystReasoning)]}
          className={`rounded-md border px-3 py-px text-label ${
            isReusablePrecedent(recordKind(row.source, row.analystReasoning))
              ? "border-text bg-surface-raised text-text"
              : "border-border-strong text-text-muted"
          }`}
        >
          {RECORD_KIND_LABEL[recordKind(row.source, row.analystReasoning)]}
        </span>
        {/* Colour only for an outcome someone actually recorded. */}
        {outcome && row.source !== "evaluation" && (
          <span className={`rounded-md border px-3 py-px text-label ${OUTCOME_TONE[row.outcome ?? ""] ?? "border-border-strong text-text-secondary"}`}>
            Recorded: {outcome}
          </span>
        )}
        {outcome && row.source === "evaluation" && (
          <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">
            Expected: {outcome}
          </span>
        )}
      </div>

      {/* Aligned figures rather than ratios buried in a sentence. "Initial"
          is said out loud: it is the test on the approved terms, NOT the
          outcome, and the two differ on exactly the cases worth reading. */}
      {(row.initialDscr != null || row.minimumDscr != null || row.reportedDscr != null) && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <Fig label="Initial DSCR" value={row.initialDscr} />
          <Fig label="Minimum DSCR" value={row.minimumDscr} />
          <Fig label="Borrower reported" value={row.reportedDscr} />
        </dl>
      )}

      {/* The analyst's own words, or an honest absence. */}
      <p className="mt-3 max-w-prose text-body text-text-secondary">
        {row.analystReasoning ?? (
          <span className="text-text-muted">
            {RECORD_KIND_NOTE[recordKind(row.source, row.analystReasoning)]}
          </span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Link href={`/casefiles/${row.casefileId}`} className="text-label text-text underline decoration-border-strong hover:decoration-text underline-offset-2">
          Open casefile <span aria-hidden="true">›</span>
        </Link>
        {(row.storedText || row.patternTag) && (
          <details className="min-w-0">
            <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
              Record details
            </summary>
            <div className="mt-2 space-y-1 rounded-md border border-border bg-surface-raised p-3">
              {row.patternTag && (
                <p className="text-badge text-text-muted">pattern_tag · {row.patternTag}</p>
              )}
              {row.createdAt && <p className="text-badge tabular-nums text-text-muted">recorded · {row.createdAt.slice(0, 10)}</p>}
              {row.storedText && <p className="mt-1 text-quote text-text-secondary">{row.storedText}</p>}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
