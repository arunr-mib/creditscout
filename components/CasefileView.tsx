import { RECOMMENDATION_BADGE, type AmendmentStatus, type CalcSection, type ClaimView, type Notice, decidedHeadline, decisionBasis, exceptionNeedsClosing, headlineFor, investigationSummary, isRecommendation, recommendationOverridden, reviewMode } from "./casefileModel";
import type { LiveTraceView } from "./traceModel";
import { CasefileFindings } from "./CasefileFindings";
import { RecommendationCard } from "./RecommendationCard";
import { FinishClosing } from "./FinishClosing";
import { GuardrailNotices } from "./GuardrailNotice";
import Link from "next/link";
import { RecommendationBadge } from "./RecommendationBadge";
import { ReinvestigateButton } from "./ReinvestigateButton";
import { ReviewActions } from "./ReviewActions";
import { SeenSimilarBadge } from "./SeenSimilarBadge";
import type { Clause } from "./termsReview";

/** The recorded human decision, from `reviews`. Absent when a decided casefile has no review row (see `submitReview`'s crash window). */
/** Mirrors `SUPERSEDABLE_STATUSES` in the orchestrator, which this client component cannot import. */
const SUPERSEDABLE_STATUSES = ["approved", "overridden", "awaiting_docs", "pending_review"];

export interface ReviewRecord {
  decision: string;
  reason: string | null;
  corrected_outcome: string | null;
  pattern_tag: string | null;
  created_at: string | null;
}

export interface CasefileViewModel {
  casefileId: string;
  /** The owning exception, for the re-run action. */
  exceptionId: string;
  /** The loan this casefile belongs to, for the terms-review link. */
  facilityId: string;
  /** For a superseded casefile: the current casefile of the same exception, if one exists. */
  supersededBy: string | null;
  status: string;
  borrower: string;
  period: string;
  recommendation: string | null;
  explanation: string | null;
  /** What the agent proposed, before enforcement. Null when it never produced one. */
  draftRecommendation: string | null;
  seenSimilar: number;
  claims: ClaimView[];
  sections: CalcSection[];
  clauses: Record<string, Clause | null>;
  /** The recorded investigation trace, for the evidence pane's Trace tab. */
  trace: LiveTraceView;
  missingEvidence: string[];
  notes: Notice[];
  suggestedTag: string | null;
  /** The approved covenant terms version the test was computed on. */
  termsVersion: number | null;
  termsStatus: string | null;
  /** The covenant test period end (quarter end) and its basis (e.g. TTM). */
  testPeriodEnd: string | null;
  testBasis: string | null;
  /** Amendments on file and whether the governing terms reflect them (boarding lag). */
  amendments: AmendmentStatus[];
  humanReviewRequired: boolean | null;
  review: ReviewRecord | null;
  /** The owning exception's status, so a decided casefile can detect a failed close (A-4 drift). */
  exceptionStatus: string | null;
}

/**
 * design.md 12.13. A vertical stack: recommendation, explanation, calculation
 * table, claims with their citation chips, guardrail notices, then the actions.
 * The notices render ABOVE the actions and are never collapsed.
 *
 * Only a `pending_review` casefile gets an active action bar. A decided one
 * shows what was decided, read-only; one still investigating (or failed) has
 * nothing to decide yet and says so, and shows no recommendation or explanation:
 * whatever such a row still holds is not an answer to put in front of an analyst.
 */
