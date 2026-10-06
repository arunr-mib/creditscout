import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { runDscrCalculator } from "@/lib/agent/tools/dscr-calculator";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });

  try {
    const { status, body: out } = await runDscrCalculator(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    console.error("dscr-calculator failed", err);
    return NextResponse.json({ error: "calculation failed" }, { status: 500 });
  }
}
