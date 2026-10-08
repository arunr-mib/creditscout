import { InvestigationError, syncRun } from "./orchestrator.ts";
import { LIVE_STATUS, toSyncState, type SyncState } from "../../components/traceModel.ts";

/**
 * Drive one investigation forward from the browser, SAFELY.
 *
 * This runs behind a Server Action, so it is already server-side. It therefore
 * drives the run IN PROCESS by calling `syncRun` directly. The client gets only
 * the sanitised `SyncState`; no key, no Foundry detail, ever.
 *
 * IT USED TO HTTP-POST ITS OWN `/api/investigate/sync` ROUTE. That hop bought
 * nothing — both ends are the same server, and the Server Action already held
 * the tool key the route checks — and on Vercel it was the thing that broke:
 * the function's fetch to its own public domain failed, so every drive returned
 * "the investigation could not be reached: fetch failed" and the run sat at
 * zero steps while Foundry waited. Calling the orchestrator directly removes
 * the whole failure class.
 *
 * The ROUTE STAYS, key-gated, because `scripts/investigate.mjs` and the eval
 * harness drive runs over HTTP from outside the server. It is simply no longer
 * how the app talks to itself.
 *
 * A thrown drive is reported as still `investigating`, not as a failure, so a
 * transient blip never stops the poll loop or reads to the analyst as a failed
 * investigation. A real failure comes back as a terminal `casefile_status`,
 * which the reducer then stops on.
 */

export interface SyncDeps {
  /** Injected only by tests. Defaults to the in-process orchestrator. */
  syncImpl?: (casefileId: string) => Promise<unknown>;
}

/**
 * `fetch` failures surface as a bare "fetch failed" with the real reason hidden
 * on `cause`. Unwrapping it is the difference between a diagnosable error and a
 * shrug — that opacity cost real time on the first production run.
 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : cause ? String(cause) : "";
  return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
}

export async function syncInvestigation(casefileId: string, deps: SyncDeps = {}): Promise<SyncState> {
  const drive = deps.syncImpl ?? syncRun;
  try {
    return toSyncState(casefileId, await drive(casefileId));
  } catch (err) {
    // An InvestigationError is the orchestrator refusing on purpose (a bad id, a
    // casefile that is not ours to drive). Surface it, but let the poll loop
    // keep going — the route's own terminal status is what concludes a casefile.
    const message = err instanceof InvestigationError ? err.message : describe(err);
    return {
      casefileId,
      casefileStatus: LIVE_STATUS,
      runStatus: "unreachable",
      steps: 0,
      maxSteps: 0,
      stopped: null,
      error: `the investigation could not be advanced: ${message}`,
    };
  }
}
