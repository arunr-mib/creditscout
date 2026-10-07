"use server";

import { InvestigationError, startInvestigation } from "@/lib/agent/orchestrator";

/**
 * Start investigating an exception, from the portfolio queue.
 *
 * It goes through a Server Action rather than `POST /api/investigate` on
 * purpose: that route is gated by the server-side shared key (review finding
 * I-4), which must never reach the browser, and it is the first route that
 * spends orchestration tokens per call. `startInvestigation` is idempotent per
 * exception — the same exception returns the same casefile — so a double click
 * cannot start two Foundry runs.
 *
 * Returns the casefile id for the client to navigate to; a refusal surfaces as a
 * message, never a thrown 500 the analyst cannot read.
 */
export async function investigateException(
  exceptionId: string,
): Promise<{ ok: true; casefileId: string } | { ok: false; error: string }> {
  try {
    const result = await startInvestigation(exceptionId);
    return { ok: true, casefileId: result.casefileId };
  } catch (err) {
    if (err instanceof InvestigationError) return { ok: false, error: err.message };
    console.error("investigate from queue failed", err);
    return { ok: false, error: "The investigation could not be started. Check the server log." };
  }
}
