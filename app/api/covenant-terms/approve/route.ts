import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { runApprove } from "@/lib/terms";

export const runtime = "nodejs";

/**
 * The approval gate. Provenance is re-verified here, on the server, against
 * chunks it loads itself; the screen's own check is convenience, because a UI is
 * not a security boundary. Nothing about this route is advisory.
 *
 * Four-eyes is RECORDED here, not ENFORCED: `approved_by` is a name the caller
 * supplies, with no authentication behind it and no check that it differs from
 * whoever proposed. See `runApprove`.
 *
 * Gated by the shared key (fail closed): a public visitor must not be able to
 * approve terms. The covenant-setup UI goes through the `approveTerms` Server
 * Action instead, which runs `runApprove` in-process.
 */
export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  try {
    const { status, body: out } = await runApprove(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("approve failed", err);
    return NextResponse.json({ error: "Approval failed. Check the server log." }, { status: 500 });
  }
}