export function CasefileView({ view }: { view: CasefileViewModel }) {
  const mode = reviewMode(view.status);

  // History shows everything the decided view shows; it simply offers no actions.
  const showRec = mode !== "not_ready";
  // Enforcement overruled the agent: its prose argues a conclusion that was
  // rejected, so it is labelled a draft rather than left reading as the answer.
  const overridden = recommendationOverridden(view.notes);
  // The governing calculation used terms the approved version does not carry.
  // The guardrail already flags it below; the header must not contradict it.
  const onAmendedTerms = view.notes.some((n) => n.check === "terms_differ_from_approved");
  const rec = isRecommendation(view.recommendation) ? view.recommendation : null;
  const headline = headlineFor(view.sections);
  const accent =
    rec === "resolve" ? "border-l-success"
      : rec === "escalate" ? "border-l-danger"
        : rec === "request" ? "border-l-human"
          : "border-l-border-strong";

  const summary = investigationSummary(view.sections, view.notes);
  // WHY this recommendation, given the amendment and the open notices. Derived
  // from the notes and the calculation log; never written by the model.
  const basis = decisionBasis(summary, view.notes, view.draftRecommendation, view.notes.length, view.amendments);
  const statusPill =
    mode === "active"
      ? { label: "Ready for analyst decision", tone: "border-success bg-success-bg text-success" }
      : mode === "read_only"
        ? { label: decidedHeadline(view.status), tone: "border-border-strong text-text-muted" }
        : { label: view.status, tone: "border-border-strong text-text-muted" };

  return (
    <article className="space-y-3">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-label uppercase tracking-[0.14em] text-model-bright">DSCR exception investigation</p>
          <h1 className="text-title text-text">
            {view.borrower} <span className="font-normal text-text-secondary">· {view.period}</span>
          </h1>
          <p className="max-w-prose text-body text-text-secondary">
            Review the agent&rsquo;s recommendation, calculations, and supporting evidence.
          </p>
        </div>
        {/* The memory badge sits under the status pill rather than taking a row
            of its own below the subtitle. */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`inline-flex items-center gap-2 rounded border px-4 py-2 text-body ${statusPill.tone}`}>
            <span aria-hidden="true">●</span> {statusPill.label}
          </span>
          <SeenSimilarBadge count={view.seenSimilar} />
        </div>
      </header>

      {/* ------------------------------------------------- the recommendation */}
      {showRec && rec && (
        <RecommendationCard
          accent={accent}
          headline={RECOMMENDATION_HEADLINE[rec]}
          summary={summary.headline}
          humanReviewRequired={view.humanReviewRequired}
          explanation={view.explanation}
          overridden={overridden}
          basis={basis}
        />
      )}

      {/* ---------------------------------------------------------- figures */}
      {showRec && (summary.initial || headline) && (
        <dl className="grid gap-px overflow-hidden rounded-lg border border-border-strong bg-border sm:grid-cols-2 lg:grid-cols-4">
          {summary.initial && (
            <Figure
              label="Initial DSCR"
              value={fmtX(summary.initial.dscr)}
              tag={summary.comparison[0]?.status === "below_minimum" ? "below minimum" : undefined}
              tone={summary.comparison[0]?.status === "below_minimum" ? "danger" : undefined}
            />
          )}
          {summary.comparison.length > 1 && summary.governing && (
            <Figure
              label={onAmendedTerms ? "Investigation recalculation" : "Recalculation"}
              value={fmtX(summary.governing.dscr)}
              tag={onAmendedTerms ? "provisional" : undefined}
              tone={onAmendedTerms ? "code" : summary.governing.passes ? "success" : undefined}
            />
          )}
          <Figure label="Minimum DSCR" value={fmtX(summary.required)} />
          <Figure
            label="Period"
            value={view.testPeriodEnd ? `${view.testBasis ?? ""} ending ${view.testPeriodEnd}`.trim() : view.period}
            muted
          />
        </dl>
      )}

      {/* ---------------------------------- findings, evidence and attention */}
      {showRec && (summary.steps.length > 0 || view.amendments.length > 0 || view.notes.length > 0) && (
        <CasefileFindings
          summary={summary}
          sections={view.sections}
          amendments={view.amendments}
          notes={view.notes}
          claims={view.claims}
          clauses={view.clauses}
          trace={view.trace}
          termsVersion={view.termsVersion}
          facilityId={view.facilityId}
          missingEvidence={view.missingEvidence}
        />
      )}

      {mode === "history" && <Superseded currentId={view.supersededBy} />}
      {mode === "not_ready" && <NotReady status={view.status} />}

      {mode === "active" && (
        <ReviewActions casefileId={view.casefileId} suggestedTag={view.suggestedTag} humanReviewRequired={view.humanReviewRequired} recommendation={view.recommendation} borrower={view.borrower} period={view.period} />
      )}
      {mode === "read_only" && (
        <Decided
          casefileId={view.casefileId}
          status={view.status}
          review={view.review}
          exceptionStatus={view.exceptionStatus}
        />
      )}
      {SUPERSEDABLE_STATUSES.includes(view.status) && (
        <ReinvestigateButton exceptionId={view.exceptionId} awaitingDocs={view.status === "awaiting_docs"} />
      )}
      {/* A failed investigation has no action bar and never held the live slot,
          so without this the only way to retry was from another casefile. */}
      {view.status === "failed" && (
        <ReinvestigateButton exceptionId={view.exceptionId} awaitingDocs={false} failed />
      )}
    </article>
  );
}

