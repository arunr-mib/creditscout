import { NextResponse } from "next/server";
import { MAX_BYTES, ingestDocument } from "@/lib/ingest";
import { DocumentError } from "@/lib/pdf";

// unpdf and Buffer need Node, not Edge.
export const runtime = "nodejs";

/** "harbor-q2_agreement.pdf" -> "Harbor Q2 Agreement" */
function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

export async function POST(req: Request) {
  // Rejected before the body is read, so an oversized or mistyped upload never gets parsed.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return fail("Send the document as multipart/form-data.", 415);
  }
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BYTES + 64 * 1024) {
    return fail(`The upload is larger than ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }

  try {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("The upload could not be read as a form.", 400);
    const file = form.get("file");
    if (!(file instanceof File)) return fail("A file field is required.", 400);

    const result = await ingestDocument({
      facilityId: field(form, "facility_id"),
      docType: field(form, "doc_type"),
      title: field(form, "title") || titleFromFilename(file.name),
      effectiveDate: field(form, "effective_date") || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
    });
    return NextResponse.json({
      document_id: result.document_id,
      chunks_created: result.chunks_created,
    });
  } catch (err) {
    if (err instanceof DocumentError) return fail(err.message, err.status);
    console.error("ingest failed", err);
    return fail("Ingest failed. Try again; if it keeps failing, check the server log.", 500);
  }
}
