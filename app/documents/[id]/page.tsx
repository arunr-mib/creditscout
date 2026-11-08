import Link from "next/link";
import { notFound } from "next/navigation";

import { anonReader } from "@/lib/supabase/anon";
import { dateLabel, longDate } from "@/lib/terms-labels";

export const dynamic = "force-dynamic";

/**
 * A document, as CreditScout holds it.
 *
 * THE ORIGINAL FILE IS NOT STORED. Ingest extracts the text, splits it by
 * section, embeds each piece and keeps those; the upload itself is discarded.
 * So there is nothing to download, and this page does not pretend otherwise —
 * it says what it is showing.
 *
 * For an audit product that is arguably the more useful artefact anyway: these
 * sections are EXACTLY what the agent read and what every citation resolves to.
 * A PDF viewer would show a document that may differ from the indexed text; a
 * claim citing "CA §7.11" is checked against the section below, not the file.
 */
interface ChunkRow {
  content: string;
  metadata: { heading?: unknown; section?: unknown; chunk_index?: unknown } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = anonReader();

  const doc = (
    await db.from("documents").select("id, facility_id, doc_type, title, effective_date").eq("id", id).maybeSingle()
  ).data as { id: string; facility_id: string; doc_type: string; title: string; effective_date: string | null } | null;
  if (!doc) notFound();

  const facility = (
    await db.from("facilities").select("borrower_name").eq("id", doc.facility_id).maybeSingle()
  ).data as { borrower_name: string } | null;

  const chunks = ((await db.from("doc_chunks").select("content, metadata").eq("document_id", id)).data ??
    []) as ChunkRow[];

  // `chunk_index` is written at ingest. Documents indexed before it exists sort
  // last, in whatever order they come back — stated rather than disguised.
  const ordered = [...chunks].sort((a, b) => {
    const ai = typeof a.metadata?.chunk_index === "number" ? a.metadata.chunk_index : Number.MAX_SAFE_INTEGER;
    const bi = typeof b.metadata?.chunk_index === "number" ? b.metadata.chunk_index : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const unordered = ordered.some((c) => typeof c.metadata?.chunk_index !== "number");

  return (
    <article className="max-w-4xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-label text-text-muted">
        <Link href="/documents" className="underline-offset-2 hover:text-text hover:underline">
          Documents
        </Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span className="text-text-secondary">{doc.title}</span>
      </nav>

      <header className="space-y-1">
        <h1 className="font-brand text-title text-text">{doc.title}</h1>
        <p className="text-body text-text-secondary">
          {facility?.borrower_name ?? "Unknown borrower"}
          {doc.effective_date ? ` · ${dateLabel(doc.doc_type)} ${longDate(doc.effective_date)}` : ""}
        </p>
      </header>

      <p className="max-w-prose rounded-xl border border-border bg-surface-raised px-4 py-3 text-body text-text-secondary">
        These are the indexed sections — the text CreditScout read and the text every citation resolves to. The
        uploaded file itself is not retained.
        {unordered && " Some sections were indexed before document order was recorded and may appear out of sequence."}
      </p>

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-body text-text-muted shadow-card">
          No indexed sections for this document.
        </p>
      ) : (
        <ol className="space-y-3">
          {ordered.map((c, i) => {
            const section = str(c.metadata?.section);
            const heading = str(c.metadata?.heading);
            return (
              <li
                key={i}
                id={section ? `section-${section.replace(/\s+/g, "-")}` : undefined}
                className="scroll-mt-6 rounded-xl border border-border bg-surface p-4 shadow-card"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-card text-text">{heading ?? section ?? `Section ${i + 1}`}</h2>
                  {section && <span className="font-mono text-label text-text-muted">{section}</span>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-body text-text-secondary">{c.content}</p>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
