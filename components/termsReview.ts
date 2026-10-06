/**
 * The covenant setup review, as pure functions. No React, no I/O, no imports
 * from the server side of the app, so the Client Components can use it and
 * `node --test` can exercise it.
 *
 * What lives here is the part of the screen that must not be wrong: which rows
 * a proposal produces, what state each row is in, what blocks the Approve
 * button, and where a quote sits inside its clause. The components only draw it.
 *
 * Nothing here is the control. The server re-verifies everything on approve;
 * this is the analyst's early warning, and `blockers` says so by never being
 * treated as permission.
 */
import { resolveCitation } from "../lib/chunk.ts";

// ------------------------------------------------------------------ types

export type Scalar = string | number | boolean | null;

export interface Citation {
  field: string;
  citation: string;
  quote: string;
  provenance?: string;
  original_value?: unknown;
}

export interface Violation {
  field: string;
  value?: unknown;
  reason: string;
}

export interface Warning {
  code: string;
  message: string;
  citation?: string;
  field?: string;
}

/** A clause of the agreement or an amendment, as stored. */
export interface Clause {
  citation: string;
  doc_title: string | null;
  doc_type: string | null;
  section: string | null;
  content: string;
  effective_date?: string | null;
}

export interface Edit {
  field: string;
  value: Scalar | Scalar[];
  citation: string;
  quote: string;
}

export type Terms = Record<string, unknown>;

// -------------------------------------------------------------- vocabulary

/**
 * The calculator's component names (calc/dscr.js). Mirrored here only to offer
 * them as checkboxes; the server refuses any name outside its own copy, so a
 * drift between the two costs a refusal, never a wrong term.
 */
export const DEDUCTION_VOCABULARY = ["unfinanced_capex", "cash_taxes"];
export const DENOMINATOR_VOCABULARY = ["scheduled_principal", "cash_interest"];

// -------------------------------------------------------- paths and values

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

export function getAt(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const s of parsePath(path)) {
    if (typeof s === "number") cur = Array.isArray(cur) ? cur[s] : undefined;
    else cur = isObj(cur) ? cur[s] : undefined;
  }
  return cur;
}

/** A copy of `root` with `path` set. The original is never touched. */
export function setAt<T>(root: T, path: string, value: unknown): T {
  const out = structuredClone(root) as unknown;
  const segs = parsePath(path);
  let cur: unknown = out;
  for (const s of segs.slice(0, -1)) cur = typeof s === "number" ? (cur as unknown[])[s] : (cur as Record<string, unknown>)[s];
  const last = segs[segs.length - 1];
  if (typeof last === "number") (cur as unknown[])[last] = value;
  else (cur as Record<string, unknown>)[last] = value;
  return out as T;
}

