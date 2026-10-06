import { NextResponse } from "next/server";
import { runReview } from "@/lib/review";

export const runtime = "nodejs";

/**
 * The analyst's decision on a casefile: approve, override or request_docs.
 * Body is snake_case on the wire, `{casefile_id, decision, reason?,
 * corrected_outcome?, confirmed_tag?}`; `runReview` maps it.
 *
 * Like the approval gate, the reviewer is RECORDED by the UI, not authenticated
 * here. An approve or override is also a lesson: if it cannot be embedded the
 * whole request fails and nothing is recorded. See `submitReview`.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  try {
    const { status, body: out } = await runReview(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("review failed", err);
    return NextResponse.json({ error: "Review failed. Check the server log." }, { status: 500 });
  }
}
