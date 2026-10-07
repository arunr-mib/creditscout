import Link from "next/link";
import { boardingState } from "@/components/portfolioModel";
import { anonReader } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

interface FacilityRow { id: string; borrower_name: string; industry: string | null }
interface TermsRow { facility_id: string; version: number; status: string; effective_from: string; terms: unknown }
interface DocRow { facility_id: string; doc_type: string; title: string; effective_date: string | null }

const STATUS_LABEL: Record<string, string> = { approved: "Approved", proposed: "Proposed", superseded: "Superseded" };

/**
 * Covenant terms, maker-checker (audit 3.6 / §2). Terms are versioned and
 * effective-dated; only an approved version governs a test, and a new amendment
 * proposes a version rather than overwriting history. An amendment on file that
 * the approved version does not carry is the boarding lag — surfaced here as
 * "review required", linking to the setup screen where the analyst approves.
 */
export default async function TermsPage() {
  const db = anonReader();
  const [facilitiesRes, termsRes, documentsRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name, industry").order("borrower_name"),
    db.from("covenant_terms").select("facility_id, version, status, effective_from, terms").order("version", { ascending: false }),
    db.from("documents").select("facility_id, doc_type, title, effective_date"),
  ]);

  const facilities = (must(facilitiesRes, "facilities") ?? []) as FacilityRow[];
  const allTerms = (must(termsRes, "covenant_terms") ?? []) as TermsRow[];
  const documents = (must(documentsRes, "documents") ?? []) as DocRow[];

  return (
    <div className="space-y-12">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Covenant definitions</p>
        <h1 className="text-title text-text">Terms</h1>
        <p className="pt-1 text-body text-text-secondary">
          The agent proposes covenant rules from the documents; an analyst approves them. Versions are immutable and
          effective-dated, so a past test keeps the terms it was computed on.
        </p>
      </header>

      <div className="space-y-4">
        {facilities.map((f) => {
          const versions = allTerms.filter((t) => t.facility_id === f.id);
          const approved = versions.find((t) => t.status === "approved") ?? null;
          const unboarded = documents.filter(
            (d) => d.facility_id === f.id && boardingState({ doc_type: d.doc_type, title: d.title, effective_date: d.effective_date }, (approved as never) ?? null) === "not_boarded",
          );

          return (
            <article key={f.id} className="overflow-hidden rounded-lg border border-border-strong bg-surface">
              <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4">
                <h2 className="text-card text-text">
                  {f.borrower_name}
                  {approved && <span className="ml-2 font-mono text-label font-normal text-text-muted">Approved v{approved.version}</span>}
                </h2>
                <Link href={`/facilities/${f.id}/covenant-setup`} className="rounded-md border border-border-strong px-3 py-1 text-body text-text hover:bg-surface-raised">
                  Open terms setup
                </Link>
              </header>

              <div className="space-y-4 p-5">
                {unboarded.length > 0 && (
                  <div role="note" className="rounded-md border border-code border-l-4 bg-code-bg p-3">
                    <p className="text-body text-code-bright">
                      <span aria-hidden="true">⟡ </span>Terms review required
                    </p>
                    <p className="mt-1 text-label text-text-secondary">
                      {unboarded.map((d) => d.title).join(", ")} {unboarded.length === 1 ? "is" : "are"} on file but not
                      reflected in the approved terms. Tests still use v{approved?.version ?? "1"} until an analyst boards it.
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-label uppercase tracking-wide text-text-muted">Version history</h3>
                  {versions.length === 0 ? (
                    <p className="text-body text-text-muted">No terms boarded yet. Open setup to propose and approve v1.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {versions.map((v) => (
                        <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                          <span className="font-mono text-num text-text">v{v.version}</span>
                          <span className="text-label text-text-secondary">{STATUS_LABEL[v.status] ?? v.status}</span>
                          <span className="font-mono text-label text-text-muted">effective {v.effective_from}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
