"use server";

import { revalidatePath } from "next/cache";
import { decideReview, type ReviewOutcome, type ReviewRequest } from "@/lib/review-action";
import { syncInvestigation } from "@/lib/agent/poll";
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
