import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { ExceptionNotFound } from "@/lib/memory";
import { InvestigationError, startInvestigation } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";
// startInvestigation embeds the lesson query and creates the Foundry run before
// returning, which can exceed Vercel's 10s default. 60s is the Hobby ceiling.
export const maxDuration = 60;

/**
 * Start investigating an exception.
 *
 * It returns `{casefile_id}` as soon as the Foundry run is started, before the
 * agent has done any work — spec §4.2 requires it, and it is what lets this run
 * on a serverless platform at all: no request stays open while a model thinks.
 * The live trace is how the analyst watches the rest.
 *
 * Investigating the same exception twice returns the SAME casefile. A second
 * concurrent run on one exception would produce two traces and two
 * recommendations for one question.
 *
 * GATED by the same fail-closed shared key as the tool routes (review finding
 * I-4). It is the first route that spends orchestration tokens per call, so an
 * anonymous caller could bill the project by looping it, and the unique index
 * in migration 0009 is the only thing stopping each attempt from starting a
 * fresh Foundry run. Stage 9 therefore cannot call this from the browser: the
 * key stays server-side, and the Investigate button goes through a Server
 * Action or a route that holds it.
 */
export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  try {
    // run_id is optional and defaults to the demo run. A verification or eval
    // run passes its own, so its casefile never lands among the demo's.
    const result = await startInvestigation(body.exception_id, { runId: body.run_id ?? undefined });
    return NextResponse.json({ casefile_id: result.casefileId, status: result.status, reused: result.reused });
  } catch (err) {
    if (err instanceof InvestigationError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ExceptionNotFound) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("start investigation failed", err);
    return NextResponse.json(
      { error: "The investigation could not be started. Check the server log." },
      { status: 500 },
    );
  }
}
