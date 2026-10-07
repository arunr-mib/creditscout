"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done"; sections: number; title: string }
  | { kind: "rejected"; reason: string };

/**
 * design.md §12.4 — the quarterly-package dropzone. It posts to the existing
 * `/api/ingest`; wiring the re-run after an upload is a later task (F9f), so
 * this does the upload and nothing more.
 *
 * The success state is a SLATE toast, never green — green means *compliant*, and
 * an indexed document is a human action, not a passing test. A rejection states
 * the reason (a scanned PDF, a wrong type) so the analyst knows what to fix.
 */
export function UploadPackage({ facilities }: { facilities: UploadFacility[] }) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [docType, setDocType] = useState("financials");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  async function upload(file: File) {
    if (!facilityId) {
      setState({ kind: "rejected", reason: "Choose a borrower before uploading." });
      return;
    }
    setState({ kind: "uploading" });
    const form = new FormData();
    form.set("file", file);
    form.set("facility_id", facilityId);
    form.set("doc_type", docType);
    if (effectiveDate) form.set("effective_date", effectiveDate);
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setState({ kind: "rejected", reason: (data && typeof data.error === "string" && data.error) || `Upload failed (${res.status}).` });
        return;
      }
      setState({ kind: "done", sections: Number(data?.chunks_created ?? 0), title: file.name });
      router.refresh();
    } catch {
      setState({ kind: "rejected", reason: "Could not reach the server. Try again." });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text";

  return (
    <section aria-labelledby={`${baseId}-title`} className="rounded-md border border-border bg-surface p-4">
      <h3 id={`${baseId}-title`} className="text-card text-text">
        Upload a quarterly package
      </h3>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-label text-text-muted">
          Borrower
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={field}>
            {facilities.length === 0 && <option value="">No facilities</option>}
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.borrower_name}
              </option>
            ))}
          </select>
        </label>
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
          Effective date (optional)
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={`${field} font-mono`} />
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
        {state.kind === "uploading" ? "Indexing…" : "Drop the quarterly package, or click to choose a file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,.txt"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />

      {state.kind === "done" && (
        <p role="status" className="mt-3 rounded-md border border-border-strong bg-surface-raised p-3 text-body text-text">
          Indexed <span className="font-mono">{state.title}</span> — {state.sections} section{state.sections === 1 ? "" : "s"} indexed.
        </p>
      )}
      {state.kind === "rejected" && (
        <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          {state.reason}
        </p>
      )}
    </section>
  );
}
