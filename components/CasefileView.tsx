import { type AmendmentStatus, type CalcSection, type ClaimView, type Notice, OUTCOME_LABEL, decidedHeadline, decisionBasis, exceptionNeedsClosing, investigationSummary, isRecommendation, outstandingSummary, recommendationOverridden, reviewMode, statusHeadline, tagLabel } from "./casefileModel";
import type { LiveTraceView } from "./traceModel";
import { CasefileFindings } from "./CasefileFindings";
import { RecommendationCard } from "./RecommendationCard";
import { FinishClosing } from "./FinishClosing";
import Link from "next/link";

import { longDate } from "@/lib/terms-labels";
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
  /**
   * The three figures that raised the exception, read from the exception row —
   * the same ones the pipeline card shows. Evidence, never recomputed here.
   */
  figures: { computed: number | null; reported: number | null; required: number | null };
  /** The covenant test period end (quarter end) and its basis (e.g. TTM). */
  testPeriodEnd: string | null;
  testBasis: string | null;
  /** Amendments on file and whether the governing terms reflect them (boarding lag). */
  amendments: AmendmentStatus[];
  /** Every document on file for the loan, so the evidence list can open the source. */
  documents: { id: string; title: string; docType: string | null; date: string | null }[];
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
  const rec = isRecommendation(view.recommendation) ? view.recommendation : null;
  const summary = investigationSummary(view.sections, view.notes);
  // WHY this recommendation, given the amendment and the open notices. Derived
  // from the notes and the calculation log; never written by the model.
  const basis = decisionBasis(summary, view.notes, view.draftRecommendation, view.notes.length, view.amendments);
  const outstanding = outstandingSummary(view.amendments, view.notes);
  // The state, in the analyst's words. Never the raw column value: `superseded`
  // and `failed` fell through to it and the screen spoke the database's words.
  const state = statusHeadline(view.status);
  const basisLine = [
    `${view.claims.filter((c) => c.cited).length} citation${view.claims.filter((c) => c.cited).length === 1 ? "" : "s"}`,
    `${view.sections.length} calculation${view.sections.length === 1 ? "" : "s"}`,
    view.termsVersion != null ? `terms v${view.termsVersion}` : null,
  ]
    .filter((p): p is string => p != null)
    .join(" · ");

  return (
    <article className="space-y-3">
      {/* ------------------------------------------------------------ header */}
      <header className="space-y-3">
        <div className="space-y-1">
          {/* A way back to the pipeline: the casefile is reached FROM a
              board of loans, and an analyst needs the way back. */}
          <nav aria-label="Breadcrumb" className="text-label text-text-muted">
            <Link href="/" className="underline-offset-2 hover:text-text hover:underline">
              <span aria-hidden="true">← </span>Pipeline
            </Link>
            <span aria-hidden="true" className="mx-2">/</span>
            <span className="text-text-secondary">{view.borrower}</span>
          </nav>
          {/* The identity line carries the state. Green is for a verified pass,
              so the state is words, not a coloured status object. */}
          <p className="text-label uppercase tracking-wider text-text-muted">
            {view.period}
            {view.termsVersion != null && ` · Terms v${view.termsVersion}`} · {state}
          </p>
          <h1 className="font-brand text-title text-text">{view.borrower}</h1>
          {/* Memory is agent provenance, not a status: the agent tag. Renders
              nothing when no prior case informed this run. */}
          {view.seenSimilar > 0 && (
            <p>
              <SeenSimilarBadge count={view.seenSimilar} />
            </p>
          )}
        </div>
      </header>

      {/* ------------------------------------------------- the recommendation */}
      {showRec && rec && (
        <RecommendationCard
          outcome={rec}
          headline={RECOMMENDATION_HEADLINE[rec]}
          summary={summary.headline}
          explanation={view.explanation}
          overridden={overridden}
          basis={basis}
          basisLine={basisLine}
          facts={{
            testResult: summary.governing?.passes === false ? "Outside covenant limit" : summary.governing?.passes === true ? "Within covenant limit" : null,
            reportingPeriod: view.period,
          }}
          outstanding={outstanding ? { label: outstanding.label, href: "#outstanding" } : null}
        />
      )}

      {/* ------------------------------------------------- the decision block */}
      {/* Directly under the recommendation, not after the findings: the point
          of this screen is a decision, and an analyst should never have to
          scroll past the evidence to reach it. The evidence is still one
          scroll away for whoever wants it before deciding — it is not hidden,
          only no longer first. */}
      {mode === "history" && <Superseded currentId={view.supersededBy} />}
      {mode === "not_ready" && <NotReady status={view.status} />}

      {mode === "active" && (
        <ReviewActions
          casefileId={view.casefileId}
          suggestedTag={view.suggestedTag}
          humanReviewRequired={view.humanReviewRequired}
          recommendation={view.recommendation}
          borrower={view.borrower}
          period={view.period}
          headerAction={
            SUPERSEDABLE_STATUSES.includes(view.status) ? (
              <ReinvestigateButton exceptionId={view.exceptionId} awaitingDocs={view.status === "awaiting_docs"} />
            ) : undefined
          }
        />
      )}
      {mode === "read_only" && (
        <Decided
          casefileId={view.casefileId}
          status={view.status}
          review={view.review}
          exceptionStatus={view.exceptionStatus}
        />
      )}
      {/* The active case's re-run control now lives in the decision card's own
          header (owner's call, 2026-11-10), not as a separate button here. */}
      {mode !== "active" && SUPERSEDABLE_STATUSES.includes(view.status) && (
        <ReinvestigateButton exceptionId={view.exceptionId} awaitingDocs={view.status === "awaiting_docs"} />
      )}
      {/* A failed investigation has no action bar and never held the live slot,
          so without this the only way to retry was from another casefile. */}
      {view.status === "failed" && (
        <ReinvestigateButton exceptionId={view.exceptionId} awaitingDocs={false} failed />
      )}

      {/* ---------------------------------- findings, evidence and attention */}
      {/* `missingEvidence` lives in this panel, so a `request` casefile with no
          steps, no amendments and no notes said NOTHING about what it was
          waiting for. */}
      {showRec &&
        (summary.steps.length > 0 ||
          view.amendments.length > 0 ||
          view.notes.length > 0 ||
          view.missingEvidence.length > 0) && (
        <CasefileFindings
          summary={summary}
          sections={view.sections}
          amendments={view.amendments}
          notes={view.notes}
          claims={view.claims}
          trace={view.trace}
          termsVersion={view.termsVersion}
          facilityId={view.facilityId}
          missingEvidence={view.missingEvidence}
          amendmentEffect={basis.amendmentEffect}
          documents={view.documents}
        />
      )}
    </article>
  );
}

