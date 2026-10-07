import { submitReview, type ReviewDeps, type ReviewResult } from "./review.ts";

/**
 * What the casefile screen's Server Action does, minus the framework: take the
 * analyst's click, hand it to `submitReview` DIRECTLY (no self-HTTP, so no
 * second copy of the 400/404/409 rules), refresh the page, and say what
 * happened in terms the screen can draw.
 *
 * Kept apart from `app/casefiles/actions.ts` because a `"use server"` file may
 * export only async functions and imports `next/cache`, neither of which a
 * `node:test` can load. `revalidate` is injected here for the same reason.
 *
 * THE RULE THAT SHAPES THE OUTCOME: a decision has landed only when the body
 * carries a `review_id`. A bare 200 does not mean one did. F9a's repair path
 * answers 200 `{repaired: true}` for a casefile that was ALREADY decided, with
 * no `review_id` and no `decision`; reading that as "your decision was saved"
 * would be a lie to the analyst, so it is `already_reviewed`.
 */

export interface ReviewRequest {
  casefileId: string;
  decision: "approve" | "override" | "request_docs";
  /** Passed through exactly as typed. Never trimmed, never reworded: it becomes the lesson. */
  reason?: string;
  correctedOutcome?: string;
  confirmedTag?: string;
}

export type ReviewOutcome =
  /** A review row was written. `warning` is set when something after it failed (the exception close). */
  | { kind: "decided"; decision: string; reviewId: string; casefileStatus: string | null; warning?: string }
  /** Someone decided first, or this was a retry. The page now shows the read-only view; this is not an error. */
  | { kind: "already_reviewed"; casefileStatus: string | null; message: string }
  /** The request was refused before anything was written (a 400). Fix the input and resubmit. */
  | { kind: "refused"; message: string; missing?: string[] }
  | { kind: "not_found"; message: string }
  | { kind: "failed"; message: string };

export interface ReviewActionDeps {
  /** `revalidatePath`, from `next/cache`. */
  revalidate: (path: string) => void;
  submit?: (input: ReviewRequest, deps?: ReviewDeps) => Promise<ReviewResult>;
  review?: ReviewDeps;
}

export const casefilePath = (casefileId: string): string => `/casefiles/${casefileId}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, fallback: string): string => (typeof v === "string" && v !== "" ? v : fallback);

/** A Server Action argument comes from the browser: its shape is checked before it is trusted with anything. */
function readRequest(raw: unknown): ReviewRequest | null {
  if (!isObj(raw)) return null;
  const { casefileId, decision, reason, correctedOutcome, confirmedTag } = raw;
  if (typeof casefileId !== "string") return null;
  if (decision !== "approve" && decision !== "override" && decision !== "request_docs") return null;
  const optional = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return { casefileId, decision, reason: optional(reason), correctedOutcome: optional(correctedOutcome), confirmedTag: optional(confirmedTag) };
}

export async function decideReview(raw: unknown, deps: ReviewActionDeps): Promise<ReviewOutcome> {
  const request = readRequest(raw);
  if (!request) return { kind: "refused", message: "That request was not a review of a casefile." };

  let result: ReviewResult;
  try {
    result = await (deps.submit ?? submitReview)(request, deps.review);
  } catch (err) {
    console.error("review failed", err);
    return { kind: "failed", message: "The review was not recorded. Check the server log, then try again." };
  }
  const { status, body } = result;
  const casefileStatus = typeof body.casefile_status === "string" ? body.casefile_status : null;

  // The page must be re-read whenever the casefile may have changed: a decision
  // landed (even one whose exception close failed), or it was already decided.
  const decidedInBody = typeof body.review_id === "string";
  if (decidedInBody || status === 409 || status === 200) deps.revalidate(casefilePath(request.casefileId));

  if (decidedInBody) {
    return {
      kind: "decided",
      decision: typeof body.decision === "string" ? body.decision : request.decision,
      reviewId: body.review_id as string,
      casefileStatus,
      ...(status >= 400 ? { warning: text(body.error, "Something after the review failed. Check the server log.") } : {}),
    };
  }
  if (status === 409) return { kind: "already_reviewed", casefileStatus, message: text(body.error, "This casefile is already reviewed.") };
  if (status === 200 && body.repaired === true) {
    return { kind: "already_reviewed", casefileStatus, message: text(body.note, "This casefile was already decided; no new review was recorded.") };
  }
  if (status === 400) {
    return { kind: "refused", message: text(body.error, "The review was refused."), ...(Array.isArray(body.missing) ? { missing: body.missing.filter((m): m is string => typeof m === "string") } : {}) };
  }
  if (status === 404) return { kind: "not_found", message: text(body.error, "No casefile with that id.") };
  return { kind: "failed", message: text(body.error, "The review was not recorded.") };
}
