"use server";

import { revalidatePath } from "next/cache";
import { decideReview, type ReviewOutcome, type ReviewRequest } from "@/lib/review-action";
import { syncInvestigation } from "@/lib/agent/poll";
import { InvestigationError, startInvestigation } from "@/lib/agent/orchestrator";
import type { SyncState } from "@/components/traceModel";

/**
 * The analyst's decision from the casefile screen. It calls `submitReview`
 * directly, on the server; `POST /api/review` stays the documented webhook and
 * is not routed through. The reviewer is recorded by the UI, not authenticated
 * here (the same model as covenant approval).
 */
export async function reviewCasefile(request: ReviewRequest): Promise<ReviewOutcome> {
  return decideReview(request, { revalidate: revalidatePath });
}

/**
 * Drive the live investigation forward one bounded slice and return its current
 * state, for the polling trace view (F9d).
 *
 * It goes through a Server Action, not a browser fetch, for the same reason the
 * Investigate action does: `POST /api/investigate/sync` is gated by the
 * server-side shared tool key (review finding I-4), which must never reach the
 * browser. `syncInvestigation` holds the key server-side and returns only the
 * sanitised `SyncState` — never the key. The in-process mutex and migration
 * 0009's unique index guard against a second run, so a double poll cannot start
 * one.
 */
export async function pollInvestigation(casefileId: string): Promise<SyncState> {
  return syncInvestigation(casefileId);
}

/**
 * Re-run the investigation for an exception whose casefile has reached an end
 * (approved, overridden, awaiting documents, or pending review). The prior
 * casefile is marked `superseded`, never deleted, and a fresh one takes the live
 * slot. A running investigation is never superseded: `startInvestigation`
 * returns it as-is. Server Action, so the shared tool key stays server-side.
 */
export async function reinvestigateException(
  exceptionId: string,
): Promise<{ ok: true; casefileId: string } | { ok: false; error: string }> {
  try {
    const result = await startInvestigation(exceptionId, { supersede: true });
    return { ok: true, casefileId: result.casefileId };
  } catch (err) {
    if (err instanceof InvestigationError) return { ok: false, error: err.message };
    console.error("re-investigate failed", err);
    return { ok: false, error: "The investigation could not be started. Check the server log." };
  }
}
