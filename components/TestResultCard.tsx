import { CalcValue } from "./CalcValue";
import { VarianceBadge } from "./VarianceBadge";
import { verdictOf, type Verdict } from "./portfolioModel";

export interface TestResultView {
  borrower: string;
  period: string;
  computed_dscr: number | null;
  reported_dscr: number | null;
  threshold: number;
  passed: boolean | null;
  variance_flagged: boolean | null;
  calc_id: string | null;
  calc_error: string | null;
}

/**
 * design.md §12.1 — one quarterly test, the spine of the portfolio screen.
 *
 * OUR DSCR is always first and always amber with its calc_id: ours decides.
 * THEIRS is second, in plain secondary text and NEVER amber — a borrower's
 * figure is evidence to reconcile against, not our calculation. When the two
 * disagree the card shows both; hiding the disagreement hides the product's
 * value. The verdict is classified from the row (`verdictOf`), never by hand,
 * and "not computed" is an em dash, never 0.00.
 */
export function TestResultCard({ test }: { test: TestResultView }) {
  const verdict = verdictOf(test);
  const breach = verdict === "breach";

  return (
    <article
      className={`rounded-md border border-border bg-surface p-4 ${breach ? "border-l-4 border-l-danger" : ""}`}
    >
      <h3 className="text-card text-text">
        {test.borrower} <span className="text-text-muted">· {test.period}</span>
      </h3>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {test.computed_dscr != null && test.calc_id ? (
          <CalcValue label="Computed DSCR" value={test.computed_dscr} calcId={test.calc_id} />
        ) : (
          <CalcValue label="Computed DSCR" error={test.calc_error ?? "not computed"} />
        )}

        <span className="inline-flex items-baseline gap-2">
          <span className="text-label uppercase tracking-wide text-text-muted">Reported DSCR</span>
          {test.reported_dscr != null ? (
            <span className="font-mono text-num text-text-secondary">{test.reported_dscr.toFixed(2)}</span>
          ) : (
            <span className="font-mono text-num text-text-muted" title="No borrower figure on file">
              —
            </span>
          )}
        </span>

        <VarianceBadge computed={test.computed_dscr} reported={test.reported_dscr} flagged={test.variance_flagged} />
      </div>

      <p className="mt-3 text-body">
        <VerdictLine verdict={verdict} test={test} />
      </p>
    </article>
  );
}

function VerdictLine({ verdict, test }: { verdict: Verdict; test: TestResultView }) {
  const threshold = test.threshold.toFixed(2);
  switch (verdict) {
    case "compliant":
      return (
        <span className="text-success">
          <span aria-hidden="true">✓ </span>
          Compliant — code computed {test.computed_dscr?.toFixed(2)}, clearing the {threshold} threshold.
        </span>
      );
    case "variance":
      return (
        <span className="text-text">
          Compliant — code computed {test.computed_dscr?.toFixed(2)}, clearing the {threshold} threshold; a variance
          against the borrower&apos;s figure was logged.
        </span>
      );
    case "breach": {
      const gap = test.computed_dscr != null ? (test.threshold - test.computed_dscr).toFixed(2) : null;
      return (
        <span className="text-danger">
          <span aria-hidden="true">↑ </span>
          Breach — code computed {test.computed_dscr?.toFixed(2)}, below the {threshold} threshold
          {gap ? ` by ${gap}` : ""}.
        </span>
      );
    }
    case "not_computed":
      return (
        <span className="text-text-muted">
          Not computed — {test.calc_error ?? "an input was missing"}. No number exists to decide against.
        </span>
      );
  }
}