/** The recommendation as a sentence, so the card does not just repeat a token. */
const RECOMMENDATION_HEADLINE: Record<string, string> = {
  resolve: "Recommends exception resolution",
  escalate: "Recommends escalation",
  request: "Recommends requesting more documents",
  abstain: "Reaches no conclusion",
};

const fmt = (v: number | null): string => (v == null ? "—" : v.toFixed(2));
/** DSCR is a multiple; the x is how an analyst reads it. */
const fmtX = (v: number | null): string => (v == null ? "—" : `${v.toFixed(2)}x`);
const fmtSigned = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);

/** The basis of a compared figure, in the product's own colour language. */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === "below_minimum" ? "border-danger bg-danger-bg text-danger"
      : status === "meets_minimum" ? "border-success bg-success-bg text-success"
        : status === "provisional" ? "border-code bg-code-bg text-code-bright"
          : "border-border-strong text-text-muted";
  const label =
    status === "below_minimum" ? "Below minimum"
      : status === "meets_minimum" ? "Meets minimum"
        : status === "provisional" ? "Provisional"
          : "Not computed";
  return <span className={`inline-flex whitespace-nowrap rounded border px-3 py-px text-label ${tone}`}>{label}</span>;
}

/** One figure in the decision banner's governing-figures strip. */
function Figure({
  label,
  value,
  tone,
  tag,
  muted,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success" | "code";
  tag?: string;
  muted?: boolean;
}) {
  const toneClass =
    tone === "danger" ? "text-danger"
      : tone === "success" ? "text-success"
        : tone === "code" ? "text-code-bright"
          : muted ? "text-text-muted" : "text-text";
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-label text-text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-section tabular-nums ${toneClass}`}>
        {value}
        {tag && <span className="ml-2 align-middle text-label text-text-muted">{tag}</span>}
      </dd>
    </div>
  );
}

/**
 * Amendment status (credit-review ask): whether each amendment on file is
 * reflected in the governing terms. An amendment effective for the period but
 * not boarded is the boarding lag — shown prominently, because the agent's
 * narrative may lean on it while the governing calculation above does not.
 */
function AmendmentPanel({ amendments, termsVersion }: { amendments: AmendmentStatus[]; termsVersion: number | null }) {
  const lag = amendments.some((a) => a.effectiveForPeriod && !a.boarded);
  return (
    <section
      aria-labelledby="amendments-heading"
      className={`rounded-md border bg-surface p-4 ${lag ? "border-human border-l-2 border-l-human" : "border-border"}`}
    >
      <h2 id="amendments-heading" className="text-card text-text">Amendment status</h2>
      <ul className="mt-2 space-y-2">
        {amendments.map((a) => {
          const status = a.boarded
            ? { label: termsVersion != null ? `Reflected in terms v${termsVersion}` : "Reflected in the approved terms", tone: "text-success" }
            : a.effectiveForPeriod
              ? { label: "On file — not reflected in the approved terms used for this test", tone: "text-human" }
              : { label: "On file — effective after this period", tone: "text-text-muted" };
          return (
            <li key={a.title} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-body text-text">
                {a.title}
                {a.effectiveDate && <span className="text-label text-text-muted"> · effective {a.effectiveDate}</span>}
              </span>
              <span className={`text-label ${status.tone}`}>{status.label}</span>
            </li>
          );
        })}
      </ul>
      {lag && (
        <p className="mt-3 max-w-content text-label text-text-secondary">
          An amendment effective for this period is not reflected in the approved terms used for this test
          {termsVersion != null ? ` (v${termsVersion})` : ""}. The calculation above uses the approved terms as they
          stand; any analysis that applies this amendment is provisional until an analyst boards it.
        </p>
      )}
    </section>
  );
}

function Superseded({ currentId }: { currentId: string | null }) {
  return (
    <p role="status" className="rounded-md border border-border bg-surface p-4 text-body text-text-muted">
      Superseded by a later investigation. This casefile is kept as history.{" "}
      {currentId && (
        <Link href={`/casefiles/${currentId}`} className="text-text-secondary underline">
          Open the current casefile
        </Link>
      )}
    </p>
  );
}

function NotReady({ status }: { status: string }) {
  return (
    <p role="status" className="rounded-md border border-border bg-surface p-4 text-body text-text-secondary">
      {status === "investigating"
        ? "The investigation is still running, so there is nothing to review yet. Come back when it reaches pending review."
        : status === "failed"
          ? "The investigation failed, so there is no recommendation to review. The notes below say what failed; start the investigation again."
          : `This casefile is ${status}, so it cannot be reviewed.`}
    </p>
  );
}

/** The recorded decision, with no action bar: a review is read-only once made. */
function Decided({
  casefileId,
  status,
  review,
  exceptionStatus,
}: {
  casefileId: string;
  status: string;
  review: ReviewRecord | null;
  exceptionStatus: string | null;
}) {
  const needsClosing = exceptionNeedsClosing(status, exceptionStatus);
  return (
    <section aria-labelledby="decided-heading" className="rounded-md border border-border-strong border-t-2 bg-surface-raised p-4">
      <h2 id="decided-heading" className="text-card text-human">{decidedHeadline(status)}</h2>
      {review ? (
        <dl className="mt-2 space-y-1 text-body text-text-secondary">
          <div className="flex gap-2"><dt className="text-text-muted">Decision</dt><dd className="font-mono">{review.decision}</dd></div>
          {review.created_at && <div className="flex gap-2"><dt className="text-text-muted">Recorded</dt><dd className="font-mono">{review.created_at.slice(0, 10)}</dd></div>}
          {review.corrected_outcome && <div className="flex gap-2"><dt className="text-text-muted">Corrected outcome</dt><dd className="font-mono">{review.corrected_outcome}</dd></div>}
          {review.pattern_tag && <div className="flex gap-2"><dt className="text-text-muted">Pattern tag</dt><dd className="font-mono">{review.pattern_tag}</dd></div>}
          {review.reason && (
            <div>
              <dt className="text-text-muted">Analyst&rsquo;s reason (stored verbatim; retrieved on similar cases)</dt>
              <dd className="mt-1 whitespace-pre-wrap text-text">{review.reason}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-2 text-body text-text-secondary">No review record was found for this casefile. Its status is {status}.</p>
      )}

      {/* The decision landed but the exception close did not (A-4 drift). Surfaced
          here, non-dismissibly, because the active action bar that carried the
          warning has unmounted — and made repairable from this read-only screen. */}
      {needsClosing && (
        <div role="alert" className="mt-4 rounded-md border border-danger border-l-4 bg-danger-bg p-3">
          <p className="text-body text-danger">
            The decision is recorded, but this casefile&rsquo;s exception was not closed. It is still open, so it would
            keep showing as an unresolved exception.
          </p>
          <FinishClosing casefileId={casefileId} />
        </div>
      )}

      <p className="mt-3 text-label text-text-muted">A review is read-only once made.</p>
    </section>
  );
}
