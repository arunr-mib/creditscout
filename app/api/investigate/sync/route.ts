import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { InvestigationError, syncRun } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";

/**
 * Drive one investigation forward: mirror the run's completed steps into the
 * trace, service whatever Foundry is waiting on, and record how it ended.
 *
 * INTERNAL. It is protected by the same fail-closed shared key as the agent
 * tool routes rather than a second scheme of its own, because this route can
 * spend orchestration tokens and write to a casefile, and a second auth scheme
 * is a second thing to get wrong. An unset or weak key rejects everything.
 *
 * One call drives the run for a bounded time and hands back; the caller polls.
 */
export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  try {
    return NextResponse.json(await syncRun(body.casefile_id));
  } catch (err) {
    if (err instanceof InvestigationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("sync investigation failed", err);
    return NextResponse.json({ error: "The investigation could not be synced. Check the server log." }, { status: 500 });
  }
}
