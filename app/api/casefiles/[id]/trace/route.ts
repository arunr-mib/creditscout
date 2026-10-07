import { NextResponse } from "next/server";
import { anonReader } from "@/lib/supabase/anon";
import { buildLiveTrace } from "@/components/traceModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The live trace, for the browser to poll while an investigation runs.
 *
 * This is a plain GET, NOT a Server Action, on purpose: Next serialises Server
 * Actions, so a fast display poll would queue behind the ~25s drive slice
 * (`pollInvestigation`) and the steps would only appear when the slice returned.
 * A normal HTTP request runs concurrently with the drive, so the steps
 * `syncRun` mirrors into `casefiles.trace` show up as they happen.
 *
 * Read-only, with the anon key under the RLS read policy — the same data the
 * casefile page already renders publicly. No tool key, no write.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "bad casefile id" }, { status: 400 });

  const db = anonReader();
  const { data, error } = await db.from("casefiles").select("status, trace").eq("id", id).maybeSingle();
  if (error) {
    console.error("read casefile trace failed", error);
    return NextResponse.json({ error: "could not read the trace" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "casefile not found" }, { status: 404 });

  return NextResponse.json(
    { status: data.status as string, view: buildLiveTrace((data as { trace: unknown }).trace) },
    { headers: { "cache-control": "no-store" } },
  );
}
