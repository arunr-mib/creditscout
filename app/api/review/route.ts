import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
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
 *
 * Gated by the shared key (fail closed), for the same reason as the approval
 * route: this WRITES a human decision, and the session gate deliberately lets
 * the agent's routes through without a cookie. The analyst UI never comes
 * here — it calls the `reviewCasefile` Server Action, which runs `runReview`
 * in-process behind the page's own session.
 */
export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  try {
    const { status, body: out } = await runReview(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("review failed", err);
    return NextResponse.json({ error: "Review failed. Check the server log." }, { status: 500 });
  }
}
