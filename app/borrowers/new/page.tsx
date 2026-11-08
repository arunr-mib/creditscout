import { OnboardingStepper } from "@/components/OnboardingStepper";
import { NewBorrowerForm } from "@/components/NewBorrowerForm";

export const dynamic = "force-dynamic";

export default function NewBorrowerPage() {
  return (
    <div className="max-w-[720px] space-y-6">
      <OnboardingStepper current="borrower" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">Onboard a loan</p>
        <h1 className="text-title text-text">Add a borrower</h1>
        <p className="max-w-prose text-body text-text-secondary">
          Enter borrower details and upload the loan agreement and relevant amendments. CreditScout will prepare
          covenant terms for your review.
        </p>
      </header>

      {/* Borrower details and documents are ONE step. Two fields did not warrant
          a screen of their own, and splitting them made onboarding feel like
          paperwork before the work. The upload area appears here as soon as the
          borrower exists — the record has to exist before a document can hang
          off it, so creation stays the first action rather than a separate page. */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <NewBorrowerForm />
      </section>
    </div>
  );
}
