"use server";

import { ingestFromForm } from "@/lib/ingest-form";
import { runApprove } from "@/lib/terms";
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

/**
 * Upload a document from the portfolio dropzone. A Server Action, not a browser
 * POST to `/api/ingest`: that route is gated by the shared key, which must never
 * reach the browser. The action runs the same ingest code in-process and
 * returns only `{status, body}`.
 */
export async function uploadPackage(form: FormData): Promise<{ status: number; body: Record<string, unknown> }> {
  return ingestFromForm(form);
}

/**
 * Approve covenant terms from the setup screen. A Server Action for the same
 * reason as the upload: `/api/covenant-terms/approve` is key-gated. Provenance
 * is still re-verified server-side by `runApprove`; the reply has the same
 * `{status, body}` shape the route's response had.
 */
export async function approveTerms(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    return await runApprove(body);
  } catch (err) {
    console.error("approve failed", err);
    return { status: 500, body: { error: "Approval failed. Check the server log." } };
  }
}
