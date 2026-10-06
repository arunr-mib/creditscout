import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { InputError, searchDocuments } from "@/lib/retrieval";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
  }

  try {
    const hits = await searchDocuments({
      facilityId: body.facility_id,
      query: body.query,
      docTypes: body.doc_types,
      k: body.k,
    });
    return NextResponse.json(hits);
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("search-documents failed", err);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
