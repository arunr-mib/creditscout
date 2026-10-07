import { NextResponse } from "next/server";
import { requireToolKey } from "@/lib/agent/auth";
import { MAX_BYTES } from "@/lib/ingest";
import { ingestFromForm } from "@/lib/ingest-form";

// unpdf and Buffer need Node, not Edge.
export const runtime = "nodejs";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Rewrites the evidence base, so it is gated by the shared key (fail closed),
 * before anything is read. The portfolio UI does not call this route: it goes
 * through the `uploadPackage` Server Action, which holds no key because it runs
 * the same code in-process. This route is for scripts and server-side callers.
 */
export async function POST(req: Request) {
  const denied = requireToolKey(req);
  if (denied) return denied;

  // Rejected before the body is read, so an oversized or mistyped upload never gets parsed.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return fail("Send the document as multipart/form-data.", 415);
  }
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BYTES + 64 * 1024) {
    return fail(`The upload is larger than ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return fail("The upload could not be read as a form.", 400);
  const { status, body } = await ingestFromForm(form);
  return NextResponse.json(body, { status });
}
