import Link from "next/link";
import { boardingState, type BoardingState } from "@/components/portfolioModel";
import { anonReader } from "@/lib/supabase/anon";
import { NOT_BOARDED_TOOLTIP, TERMS_INCLUDED, TERMS_PENDING, longDate } from "@/lib/terms-labels";

export const dynamic = "force-dynamic";

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

interface FacilityRow { id: string; borrower_name: string }
interface DocRow { id: string; facility_id: string; doc_type: string; title: string; effective_date: string | null }
interface TermsRow { facility_id: string; terms: unknown; status: string }

const DOC_TYPE_LABEL: Record<string, string> = {
  agreement: "Agreement",
  amendment: "Amendment",
  compliance_certificate: "Compliance certificate",
  financials: "Financials",
  waiver: "Waiver",
};

/**
 * The document library (audit 3.2 / §2). Every document on file, led by the ones
 * that need a human: an amendment on file that the approved terms do not yet
 * carry is a "Terms review required" — the covenant-boarding lag the agent is
 * built to catch, surfaced as an action rather than buried in a borrower card.
 */
export default async function DocumentsPage() {
  const db = anonReader();
  const [facilitiesRes, documentsRes, termsRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name").order("borrower_name"),
    db.from("documents").select("id, facility_id, doc_type, title, effective_date").order("effective_date", { ascending: false }),
    db.from("covenant_terms").select("facility_id, terms, status").eq("status", "approved"),
  ]);

  const facilities = (must(facilitiesRes, "facilities") ?? []) as FacilityRow[];
  const documents = (must(documentsRes, "documents") ?? []) as DocRow[];
  const terms = (must(termsRes, "covenant_terms") ?? []) as TermsRow[];
  const nameOf = new Map(facilities.map((f) => [f.id, f.borrower_name]));
  const approvedFor = (fid: string) => terms.find((t) => t.facility_id === fid) ?? null;

  const rows = documents.map((d) => ({
    ...d,
    borrower: nameOf.get(d.facility_id) ?? "Unknown",
    boarding: boardingState({ doc_type: d.doc_type, title: d.title, effective_date: d.effective_date }, approvedFor(d.facility_id) as never) as BoardingState,
  }));
  const needsReview = rows.filter((r) => r.boarding === "not_boarded");

  return (
    <div className="space-y-12">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Loan documentation</p>
        <h1 className="text-title text-text">Documents</h1>
        <p className="pt-1 text-body text-text-secondary">
          Access borrower documents and identify amendments that need to be reflected in approved covenant terms.
        </p>
      </header>

      {needsReview.length > 0 && (
        <section aria-label="Amendments requiring review" className="space-y-3">
          <h2 className="text-section text-text">Amendments requiring review</h2>
          <p className="max-w-prose text-body text-text-secondary">
            These amendments are on file but are not included in approved terms. Review their impact before updating
            the covenant.
          </p>
          <ul className="space-y-2">
            {needsReview.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border border-l-2 border-l-code bg-surface px-4 py-3">
                <div>
                  <p className="text-card text-text">{r.title}</p>
                  <p className="text-label text-text-muted">
                    {r.borrower} · Effective {longDate(r.effective_date)} ·{" "}
                    <span className="text-code-bright" title={NOT_BOARDED_TOOLTIP}>
                      {TERMS_PENDING}
                    </span>
                  </p>
                </div>
                <Link href={`/facilities/${r.facility_id}/covenant-setup`} className="rounded-md border border-border-strong bg-human px-3 py-1 text-body font-medium leading-5 text-bg hover:bg-text">
                  Review terms
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Document library" className="space-y-3">
        <h2 className="text-section text-text">Document library</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-label uppercase tracking-wide text-text-muted">Document</th>
                <th className="px-4 py-2 text-label uppercase tracking-wide text-text-muted">Borrower</th>
                <th className="px-4 py-2 text-label uppercase tracking-wide text-text-muted">Document type</th>
                <th className="px-4 py-2 text-label uppercase tracking-wide text-text-muted">Effective date</th>
                <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Covenant terms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-12 border-b border-border last:border-b-0 hover:bg-surface-raised">
                  <td className="px-4 align-middle text-body text-text">{r.title}</td>
                  <td className="px-4 align-middle text-body text-text-secondary">{r.borrower}</td>
                  <td className="px-4 align-middle text-label text-text-muted">{DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type}</td>
                  <td className="px-4 align-middle font-mono text-num tabular-nums text-text-secondary">{r.effective_date ?? "—"}</td>
                  <td className="px-4 py-2 text-right align-middle">
                    {r.boarding === "not_boarded" ? (
                      <span className="rounded-sm bg-code-bg px-2 py-px text-badge text-code-bright" title={NOT_BOARDED_TOOLTIP}>
                        {TERMS_PENDING}
                      </span>
                    ) : r.boarding === "boarded" ? (
                      <span className="text-label text-text-secondary">{TERMS_INCLUDED}</span>
                    ) : (
                      /* Not an amendment, so it can never board terms. `—` is
                         this project's mark for "no value exists", never 0. */
                      <span className="text-label text-text-muted" title="Only amendments can change approved covenant terms.">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
