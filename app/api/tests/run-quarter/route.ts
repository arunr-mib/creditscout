import { NextResponse } from "next/server";
import { RunTestError, runQuarter } from "@/lib/tests/run";

export const runtime = "nodejs";

/**
 * The whole quarter, for the portfolio landing screen (engineering doc A-1).
 * Loops every facility with approved terms and runs its quarterly test, skipping
 * the ones not yet boarded with a reason and recording — never dropping — any
 * that error. The per-facility `/api/tests/run` stays for re-runs.
 *
 * No model is involved. Every number comes from the calculator.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  try {
    const result = await runQuarter(body.test_period_end, body.run_id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RunTestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("run quarter failed", err);
    return NextResponse.json({ error: "The quarter could not be run. Check the server log." }, { status: 500 });
  }
}
