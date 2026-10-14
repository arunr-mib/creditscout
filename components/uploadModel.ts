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
export function stagingBlockers(files: readonly StagedFile[], hasBorrower: boolean): string[] {
  const out: string[] = [];
  if (!hasBorrower) out.push("Choose a borrower.");
  if (files.length === 0) return out;
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
export function readiness(files: readonly StagedFile[]): {
  termsReview: boolean;
  covenantTests: boolean;
} {
  const has = (t: string) => files.some((f) => f.docType === t);
  return {
    termsReview: has("agreement") || has("amendment"),
    covenantTests: has("financials"),
  };
}
