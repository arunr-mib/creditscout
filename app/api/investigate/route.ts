import { NextResponse } from "next/server";
import { ExceptionNotFound } from "@/lib/memory";
import { InvestigationError, startInvestigation } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";

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
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  try {
    const result = await startInvestigation(body.exception_id);
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
