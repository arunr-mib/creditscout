import { TermsList, type TermsCard } from "@/components/TermsList";
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

/**
 * Covenant terms, maker-checker (audit 3.6 / §2). Terms are versioned and
 * effective-dated; only an approved version governs a test, and a new amendment
 * proposes a version rather than overwriting history. An amendment on file that
 * the approved version does not carry is the boarding lag — surfaced per loan
 * as an update pending, linking to the setup screen where an analyst approves.
 *
 * Every covenant judgement is made here, on the server, and handed to the view
 * as plain data. `TermsList` is a client component only so its loan filter can
 * hold state; it derives nothing.
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

  const cards: TermsCard[] = facilities.map((f) => {
    const versions = allTerms.filter((t) => t.facility_id === f.id);
    const approved = versions.find((t) => t.status === "approved") ?? null;
    const unboarded = documents.filter(
      (d) =>
        d.facility_id === f.id &&
        boardingState({ doc_type: d.doc_type, title: d.title, effective_date: d.effective_date }, (approved as never) ?? null) ===
          "not_boarded",
    );
    return {
      facilityId: f.id,
      borrower: f.borrower_name,
      approvedVersion: approved?.version ?? null,
      unboarded: unboarded.map((d) => d.title),
      versions: versions.map((v) => ({ version: v.version, status: v.status, effectiveFrom: v.effective_from })),
    };
  });

  return (
    <div className="space-y-8">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Covenant management</p>
        <h1 className="text-title text-text">Covenant terms</h1>
        <p className="pt-1 text-body text-text-secondary">
          Review covenant definitions, approve updates, and track the terms used for each reporting period.
        </p>
      </header>

      <TermsList cards={cards} />
    </div>
  );
}
