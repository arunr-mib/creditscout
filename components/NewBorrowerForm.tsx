"use client";

import { useState } from "react";
import Link from "next/link";
import { createLoan } from "@/app/actions";
import { UploadPackage } from "./UploadPackage";

/**
 * Borrower details AND documents, on one screen (step 1 is called "Borrower &
 * documents", and now is).
 *
 * WHAT THIS FIXES: the upload area only appeared AFTER the borrower was
 * created, because a document cannot be stored before the record it hangs off
 * exists. That is a storage order, not an order an analyst should have to
 * follow — and it made a one-step screen behave like two, with the stepper
 * promising documents that were not on it.
 *
 * The files are staged and classified here, beside the name. Creation happens
 * in the same gesture that uploads them: `resolveFacility` is called once, by
 * the uploader, immediately before the first file is sent. Nothing is stored
 * until the analyst presses the one primary button on the screen — so an
 * abandoned form leaves no empty borrower behind.
 */
export function NewBorrowerForm() {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const field =
    "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text outline-none focus:border-text";

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-card text-text">Borrower details</h2>
        <p className="mt-1 text-body text-text-secondary">
          The name identifies the loan everywhere in CreditScout. Industry is optional.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-label text-text-muted">Borrower name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={created !== null}
              autoFocus
              className={field}
            />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-label text-text-muted">Industry (optional)</span>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              disabled={created !== null}
              className={field}
            />
          </label>
        </div>
      </section>

      {/* The uploader carries the screen's one primary action. It creates the
          borrower on first use and then stores each file against it. */}
      <UploadPackage
        facilities={[]}
        resolveFacility={async () => {
          if (created) return { id: created };
          const r = await createLoan({ borrower_name: name, industry });
          if (!r.ok) return { error: r.error };
          setCreated(r.id);
          return { id: r.id };
        }}
        borrowerReady={name.trim() !== ""}
        borrowerBlocker="Enter a borrower name."
        submitLabel={(n) =>
          created
            ? n === 0
              ? "All documents uploaded"
              : `Upload ${n} document${n === 1 ? "" : "s"}`
            : n === 0
              ? "Create borrower and continue"
              : `Create borrower and upload ${n} document${n === 1 ? "" : "s"}`
        }
        onUploaded={(id) => setCreated(id)}
      />

      {created && (
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
          <Link
            href={`/borrowers/${created}/onboarding?step=terms`}
            className="rounded-md border border-mint bg-mint px-4 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast hover:bg-mint-hover"
          >
            Continue to terms review
          </Link>
          {/* Leaving now loses nothing: the borrower and every uploaded document
              are already stored. Onboarding resumes from whatever is on file. */}
          <Link
            href={`/borrowers/${created}/onboarding?step=documents`}
            className="text-label text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Save and continue later
          </Link>
        </div>
      )}
    </div>
  );
}
