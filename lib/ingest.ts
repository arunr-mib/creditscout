import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkBySection } from "./chunk.ts";
import { embed } from "./embed.ts";
import { DocumentError, extractText } from "./pdf.ts";

export const MAX_BYTES = 10 * 1024 * 1024;

/** The schema's `documents.doc_type` check constraint (supabase/migrations/0001). */
export const DOC_TYPES = [
  "agreement",
  "amendment",
  "waiver",
  "compliance_certificate",
  "financials",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IngestInput {
  facilityId: string;
  docType: string;
  title: string;
  effectiveDate?: string | null;
  bytes: Buffer | Uint8Array;
  filename: string;
  /**
   * A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so a
   * plain-Node caller (data/ingest-demo.mjs) can pass its own and never import
   * the server-only module.
   */
  client?: SupabaseClient;
}

export interface IngestResult {
  document_id: string;
  chunks_created: number;
  reused_document: boolean;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function defaultClient(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("./supabase/server.ts");
  return supabaseAdmin();
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const { facilityId, docType, title, effectiveDate, bytes, filename } = input;

  // 1. Validate. Everything here is the uploader's to fix, so it is a DocumentError.
  if (!bytes || bytes.length === 0) throw new DocumentError(`${filename} is empty.`, 400);
  if (bytes.length > MAX_BYTES) {
    throw new DocumentError(`${filename} is larger than ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }
  if (!UUID.test(facilityId)) throw new DocumentError("facility_id must be a UUID.", 400);
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    throw new DocumentError(`doc_type must be one of: ${DOC_TYPES.join(", ")}.`, 400);
  }
  if (!title.trim()) throw new DocumentError("title must not be empty.", 400);
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new DocumentError("effective_date must be YYYY-MM-DD.", 400);
  }

  const client = input.client ?? (await defaultClient());

  const facility = check(
    await client.from("facilities").select("id").eq("id", facilityId).maybeSingle(),
    "select facilities",
  );
  if (!facility) throw new DocumentError(`No facility with id ${facilityId}.`, 404);

  // Read-only lookup: reuse the row the seed (or an earlier upload) created.
  const existing = check(
    await client
      .from("documents")
      .select("id")
      .eq("facility_id", facilityId)
      .eq("doc_type", docType)
      .eq("title", title)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    "select documents",
  );
  const documentId: string = existing?.id ?? crypto.randomUUID();

  // 2-3. Everything fallible happens BEFORE the first write. Postgres has no
  // transaction across these calls from the JS client, so the order is the
  // transaction: a parse or embedding failure throws here, when nothing has
  // been written, and cannot leave an orphan `documents` row. The document id
  // is chosen up front (existing, or a fresh uuid) so chunk metadata can carry
  // it without inserting the row first.
  const text = await extractText(bytes, filename);
  const chunks = chunkBySection(text, {
    facility_id: facilityId,
    document_id: documentId,
    doc_type: docType,
    doc_title: title,
  });
  if (chunks.length === 0) throw new DocumentError(`${filename} contains no text.`);
  const vectors = await embed(chunks.map((c) => c.content));

  // 4. Write.
  if (!existing) {
    check(
      await client.from("documents").insert({
        id: documentId,
        facility_id: facilityId,
        doc_type: docType,
        title,
        effective_date: effectiveDate || null,
        source: "upload",
      }),
      "insert documents",
    );
  }

  const rows = chunks.map((c, i) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    content: c.content,
    embedding: vectors[i],
    metadata: c.metadata,
  }));

  // Ruling 2: a re-ingest REPLACES the document's chunks. New rows go in first
  // and the old ones are deleted second, so a failed insert leaves the previous
  // chunks searchable instead of a document with none. The end state is the
  // same: only this run's chunks remain, so a re-run never accumulates.
  check(await client.from("doc_chunks").insert(rows), "insert doc_chunks");
  check(
    await client
      .from("doc_chunks")
      .delete()
      .eq("document_id", documentId)
      .not("id", "in", `(${rows.map((r) => r.id).join(",")})`),
    "delete replaced doc_chunks",
  );

  return { document_id: documentId, chunks_created: rows.length, reused_document: Boolean(existing) };
}