/**
 * The recommendation as the ACTION it proposes. "Recommends escalation" spent
 * its first word restating the eyebrow above it, which already says this is a
 * recommendation; the sentence now says what is being recommended.
 */
const RECOMMENDATION_HEADLINE: Record<string, string> = {
  resolve: "Resolve the covenant exception",
  escalate: "Escalate for credit review",
  request: "Request documents from the borrower",
  abstain: "No recommendation",
};

function Superseded({ currentId }: { currentId: string | null }) {
  return (
    <p role="status" className="rounded-xl border border-border bg-surface p-4 text-body text-text-muted">
      Superseded by a later investigation. This casefile is kept as history.{" "}
      {currentId && (
        <Link href={`/casefiles/${currentId}`} className="text-text underline decoration-border-strong hover:decoration-text">
          Open the current casefile
        </Link>
      )}
    </p>
  );
}

function NotReady({ status }: { status: string }) {
  return (
    <p role="status" className="rounded-xl border border-border bg-surface p-4 text-body text-text-secondary">
      {status === "investigating"
        ? "The investigation is still running, so there is nothing to review yet. Come back when it reaches pending review."
        : status === "failed"
          ? "The investigation failed, so there is no recommendation to review. The notes below say what failed; start the investigation again."
          : `This casefile is ${status}, so it cannot be reviewed.`}
    </p>
  );
}

/** The stored decision verb, as the analyst performed it. The value is unchanged. */
const DECISION_WORD: Record<string, string> = {
  approve: "Accepted the recommendation",
  override: "Recorded a different decision",
  request_docs: "Marked as awaiting documents",
};

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
    <section aria-labelledby="decided-heading" className="rounded-xl border border-border-strong border-t-2 bg-surface-raised p-4">
      <h2 id="decided-heading" className="text-card text-human">{decidedHeadline(status)}</h2>
      {review ? (
        <dl className="mt-2 space-y-1 text-body text-text-secondary">
          {/* A RECEIPT, not a database row. It read `approve` / `true_breach`
              in monospace — the stored identifiers, which are correct and are
              not what an analyst wrote down. The values still travel unchanged
              in the data; only the reading changes. */}
          <div className="flex gap-2">
            <dt className="text-text-muted">Decision</dt>
            <dd className="text-text">{DECISION_WORD[review.decision] ?? review.decision}</dd>
          </div>
          {review.created_at && (
            <div className="flex gap-2">
              <dt className="text-text-muted">Recorded</dt>
              <dd className="text-text">{longDate(review.created_at.slice(0, 10))}</dd>
            </div>
          )}
          {review.corrected_outcome && (
            <div className="flex gap-2">
              <dt className="text-text-muted">Outcome recorded</dt>
              <dd className="text-text">{OUTCOME_LABEL[review.corrected_outcome as keyof typeof OUTCOME_LABEL] ?? review.corrected_outcome}</dd>
            </div>
          )}
          {review.pattern_tag && (
            <div className="flex gap-2">
              <dt className="text-text-muted">Case category</dt>
              <dd className="text-text">{tagLabel(review.pattern_tag)}</dd>
            </div>
          )}
          {review.reason && (
            <div>
              <dt className="text-text-muted">Analyst&rsquo;s rationale — saved to the casefile, retrieved on similar investigations</dt>
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
