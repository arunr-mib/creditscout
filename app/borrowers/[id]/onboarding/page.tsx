import Link from "next/link";
import { notFound } from "next/navigation";
import { CovenantSetup } from "@/components/CovenantSetup";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { UploadPackage } from "@/components/UploadPackage";
import { loadCovenantSetupProps } from "@/lib/covenant-setup-data";
import { onboardingStep } from "@/lib/onboarding";
import { anonReader } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: requested } = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = anonReader();
  const facility = await db.from("facilities").select("id, borrower_name").eq("id", id).maybeSingle();
  if (facility.error) throw new Error(`select facilities: ${facility.error.message}`);
  if (!facility.data) notFound();

  const [docs, terms] = await Promise.all([
    db.from("documents").select("doc_type").eq("facility_id", id),
    db.from("covenant_terms").select("status").eq("facility_id", id),
  ]);
  const derived = onboardingStep({ documents: docs.data ?? [], terms: terms.data ?? [] });
  const step = requested === "terms" && derived !== "documents" ? "terms" : derived; // never jump ahead of the agreement gate

  if (step === "terms" || step === "done") {
    const props = await loadCovenantSetupProps(db, id);
    if (!props) notFound();
    return (
      <div className="space-y-8">
        <OnboardingStepper current={step === "done" ? "done" : "terms"} />
        <header className="space-y-1">
          <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
          <h1 className="text-title text-text">Covenant terms</h1>
          <p className="max-w-prose text-body text-text-secondary">The Credit-scout Agent reads the loan agreement you uploaded and proposes the covenant terms, each tied to the clause it came from. Review and approve to finish onboarding.</p>
        </header>
        <CovenantSetup {...props} />
        {step === "done" && (
          <Link href="/" className="inline-flex rounded-md border border-border-strong px-4 py-2 text-body text-text transition-colors hover:border-model">View it in the portfolio</Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper current="documents" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
        <h1 className="text-title text-text">Upload documents</h1>
        <p className="max-w-prose text-body text-text-secondary">Upload the loan agreement (required), any amendments, the quarter&rsquo;s financials, and the compliance certificate. The agreement is what the Credit-scout Agent reads to extract the covenant terms.</p>
      </header>
      <UploadPackage facilities={[{ id: facility.data.id, borrower_name: facility.data.borrower_name }]} fixedFacilityId={facility.data.id} />
      <div className="flex items-center gap-3">
        <Link href={`/borrowers/${id}/onboarding?step=terms`} aria-disabled={derived === "documents"} className={`rounded-md border px-4 py-2 text-body font-medium leading-5 transition duration-fast ${derived === "documents" ? "pointer-events-none border-border text-text-muted opacity-40" : "border-model bg-gradient-to-b from-model-bright to-model text-bg hover:-translate-y-px active:translate-y-px"}`}>
          Continue to covenant terms
        </Link>
        {derived === "documents" && <span className="text-label text-text-muted">Upload the loan agreement to continue.</span>}
      </div>
    </div>
  );
}
