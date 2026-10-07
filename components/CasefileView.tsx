import { RECOMMENDATION_BADGE, type CalcSection, type ClaimView, type Notice, decidedHeadline, exceptionNeedsClosing, isRecommendation, reviewMode } from "./casefileModel";
import { CasefileEvidence } from "./CasefileEvidence";
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
  /** For a superseded casefile: the current casefile of the same exception, if one exists. */
  supersededBy: string | null;
  status: string;
  borrower: string;
  period: string;
  recommendation: string | null;
  explanation: string | null;
  seenSimilar: number;
  claims: ClaimView[];
  sections: CalcSection[];
  clauses: Record<string, Clause | null>;
  missingEvidence: string[];
  notes: Notice[];
  suggestedTag: string | null;
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

  const showRec = mode !== "not_ready";
  const rec = isRecommendation(view.recommendation) ? view.recommendation : null;
  const accent =
    rec === "resolve" ? "border-l-success"
      : rec === "escalate" ? "border-l-danger"
        : rec === "request" ? "border-l-human"
          : "border-l-border-strong";

  return (
    <article className="space-y-6">
      {/* The decision banner: the recommendation is the first thing the analyst
          sees, and a cue to the guardrail notices they must read before deciding
          (the notices themselves still render in full above the action bar). */}
      <header className={`overflow-hidden rounded-lg border border-border-strong ${showRec ? `border-l-2 ${accent}` : ""} bg-surface`}>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="space-y-2">
            <p className="text-label text-text-muted">Casefile review</p>
            <h1 className="text-title text-text">
              {view.borrower} <span className="font-normal text-text-secondary">· {view.period}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <SeenSimilarBadge count={view.seenSimilar} />
              {view.notes.length > 0 && (
                <a
                  href="#guardrail-notices"
                  className="inline-flex items-center gap-1 rounded-sm border border-code bg-code-bg px-2 py-px text-label text-code-bright"
                >
                  <span aria-hidden="true">⟡</span>
                  {view.notes.length} guardrail {view.notes.length === 1 ? "notice" : "notices"} to review
                </a>
              )}
            </div>
          </div>
          {showRec && rec && (
            <div className={`shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-2 text-section ${RECOMMENDATION_BADGE[rec].tone}`}>
              <span aria-hidden="true">{RECOMMENDATION_BADGE[rec].icon}</span>
              {RECOMMENDATION_BADGE[rec].label}
            </div>
          )}
          {showRec && !rec && <RecommendationBadge recommendation={view.recommendation} />}
        </div>
      </header>

      {view.status === "superseded" && <Superseded currentId={view.supersededBy} />}
      {mode === "not_ready" && view.status !== "superseded" && <NotReady status={view.status} />}

      {mode !== "not_ready" && view.explanation && (
        <section aria-labelledby="explanation-heading" className="space-y-2">
          <h2 id="explanation-heading" className="text-card text-text">Explanation</h2>
          <p className="max-w-content text-body text-text-secondary">{view.explanation}</p>
        </section>
      )}

      {mode !== "not_ready" && <CasefileEvidence sections={view.sections} claims={view.claims} clauses={view.clauses} />}

      {view.missingEvidence.length > 0 && (
        <section aria-labelledby="missing-heading" className="space-y-2">
          <h2 id="missing-heading" className="text-card text-text">
            {view.status === "awaiting_docs" ? "Awaiting these documents" : "Evidence the agent says is not on file"}
          </h2>
          <ul className="space-y-1 rounded-md border border-border bg-surface p-3">
            {view.missingEvidence.map((m, i) => (
              <li key={i} className="text-body text-text-secondary">{m}</li>
            ))}
          </ul>
          {view.status === "awaiting_docs" && (
            <p className="text-label text-text-muted">
              After a document is ingested, use Re-run investigation below.
            </p>
          )}
        </section>
      )}

      {/* Above the actions, always visible, never collapsible. */}
      <div id="guardrail-notices" className="scroll-mt-4">
        <GuardrailNotices notes={view.notes} />
      </div>

      {mode === "active" && (
        <ReviewActions casefileId={view.casefileId} suggestedTag={view.suggestedTag} humanReviewRequired={view.humanReviewRequired} />
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
    </article>
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
