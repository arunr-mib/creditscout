import Link from "next/link";
import { notFound } from "next/navigation";
import { CovenantSetup } from "@/components/CovenantSetup";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { UploadPackage } from "@/components/UploadPackage";
import { readiness } from "@/components/uploadModel";
import { loadCovenantSetupProps } from "@/lib/covenant-setup-data";
import { onboardingStep } from "@/lib/onboarding";
import { anonReader } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Analyst-facing names for the stored doc_type values. */
const DOC_TYPE_LABEL: Record<string, string> = {
  agreement: "Agreement",
  amendment: "Amendment",
  financials: "Financials",
  compliance_certificate: "Compliance certificate",
  waiver: "Waiver",
};

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: requested } = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = anonReader();
  const facility = await db.from("facilities").select("id, borrower_name").eq("id", id).maybeSingle();
  if (facility.error) throw new Error(`select facilities: ${facility.error.message}`);
  if (!facility.data) notFound();

  const [docs, terms] = await Promise.all([
    db.from("documents").select("doc_type, title").eq("facility_id", id).order("created_at"),
    db.from("covenant_terms").select("status").eq("facility_id", id),
  ]);
  const derived = onboardingStep({ documents: docs.data ?? [], terms: terms.data ?? [] });
  const uploaded = (docs.data ?? []) as { doc_type: string | null; title: string }[];
  // The same two-state readiness the uploader uses, over what is actually filed.
  const ready = readiness(uploaded.map((d) => ({ docType: d.doc_type ?? "" })));
  const step =
    derived === "done" ? "done"
    : requested === "documents" ? "documents"
    : requested === "terms" && derived !== "documents" ? "terms"
    : derived; // done wins; ?step=documents stays put; terms never jumps ahead of the agreement gate

  if (step === "terms" || step === "done") {
    const props = await loadCovenantSetupProps(db, id);
    if (!props) notFound();
    return (
      <div className="space-y-8">
        <OnboardingStepper current={step === "done" ? "done" : "terms"} />
        <Link href={`/borrowers/${id}/onboarding?step=documents`} className="text-label text-text-muted underline-offset-2 hover:underline">← Upload more documents</Link>
        <header className="space-y-1">
          <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
          <h1 className="text-title text-text">Covenant terms</h1>
          <p className="max-w-prose text-body text-text-secondary">The CreditScout Agent reads the loan agreement you uploaded and proposes the covenant terms, each tied to the clause it came from. Review and approve to finish onboarding.</p>
        </header>
        <CovenantSetup {...props} />
        {step === "done" && (
          <Link href="/" className="inline-flex rounded-md border border-border-strong px-4 py-2 text-body text-text transition-colors hover:border-model">View it in the portfolio</Link>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[900px] space-y-6">
      <OnboardingStepper current="documents" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
        <h1 className="text-title text-text">Add a borrower</h1>
        <p className="max-w-prose text-body text-text-secondary">
          Upload the loan agreement and relevant amendments to prepare covenant terms. Add financial statements and the
          compliance certificate for covenant testing.
        </p>
      </header>
      <UploadPackage facilities={[{ id: facility.data.id, borrower_name: facility.data.borrower_name }]} fixedFacilityId={facility.data.id} />

      {/* What actually landed. Without this the screen could insist "upload the
          loan agreement" at an analyst who had just uploaded one — filed under
          the wrong document type, with nothing on screen to show it. */}
      {uploaded.length > 0 && (
        <section aria-label="Documents on file" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-card text-text">On file for this loan</h2>
            {/* TWO readiness states, not one. A borrower reaches the first with
                an agreement alone; testing also needs the period's financials,
                and conflating them told analysts to wait for documents they did
                not yet need. */}
            <p className="text-label text-text-muted">
              <span className={ready.termsReview ? "text-text" : undefined}>
                {ready.termsReview ? "✓ " : "· "}Ready to review terms
              </span>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              <span className={ready.covenantTests ? "text-text" : undefined}>
                {ready.covenantTests ? "✓ " : "· "}Ready to run covenant tests
              </span>
            </p>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {uploaded.map((d, i) => (
              <li key={`${d.title}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-body text-text">{d.title}</span>
                <span className={`text-label ${d.doc_type === "agreement" ? "text-model-bright" : "text-text-muted"}`}>
                  {DOC_TYPE_LABEL[d.doc_type ?? ""] ?? d.doc_type}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/borrowers/${id}/onboarding?step=terms`} aria-disabled={derived === "documents"} className={`rounded-md border px-4 py-2 text-body font-medium leading-5 transition duration-fast ${derived === "documents" ? "pointer-events-none border-border text-text-muted opacity-40" : "border-model bg-model text-bg hover:bg-model-bright"}`}>
          Continue to terms review
        </Link>
        {derived === "documents" && (
          <span className="max-w-prose text-label text-text-muted">
            {uploaded.length === 0
              ? "Upload the loan agreement to prepare covenant terms. Financial statements are needed for covenant testing, not for this step."
              : `None of the ${uploaded.length} document${uploaded.length === 1 ? "" : "s"} on file is filed as a loan agreement. Set its document type to “Agreement” and upload it again — the agreement is what the terms are extracted from.`}
          </span>
        )}
      </div>
    </div>
  );
}