/** The terms as they would stand with the analyst's edits applied. */
export function applyLocalEdits(terms: Terms, edits: Record<string, Edit>): Terms {
  let out = terms;
  for (const e of Object.values(edits)) out = setAt(out, e.field, e.value);
  return out;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

/** How a stored value reads on screen. Nothing is invented: a null cap is stated as uncapped, never as a number. */
export function valueText(field: string, value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (value === null) return /\.cap$/.test(field) ? "uncapped (no limit)" : "none";
  if (value === undefined) return "missing";
  if (typeof value === "number") return NUMBER.format(value);
  return String(value);
}

// ------------------------------------------------------------------- rows

export type FieldKind = "number" | "nullable-number" | "text" | "date" | "list";

export interface FieldSpec {
  field: string;
  /** The label of this one part of a row: "cap", "name". */
  label: string;
  kind: FieldKind;
  vocabulary?: string[];
}

export interface Row {
  id: string;
  label: string;
  /** What this row says, one part per editable field. Empty for a row that states an absence. */
  fields: FieldSpec[];
  /** The field whose citation supports the row, or null for a row that is an absence statement. */
  citeField: string | null;
  /** A row that says "nothing proposed" rather than proposing a value. */
  absence?: string;
  /** For a row with no citation of its own: what the server checks it against. */
  checkedAgainst?: string;
}

export function buildRows(terms: Terms): Row[] {
  const rows: Row[] = [];
  rows.push({
    id: "threshold",
    label: "Minimum DSCR",
    fields: [{ field: "threshold.min_dscr", label: "minimum", kind: "number" }],
    citeField: "threshold.min_dscr",
  });
  rows.push({
    id: "basis",
    label: "Test basis",
    fields: [{ field: "test_period.basis", label: "basis", kind: "text" }],
    // The server checks the basis against the clause cited for the threshold.
    citeField: "threshold.min_dscr",
    checkedAgainst: "the clause cited for Minimum DSCR",
  });
  rows.push({
    id: "base",
    label: "Numerator base",
    fields: [{ field: "numerator.base", label: "base", kind: "text" }],
    // The server checks the base against the article that defines the ratio.
    citeField: "numerator.deductions",
    checkedAgainst: "the article that defines the ratio",
  });
  rows.push({
    id: "deductions",
    label: "Deductions from the numerator",
    fields: [{ field: "numerator.deductions", label: "deducted", kind: "list", vocabulary: DEDUCTION_VOCABULARY }],
    citeField: "numerator.deductions",
  });

  const numerator = isObj(terms.numerator) ? terms.numerator : {};
  const addbacks = Array.isArray(numerator.addbacks) ? numerator.addbacks : [];
  if (addbacks.length === 0) {
    rows.push({
      id: "addbacks-none",
      label: "Add-backs",
      fields: [],
      citeField: null,
      absence: "None proposed. Nothing verifies that none are permitted: read the clauses below.",
    });
  }
  addbacks.forEach((_, i) => {
    const p = `numerator.addbacks[${i}]`;
    rows.push({
      id: `addback-${i}`,
      label: `Add-back ${i + 1}`,
      fields: [
        { field: `${p}.name`, label: "name", kind: "text" },
        { field: `${p}.cap`, label: "cap", kind: "nullable-number" },
        { field: `${p}.amount_source`, label: "amount from", kind: "text" },
      ],
      citeField: `${p}.cap`,
    });
  });

  rows.push({
    id: "denominator",
    label: "Debt service components",
    fields: [{ field: "denominator.components", label: "components", kind: "list", vocabulary: DENOMINATOR_VOCABULARY }],
    citeField: "denominator.components",
  });

  const amendments = Array.isArray(terms.effective_amendments) ? terms.effective_amendments : [];
  if (amendments.length === 0) {
    rows.push({
      id: "amendments-none",
      label: "Amendments applied",
      fields: [],
      citeField: null,
      absence: "None. An amendment on file that no term cites is flagged above.",
    });
  }
  amendments.forEach((_, i) => {
    const p = `effective_amendments[${i}]`;
    rows.push({
      id: `amendment-${i}`,
      label: `Amendment ${i + 1}`,
      fields: [
        { field: `${p}.doc`, label: "document", kind: "text" },
        { field: `${p}.effective`, label: "effective", kind: "date" },
      ],
      citeField: `${p}.effective`,
    });
  });
  return rows;
}

// -------------------------------------------------------------- violations

export type ProblemKind = "no_citation" | "value_absent" | "quote_missing" | "other";

/** What kind of refusal a reason is. Worded for a person; the server's text is kept alongside, never replaced. */
export function classify(reason: string): ProblemKind {
  if (/^no citation for this term|citation entry needs|malformed citation entry/i.test(reason)) return "no_citation";
  if (/^quote not found in|^no chunk supplied for/i.test(reason)) return "quote_missing";
  if (/does not appear in|not stated as a minimum ratio|is not the minimum ratio|sits with another add-back|does not say the add-back is uncapped|cap is null/i.test(reason)) {
    return "value_absent";
  }
  return "other";
}

export const PROBLEM_HEADLINE: Record<ProblemKind, string> = {
  no_citation: "No citation",
  value_absent: "Value is not in its own quote",
  quote_missing: "Quote not found in the cited clause",
  other: "Not supported by the clause it cites",
};

// --------------------------------------------------------------- row views

export type RowStateKind = "ok" | "no_citation" | "unsupported" | "edited";

export interface RowView {
  row: Row;
  state: RowStateKind;
  problems: { violation: Violation; kind: ProblemKind }[];
  /** The citation entry that supports the row, after edits. Undefined when there is none. */
  entry?: Citation;
  /** Per field: the value now, and the model's original when an analyst changed it. */
  parts: { spec: FieldSpec; text: string; original?: string }[];
}

export interface ReviewInput {
  terms: Terms;
  citations: Citation[];
  /** The latest refusals the server gave: from propose, or from a 422. */
  violations: Violation[];
  edits: Record<string, Edit>;
  /** Fields edited since `violations` were issued. Their violations describe a value that no longer stands. */
  staleFields: ReadonlySet<string>;
}

export function entryFor(field: string, citations: Citation[], edits: Record<string, Edit>): Citation | undefined {
  const edit = edits[field];
  if (edit) {
    return { field, citation: edit.citation, quote: edit.quote, provenance: "analyst-corrected" };
  }
  return citations.find((c) => c.field === field);
}

export function reviewRows(input: ReviewInput): { views: RowView[]; stray: Violation[] } {
  const { terms, citations, edits, staleFields } = input;
  const live = input.violations.filter((v) => !staleFields.has(v.field));
  const effective = applyLocalEdits(terms, edits);
  const rows = buildRows(effective);
  const claimed = new Set<string>();

  const views = rows.map<RowView>((row) => {
    // A row owns the refusals on its OWN values. A row that borrows another's
    // citation (the basis is checked against the threshold's clause) does not
    // inherit that row's refusal: "Test basis: value is not in its quote" would
    // blame the wrong term. It still shows no citation if the borrowed one is gone.
    const owned = new Set(row.fields.map((f) => f.field));
    const mine = live.filter((v) => owned.has(v.field));
    mine.forEach((v) => claimed.add(v.field));
    const entry = row.citeField ? entryFor(row.citeField, citations, edits) : undefined;
    const problems = mine.map((violation) => ({ violation, kind: classify(violation.reason) }));

    // Original beside the correction: from the local edit, or from a marker the server wrote.
    const parts = row.fields.map((spec) => {
      const text = valueText(spec.field, getAt(effective, spec.field));
      const edited = edits[spec.field];
      const stored = citations.find((c) => c.field === spec.field && c.provenance === "analyst-corrected");
      const original = edited
        ? valueText(spec.field, getAt(terms, spec.field))
        : stored && "original_value" in stored
          ? valueText(spec.field, stored.original_value)
          : undefined;
      return { spec, text, original };
    });

    const anyEdited = row.fields.some((f) => edits[f.field]);
    let state: RowStateKind;
    if (problems.some((p) => p.kind === "no_citation")) state = "no_citation";
    else if (problems.length > 0) state = "unsupported";
    // A row that cites something must have an entry; one that does not has no citation, whatever the server said.
    else if (row.citeField && !entry) state = "no_citation";
    else if (anyEdited) state = "edited";
    else state = "ok";
    return { row, state, problems, entry, parts };
  });

  // A refusal no row owns still has to be seen: it is never dropped for being awkward to place.
  const stray = live.filter((v) => !claimed.has(v.field));
  return { views, stray };
}

// ---------------------------------------------------------------- blockers

/**
 * The reasons Approve is disabled, in words. Empty means the client sees
 * nothing in the way, which is NOT permission: the server decides.
 */
export function blockers(args: {
  views: RowView[];
  stray: Violation[];
  approver: string;
  /** definition_not_located fields the analyst has not yet confirmed they checked themselves. */
  unconfirmed: string[];
}): string[] {
  const out: string[] = [];
  for (const v of args.views) {
    if (v.state === "no_citation") {
      out.push(`${v.row.label}: no citation.`);
    } else if (v.state === "unsupported") {
      out.push(`${v.row.label}: ${v.problems[0] ? PROBLEM_HEADLINE[v.problems[0].kind].toLowerCase() : "not supported"}.`);
    }
  }
  for (const s of args.stray) out.push(`${s.field}: ${s.reason}.`);
  for (const f of args.unconfirmed) out.push(`${f}: completeness was not checked. Confirm you read the definition, above.`);
  if (args.approver.trim() === "") out.push("Enter the approver's name.");
  return out;
}

// ------------------------------------------------------ quote in its clause

const QUOTES_SINGLE = /[‘’]/;
const QUOTES_DOUBLE = /[“”]/;
const DASHES = /[‐-―]/;

/**
 * The server's folding (smart quotes, dashes, runs of whitespace), with a map
 * back to the original character positions so the exact span can be marked in
 * the text as written.
 */
function foldWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (QUOTES_SINGLE.test(ch)) ch = "'";
    else if (QUOTES_DOUBLE.test(ch)) ch = '"';
    else if (DASHES.test(ch)) ch = "-";
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = " ";
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    text += ch;
    map.push(i);
  }
  return { text, map };
}

