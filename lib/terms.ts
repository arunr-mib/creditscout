import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFigures, verifyTermsProvenance } from "../guardrails/guardrail.js";
import { resolveCitation } from "./chunk.ts";
import { citationFor } from "./retrieval.ts";

/**
 * Covenant terms: shape validation, versioning, supersession, and the approve
 * gate (security finding S-1).
 *
 * The blast radius is why this file is strict. A casefile with a wrong number is
 * one wrong casefile; a covenant term with a wrong number is every future test
 * for that borrower, silently. So:
 *
 *   - Nothing here coerces or defaults. A missing field is an error.
 *   - Approval re-verifies provenance on the SERVER, against chunks it loads
 *     itself. The client's copy of the check is convenience; this is the control.
 *   - A terms row is never overwritten once approved. A new version supersedes
 *     it, so a Q1 test stays reproducible against the terms in force in Q1.
 *
 * Pure functions come first (no I/O), then the Supabase helpers, then the two
 * request handlers the routes call. The handlers return `{status, body}` like
 * `runDscrCalculator`, so the routes stay thin and the gate is testable.
 */

// ------------------------------------------------------------------- types

type Obj = Record<string, unknown>;

export interface SourceCitation {
  field: string;
  citation: string;
  quote: string;
  /** Present only on a field a human changed: "analyst-corrected". */
  provenance?: typeof ANALYST_CORRECTED;
  /** What the model proposed before the analyst changed it. */
  original_value?: unknown;
}

/** A chunk of an agreement or amendment, as stored. */
export interface SourceChunk {
  content: string;
  citation: string;
  doc_type: string | null;
  doc_title: string | null;
  section: string | null;
  /**
   * When the document it came from took effect. Optional because only one thing
   * needs it — deciding which of two documents defining the same term governs —
   * and `loadSourceChunks` fills it from `documents.effective_date`.
   */
  effective_date?: string | null;
}

export interface Violation {
  field: string;
  value: unknown;
  reason: string;
}

export interface TermsRow {
  id: string;
  facility_id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  terms: Obj;
  source_citations: SourceCitation[];
  status: "proposed" | "approved" | "superseded";
  approved_by: string | null;
  approved_at: string | null;
  /** null on a row written before migration 0008; [] means the checks ran and raised nothing. */
  warnings?: TermsWarning[] | null;
}

type Scalar = string | number | boolean | null;

export interface TermsEdit {
  field: string;
  /** A single value, or a whole list for a list-valued field (a deduction list, the denominator components). */
  value: Scalar | Scalar[];
  citation: string;
  quote: string;
}

export interface ToolResult {
  status: number;
  body: Record<string, unknown>;
}

type Db = Pick<SupabaseClient, "from">;

/** The marker a human override leaves in `source_citations`. */
export const ANALYST_CORRECTED = "analyst-corrected" as const;

/** Only these may be cited as the source of terms. A waiver request is not a source. */
export const SOURCE_DOC_TYPES = ["agreement", "amendment"] as const;

/** An error that maps straight onto an HTTP status. `details` carries the violation or error list. */
export class TermsError extends Error {
  status: number;
  details: Record<string, unknown>;
  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
/** Migration 0007: at most one approved row per facility. */
export const ONE_APPROVED_INDEX = "covenant_terms_one_approved_per_facility";
const MAX_APPROVER_LENGTH = 200;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// ------------------------------------------------------------ dates

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is rejected). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** "2026-04-01" -> "2026-03-31". UTC arithmetic, so no timezone can shift the day. */
export function dayBefore(iso: string): string {
  if (!isIsoDate(iso)) throw new TermsError(400, `not a date: ${String(iso)}`);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// -------------------------------------------------------------- validateTerms

/**
 * The calculator's component vocabulary (calc/dscr.js). A name outside it is
 * refused there at test time, so refuse it here at setup, where a human is
 * looking, rather than months later in a quarterly run.
 */
const DEDUCTION_NAMES = ["unfinanced_capex", "cash_taxes"];
const DENOMINATOR_NAMES = ["scheduled_principal", "cash_interest"];

function onlyKeys(o: Obj, allowed: string[], path: string, errors: string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errors.push(`${path}.${k} is not part of the terms schema`);
  }
}

function nameList(v: unknown, vocabulary: string[], path: string, errors: string[], requireOne: boolean): void {
  if (!Array.isArray(v)) {
    errors.push(`${path} is required and must be an array`);
    return;
  }
  if (requireOne && v.length === 0) errors.push(`${path} must list at least one component`);
  const seen = new Set<string>();
  v.forEach((name, i) => {
    if (typeof name !== "string" || !vocabulary.includes(name)) {
      errors.push(`${path}[${i}] must be one of: ${vocabulary.join(", ")}`);
    } else if (seen.has(name)) {
      errors.push(`${path}[${i}] duplicates "${name}"`);
    }
    if (typeof name === "string") seen.add(name);
  });
}

/**
 * Shape only, against the §4.2 terms schema. Never coerces and never defaults:
 * `addbacks` and `deductions` must be present as arrays (an empty array is a
 * legitimate "none"; an absent one is a mapping error), and `cap` must be
 * present too, as a number or an explicit null for "uncapped".
 *
 * Shape is not provenance. This accepts a threshold of 0.85 whatever the
 * clause says; `checkTermsProvenance` is what rejects it.
 */
export function validateTerms(terms: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(terms)) return { valid: false, errors: ["terms must be an object"] };
  onlyKeys(terms, ["test_period", "threshold", "numerator", "denominator", "effective_amendments"], "terms", errors);

  const tp = terms.test_period;
  if (!isObj(tp)) {
    errors.push("test_period is required and must be an object");
  } else {
    onlyKeys(tp, ["basis", "period_end"], "test_period", errors);
    if (!isText(tp.basis)) errors.push("test_period.basis is required and must be a non-empty string");
    // A versioned row governs many quarters, so the period is set per test.
    // null says so explicitly; absent is still an error.
    if (!("period_end" in tp)) errors.push("test_period.period_end is required (a date, or null until a test sets it)");
    else if (tp.period_end !== null && !isIsoDate(tp.period_end)) errors.push("test_period.period_end must be a YYYY-MM-DD date or null");
  }

  const th = terms.threshold;
  if (!isObj(th)) {
    errors.push("threshold is required and must be an object");
  } else {
    onlyKeys(th, ["min_dscr", "citation"], "threshold", errors);
    if (!isNum(th.min_dscr) || th.min_dscr <= 0) errors.push("threshold.min_dscr is required and must be a number greater than 0");
    if (!isText(th.citation)) errors.push("threshold.citation is required and must be a non-empty string");
  }

  const nu = terms.numerator;
  if (!isObj(nu)) {
    errors.push("numerator is required and must be an object");
  } else {
    onlyKeys(nu, ["base", "addbacks", "deductions"], "numerator", errors);
    if (!isText(nu.base)) errors.push("numerator.base is required and must be a non-empty string");
    if (!Array.isArray(nu.addbacks)) {
      errors.push("numerator.addbacks is required and must be an array (use [] for none)");
    } else {
      const names = new Set<string>();
      nu.addbacks.forEach((ab, i) => {
        const p = `numerator.addbacks[${i}]`;
        if (!isObj(ab)) return void errors.push(`${p} must be an object`);
        onlyKeys(ab, ["name", "amount_source", "cap", "citation"], p, errors);
        if (!isText(ab.name)) errors.push(`${p}.name is required and must be a non-empty string`);
        else if (names.has(ab.name)) errors.push(`${p}.name duplicates "${ab.name}"`);
        else names.add(ab.name);
        if (!isText(ab.amount_source)) errors.push(`${p}.amount_source is required and must be a non-empty string`);
        if (!("cap" in ab)) errors.push(`${p}.cap is required (a number, or null for uncapped)`);
        else if (ab.cap !== null && (!isNum(ab.cap) || ab.cap < 0)) errors.push(`${p}.cap must be a number of 0 or more, or null`);
        if (!isText(ab.citation)) errors.push(`${p}.citation is required and must be a non-empty string`);
      });
    }
    nameList(nu.deductions, DEDUCTION_NAMES, "numerator.deductions", errors, false);
  }

  const de = terms.denominator;
  if (!isObj(de)) {
    errors.push("denominator is required and must be an object");
  } else {
    onlyKeys(de, ["components", "citation"], "denominator", errors);
    nameList(de.components, DENOMINATOR_NAMES, "denominator.components", errors, true);
    if (!isText(de.citation)) errors.push("denominator.citation is required and must be a non-empty string");
  }

  if (!Array.isArray(terms.effective_amendments)) {
    errors.push("effective_amendments is required and must be an array (use [] for none)");
  } else {
    terms.effective_amendments.forEach((am, i) => {
      const p = `effective_amendments[${i}]`;
      if (!isObj(am)) return void errors.push(`${p} must be an object`);
      onlyKeys(am, ["doc", "effective", "citation"], p, errors);
      if (!isText(am.doc)) errors.push(`${p}.doc is required and must be a non-empty string`);
      if (!isIsoDate(am.effective)) errors.push(`${p}.effective is required and must be a YYYY-MM-DD date`);
      if (!isText(am.citation)) errors.push(`${p}.citation is required and must be a non-empty string`);
    });
  }

  return { valid: errors.length === 0, errors };
}

