"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { createLoan } from "@/app/actions";
import { UploadPackage } from "./UploadPackage";

export function NewBorrowerForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  /**
   * The borrower, once created. A document cannot be stored before the record
   * it hangs off exists, so creation stays the first action — but it no longer
   * costs a NAVIGATION. The upload area appears in place, on the same screen,
   * which is what "one step" has to mean for it to be worth collapsing.
   */
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createLoan({ borrower_name: name, industry });
      if (!r.ok) { setError(r.error); return; }
      setCreated({ id: r.id, name: name.trim() });
    });
  };

  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text outline-none focus:border-model";
  if (created) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2">
          <p className="text-body text-text">
            <span className="text-text-muted">Borrower created · </span>
            {created.name}
          </p>
          <Link
            href={`/borrowers/${created.id}/onboarding?step=documents`}
            className="text-label text-model underline-offset-2 hover:underline"
          >
            Open the full onboarding view ›
          </Link>
        </div>

        <UploadPackage facilities={[{ id: created.id, borrower_name: created.name }]} fixedFacilityId={created.id} />

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/borrowers/${created.id}/onboarding?step=terms`}
            className="rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg transition-colors duration-fast hover:bg-model-bright"
          >
            Prepare covenant terms
          </Link>
          {/* Leaving now loses nothing: the borrower and every uploaded document
              are already stored. Onboarding resumes from whatever is on file. */}
          <Link
            href={`/borrowers/${created.id}/onboarding?step=documents`}
            className="text-label text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Save and continue later
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h2 className="text-card text-text">Borrower details</h2>
        <p className="mt-1 text-body text-text-secondary">The name identifies the loan everywhere in CreditScout. Industry is optional.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="text-label text-text-muted">Borrower name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={field} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-label text-text-muted">Industry (optional)</span>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={field} />
        </label>
      </div>
      {error && <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-body text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="self-start rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg transition-colors duration-fast ease-out hover:bg-model-bright disabled:opacity-40">
        {pending ? "Creating…" : "Create borrower and continue"}
      </button>
    </form>
  );
}
