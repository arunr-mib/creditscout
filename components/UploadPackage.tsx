"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPackage } from "@/app/actions";

export interface UploadFacility {
  id: string;
  borrower_name: string;
}

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "financials", label: "Financials" },
  { value: "compliance_certificate", label: "Compliance certificate" },
  { value: "amendment", label: "Amendment" },
  { value: "agreement", label: "Agreement" },
  { value: "waiver", label: "Waiver" },
];

/** One file's outcome. A batch reports every file, so a partial failure cannot read as a success. */
type Result =
  | { name: string; ok: true; sections: number }
  | { name: string; ok: false; reason: string };

type State =
  | { kind: "idle" }
  /** `done`/`total` are counted files, not an invented percentage. */
  | { kind: "uploading"; done: number; total: number; current: string }
  | { kind: "results"; results: Result[] }
  /** Refused before anything was sent (no borrower, no effective date). */
  | { kind: "rejected"; reason: string };

/**
 * design.md §12.4 — the quarterly-package dropzone. It calls the `uploadPackage`
 * Server Action (the `/api/ingest` route is key-gated); wiring the re-run after an upload is a later task (F9f), so
 * this does the upload and nothing more.
 *
 * The success state is a SLATE toast, never green — green means *compliant*, and
 * an indexed document is a human action, not a passing test. A rejection states
 * the reason (a scanned PDF, a wrong type) so the analyst knows what to fix.
 */
export function UploadPackage({ facilities, fixedFacilityId }: { facilities: UploadFacility[]; fixedFacilityId?: string }) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState(fixedFacilityId ?? facilities[0]?.id ?? "");
  const [docType, setDocType] = useState("financials");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  // In onboarding (a pinned loan), the agreement and amendment anchor the terms'
  // effective-from, so their effective date is required — without it, extracting
  // the covenant terms fails. Financials/certificates stay optional.
  const requireEffectiveDate = fixedFacilityId != null && (docType === "agreement" || docType === "amendment");

  /** Send one file. Returns its outcome rather than setting state, so a batch can report every file. */
  async function send(file: File): Promise<Result> {
    const form = new FormData();
    form.set("file", file);
    form.set("facility_id", facilityId);
    form.set("doc_type", docType);
    if (effectiveDate) form.set("effective_date", effectiveDate);
    try {
      const { status, body: data } = await uploadPackage(form);
      if (status !== 200) {
        return { name: file.name, ok: false, reason: (data && typeof data.error === "string" && data.error) || `Upload failed (${status}).` };
      }
      return { name: file.name, ok: true, sections: Number(data?.chunks_created ?? 0) };
    } catch {
      return { name: file.name, ok: false, reason: "Could not reach the server." };
    }
  }

  /**
   * Every dropped file is indexed, one after another.
   *
   * It used to take `files[0]` and drop the rest on the floor while reporting
   * success — an analyst who dragged a quarter's package in one gesture lost
   * most of it silently. Sequential, not parallel: each upload embeds its
   * sections, and the ingest route is not the place to open N of those at once.
   *
   * Every file's outcome is reported, so a batch where one file fails cannot
   * read as a clean success.
   */
  async function upload(files: readonly File[]) {
    if (files.length === 0) return;
    if (!facilityId) {
      setState({ kind: "rejected", reason: "Choose a borrower before uploading." });
      return;
    }
    if (requireEffectiveDate && !effectiveDate) {
      setState({ kind: "rejected", reason: `Set the effective date above — it is required for the ${docType === "agreement" ? "agreement" : "amendment"} so the Credit-scout Agent can extract its terms.` });
      return;
    }
    const results: Result[] = [];
    for (const [i, file] of files.entries()) {
      setState({ kind: "uploading", done: i, total: files.length, current: file.name });
      results.push(await send(file));
    }
    setState({ kind: "results", results });
    router.refresh();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    void upload(Array.from(e.dataTransfer.files ?? []));
  }

  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text";

  return (
    <section aria-labelledby={`${baseId}-title`} className="rounded-md border border-border bg-surface p-4">
      <h3 id={`${baseId}-title`} className="text-card text-text">
        Upload a quarterly package
      </h3>

      <div className="mt-3 flex flex-wrap gap-3">
        {!fixedFacilityId && (
        <label className="flex flex-col gap-1 text-label text-text-muted">
          Borrower
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={field}>
            {facilities.length === 0 && <option value="">No loans</option>}
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.borrower_name}
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="flex flex-col gap-1 text-label text-text-muted">
          Document type
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={field}>
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label text-text-muted">
          {requireEffectiveDate ? "Effective date (required)" : "Effective date (optional)"}
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={`${field} font-mono ${requireEffectiveDate && !effectiveDate ? "border-human" : ""}`} />
        </label>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        className={`mt-3 flex w-full items-center justify-center rounded-md border border-dashed p-6 text-body transition-colors duration-fast ease-out ${
          dragover ? "border-model bg-model-bg text-text" : "border-border-strong text-text-muted"
        }`}
      >
        {state.kind === "uploading"
          ? `Indexing ${state.done + 1} of ${state.total} — ${state.current}`
          : fixedFacilityId
            ? "Drop documents (agreement, amendment, financials, or certificate), or click to choose files"
            : "Drop the quarterly package, or click to choose files"}
      </button>
      {/* One drop carries ONE document type: the selector above applies to every
          file in it. Said plainly, because silently tagging an agreement as
          financials is worse than making the analyst drop twice. */}
      <p className="mt-2 text-label text-text-muted">
        Several files at once is fine. Every file in one drop is indexed as{" "}
        <span className="text-text-secondary">{DOC_TYPES.find((d) => d.value === docType)?.label ?? docType}</span> — drop
        each document type separately.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf,.txt"
        className="sr-only"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {state.kind === "results" && <Results results={state.results} />}
      {state.kind === "rejected" && (
        <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          {state.reason}
        </p>
      )}
    </section>
  );
}

/**
 * Every file's outcome, listed. Slate, never green — green means *compliant*,
 * and an indexed document is a human action, not a passing test.
 *
 * A batch with any failure leads with the failure count: "3 indexed" on a drop
 * of four is the sentence that loses a document without anyone noticing.
 */
function Results({ results }: { results: readonly Result[] }) {
  const failed = results.filter((r) => !r.ok);
  const indexed = results.length - failed.length;
  return (
    <div
      role={failed.length > 0 ? "alert" : "status"}
      className={`mt-3 rounded-md border p-3 ${failed.length > 0 ? "border-danger bg-danger-bg" : "border-border-strong bg-surface-raised"}`}
    >
      <p className={`text-body ${failed.length > 0 ? "text-danger" : "text-text"}`}>
        {failed.length > 0
          ? `${failed.length} of ${results.length} could not be indexed. ${indexed} ${indexed === 1 ? "was" : "were"}.`
          : `Indexed ${results.length} document${results.length === 1 ? "" : "s"}.`}
      </p>
      <ul className="mt-2 space-y-1">
        {results.map((r, i) => (
          <li key={`${r.name}-${i}`} className="text-label text-text-secondary">
            <span aria-hidden="true" className={r.ok ? "text-text-muted" : "text-danger"}>{r.ok ? "· " : "✕ "}</span>
            <span className="font-mono">{r.name}</span>
            {r.ok ? ` — ${r.sections} section${r.sections === 1 ? "" : "s"} indexed` : ` — ${r.reason}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