// ------------------------------------------------------------- versioning

/** `max + 1`, starting at 1. Gaps are fine; reuse is not. */
export function nextVersion(existingVersions: readonly number[]): number {
  let max = 0;
  for (const v of existingVersions) {
    if (!Number.isInteger(v) || v < 1) throw new TermsError(500, `invalid stored version: ${String(v)}`);
    if (v > max) max = v;
  }
  return max + 1;
}

// ------------------------------------------------------------ field paths

/** "numerator.addbacks[0].cap" -> ["numerator", "addbacks", 0, "cap"]. null when the path is malformed. */
function parsePath(path: string): (string | number)[] | null {
  if (!/^[^.[\]]+(?:\.[^.[\]]+|\[\d+\])*$/.test(path)) return null;
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

function getAtPath(root: unknown, path: string): unknown {
  const segs = parsePath(path);
  if (!segs) return undefined;
  let cur: unknown = root;
  for (const s of segs) {
    if (typeof s === "number") cur = Array.isArray(cur) ? cur[s] : undefined;
    else cur = isObj(cur) ? cur[s] : undefined;
  }
  return cur;
}

// ----------------------------------------------------------------- edits

/**
 * Apply an analyst's edits. Returns copies; the inputs are never mutated.
 *
 * An edit changes ONE existing scalar and must carry its own citation and
 * verbatim quote, because an edited value is held to the same standard as the
 * model's: its number has to appear in the quote it cites, and the server
 * checks that. The field's entry in `source_citations` is marked
 * `analyst-corrected` (and keeps the model's original value), so the record
 * shows a human overrode the model rather than presenting the edit as the
 * model's cited work.
 *
 * What the marker is NOT: it is not a bypass. The citation stays a real
 * citation, because `verifyTermsProvenance` resolves it to a chunk; replacing
 * it with the literal "analyst-corrected" would make every edit unapprovable.
 *
 * WHAT A LIST EDIT IS FOR. A gate that can refuse a deduction list but only
 * repair single numbers is a dead end, not a control: the analyst's only way
 * out is to re-propose and hope, and the pressure moves to editing whatever the
 * checker will swallow. So an edit may also replace a LIST of scalars
 * (`numerator.deductions`, `denominator.components`) wholesale.
 *
 * WHAT IT REFUSES, so this is not a hole: the value's SHAPE must match what is
 * already there — a list for a list, a scalar for a scalar — the path must
 * already exist, no object may be replaced, and every element must be a scalar.
 * Nothing about the checks changes: `validateTerms` and the provenance check
 * re-run on the edited terms afterwards, so an edited list is held to the
 * server-located definition exactly like the model's.
 */
export function applyEdits(
  terms: Obj,
  sourceCitations: SourceCitation[],
  edits: unknown,
): { terms: Obj; source_citations: SourceCitation[] } {
  if (!Array.isArray(edits)) throw new TermsError(400, "edits must be an array");
  const outTerms = structuredClone(terms);
  const outCites = structuredClone(sourceCitations);

  edits.forEach((e, i) => {
    const at = `edits[${i}]`;
    if (!isObj(e)) throw new TermsError(400, `${at} must be an object`);
    const { field, value, citation, quote } = e;
    if (!isText(field)) throw new TermsError(400, `${at}.field is required`);
    const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
    if (!(scalar(value) || (Array.isArray(value) && value.every(scalar)))) {
      throw new TermsError(400, `${at}.value must be a string, number, boolean, null, or a list of those`);
    }
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === "number" && !Number.isFinite(v)) throw new TermsError(400, `${at}.value must be finite`);
    }
    if (!isText(citation) || !isText(quote)) {
      throw new TermsError(400, `${at} needs a citation and a verbatim quote: an edited term is held to the same standard as a proposed one`);
    }

    const segs = parsePath(field);
    if (!segs) throw new TermsError(400, `${at}.field is not a valid path: "${field}"`);
    const parentPath = segs.slice(0, -1);
    let parent: unknown = outTerms;
    for (const s of parentPath) parent = typeof s === "number" ? (Array.isArray(parent) ? parent[s] : undefined) : isObj(parent) ? parent[s] : undefined;
    const last = segs[segs.length - 1];
    const existing = typeof last === "number" ? (Array.isArray(parent) ? parent[last] : undefined) : isObj(parent) ? parent[last] : undefined;
    // An existing scalar, or an existing list of scalars, may be edited. Adding
    // a path, or replacing an object, is not an edit; it is a different proposal.
    const isScalar = scalar(existing);
    const isList = Array.isArray(existing) && existing.every(scalar);
    if (!isScalar && !isList) throw new TermsError(400, `${at}.field "${field}" is not an existing scalar or list value in the terms`);
    if (isList !== Array.isArray(value)) {
      throw new TermsError(400, `${at}.value must be ${isList ? "a list, because that field holds a list" : "a single value, because that field holds a single value"}`);
    }
    if (typeof last === "number") (parent as unknown[])[last] = value;
    else (parent as Obj)[last] = value;

    const entry: SourceCitation = {
      field,
      citation: citation.trim(),
      quote,
      provenance: ANALYST_CORRECTED,
      original_value: existing,
    };
    const at0 = outCites.findIndex((c) => c.field === field);
    if (at0 >= 0) {
      // A second edit of the same field keeps the model's value, not the first edit's.
      if (outCites[at0].provenance === ANALYST_CORRECTED) entry.original_value = outCites[at0].original_value;
      outCites[at0] = entry;
    } else {
      outCites.push(entry);
    }
  });

  return { terms: outTerms, source_citations: outCites };
}

// ------------------------------------------------------------- provenance