/** Where `quote` sits in `content`, as [start, end) in the original text, or null when it is not there. */
export function findQuote(content: string, quote: string): { start: number; end: number } | null {
  const q = foldWithMap(quote).text.trim();
  if (q === "") return null;
  const folded = foldWithMap(content);
  const at = folded.text.indexOf(q);
  if (at < 0) return null;
  return { start: folded.map[at], end: folded.map[at + q.length - 1] + 1 };
}

// ----------------------------------------------------------- clauses

/** Joined the way the server joins them, so what the analyst reads is what was checked. */
export function clauseFor(citation: string, clauses: readonly Clause[]): Clause | null {
  const r = resolveCitation(citation);
  if (!r.doc_title || !r.section) return null;
  const parts = clauses.filter((c) => c.doc_title === r.doc_title && c.section === r.section);
  if (parts.length === 0) return null;
  return { ...parts[0], content: parts.map((p) => p.content).join("\n") };
}

const clauseKey = (doc: string | null, section: string | null) => `${doc ?? ""}|${section ?? ""}`;

/**
 * The clauses the model saw (or, for a stored proposal, the ones on file) that
 * no term cites. This is the only control against OMISSION: provenance proves a
 * stated value is supported, never that something was left out.
 *
 * Citing a section covers the whole section here, so a cited clause can still
 * hold a provision no term uses; the screen says so beside the list.
 */
