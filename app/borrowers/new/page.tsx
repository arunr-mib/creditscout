import { OnboardingStepper } from "@/components/OnboardingStepper";
import { NewBorrowerForm } from "@/components/NewBorrowerForm";

export const dynamic = "force-dynamic";

export default function NewBorrowerPage() {
  return (
    <div className="space-y-8">
      <OnboardingStepper current="borrower" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">Onboard a loan</p>
        <h1 className="text-title text-text">New borrower</h1>
        <p className="max-w-prose text-body text-text-secondary">Create the borrower and their loan. Next you&rsquo;ll upload the loan agreement and the Credit-scout Agent will extract the covenant terms from it.</p>
      </header>
      <NewBorrowerForm />
    </div>
  );
}
