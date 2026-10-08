"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLoan } from "@/app/actions";

export function NewBorrowerForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createLoan({ borrower_name: name, industry });
      if (!r.ok) { setError(r.error); return; }
      router.push(`/borrowers/${r.id}/onboarding?step=documents`);
    });
  };

  const field = "rounded-md border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none focus:border-model";
  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Borrower name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Industry (optional)</span>
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={field} />
      </label>
      {error && <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-body text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg transition-colors duration-fast ease-out hover:bg-model-bright disabled:opacity-40">
        {pending ? "Creating…" : "Create loan & continue"}
      </button>
    </form>
  );
}
