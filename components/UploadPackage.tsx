"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPackage } from "@/app/actions";
import {
  DATED_TYPES,
  DOC_TYPES,
  duplicateNames,
  stageFile,
  stagingBlockers,
  type StagedFile,
} from "./uploadModel";

export interface UploadFacility {
  id: string;
  borrower_name: string;
}


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
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragover, setDragover] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();


  /** Send one file WITH ITS OWN TYPE. Returns its outcome so a batch can report every file. */
  async function send(file: File, meta: StagedFile): Promise<Result> {
    const form = new FormData();
    form.set("file", file);
    form.set("facility_id", facilityId);
    form.set("doc_type", meta.docType);
    if (meta.date) form.set("effective_date", meta.date);
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

  /** Dropped files are STAGED, not sent: each one is classified before anything is stored. */
  function stage(files: readonly File[]) {
    if (files.length === 0) return;
    setState({ kind: "idle" });
    setPicked((p) => [...p, ...files]);
    setStaged((rows) => [...rows, ...files.map((f) => stageFile(f))]);
  }

  /**
   * Upload the staged batch, each file with the type the analyst confirmed.
   *
   * It used to send every file with ONE dropdown value, so a package dropped in
   * a single gesture was filed entirely as whatever that dropdown showed —
   * `financials` by default. doc_type scopes the agent's retrieval, so a
   * misfiled agreement is invisible to terms extraction.
   */
  async function upload() {
    const blockers = stagingBlockers(staged, facilityId !== "");
    if (blockers.length > 0) {
      setState({ kind: "rejected", reason: blockers[0] });
      return;
    }
    const results: Result[] = [];
    for (const [i, meta] of staged.entries()) {
      const file = picked.find((f) => f.name === meta.name && f.size === meta.size);
      if (!file) continue;
      setState({ kind: "uploading", done: i, total: staged.length, current: meta.name });
      results.push(await send(file, meta));
    }
    setState({ kind: "results", results });
    setStaged([]);
    setPicked([]);
    router.refresh();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    stage(Array.from(e.dataTransfer.files ?? []));
  }

  const field = "rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text";
  const blockers = stagingBlockers(staged, facilityId !== "");
  const dupes = duplicateNames(staged);

  return (
    <section aria-labelledby={`${baseId}-title`} className="rounded-md border border-border bg-surface p-4">
      <h3 id={`${baseId}-title`} className="text-card text-text">
        Add borrower documents
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
          : "Drop documents, or click to choose files"}
      </button>
      <p className="mt-2 text-label text-text-muted">
        Drop the loan agreement and any amendments to prepare covenant terms. Add financial statements and the
        compliance certificate for covenant testing. Each file is classified on its own below.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf,.txt"
        className="sr-only"
        onChange={(e) => {
          stage(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* ONE ROW PER FILE. The type is suggested from the name and confirmed by
          the analyst — never applied batch-wide, which is how an agreement used
          to be stored as `financials` and vanish from terms extraction. */}
      {staged.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-label text-text-muted">
              {staged.length} file{staged.length === 1 ? "" : "s"} to classify
            </h4>
            {dupes.length > 0 && (
              <p className="text-label text-code">Same name twice: {dupes.join(", ")}</p>
            )}
          </div>

          {staged.map((f) => (
            <div key={f.key} className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3">
              <span className="min-w-0 flex-1 truncate font-mono text-label text-text" title={f.name}>{f.name}</span>

              <label className="flex flex-col gap-1 text-label text-text-muted">
                Document type
                <select
                  value={f.docType}
                  onChange={(e) => setStaged((rows) => rows.map((r) => (r.key === f.key ? { ...r, docType: e.target.value, suggested: false } : r)))}
                  className={`${field} ${f.docType === "" ? "border-code" : ""}`}
                >
                  <option value="">Choose…</option>
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-label text-text-muted">
                {DATED_TYPES.includes(f.docType) ? "Effective date (required)" : "Date (optional)"}
                <input
                  type="date"
                  value={f.date}
                  onChange={(e) => setStaged((rows) => rows.map((r) => (r.key === f.key ? { ...r, date: e.target.value } : r)))}
                  className={`${field} font-mono ${DATED_TYPES.includes(f.docType) && f.date === "" ? "border-code" : ""}`}
                />
              </label>

              {f.suggested && f.docType !== "" && <span className="text-label text-text-muted">suggested</span>}

              <button
                type="button"
                onClick={() => setStaged((rows) => rows.filter((r) => r.key !== f.key))}
                className="text-label text-text-muted underline-offset-2 hover:text-text hover:underline"
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void upload()}
              disabled={state.kind === "uploading"}
              className="rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {state.kind === "uploading" ? "Indexing…" : `Upload ${staged.length} document${staged.length === 1 ? "" : "s"}`}
            </button>
            {blockers.length > 0 && <p className="text-label text-text-muted">{blockers[0]}</p>}
          </div>
        </div>
      )}

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