export function uncitedClauses(citations: readonly { citation: string }[], seen: readonly Clause[]): Clause[] {
  const cited = new Set<string>();
  for (const c of citations) {
    const r = resolveCitation(c.citation);
    if (r.doc_title && r.section) cited.add(clauseKey(r.doc_title, r.section));
  }
  const merged = new Map<string, Clause>();
  for (const s of seen) {
    const k = clauseKey(s.doc_title, s.section);
    if (cited.has(k)) continue;
    const prior = merged.get(k);
    merged.set(k, prior ? { ...prior, content: `${prior.content}\n${s.content}` } : s);
  }
  return [...merged.values()];
}

export type ClauseGroup = "amendment" | "covenant" | "other";

/** Amendments first, then the definitions and the covenant article, then everything else. Nothing is dropped. */
export function groupOf(c: Clause): ClauseGroup {
  if (c.doc_type === "amendment") return "amendment";
  const s = c.section ?? "";
  if (c.doc_type === "agreement" && (/^§(?:1|7)\./.test(s) || /^ARTICLE (?:I|VII)$/.test(s))) return "covenant";
  return "other";
}

/** Natural order of section ids: §1.01 before §1.02 before §7.11, ARTICLE before its sections. */
export function bySection(a: Clause, b: Clause): number {
  const key = (c: Clause) => {
    const s = c.section ?? "";
    const m = /^§(\d+)(?:\.(\d+))?/.exec(s);
    if (m) return [1, Number(m[1]), Number(m[2] ?? 0)];
    return [0, 0, 0];
  };
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return (a.section ?? "").localeCompare(b.section ?? "");
}

// ------------------------------------------------------------- warnings

/**
 * The checks the server raised. `definition_not_located` is the one that is not
 * a note about the terms but a statement that a check DID NOT RUN, so it is
 * separated from the rest and treated differently on screen.
 */
export function splitWarnings(warnings: readonly Warning[]): { notRun: Warning[]; notes: Warning[] } {
  return {
    notRun: warnings.filter((w) => w.code === "definition_not_located"),
    notes: warnings.filter((w) => w.code !== "definition_not_located"),
  };
}

export const WARNING_LABEL: Record<string, string> = {
  amendment_not_cited: "Amendment not cited",
  clause_amended: "Cited clause is amended",
  addback_not_in_terms: "Add-back permitted but not listed",
  definition_superseded: "Definition superseded",
  definition_conflict: "Conflicting definitions",
  definition_amendment_partial: "Amendment limits itself",
  definition_extent_ambiguous: "Definition's extent is ambiguous",
};

// ------------------------------------------------------------- responses

/** What the approve route said, reduced to what the screen shows. */
export interface Refusal {
  status: number;
  message: string;
  violations: Violation[];
  errors: string[];
}

export function readRefusal(status: number, body: unknown): Refusal {
  const b = isObj(body) ? body : {};
  const violations = Array.isArray(b.violations)
    ? b.violations.filter(isObj).map((v) => ({ field: String(v.field ?? ""), value: v.value, reason: String(v.reason ?? "") }))
    : [];
  const errors = Array.isArray(b.errors) ? b.errors.map(String) : [];
  const message = typeof b.error === "string" && b.error !== "" ? b.error : `The server answered ${status} without saying why.`;
  return { status, message, violations, errors };
}
