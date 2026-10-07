import { notFound } from "next/navigation";
import { CovenantSetup, type DocumentRow, type HistoryRow, type Proposal } from "@/components/CovenantSetup";
import { amendmentDocs, type Citation, type Terms, type Warning } from "@/components/termsReview";
import { anonReader } from "@/lib/supabase/anon";
import { checkTermsProvenance, loadAmendmentTitles, loadSourceChunks, termsWarnings, type TermsRow } from "@/lib/terms";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CovenantSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = anonReader();

  const facility = await db.from("facilities").select("id, borrower_name").eq("id", id).maybeSingle();
  if (facility.error) throw new Error(`select facilities: ${facility.error.message}`);
  if (!facility.data) notFound();

  const [docs, terms, chunks, amendmentTitles] = await Promise.all([
    db.from("documents").select("id, title, doc_type, effective_date").eq("facility_id", id).order("effective_date"),
    // `*`, not a column list: `warnings` exists only after migration 0008, and a
    // named column would turn a missing migration into an unreadable page.
    db.from("covenant_terms").select("*").eq("facility_id", id).order("version"),
    loadSourceChunks(db, id),
    loadAmendmentTitles(db, id),
  ]);
  if (docs.error) throw new Error(`select documents: ${docs.error.message}`);
  if (terms.error) throw new Error(`select covenant_terms: ${terms.error.message}`);

  const rows = (terms.data ?? []) as TermsRow[];
  const history: HistoryRow[] = rows.map((r) => ({
    version: r.version,
    status: r.status,
    effective_from: r.effective_from,
    approved_by: r.approved_by,
    approved_at: r.approved_at,
    boarded_docs: amendmentDocs(r.terms as Terms),
  }));

  // The newest proposal still waiting for a person. Approved and superseded rows are history.
  const open = [...rows].reverse().find((r) => r.status === "proposed");
  let initial: Proposal | null = null;
  if (open) {
    // Judged now, by the same functions the approve route runs, so a stored
    // proposal is shown with the refusals the server would give it today.
    const provenance = checkTermsProvenance(open.terms, open.source_citations, chunks);
    const stored = Array.isArray(open.warnings);
    const warnings = stored ? (open.warnings as Warning[]) : (termsWarnings(open.terms, open.source_citations, chunks, amendmentTitles) as Warning[]);
    initial = {
      termsId: open.id,
      version: open.version,
      effectiveFrom: open.effective_from,
      terms: open.terms as Terms,
      citations: open.source_citations as Citation[],
      violations: provenance.violations,
      warnings,
      warningsNote: stored
        ? undefined
        : "These notes were not stored with this proposal, so they were worked out when this page loaded, from the documents on file now.",
      shown: null, // what the model was shown was not stored with the proposal
      stored: true,
    };
  }

  return (
    <CovenantSetup
      facility={facility.data}
      documents={(docs.data ?? []) as DocumentRow[]}
      history={history}
      clauses={chunks}
      initial={initial}
    />
  );
}
