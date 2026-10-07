import { ingestDocument, type IngestInput } from "./ingest.ts";
import { DocumentError } from "./pdf.ts";

/**
 * The upload form -> `ingestDocument`, shared by the gated `POST /api/ingest`
 * route and the portfolio Server Action, so both validate identically and
 * neither can drift. Returns `{status, body}`; it never throws a DocumentError.
 */
export interface FormResult {
  status: number;
  body: Record<string, unknown>;
}

/** "harbor-q2_agreement.pdf" -> "Harbor Q2 Agreement" */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

const fail = (error: string, status: number): FormResult => ({ status, body: { error } });

export async function ingestFromForm(
  form: FormData,
  deps: { ingest?: (i: IngestInput) => ReturnType<typeof ingestDocument> } = {},
): Promise<FormResult> {
  try {
    const file = form.get("file");
    if (!(file instanceof File)) return fail("A file field is required.", 400);
    const result = await (deps.ingest ?? ingestDocument)({
      facilityId: field(form, "facility_id"),
      docType: field(form, "doc_type"),
      title: field(form, "title") || titleFromFilename(file.name),
      effectiveDate: field(form, "effective_date") || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
    });
    return { status: 200, body: { document_id: result.document_id, chunks_created: result.chunks_created } };
  } catch (err) {
    if (err instanceof DocumentError) return fail(err.message, err.status);
    console.error("ingest failed", err);
    return fail("Ingest failed. Try again; if it keeps failing, check the server log.", 500);
  }
}
