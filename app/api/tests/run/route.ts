import { NextResponse } from "next/server";
import { RunTestError, runTest } from "@/lib/tests/run";

export const runtime = "nodejs";

/**
 * The quarterly test for one borrower and one period. The analyst triggers it
 * per borrower (engineering doc A-1); there is deliberately no "run everything".
 *
 * No model is involved. The number comes from the calculator and the
 * borrower's figure only reconciles against it.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  try {
    const result = await runTest(body.facility_id, body.test_period_end, body.run_id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RunTestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("run test failed", err);
    return NextResponse.json({ error: "The test could not be run. Check the server log." }, { status: 500 });
  }
}
