/**
 * Classifying an uploaded file BEFORE it is stored.
 *
 * THE BUG THIS EXISTS TO FIX: the uploader had one document-type dropdown and
 * applied it to every file in the batch. An analyst dragging a quarter's
 * package in one gesture — agreement, amendment, financials, certificate — got
 * all four stored as whatever the dropdown happened to show, which defaulted to
 * `financials`.
 *
 * That is not a tidiness problem. `doc_type` scopes the agent's retrieval:
 * `search_documents` filters on it and `definition_agent` reads agreements and
 * amendments. A misfiled agreement is INVISIBLE to terms extraction, and
 * misfiled financials pollute the corpus the calculator cites.
 *
 * So each file is suggested a type from its name, and the analyst confirms or
 * corrects it before anything is sent. The suggestion is a convenience and is
 * never trusted: the value that uploads is the one on screen.
 */

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "agreement", label: "Agreement" },
  { value: "amendment", label: "Amendment" },
  { value: "financials", label: "Financials" },
  { value: "compliance_certificate", label: "Compliance certificate" },
  { value: "waiver", label: "Waiver" },
];

export const DOC_TYPE_VALUES: readonly string[] = DOC_TYPES.map((d) => d.value);

/** Types whose terms the agent extracts, and which therefore need an effective date. */
export const DATED_TYPES: readonly string[] = ["agreement", "amendment"];

/**
 * A type guessed from the file name.
 *
 * Order matters: "amendment" is checked before "agreement" because an amendment
 * to a credit agreement is routinely named for both, and the more specific
 * reading is the right one. Returns null rather than guessing when nothing
 * matches — an unlabelled row the analyst must set is safer than a confident
 * wrong default.
 */
export function suggestDocType(filename: string): string | null {
  const n = filename.toLowerCase();
  if (/amend/.test(n)) return "amendment";
  if (/waiver/.test(n)) return "waiver";
  if (/compliance|certificate|\bcert\b|\bcc[-_]/.test(n)) return "compliance_certificate";
  if (/financial|balance|income|statement|\bfin[-_]/.test(n)) return "financials";
  if (/agreement|\bca[-_]|loan[-_]?doc/.test(n)) return "agreement";
  return null;
}

/** An ISO date in the file name, which is how the generated packages carry a period. */
export function suggestDate(filename: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(filename);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

export interface StagedFile {
  /** Stable within a batch, so a row survives re-ordering and removal. */
  key: string;
  name: string;
  size: number;
  docType: string;
  /** Effective date for an agreement or amendment; period end for the rest. */
  date: string;
  /** True when the type was guessed rather than chosen, so the UI can say so. */
  suggested: boolean;
}

let seq = 0;
export function stageFile(file: { name: string; size: number }): StagedFile {
  const guess = suggestDocType(file.name);
  return {
    key: `${Date.now()}-${seq++}-${file.name}`,
    name: file.name,
    size: file.size,
    docType: guess ?? "",
    date: suggestDate(file.name) ?? "",
    suggested: guess !== null,
  };
}

/**
 * What still stops a batch from uploading, one sentence each.
 *
 * An agreement or amendment with no effective date cannot have its terms
 * extracted, so it is refused here rather than stored unusable.
 */
export function stagingBlockers(
  files: readonly StagedFile[],
  hasBorrower: boolean,
  /** What to say when there is no borrower yet. On the onboarding screen the
   *  borrower is being TYPED, not chosen, and "Choose a borrower" names a
   *  control that is not on that screen. */
  noBorrower = "Choose a borrower.",
): string[] {
  const out: string[] = [];
  if (!hasBorrower) out.push(noBorrower);
  if (files.length === 0) return out;
  const big = oversizeNames(files);
  if (big.length > 0) {
    out.push(
      big.length === 1
        ? `${big[0]} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB and cannot be uploaded.`
        : `${big.length} files are larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB and cannot be uploaded.`,
    );
  }
  const untyped = files.filter((f) => f.docType === "");
  if (untyped.length > 0) {
    out.push(
      untyped.length === 1
        ? `Set the document type for ${untyped[0].name}.`
        : `Set the document type for ${untyped.length} files.`,
    );
  }
  const undated = files.filter((f) => DATED_TYPES.includes(f.docType) && f.date === "");
  if (undated.length > 0) {
    out.push(
      undated.length === 1
        ? `Set the effective date for ${undated[0].name} — terms cannot be extracted without it.`
        : `Set the effective date for ${undated.length} agreements or amendments.`,
    );
  }
  return out;
}

/** Same name twice in one batch is almost always a mistake worth naming. */
export function duplicateNames(files: readonly StagedFile[]): string[] {
  const seen = new Map<string, number>();
  for (const f of files) seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}

/**
 * Whether the batch can prepare covenant terms, which is a different question
 * from whether it can be tested. A borrower reaches the first state with an
 * agreement alone; testing also needs the period's financials.
 */
export function readiness(files: readonly Pick<StagedFile, "docType">[]): {
  termsReview: boolean;
  covenantTests: boolean;
} {
  const has = (t: string) => files.some((f) => f.docType === t);
  return {
    termsReview: has("agreement") || has("amendment"),
    covenantTests: has("financials"),
  };
}

// ------------------------------------------------- what happened to each file

/**
 * Where one file has got to.
 *
 * THE DEFECT: a batch reported itself as one banner and the rows disappeared.
 * A file that failed left a sentence behind and no row, so "retry" meant
 * finding the file in Finder and dragging it in again — and a partial failure
 * in a four-file package was a line of text under a cleared list.
 *
 NO SEPARATE "PROCESSING" STATE, deliberately. The server extracts, chunks and
 * embeds after the bytes arrive, and that is the slow part — but it happens
 * inside ONE Server Action call, and the browser gets no signal at the
 * boundary. A state that switched on a timer would be a progress animation
 * dressed as a measurement, which is the one thing this product does not do.
 * The in-flight state is named for everything it covers instead.
 */
export type UploadStatus = "staged" | "uploading" | "ready" | "failed";

export const UPLOAD_STATUS_LABEL: Record<UploadStatus, string> = {
  staged: "Not uploaded",
  uploading: "Uploading and indexing",
  ready: "Ready",
  failed: "Failed",
};

/** The real limits, stated to the analyst rather than discovered on a 413. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FORMATS = "PDF or plain text";
export const LIMITS_NOTE = `${ACCEPTED_FORMATS}, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB each. A scanned PDF with no text layer cannot be indexed.`;

/** Files the server will refuse on size — named here, before anything is sent. */
export function oversizeNames(files: readonly { name: string; size: number }[]): string[] {
  return files.filter((f) => f.size > MAX_UPLOAD_BYTES).map((f) => f.name);
}

/**
 * The batch in one line, counting only what actually happened. A file still
 * staged is not counted as anything: it has not been attempted.
 */
export function uploadSummary(rows: readonly { status: UploadStatus }[]): string | null {
  const n = (s: UploadStatus) => rows.filter((r) => r.status === s).length;
  const parts: string[] = [];
  if (n("ready") > 0) parts.push(`${n("ready")} ready`);
  if (n("failed") > 0) parts.push(`${n("failed")} failed`);
  const busy = n("uploading");
  if (busy > 0) parts.push(`${busy} in progress`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