/** Same folding as the guardrail's quote match (smart quotes, dashes, whitespace). Only used for extra checks. */
function foldText(s: string): string {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Like `foldText`, but KEEPS line breaks. A line break is the one boundary in
 * legal prose that can be trusted: a full stop cannot (abbreviations, "(i)",
 * decimals), and a semicolon cannot (it joins clauses as often as it ends them).
 * Used only to bound a located definition, never to match a quote.
 */
function foldLines(s: string): string {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ------------------------------------------- the server's own ground truth

/**
 * WHOEVER CHOOSES THE SCOPE DEFINES THE TRUTH, so the server chooses it.
 *
 * Completeness ("did the proposal drop a deduction?") cannot be judged against
 * anything the proposer picked. Judging the QUOTE let a short quote define its
 * own ground truth; judging the enclosing SENTENCE was defeated by punctuation;
 * judging the CITED CHUNK let the proposer pick a chunk that happens to mention
 * the base and no deduction (`numerator.deductions = []` citing CA §7.11 read
 * as valid on real data). Each time the scope moved up, the proposer moved with
 * it, because the proposer was still the one choosing.
 *
 * So for the definitional fields the server locates the defining clause itself,
 * in the chunks IT loaded for the facility, and ignores the citation for the
 * purpose of deciding what the truth is. The citation is then checked AGAINST
 * that location (it must point at the defining clause), which is the opposite
 * direction of trust.
 *
 * A definition is located by its drafting form: `"Term" means` / `"Term" shall
 * mean`. Quoted terms are preferred and are self-delimiting, so looking for
 * `"Debt Service" means` can never land inside `"Debt Service Coverage Ratio"
 * means`; the unquoted form is a fallback for documents that do not quote
 * defined terms.
 *
 * THE CLAUSE'S EXTENT IS THE DOCUMENT'S BLOCK, NOT WHERE A LINE WRAPPED. It
 * runs from its opener to the next structural boundary the document itself
 * draws: the next defined term's opener, a blank line, a heading or an
 * enumerator at the start of a line, or the end of the section. It does NOT
 * stop at the first full stop that happens to end a line, which was wrong in
 * both directions at once:
 *
 *   - a definition written as two sentences ('... minus Unfinanced Capital
 *     Expenditures.' / 'For the avoidance of doubt, cash taxes paid shall also
 *     be deducted.') lost its second sentence, so the CORRECT list was refused
 *     ("terms include cash_taxes but the clause does not mention it") and the
 *     list with cash_taxes dropped was ACCEPTED
 *   - a hard wrap after an abbreviation ('... owed by Northgate Foods, Inc.')
 *     cut the clause mid-sentence, reviving the "Inc." bypass server-side
 *
 * The residue of the block rule, stated honestly because no warning used to
 * exist for it and the old comment claimed one did: section prose that follows
 * a definition in the SAME paragraph is taken as part of it. If that prose is
 * what makes a deduction word appear, `termsWarnings` raises
 * `definition_extent_ambiguous` and names the word, so a human decides. It
 * fires only when the continuation changes the verdict, so it is not noise.
 *
 * WHICH DOCUMENT WINS: the one with the latest `effective_date`. An amendment
 * restates a definition and supersedes the agreement's wording, but two
 * amendments can both restate it, and then the NEWEST governs — not "any
 * amendment", which took the stale one's words as truth as well. Undated
 * documents rank below dated ones; a genuine tie is reported
 * (`definition_conflict`) and judged against both, which fails closed.
 *
 * Returns an empty array when no definition of that form is on file, and the
 * caller must then NOT fall back to the cited chunk — see `checkTermsProvenance`.
 */
export interface LocatedDefinition {
  /** The citation of the chunk the defining clause sits in, e.g. "CA §1.01". */
  citation: string;
  /** The defining clause only, not the whole section. This is the completeness scope. */
  text: string;
  /** The whole section the clause sits in. Used only where the narrow scope would refuse correct terms. */
  section_text: string;
  /** Which document it came from, and when that document took effect: how precedence is decided. */
  doc_title: string | null;
  effective_date: string | null;
}

export function locateDefinition(term: string, chunks: readonly SourceChunk[]): LocatedDefinition[] {
  const quoted = findDefinitions(term, chunks, true);
  const found = quoted.length > 0 ? quoted : findDefinitions(term, chunks, false);
  if (found.length === 0) return [];
  return governing(found).map(({ citation, text, section_text, doc_title, effective_date }) => ({ citation, text, section_text, doc_title, effective_date }));
}

/**
 * Of several documents defining the same term, the one in force: the latest
 * `effective_date`. A dated document always beats an undated one (an undated
 * amendment cannot be shown to be later than the agreement). Ties — including
 * all-undated, which is what the doc_type rule used to collapse to — are kept
 * and judged together, so a conflict fails closed and is reported rather than
 * resolved by accident of ordering.
 */
function governing<T extends { doc_title: string | null; effective_date: string | null }>(found: T[]): T[] {
  const rank = (f: T) => (isIsoDate(f.effective_date) ? f.effective_date : "");
  const best = found.reduce((a, f) => (rank(f) > a ? rank(f) : a), "");
  return found.filter((f) => rank(f) === best);
}

/** Every document that defines `term`, by title, with the date it took effect. */
export function definingDocuments(term: string, chunks: readonly SourceChunk[]): { doc_title: string | null; effective_date: string | null }[] {
  const quoted = findDefinitions(term, chunks, true);
  const found = quoted.length > 0 ? quoted : findDefinitions(term, chunks, false);
  const seen = new Map<string, { doc_title: string | null; effective_date: string | null }>();
  for (const f of found) seen.set(`${f.doc_title}`, { doc_title: f.doc_title, effective_date: f.effective_date });
  return [...seen.values()];
}

/** Any defined term's opener: where this one's block stops. */
const ANY_DEFINITION = /"[^"\n]{1,160}"\s+(?:means|shall\s+mean)\b/gi;
/**
 * A structural break the DOCUMENT draws. Two kinds, and the second needs a
 * condition the first does not:
 *
 *   - A BLANK LINE always ends the block. Nothing legitimate continues a
 *     definition across one.
 *   - A HEADING or ENUMERATOR at the start of a line ends it ONLY when the
 *     previous line ended in a full stop, i.e. only when the sentence before it
 *     was finished. Without that condition the marker is just as likely to be
 *     INSIDE the definition, and the block was cut silently:
 *       · a definition with a sub-list — "means the ratio of:" / "(i) …" / "(ii) …"
 *       · a hard wrap that lands a line on "(i) Consolidated EBITDA …",
 *         "Section 7.11, minus …" or "7.11(b) …"
 *     Both truncated the clause, so the emptied list was ACCEPTED and the
 *     correct list REFUSED, with no warning. Requiring the finished sentence
 *     keeps every one of those inside the definition.
 *
 * A full stop alone is still NOT a break — a definition may be written in
 * several sentences ("For the avoidance of doubt, …"), and a wrap after an
 * abbreviation ("Northgate Foods, Inc.") is not the end of anything. It takes
 * BOTH a finished sentence and a structural marker opening the next line.
 */
const BLOCK_BREAK = /\n\n|(?<=\.)\n(?:§|ARTICLE\b|Article\b|Section\s+\d|\([a-z0-9ivx]+\)|\d+\.\d)/g;

function findDefinitions(
  term: string,
  chunks: readonly SourceChunk[],
  requireQuotes: boolean,
): (LocatedDefinition & { doc_type: string | null })[] {
  const t = escapeRe(foldText(term));
  const opener = requireQuotes
    ? new RegExp(`"${t}"\\s+(?:means|shall\\s+mean)\\b`, "gi")
    : new RegExp(`(?<![\\w"])${t}\\s+(?:means|shall\\s+mean)\\b`, "gi");
  const out: (LocatedDefinition & { doc_type: string | null })[] = [];
  for (const chunk of chunks) {
    const text = foldLines(chunk.content);
    for (const m of text.matchAll(opener)) {
      const start = m.index ?? 0;
      const bodyFrom = start + m[0].length;
      let end = text.length;
      for (const re of [ANY_DEFINITION, BLOCK_BREAK]) {
        for (const n of text.slice(bodyFrom).matchAll(re)) {
          const at = bodyFrom + (n.index ?? 0);
          if (at < end) end = at;
          break; // the FIRST boundary of each kind is the only one that matters
        }
      }
      out.push({
        citation: chunk.citation,
        doc_type: chunk.doc_type,
        doc_title: chunk.doc_title,
        effective_date: chunk.effective_date ?? null,
        text: text.slice(start, end).trim(),
        section_text: text,
      });
    }
  }
  return out;
}

/** Two citations naming the same (document, section) — "CA §1.01" and "CA §1.01(a)" do. */
function sameClause(a: string, b: string): boolean {
  const x = resolveCitation(a);
  const y = resolveCitation(b);
  return x.section !== null && x.section === y.section && x.doc_title === y.doc_title;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** True when the quote writes `iso` as 2026-04-01, "April 1, 2026" or "1 April 2026". */
export function quoteContainsDate(quote: string, iso: string): boolean {
  if (!isIsoDate(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const q = foldText(quote).toLowerCase();
  const month = MONTHS[m - 1].toLowerCase();
  return q.includes(iso) || q.includes(`${month} ${d}, ${y}`) || q.includes(`${d} ${month} ${y}`);
}

/**
 * Chunks keyed the way the guardrail looks them up: by the EXACT citation string
 * each source citation uses. A citation names a sub-clause ("CA §7.11(b)(i)")
 * while a chunk is a whole section, so the citation is resolved to its
 * (document, section) with `resolveCitation` and mapped to that chunk's text.
 * One citation that resolves to nothing gets no chunk, and so a violation.
 */
export function chunksForCitations(
  sourceCitations: unknown,
  chunks: readonly SourceChunk[],
): { citation: string; content: string }[] {
  const out = new Map<string, string>();
  for (const c of Array.isArray(sourceCitations) ? sourceCitations : []) {
    if (!isObj(c) || typeof c.citation !== "string") continue;
    const cite = c.citation.trim();
    if (out.has(cite)) continue;
    const r = resolveCitation(cite);
    if (!r.doc_title || !r.section) continue;
    const parts = chunks.filter((k) => k.doc_title === r.doc_title && k.section === r.section).map((k) => k.content);
    if (parts.length > 0) out.set(cite, parts.join("\n"));
  }
  return [...out].map(([citation, content]) => ({ citation, content }));
}

/** Citations the server insists on. Numeric ones are also caught by the guardrail; the rest are not. */
function requiredCitationFields(terms: Obj): string[] {
  const fields = ["threshold.min_dscr", "denominator.components"];
  const nu = terms.numerator;
  if (isObj(nu)) {
    // Always, even for an empty list: "no deductions" is a claim about the ratio
    // definition, and an empty list with no citation is how deductions get dropped.
    fields.push("numerator.deductions");
    if (Array.isArray(nu.addbacks)) nu.addbacks.forEach((_, i) => fields.push(`numerator.addbacks[${i}].cap`));
  }
  if (Array.isArray(terms.effective_amendments)) terms.effective_amendments.forEach((_, i) => fields.push(`effective_amendments[${i}].effective`));
  return fields;
}

/**
 * THE S-1 CHECK. Runs `verifyTermsProvenance` (every numeric value appears in
 * the quote it cites, a minimum ratio is stated AS a ratio, and the quote is in
 * the cited chunk) and then closes what it leaves open:
 *
 *   - a required non-numeric field with no citation at all (a deduction list, a
 *     denominator, an amendment date) would pass the guardrail, which only walks
 *     numbers
 *   - a non-numeric citation whose quote is not in its chunk likewise
 *   - an amendment's effective date feeds `effective_from`, so it must be written
 *     in its own quote
 *   - names and lists (add-backs, deductions, components, base, basis) must be
 *     supported by the text cited for them: see `checkNamedTerms`
 *
 * For the DEFINITIONAL fields it also refuses to take the proposer's word for
 * what the question is. `locateDefinition` finds the defining clause in the
 * chunks the SERVER loaded, and completeness is judged against that; the
 * citation has to point at it. If no definition of that drafting form is on
 * file the completeness check does NOT run and does NOT fall back to the cited
 * chunk — falling back would hand scope selection straight back to the
 * proposer, which is the bug this exists to fix. `termsWarnings` then raises
 * `definition_not_located` so the human knows the check did not run rather
 * than believing it passed.
 *
 * Returns every violation with the field, the value and the reason, so a human
 * can act on it. Pure; callers supply the chunks.
 */
export function checkTermsProvenance(
  terms: Obj,
  sourceCitations: unknown,
  chunks: readonly SourceChunk[],
): { valid: boolean; violations: Violation[] } {
  const cites = Array.isArray(sourceCitations) ? sourceCitations : [];
  const keyed = chunksForCitations(cites, chunks);
  const base = verifyTermsProvenance(terms, cites, keyed) as { violations: Violation[] };
  const violations: Violation[] = [...base.violations];
  const flagged = new Set(violations.map((v) => v.field));
  const flag = (field: string, reason: string) => {
    if (flagged.has(field)) return;
    flagged.add(field);
    violations.push({ field, value: getAtPath(terms, field) ?? null, reason });
  };

  const byField = new Map<string, Obj>();
  for (const c of cites) if (isObj(c) && typeof c.field === "string") byField.set(c.field, c);

  for (const field of requiredCitationFields(terms)) {
    if (!byField.has(field)) flag(field, "no citation for this term");
  }

  const content = new Map(keyed.map((k) => [k.citation, foldText(k.content)]));
  for (const c of cites) {
    if (!isObj(c) || typeof c.field !== "string") {
      violations.push({ field: String(isObj(c) ? c.field : c), value: null, reason: "malformed citation entry" });
      continue;
    }
    if (typeof c.citation !== "string" || typeof c.quote !== "string" || c.quote.trim() === "") {
      flag(c.field, "citation entry needs a citation and a non-empty quote");
      continue;
    }
    const chunk = content.get(c.citation.trim());
    if (chunk === undefined) flag(c.field, `no chunk supplied for ${c.citation}`);
    else if (!chunk.includes(foldText(c.quote))) flag(c.field, `quote not found in ${c.citation}`);
    else if (/\.effective$/.test(c.field)) {
      const date = getAtPath(terms, c.field);
      if (typeof date !== "string" || !quoteContainsDate(c.quote, date)) {
        flag(c.field, `date ${String(date)} does not appear in its cited quote`);
      }
    }
  }

  // Everything the guardrail's number-walk cannot see: names and lists.
  const entry = (field: string) => (flagged.has(field) ? undefined : byField.get(field));
  // The whole cited chunk, raw, so list items can be split on the document's own delimiters.
  const rawByCitation = new Map(keyed.map((k) => [k.citation, k.content]));
  const chunkOf = (field: string): string => {
    const e = entry(field);
    return e ? rawByCitation.get(String(e.citation).trim()) ?? "" : "";
  };
  checkNamedTerms(terms, entry, chunkOf, definitionsIn(chunks), flag);

  return { valid: violations.length === 0, violations };
}

/** The terms whose definition the server locates for itself, and the field each governs. */
export const DEFINED_BY_SERVER = {
  "numerator.deductions": "Debt Service Coverage Ratio",
  "denominator.components": "Debt Service",
} as const;

export type ServerDefinitions = Record<string, LocatedDefinition[]>;

/** Every server-located definition the provenance check needs, computed once. */
export function definitionsIn(chunks: readonly SourceChunk[]): ServerDefinitions {
  const out: ServerDefinitions = {};
  for (const [field, term] of Object.entries(DEFINED_BY_SERVER)) out[field] = locateDefinition(term, chunks);
  return out;
}

// ---------------------------------------------------- non-numeric support

/** How each calculator component is written in a clause. The vocabulary is calc/dscr.js's. */
const DEDUCTION_WORDS: Record<string, RegExp> = {
  unfinanced_capex: /unfinanced\s+capital\s+expenditures?|unfinanced\s+capex/i,
  cash_taxes: /cash\s+taxes|taxes\s+paid/i,
};
const DENOMINATOR_WORDS: Record<string, RegExp> = {
  scheduled_principal: /scheduled\s+principal/i,
  cash_interest: /cash\s+interest|interest\s+paid/i,
};
/** A clause saying an add-back has no limit. A quote with none of these cannot support `cap: null`. */
const UNCAPPED = /\b(without\s+(?:any\s+)?(?:limit|limitation|cap)|no\s+(?:limit|cap|maximum)|not\s+(?:be\s+)?subject\s+to\s+(?:any\s+)?(?:limit|cap)|unlimited|uncapped|without\s+regard\s+to\s+(?:any\s+)?(?:limit|cap))/i;
/** Words that put a limit on an amount; a quote containing one cannot be the source of "uncapped". */
const CAPPING = /\$\s?\d|not\s+to\s+exceed|shall\s+not\s+exceed|no\s+more\s+than|up\s+to|at\s+most/i;

const has = (quote: string, phrase: string) => phrase.trim() !== "" && foldText(quote).toLowerCase().includes(foldText(phrase).toLowerCase());

/** The delimited items of a passage: lines, `;`, and ", and" / ", or" in a list. Sentences are NOT detected: legal prose has no reliable full stop. */
const listItems = (raw: string): string[] => raw.split(/;|\n|,\s+(?:and|or)\s+/i).map(foldText).filter(Boolean);

const sameFigure = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The guardrail proves a NUMBER is in its quote. A named add-back, a deduction,
 * a denominator component, the basis and the base are just as capable of being
 * wrong, and a fabricated add-back name is the same class of lie as a fabricated
 * cap. There are three questions here with three different scopes, on purpose,
 * and the scope is chosen by whoever can be trusted to choose it:
 *
 *   COMPLETENESS ("did the proposal drop a deduction?") is judged against the
 *   DEFINING CLAUSE THE SERVER LOCATED (`locateDefinition`), never against
 *   anything the proposer chose. A proposer that quotes half a definition, stops
 *   at a ";" or an "Inc.", or cites a different section altogether changes
 *   nothing about the answer.
 *
 *     deductions        exactly the set the DSCR definition names: one it names
 *                       that the terms drop is as wrong as one invented
 *     components        exactly the set the Debt Service definition names
 *     numerator.base    appears in the DSCR definition
 *     citation          must point AT the defining clause, so the provenance
 *                       record shows the clause the check actually used
 *
 *   What that refuses: emptying or trimming either list. What it must keep
 *   allowing: correct terms whose definition sits in a §1.01 definitions dump
 *   alongside unrelated definitions that happen to use a deduction's words
 *   ('"Net Income" means net income after taxes paid in cash'). Judging the
 *   whole section refused those, and a refusal of correct terms stops an
 *   analyst boarding a covenant at all.
 *
 *   CLAUSE SCOPE: `cap: null` is not a definition, so its ground truth is the
 *   clause that PERMITS the add-back, which is cited and whose quote is
 *   verbatim. The quote must say uncapped, and no list item of the cited chunk
 *   naming the add-back may state a limit; so a quote cut away from "not to
 *   exceed $500,000" cannot support an uncapped term. `basis` likewise: the
 *   chunk whose quote states the threshold must state the period.
 *
 *   PAIRING ("does this cap belong to this add-back?") is judged against the
 *   DELIMITED LIST ITEM, because the delimiter that is wrong for completeness is
 *   right for pairing: in "may add back A, up to $500,000; and B, up to
 *   $800,000" both numbers are in the quote, and only the item says which is A's.
 *   It refuses a cap that sits in the item of a DIFFERENT add-back the terms
 *   name — a swap. It keeps allowing a figure in an item that names no other
 *   add-back: a list sharing one cap ("A, B, and C ... not to exceed $500,000"),
 *   a name that itself contains ", and", and a quote carrying the source's hard
 *   line wraps. Those are correct terms, and refusing them bought nothing: the
 *   figure is still proved present in the quote by the guardrail.
 *
 * `entry(field)` is undefined when that field has no usable citation (absent, or
 * already flagged), in which case there is nothing to check against and the
 * earlier violation already stands.
 */
function checkNamedTerms(
  terms: Obj,
  entry: (field: string) => Obj | undefined,
  chunkOf: (field: string) => string,
  definitions: ServerDefinitions,
  flag: (field: string, reason: string) => void,
): void {
  const quoteOf = (field: string): string | undefined => {
    const q = entry(field)?.quote;
    return typeof q === "string" ? q : undefined;
  };

  const nu = isObj(terms.numerator) ? terms.numerator : {};
  const addbacks = Array.isArray(nu.addbacks) ? nu.addbacks : [];
  const addbackNames = addbacks.filter(isObj).map((a) => (typeof a.name === "string" ? a.name : "")).filter(Boolean);
  addbacks.forEach((ab, i) => {
    if (!isObj(ab) || typeof ab.name !== "string") return;
    const name: string = ab.name;
    const field = `numerator.addbacks[${i}].cap`;
    const q = quoteOf(field);
    if (q === undefined) return;
    if (!has(q, name)) {
      flag(`numerator.addbacks[${i}].name`, `add-back "${name}" does not appear in the quote cited for it`);
      return;
    }
    const items = listItems(q);
    const mine = items.filter((it) => has(it, name));
    if (typeof ab.cap === "number") {
      const cap = ab.cap;
      const hasCap = (it: string) => extractFigures(it).some((n: number) => sameFigure(n, cap));
      // Refuse only a cap that belongs to a DIFFERENT add-back these terms name.
      // A figure in an item naming no add-back at all is a shared or trailing
      // cap, which is how lists are drafted, so it is allowed.
      const theirs = items.filter((it) => !has(it, name) && addbackNames.some((other) => other !== name && has(it, other)));
      if (!mine.some(hasCap) && theirs.some(hasCap)) {
        flag(field, `cap ${cap} sits with another add-back, not with "${name}", in its cited quote`);
      }
    } else if (ab.cap === null) {
      const named = listItems(chunkOf(field)).filter((it) => has(it, name));
      if (!mine.some((it) => UNCAPPED.test(it))) {
        flag(field, "cap is null (uncapped), but its cited quote does not say the add-back is uncapped");
      } else if (named.some((it) => CAPPING.test(it))) {
        flag(field, "cap is null (uncapped), but the cited chunk states a limit for this add-back");
      }
    }
  });

  /**
   * The ground truth for a definitional field: what the server found, not what
   * was cited. `null` means no definition of that form is on file, and then
   * nothing here runs — see `checkTermsProvenance` and `definition_not_located`.
   */
  const groundTruth = (field: string): { text: string; where: string } | null => {
    const found = definitions[field] ?? [];
    if (found.length === 0) return null;
    const term = DEFINED_BY_SERVER[field as keyof typeof DEFINED_BY_SERVER];
    const where = `the clause that defines "${term}" (${[...new Set(found.map((d) => d.citation))].join(", ")})`;
    const e = entry(field);
    if (e && typeof e.citation === "string" && !found.some((d) => sameClause(e.citation as string, d.citation))) {
      flag(field, `this term must cite ${where}, not ${e.citation}`);
      return null;
    }
    return { text: found.map((d) => d.text).join("\n"), where };
  };

  const exactSet = (field: string, listed: unknown, words: Record<string, RegExp>) => {
    if (!Array.isArray(listed)) return;
    const truth = groundTruth(field);
    if (truth === null) return;
    const problems: string[] = [];
    for (const [name, re] of Object.entries(words)) {
      const named = re.test(foldText(truth.text));
      const included = listed.includes(name);
      if (included && !named) problems.push(`terms include ${name} but ${truth.where} does not mention it`);
      if (named && !included) problems.push(`${truth.where} mentions ${name} but the terms leave it out`);
    }
    if (problems.length > 0) flag(field, problems.join("; "));
  };
  exactSet("numerator.deductions", nu.deductions, DEDUCTION_WORDS);
  exactSet("denominator.components", isObj(terms.denominator) ? terms.denominator.components : undefined, DENOMINATOR_WORDS);

  // The base is a NAME, not a completeness question, so its scope is the whole
  // section the located definition sits in — still chosen by the server, never by
  // the proposer. Refuses a fabricated base ("Adjusted EBITDA" is nowhere in the
  // definitions article); keeps allowing a definition that writes the base once
  // and refers to it by a short form afterwards, which the clause-only scope
  // would have refused.
  const ratioDefinition = definitions["numerator.deductions"] ?? [];
  const baseScope = ratioDefinition.map((d) => `${d.text}\n${d.section_text}`).join("\n");
  if (baseScope !== "" && typeof nu.base === "string" && !has(baseScope, nu.base)) {
    flag("numerator.base", `base "${nu.base}" does not appear in the article that defines "${DEFINED_BY_SERVER["numerator.deductions"]}"`);
  }

  const thresholdChunk = chunkOf("threshold.min_dscr");
  const tp = isObj(terms.test_period) ? terms.test_period : {};
  if (thresholdChunk !== "" && typeof tp.basis === "string") {
    const trailing = /trailing\s+(?:four|4|twelve|12)[\s-]+(?:fiscal\s+)?(?:quarter|month)s?/i.test(foldText(thresholdChunk));
    const supported = tp.basis === "TTM" ? trailing : has(thresholdChunk, tp.basis);
    if (!supported) flag("test_period.basis", `basis "${tp.basis}" is not stated in the chunk cited for the threshold`);
  }

  const amendments = Array.isArray(terms.effective_amendments) ? terms.effective_amendments : [];
  amendments.forEach((am, i) => {
    const e = entry(`effective_amendments[${i}].effective`);
    if (!isObj(am) || !e || typeof e.citation !== "string") return;
    const cited = resolveCitation(e.citation).doc_title;
    if (cited !== am.doc) flag(`effective_amendments[${i}].doc`, `"${String(am.doc)}" is not the document its effective-date citation (${e.citation}) points into`);
  });
}

/**
 * The threshold alone. The definition agent uses it to refuse to propose
 * anything whose minimum DSCR cannot be found, verbatim, in the retrieved text:
 * a plausible default (1.25 is the common value) is the worst failure available.
 */
export function thresholdProvenance(
  terms: Obj,
  sourceCitations: unknown,
  chunks: readonly SourceChunk[],
): { valid: boolean; violations: Violation[] } {
  const th = isObj(terms.threshold) ? terms.threshold : {};
  const only = checkTermsProvenance({ threshold: { min_dscr: th.min_dscr } }, sourceCitations, chunks);
  const violations = only.violations.filter((v) => v.field === "threshold.min_dscr");
  return { valid: violations.length === 0, violations };
}

// ------------------------------------------------------------ warnings

/**
 * A heads-up for the human, never a refusal: the agent may be right and the
 * deterministic reading below may be wrong. What these catch is OMISSION, which
 * provenance cannot (it proves what is stated, not what was left out).
 */
export interface TermsWarning {
  code:
    | "amendment_not_cited"
    | "clause_amended"
    | "addback_not_in_terms"
    /** No `"Term" means` clause on file: the completeness check DID NOT RUN. */
    | "definition_not_located"
    /** The located clause runs past its first sentence, and the continuation is what puts a word in the test. */
    | "definition_extent_ambiguous"
    /** Two documents of the same effective date define the term; both were used. */
    | "definition_conflict"
    /** Another document also defines the term; the later one was used and this records the choice. */
    | "definition_superseded"
    /** The governing definition limits itself (a period, a purpose) but was taken whole. */
    | "definition_amendment_partial";
  message: string;
  citation?: string;
  field?: string;
}

const norm = (s: string) => foldText(s).toLowerCase();

/** "Section 7.11(b) of the Credit Agreement is amended", "amends Section 7.11" -> ["7.11(b)", ...] */
const AMENDED_SECTION = [
  /Section\s+(\d+(?:\.\d+)*)((?:\([a-z0-9]+\))*)\s+of\s+the\s+(?:Credit\s+)?Agreement\s+(?:is|are|shall\s+be)\s+(?:hereby\s+)?(?:amended|restated|replaced|deleted|modified)/gi,
  /\bamends?\s+(?:and\s+restates\s+)?Section\s+(\d+(?:\.\d+)*)((?:\([a-z0-9]+\))*)/gi,
];
/** "the Borrower may add back <name>, to the extent ..." */
const ADD_BACK_PERMISSION = /\badd\s+back\s+([^,.;()]+?)(?=\s*(?:,|;|\.|\bto\s+the\s+extent\b|\bin\s+an\s+aggregate\b|$))/gi;

const subOverlap = (a: string, b: string) => a === "" || b === "" || a.startsWith(b) || b.startsWith(a);

/** Words the calculator's vocabulary is detected by, for both definitional fields. */
const DEFINITION_WORDS: Record<string, Record<string, RegExp>> = {
  "numerator.deductions": DEDUCTION_WORDS,
  "denominator.components": DENOMINATOR_WORDS,
};

/**
 * A restatement that limits itself: to a period, to a purpose, to a while. Taken
 * whole it would replace the agreement's definition for every test, forever.
 */
const LIMITED_RESTATEMENT = /\b(solely\s+for|only\s+for|only\s+with\s+respect\s+to|for\s+the\s+(?:test\s+period|fiscal\s+quarter|fiscal\s+year)s?\s+end(?:ing|ed)|for\s+purposes\s+of\s+this\s+(?:Section|Amendment)|temporar(?:y|ily)|through\s+the\s+test\s+period|until\s+(?:the|such)|notwithstanding\s+the\s+foregoing)\b/i;

/** Rough sentence split. Used ONLY for a warning, never to decide a scope: a wrong split here costs a heads-up, not a verdict. */
const sentences = (text: string): string[] =>
  foldText(text)
    .split(/(?<=[.;])\s+(?=[A-Z"(])/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * What the human needs to know about the clause the server judged them against.
 * None of these is a refusal: each is a place where the DOCUMENT, not the model,
 * leaves the machine check less than conclusive, and a human reading the clause
 * settles it. Saying nothing would let silence read as a clean pass, which is
 * the same failure shape as a wrong number with a real citation.
 */
function definitionWarnings(
  field: string,
  term: string,
  located: readonly LocatedDefinition[],
  chunks: readonly SourceChunk[],
): TermsWarning[] {
  const out: TermsWarning[] = [];
  const words = DEFINITION_WORDS[field] ?? {};
  const where = [...new Set(located.map((d) => d.citation))].join(", ");

  // Two documents of the same effective date: both were used, so the check fails
  // closed, but nothing decided WHICH governs and a human must.
  const titles = [...new Set(located.map((d) => d.doc_title ?? "an untitled document"))];
  if (titles.length > 1) {
    out.push({
      code: "definition_conflict",
      field,
      citation: where,
      message: `${titles.join(" and ")} each define "${term}" and nothing separates them by date, so ${field} was checked against both. Read them and decide which governs.`,
    });
  }

  // The definitions on file that are NOT the governing one. Named so a human can
  // see that a restatement was superseded rather than ignored.
  const all = definingDocuments(term, chunks);
  const superseded = all.filter((d) => !titles.includes(d.doc_title ?? "an untitled document"));
  if (superseded.length > 0) {
    out.push({
      code: "definition_superseded",
      field,
      citation: where,
      message: `"${term}" is also defined in ${superseded.map((d) => `${d.doc_title ?? "an untitled document"} (${d.effective_date ?? "no effective date on file"})`).join(", ")}. ${titles.join(" and ")} governs because it is later; the others were not used.`,
    });
  }

  for (const d of located) {
    // A restatement that limits itself was still taken as the whole definition
    // for every period. Scoping a definition to a test period is not implemented:
    // a proposal's `test_period.period_end` is null, so there is no period to
    // scope it against. The honest move is to say so, not to take it silently.
    const limit = LIMITED_RESTATEMENT.exec(d.text);
    if (limit && d.doc_title !== null && d.effective_date !== null && (chunks.find((c) => c.doc_title === d.doc_title)?.doc_type === "amendment")) {
      out.push({
        code: "definition_amendment_partial",
        field,
        citation: d.citation,
        message: `The definition of "${term}" in ${d.doc_title} limits itself ("${limit[0]}") but was taken as the whole definition for every period: scoping a definition to a test period is not implemented. Confirm it governs the period you are boarding.`,
      });
    }

    // The clause runs past its first sentence, and the continuation is what puts
    // a word into the test. Legitimate ("for the avoidance of doubt, cash taxes
    // paid shall also be deducted") or not (section prose in the same paragraph),
    // and only the document can say which.
    const parts = sentences(d.text);
    if (parts.length > 1) {
      const first = parts[0];
      const added = Object.entries(words)
        .filter(([, re]) => re.test(d.text) && !re.test(first))
        .map(([name]) => name);
      if (added.length > 0) {
        out.push({
          code: "definition_extent_ambiguous",
          field,
          citation: d.citation,
          message: `${added.join(", ")} appears in "${term}" (${d.citation}) only after its first sentence: "${parts[1].slice(0, 140)}". It was read as part of the definition. If that sentence is separate section prose, ${field} is being checked against the wrong extent.`,
        });
      }
    }
  }
  return out;
}


export function termsWarnings(
  terms: Obj,
  sourceCitations: unknown,
  chunks: readonly SourceChunk[],
  amendmentTitles: readonly string[] = [],
): TermsWarning[] {
  const out: TermsWarning[] = [];
  const cites = (Array.isArray(sourceCitations) ? sourceCitations : []).filter(
    (c): c is Obj & { field: string; citation: string } => isObj(c) && typeof c.field === "string" && typeof c.citation === "string",
  );

  // 0. The server could not find a defining clause, so the completeness check on
  //    that field DID NOT RUN. It deliberately does not fall back to the chunk
  //    the proposer cited (that is the bug it exists to prevent), so the only
  //    honest thing is to say so: a human must read the definition themselves.
  //    Not a refusal — refusing would make every agreement drafted without a
  //    `"Term" means` definitions clause unboardable.
  for (const [field, term] of Object.entries(DEFINED_BY_SERVER)) {
    const located = locateDefinition(term, chunks);
    if (located.length === 0) {
      out.push({
        code: "definition_not_located",
        field,
        message: `No clause defining "${term}" could be found in the agreement or amendments on file, so the completeness of ${field} was NOT verified against the document. Read the definition and check this list yourself.`,
      });
      continue;
    }
    out.push(...definitionWarnings(field, term, located, chunks));
  }

  // 1. An amendment on file that no term cites. If it changes the covenant, the terms omit it.
  const titles = new Set<string>([...amendmentTitles, ...chunks.filter((c) => c.doc_type === "amendment" && c.doc_title).map((c) => c.doc_title as string)]);
  const referenced = new Set<string>();
  for (const c of cites) {
    const t = resolveCitation(c.citation).doc_title;
    if (t) referenced.add(t);
  }
  for (const am of Array.isArray(terms.effective_amendments) ? terms.effective_amendments : []) {
    if (isObj(am) && typeof am.doc === "string") referenced.add(am.doc);
  }
  for (const title of [...titles].sort()) {
    if (!referenced.has(title)) {
      out.push({
        code: "amendment_not_cited",
        message: `${title} is on file but no term cites it. If it changes the covenant, these terms leave that out; read it before approving.`,
      });
    }
  }

  // 2. A cited clause that a later amendment amends or restates.
  const amended: { ref: string; section: string; subs: string; by: string }[] = [];
  for (const chunk of chunks) {
    if (chunk.doc_type !== "amendment") continue;
    for (const re of AMENDED_SECTION) {
      for (const m of chunk.content.matchAll(re)) {
        amended.push({ ref: `§${m[1]}${m[2]}`, section: `§${m[1]}`, subs: m[2], by: chunk.citation });
      }
    }
  }
  const seen = new Set<string>();
  for (const c of cites) {
    const r = resolveCitation(c.citation);
    if (r.doc_type !== "agreement" || !r.section) continue;
    const subs = /^[^§]*§\s*\d+(?:\.\d+)*((?:\([a-z0-9]+\))*)/i.exec(c.citation)?.[1] ?? "";
    for (const a of amended) {
      if (a.section !== r.section || !subOverlap(a.subs, subs)) continue;
      const key = `${c.field}|${a.by}|${a.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code: "clause_amended",
        field: c.field,
        citation: c.citation,
        message: `${c.field} cites ${c.citation}, but ${a.by} amends ${a.ref}. Check the original clause still reads as quoted.`,
      });
    }
  }

  // 3. An add-back the documents permit that no term lists.
  const listed = new Set(
    (isObj(terms.numerator) && Array.isArray(terms.numerator.addbacks) ? terms.numerator.addbacks : [])
      .map((ab) => (isObj(ab) && typeof ab.name === "string" ? norm(ab.name) : ""))
      .filter(Boolean),
  );
  const flagged = new Set<string>();
  for (const chunk of chunks) {
    for (const m of chunk.content.matchAll(ADD_BACK_PERMISSION)) {
      const name = norm(m[1]);
      if (!name || listed.has(name) || flagged.has(name)) continue;
      flagged.add(name);
      out.push({
        code: "addback_not_in_terms",
        citation: chunk.citation,
        message: `${chunk.citation} permits an add-back for "${m[1].trim()}", but no term lists it.`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------ database

const check = <T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T => {
  if (r.error) throw new TermsError(500, `${what}: ${r.error.message}`);
  return r.data;
};

/** Everything a facility's agreement and amendments say, as the guardrail's chunk shape. */
export async function loadSourceChunks(client: Db, facilityId: string): Promise<SourceChunk[]> {
  const rows = check(
    await client
      .from("doc_chunks")
      .select("content, metadata")
      .eq("metadata->>facility_id", facilityId)
      .in("metadata->>doc_type", [...SOURCE_DOC_TYPES]),
    "select doc_chunks",
  ) as { content: string; metadata: { doc_type?: string; doc_title?: string; section?: string | null } }[] | null;
  // The chunk metadata does not carry a date, and precedence between two
  // documents defining the same term is decided by date, so bring it along.
  const docs = check(
    await client.from("documents").select("title, effective_date").eq("facility_id", facilityId),
    "select documents",
  ) as { title: string; effective_date: string | null }[] | null;
  const effective = new Map((docs ?? []).map((d) => [d.title, d.effective_date]));
  return (rows ?? []).map((r) => ({
    content: r.content,
    doc_type: r.metadata?.doc_type ?? null,
    doc_title: r.metadata?.doc_title ?? null,
    section: r.metadata?.section ?? null,
    effective_date: effective.get(r.metadata?.doc_title ?? "") ?? null,
    citation: citationFor(r.metadata?.doc_type ?? null, r.metadata?.doc_title ?? null, r.metadata?.section ?? null),
  }));
}

/** Titles of every amendment document on file, whether or not it produced chunks. */
export async function loadAmendmentTitles(client: Db, facilityId: string): Promise<string[]> {
  const rows = check(
    await client.from("documents").select("title").eq("facility_id", facilityId).eq("doc_type", "amendment"),
    "select documents",
  ) as { title: string }[] | null;
  return (rows ?? []).map((r) => r.title);
}

/**
 * The date the terms take effect: the latest amendment they carry, else the
 * agreement's own date. Derived from the terms and the document record, never
 * typed in, so the date cannot disagree with the clause it came from.
 */
export async function resolveEffectiveFrom(client: Db, facilityId: string, terms: Obj): Promise<string> {
  const amendments = Array.isArray(terms.effective_amendments) ? terms.effective_amendments : [];
  const dates = amendments.map((a) => (isObj(a) ? a.effective : null)).filter(isIsoDate).sort();
  if (dates.length > 0) return dates[dates.length - 1];

  const docs = check(
    await client.from("documents").select("effective_date").eq("facility_id", facilityId).eq("doc_type", "agreement"),
    "select documents",
  ) as { effective_date: string | null }[] | null;
  const agreement = (docs ?? []).map((d) => d.effective_date).filter(isIsoDate).sort()[0];
  if (!agreement) {
    throw new TermsError(422, "Cannot determine an effective date: the terms list no amendment and the agreement has no effective_date on file.");
  }
  return agreement;
}

interface VersionRow {
  id: string;
  version: number;
  status: string;
  effective_from: string;
}

async function loadVersions(client: Db, facilityId: string): Promise<VersionRow[]> {
  return (check(
    await client.from("covenant_terms").select("id, version, status, effective_from").eq("facility_id", facilityId),
    "select covenant_terms",
  ) ?? []) as VersionRow[];
}

/**
 * Retire the approved version(s) the new terms replace: `effective_to` becomes
 * the day before `newEffectiveFrom` and the status becomes `superseded`. That is
 * the whole write. `terms` and `source_citations` are never in the patch, so a Q1
 * test stays reproducible against the terms in force in Q1.
 */
export async function supersede(
  client: Db,
  facilityId: string,
  newEffectiveFrom: string,
): Promise<{ id: string; version: number }[]> {
  const effectiveTo = dayBefore(newEffectiveFrom);
  const approved = (await loadVersions(client, facilityId)).filter((r) => r.status === "approved");
  if (approved.length === 0) return [];
  for (const r of approved) {
    if (r.effective_from > effectiveTo) {
      throw new TermsError(422, `New terms effective ${newEffectiveFrom} must start after version ${r.version} (effective ${r.effective_from}).`);
    }
  }
  const done = check(
    await client
      .from("covenant_terms")
      .update({ status: "superseded", effective_to: effectiveTo })
      .eq("facility_id", facilityId)
      .in("id", approved.map((r) => r.id))
      .eq("status", "approved")
      .select("id, version"),
    "supersede covenant_terms",
  ) as { id: string; version: number }[] | null;
  return done ?? [];
}

/**
 * The version that governs a test for `periodEnd`: effective on or before it and
 * not yet ended. Stage 7 calls this.
 *
 * It looks at `superseded` rows as well as `approved` ones, and that is the
 * point. Once v2 exists, v1 is `superseded`, yet a Q1 test must still resolve to
 * v1. A `proposed` row never governs anything. Returns null when nothing is in
 * force, and the caller must then refuse to run rather than guess.
 */
export async function termsInForce(client: Db, facilityId: string, periodEnd: string): Promise<TermsRow | null> {
  if (!isIsoDate(periodEnd)) throw new TermsError(400, "periodEnd must be a YYYY-MM-DD date");
  const rows = (check(
    await client
      .from("covenant_terms")
      .select("*")
      .eq("facility_id", facilityId)
      .in("status", ["approved", "superseded"])
      .lte("effective_from", periodEnd)
      .order("version", { ascending: false }),
    "select covenant_terms",
  ) ?? []) as TermsRow[];
  // Newest first, so if a half-finished supersede left two open-ended rows, the later one wins.
  return rows.find((r) => r.effective_to === null || r.effective_to >= periodEnd) ?? null;
}

/**
 * The claim lost, after the previous version was already superseded. Leave the
 * facility in a state that is true:
 *
 *   - someone else's approval is now the current version: the previous version's
 *     window must end the day before THEIR terms begin, not before ours
 *   - nobody's is: the previous version governs again, as if we had not tried
 *
 * It only touches the version this call retired, and only its status and end
 * date. Never its terms. Returns false if the repair itself failed.
 */
async function settleAfterFailedClaim(
  client: Db,
  facilityId: string,
  retired: { id: string }[],
  myId: string,
): Promise<boolean> {
  if (retired.length === 0) return true; // someone else retired it, with their own date
  try {
    const winner = (await loadVersions(client, facilityId)).find((r) => r.status === "approved" && r.id !== myId);
    const patch = winner ? { effective_to: dayBefore(winner.effective_from) } : { status: "approved", effective_to: null };
    check(
      await client.from("covenant_terms").update(patch).eq("facility_id", facilityId).in("id", retired.map((r) => r.id)).eq("status", "superseded").select("id"),
      "repair covenant_terms",
    );
    return true;
  } catch (err) {
    console.error("could not repair the superseded version after a lost approval", err);
    return false;
  }
}

// -------------------------------------------------------------- handlers

export interface TermsDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  now?: () => string;
  /** Propose: the definition agent. Defaults to the real one. */
  propose?: (facilityId: string) => Promise<ProposeResult>;
}

/** A clause the model was shown. The screen lists the ones the proposal did not cite: that is how omission gets noticed. */
export interface Excerpt {
  citation: string;
  doc_title: string | null;
  doc_type: string | null;
  section: string | null;
  content: string;
}

export type ProposeResult =
  | { found: true; terms: Obj; source_citations: SourceCitation[]; excerpts?: Excerpt[] }
  | { found: false; reason: string; excerpts?: Excerpt[] };

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("./supabase/server.ts");
  return supabaseAdmin();
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ToolResult => ({
  status,
  body: { error, ...extra },
});

/**
 * PostgREST's "that column does not exist" for `warnings`. Migration 0008 adds
 * it; until the owner applies it, propose and approve fail, and they should fail
 * saying WHY rather than with a schema error nobody can act on. Silently
 * dropping the warnings instead would be the exact failure the column exists to
 * prevent: no record that a check did not run.
 */
function missingWarningsColumn(error: { message?: string; code?: string }): string | null {
  const m = String(error?.message ?? "");
  const undefinedColumn = error?.code === "42703" || error?.code === "PGRST204";
  return undefinedColumn && /warnings/i.test(m)
    ? `${m} — apply supabase/migrations/0008_terms_warnings.sql, which adds covenant_terms.warnings`
    : null;
}

function asResult(err: unknown): ToolResult {
  if (err instanceof TermsError) return fail(err.status, err.message, err.details);
  throw err;
}

/**
 * POST /api/covenant-terms/propose. Writes ONE `proposed` row, which governs
 * nothing; only an approved row can govern a test.
 */
export async function runPropose(body: unknown, deps: TermsDeps = {}): Promise<ToolResult> {
  try {
    if (!isObj(body)) return fail(400, "request body must be a JSON object");
    const facilityId = body.facility_id;
    if (typeof facilityId !== "string" || !UUID.test(facilityId)) return fail(400, "facility_id must be a UUID");

    const propose =
      deps.propose ?? (async (id: string) => (await import("./agent/tools/definition-agent.ts")).proposeTerms(id));
    const proposal = await propose(facilityId);
    // "No DSCR covenant I can find" is a legitimate answer a human must resolve, not an error.
    if (!proposal.found) {
      return { status: 200, body: { found: false, reason: proposal.reason, excerpts: proposal.excerpts ?? [] } };
    }

    const shape = validateTerms(proposal.terms);
    if (!shape.valid) return fail(502, "The definition agent returned terms that fail validation.", { errors: shape.errors });

    const client = deps.client ?? (await defaultClient());
    const chunks = await loadSourceChunks(client, facilityId);
    const provenance = checkTermsProvenance(proposal.terms, proposal.source_citations, chunks);
    const warnings = termsWarnings(proposal.terms, proposal.source_citations, chunks, await loadAmendmentTitles(client, facilityId));
    const effectiveFrom = await resolveEffectiveFrom(client, facilityId, proposal.terms);
    const version = nextVersion((await loadVersions(client, facilityId)).map((r) => r.version));

    const inserted = await client
      .from("covenant_terms")
      .insert({
        facility_id: facilityId,
        version,
        effective_from: effectiveFrom,
        terms: proposal.terms,
        source_citations: proposal.source_citations,
        status: "proposed",
        // Recorded ON the row, not only returned. A warning that only ever
        // reaches the screen cannot be audited a year later, and the one that
        // matters most says a machine check DID NOT RUN.
        warnings,
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code === UNIQUE_VIOLATION) return fail(409, "Another proposal for this facility was written at the same moment. Try again.");
      throw new TermsError(500, `insert covenant_terms: ${missingWarningsColumn(inserted.error) ?? inserted.error.message}`);
    }

    return {
      status: 200,
      body: {
        terms_id: (inserted.data as { id: string }).id,
        version,
        effective_from: effectiveFrom,
        terms: proposal.terms,
        source_citations: proposal.source_citations,
        provenance,
        warnings,
        // Everything the model was shown. The screen lists the clauses the terms
        // did not cite, because a person noticing a permitted add-back that no
        // term mentions is the only thing in the system that catches omission.
        excerpts: proposal.excerpts ?? [],
      },
    };
  } catch (err) {
    return asResult(err);
  }
}

/**
 * POST /api/covenant-terms/approve. The approval gate. Nothing is written until
 * every check has passed, and every check runs here regardless of what the
 * client already did:
 *
 *   1. an approver is named
 *   2. edits are applied, each marked analyst-corrected
 *   3. the shape is valid
 *   4. provenance holds, against chunks loaded from the database, not the client
 *   5. the previous version is superseded, THEN this one is approved. The
 *      database allows at most one approved row per facility (migration 0007),
 *      so of two racing approvals the second fails (409) at that step. It is
 *      never overwritten.
 *
 * What the approver field is and is not: four-eyes here is RECORDED, not
 * ENFORCED. `approved_by` is a name the caller typed. Nothing authenticates it,
 * and nothing stops the person who proposed from approving. What the route does
 * enforce is that a name is present and that the terms are supported by the text
 * they cite. Real maker-checker needs authenticated identity and a recorded
 * proposer, neither of which exists yet.
 */
export async function runApprove(body: unknown, deps: TermsDeps = {}): Promise<ToolResult> {
  try {
    if (!isObj(body)) return fail(400, "request body must be a JSON object");
    const { terms_id: termsId, approved_by: approvedByRaw, edits } = body;
    if (typeof termsId !== "string" || !UUID.test(termsId)) return fail(400, "terms_id must be a UUID");
    if (typeof approvedByRaw !== "string" || approvedByRaw.trim() === "") {
      return fail(400, "approved_by is required: an approval with no approver is a rubber stamp.");
    }
    const approvedBy = approvedByRaw.trim();
    if (approvedBy.length > MAX_APPROVER_LENGTH) return fail(400, `approved_by must be at most ${MAX_APPROVER_LENGTH} characters`);
    if (edits !== undefined && edits !== null && !Array.isArray(edits)) return fail(400, "edits must be an array");

    const client = deps.client ?? (await defaultClient());
    const found = check(await client.from("covenant_terms").select("*").eq("id", termsId).maybeSingle(), "select covenant_terms") as TermsRow | null;
    if (!found) return fail(404, "No covenant terms with that id.");
    if (found.status !== "proposed") return fail(409, `These terms are already ${found.status}; only a proposed row can be approved.`);

    let terms = found.terms;
    let citations = found.source_citations;
    if (Array.isArray(edits) && edits.length > 0) ({ terms, source_citations: citations } = applyEdits(terms, citations, edits));

    const shape = validateTerms(terms);
    if (!shape.valid) return fail(422, "The terms fail validation. Nothing was approved.", { errors: shape.errors });

    const chunks = await loadSourceChunks(client, found.facility_id);
    const provenance = checkTermsProvenance(terms, citations, chunks);
    if (!provenance.valid) {
      return fail(422, "Provenance check failed: a term's value is not supported by the clause it cites. Nothing was approved.", {
        violations: provenance.violations,
      });
    }

    const warnings = termsWarnings(terms, citations, chunks, await loadAmendmentTitles(client, found.facility_id));

    const effectiveFrom = await resolveEffectiveFrom(client, found.facility_id, terms);
    const others = (await loadVersions(client, found.facility_id)).filter((r) => r.id !== found.id);
    const latest = others.filter((r) => r.status !== "proposed").sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (latest && effectiveFrom <= latest.effective_from) {
      return fail(422, `These terms take effect ${effectiveFrom}, which is not after version ${latest.version} (effective ${latest.effective_from}). Nothing was approved.`);
    }
    const version = nextVersion(others.map((r) => r.version));
    const approvedAt = (deps.now ?? (() => new Date().toISOString()))();

    // Retire the previous version FIRST. The one-approved-row-per-facility index
    // (migration 0007) would otherwise reject the new row, and it is also what
    // turns two racing approvals into one winner and one 409.
    const retired = await supersede(client, found.facility_id, effectiveFrom);

    let claimed;
    try {
      claimed = await client
        .from("covenant_terms")
        .update({
          version,
          effective_from: effectiveFrom,
          terms,
          source_citations: citations,
          status: "approved",
          approved_by: approvedBy,
          approved_at: approvedAt,
          // RECOMPUTED here, from the chunks in this database and the terms as
          // edited, never taken from what propose returned: the client sits in
          // between and may have changed anything. This is the same reason
          // provenance is re-verified rather than trusted.
          warnings,
        })
        .eq("id", found.id)
        .eq("status", "proposed")
        .select("id, version, effective_from, status")
        .maybeSingle();
    } catch (err) {
      await settleAfterFailedClaim(client, found.facility_id, retired, found.id);
      throw err;
    }
    if (claimed.error || !claimed.data) {
      const repaired = await settleAfterFailedClaim(client, found.facility_id, retired, found.id);
      const note = repaired ? "" : " The previous version's end date could not be repaired; report this.";
      if (claimed.error && claimed.error.code !== UNIQUE_VIOLATION) {
        throw new TermsError(500, `approve covenant_terms: ${missingWarningsColumn(claimed.error) ?? claimed.error.message}.${note}`);
      }
      return fail(
        409,
        (claimed.error
          ? claimed.error.message.includes(ONE_APPROVED_INDEX)
            ? "Another approval for this facility landed first, and a facility may have only one approved version. Reload and review again."
            : "Another approval for this facility landed first. Reload and review again."
          : "These terms changed while you were approving them. Reload and review again.") + note,
      );
    }

    const row = claimed.data as { id: string; version: number; effective_from: string; status: string };
    return { status: 200, body: { terms_id: row.id, version: row.version, effective_from: row.effective_from, status: row.status } };
  } catch (err) {
    return asResult(err);
  }
}
