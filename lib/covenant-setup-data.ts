import type { DocumentRow, HistoryRow, Proposal } from "@/components/CovenantSetup";
import { amendmentDocs, type Citation, type Clause, type Terms, type Warning } from "@/components/termsReview";
import type { anonReader } from "@/lib/supabase/anon";
import { demoUser } from "@/lib/auth/gate";
import { checkTermsProvenance, loadAmendmentTitles, loadSourceChunks, termsWarnings, type TermsRow } from "@/lib/terms";

type AnonReader = ReturnType<typeof anonReader>;

export interface CovenantSetupProps {
  facility: { id: string; borrower_name: string };
  documents: DocumentRow[];
  history: HistoryRow[];
  clauses: Clause[];
  initial: Proposal | null;
  /** The terms in force, so the screen can show what a proposal CHANGES. Null before a first approval. */
  approved: { version: number; terms: Terms } | null;
  /** The signed-in analyst, offered as the approver name. Never recorded without the analyst choosing it. */
  signedInAs: string | null;
}

/** Everything the covenant-setup screen draws. Null when the loan does not exist. */
export async function loadCovenantSetupProps(db: AnonReader, id: string): Promise<CovenantSetupProps | null> {
  const facility = await db.from("facilities").select("id, borrower_name").eq("id", id).maybeSingle();
  if (facility.error) throw new Error(`select facilities: ${facility.error.message}`);
  if (!facility.data) return null;

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

  // The version in force: what a proposal is a change TO.
  const governing = [...rows].reverse().find((r) => r.status === "approved") ?? null;

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

  return {
    facility: facility.data,
    documents: (docs.data ?? []) as DocumentRow[],
    history,
    clauses: chunks,
    initial,
    approved: governing ? { version: governing.version, terms: governing.terms as Terms } : null,
    signedInAs: demoUser().name,
  };
}
