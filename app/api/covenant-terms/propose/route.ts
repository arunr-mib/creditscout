import { NextResponse } from "next/server";
import { AgentOutputError, DeploymentNotFoundError } from "@/lib/agent/tools/definition-agent";
import { runPropose } from "@/lib/terms";

export const runtime = "nodejs";
// The model reads an agreement; that is not instant.
export const maxDuration = 120;

/**
 * Analyst route, not a tool route: the agent never calls it, so it takes no tool
 * key. It writes a `proposed` row only, which governs nothing.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  try {
    const { status, body: out } = await runPropose(body);
    return NextResponse.json(out, { status });
  } catch (err) {
    if (err instanceof DeploymentNotFoundError) {
      console.error("definition agent: deployment not found", err.message);
      return NextResponse.json({ error: "The chat model deployment was not found. Check FOUNDRY_SPECIALIST_MODEL." }, { status: 502 });
    }
    if (err instanceof AgentOutputError) {
      console.error("definition agent: unusable output", err.message);
      return NextResponse.json({ error: `The definition agent returned something unusable. ${err.message}` }, { status: 502 });
    }
    console.error("propose failed", err);
    return NextResponse.json({ error: "Proposing terms failed. Try again; if it keeps failing, check the server log." }, { status: 500 });
  }
}
