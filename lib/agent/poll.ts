import { TOOL_KEY_HEADER, protectionBypassHeaders } from "./auth.ts";
import { DEFAULT_BASE_URL } from "./openapi.ts";
import { LIVE_STATUS, toSyncState, type SyncState } from "../../components/traceModel.ts";

/**
 * Drive one investigation forward from the browser, SAFELY.
 *
 * `POST /api/investigate/sync` is gated by the shared tool key (`requireToolKey`,
 * review finding I-4) and must never be called from the browser. This runs
 * server-side — behind a Server Action — and holds the key, exactly as
 * `callToolRoute` already fetches our own tool routes with it. The key goes into
 * the request header and NOTHING here returns it: the client gets only the
 * sanitised `SyncState`.
 *
 * A network/unreachable error is reported as still `investigating`, not as a
 * failure, so a transient blip never stops the poll loop or reads to the analyst
 * as a failed investigation. A real failure comes back from the route as a
 * terminal `casefile_status`, which the reducer then stops on.
 */

export interface SyncDeps {
  /** Injected only by tests. Defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected only by tests. Defaults to the server-side env key. */
  toolKey?: string;
  baseUrl?: string;
}

export async function syncInvestigation(casefileId: string, deps: SyncDeps = {}): Promise<SyncState> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const toolKey = deps.toolKey ?? process.env.CREDITSCOUT_TOOL_KEY ?? "";
  const base = (deps.baseUrl ?? process.env.PUBLIC_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/investigate/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOOL_KEY_HEADER]: toolKey, ...protectionBypassHeaders() },
      body: JSON.stringify({ casefile_id: casefileId }),
    });
  } catch (err) {
    // Unreachable is transient, not terminal. Stay `investigating` so the poll
    // keeps trying rather than dropping the analyst onto a false failure.
    return {
      casefileId,
      casefileStatus: LIVE_STATUS,
      runStatus: "unreachable",
      steps: 0,
      maxSteps: 0,
      stopped: null,
      error: `the investigation could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A non-2xx from the sync route is an error to surface, but it does not
    // itself conclude the casefile — keep polling unless the route reported a
    // terminal status in the body.
    const state = toSyncState(casefileId, body);
    return { ...state, error: state.error ?? `the investigation sync returned ${res.status}` };
  }
  return toSyncState(casefileId, body);
}
