import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `casefiles.guardrail_notes`: one array, one convention, several writers.
 *
 * The orchestrator records the step cap and failures there; the casefile
 * guardrail records every forced change. They used to disagree — `noteStepCap`
 * OVERWROTE the array while `markFailed` appended (E-6) — and `stoppedAtCap`
 * reads this array to decide whether a cap is final, so an overwrite landing
 * late erased the only record that the cap was reached. Everyone appends, and
 * everyone appends through `appendNotes`.
 */

type Db = Pick<SupabaseClient, "from">;

export interface Note {
  layer: string;
  check: string;
  action: string;
  detail: string;
}

/** The `check` of the policy note that records the orchestrator stopping a run at the cap. */
export const STEP_CAP_CHECK = "max_steps";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Was this investigation already stopped by the cap?
 *
 * It has to be asked, because the cap CANCELS the Foundry run — so the next
 * sync sees `cancelled` and, with no way to tell our own cancel from a platform
 * failure, would rewrite a policy decision as an outage and lose the note that
 * recorded it.
 */
export function stoppedAtCap(guardrailNotes: unknown): boolean {
  return (
    Array.isArray(guardrailNotes) &&
    guardrailNotes.some((n) => isObj(n) && n.layer === "policy" && n.check === STEP_CAP_CHECK && n.action === "end_run")
  );
}

/**
 * Append to a casefile's notes, reading the array fresh rather than trusting a
 * copy taken earlier in the request. Returns the array as written.
 *
 * Read-then-write, so two writers racing on one casefile could still lose one;
 * the sync lock serialises the writers on one server, and the cross-instance
 * case is the database lease already recorded as open (stage 8a).
 */
export async function appendNotes(client: Db, casefileId: string, notes: readonly Note[]): Promise<unknown[]> {
  const read = await client.from("casefiles").select("guardrail_notes").eq("id", casefileId).maybeSingle();
  if (read.error) throw new Error(`read guardrail_notes: ${read.error.message}`);
  const existing = isObj(read.data) && Array.isArray(read.data.guardrail_notes) ? read.data.guardrail_notes : [];
  const next = [...existing, ...notes];
  const write = await client.from("casefiles").update({ guardrail_notes: next }).eq("id", casefileId);
  if (write.error) throw new Error(`append guardrail_notes: ${write.error.message}`);
  return next;
}
