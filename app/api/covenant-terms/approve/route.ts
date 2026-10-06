import { NextResponse } from "next/server";
import { runApprove } from "@/lib/terms";

export const runtime = "nodejs";

/**
 * THE four-eyes control. Provenance is re-verified here, on the server, against
 * chunks it loads itself; the screen's own check is convenience, because a UI is
 * not a security boundary. Nothing about this route is advisory.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  try {
    const { status, body: out } = await runApprove(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("approve failed", err);
    return NextResponse.json({ error: "Approval failed. Check the server log." }, { status: 500 });
  }
}
