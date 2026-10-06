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
}

export interface TermsEdit {
  field: string;
  value: string | number | boolean | null;
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
    if (!(value === null || ["string", "number", "boolean"].includes(typeof value))) {
      throw new TermsError(400, `${at}.value must be a string, number, boolean or null`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new TermsError(400, `${at}.value must be finite`);
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
    // Only an existing scalar may be edited. Adding or removing structure is
    // not an edit; it is a different proposal.
    const isScalar = existing === null || ["string", "number", "boolean"].includes(typeof existing);
    if (!isScalar) throw new TermsError(400, `${at}.field "${field}" is not an existing scalar value in the terms`);
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
 *     supported by the quote cited for them: see `checkNamedTerms`
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
  checkNamedTerms(terms, entry, chunkOf, flag);

  return { valid: violations.length === 0, violations };
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
 * cap. So each is tied to the text cited for it, and there are two different
 * questions with two different scopes, on purpose:
 *
 *   COMPLETENESS ("did the proposal drop something?") is judged against the WHOLE
 *   CITED CHUNK. A chunk is one section, the natural legal unit, so no sentence
 *   has to be found: a proposer that quotes half a definition, or stops at a ";"
 *   or an "Inc.", cannot choose its own ground truth. The quote must still be
 *   verbatim in the chunk (checked before this runs); that anchors provenance.
 *
 *     deductions        the set the chunk names, exactly: one it names that the
 *                       terms drop is as wrong as one invented
 *     components        the same, for the Debt Service definition's chunk
 *     numerator.base    appears in the ratio definition's chunk
 *     basis             the threshold's chunk states it ("trailing four-quarter")
 *     cap: null         no list item of the chunk that names the add-back states
 *                       a limit, and the quote says it is uncapped
 *
 *   PAIRING ("does this cap belong to this add-back?") is judged against the
 *   DELIMITED LIST ITEM, because the delimiter that is wrong for completeness is
 *   right for pairing: in "may add back A, up to $500,000; and B, up to $800,000"
 *   both numbers are in the quote, and only the item says which is A's.
 *
 *     add-back name     appears in the quote cited for its cap
 *     capped add-back   the cap's figure is in the list item that names it
 *     amendment doc     is the document its effective-date citation points into
 *
 * `entry(field)` is undefined when that field has no usable citation (absent, or
 * already flagged), in which case there is nothing to check against and the
 * earlier violation already stands.
 */
function checkNamedTerms(
  terms: Obj,
  entry: (field: string) => Obj | undefined,
  chunkOf: (field: string) => string,
  flag: (field: string, reason: string) => void,
): void {
  const quoteOf = (field: string): string | undefined => {
    const q = entry(field)?.quote;
    return typeof q === "string" ? q : undefined;
  };

  const nu = isObj(terms.numerator) ? terms.numerator : {};
  const addbacks = Array.isArray(nu.addbacks) ? nu.addbacks : [];
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
    const mine = listItems(q).filter((it) => has(it, name));
    if (typeof ab.cap === "number") {
      const cap = ab.cap;
      if (!mine.some((it) => extractFigures(it).some((n: number) => sameFigure(n, cap)))) {
        flag(field, `cap ${cap} is not in the same list item as add-back "${name}" in its cited quote`);
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

  const exactSet = (field: string, listed: unknown, words: Record<string, RegExp>) => {
    const chunk = foldText(chunkOf(field));
    if (chunk === "" || !Array.isArray(listed)) return;
    const problems: string[] = [];
    for (const [name, re] of Object.entries(words)) {
      const named = re.test(chunk);
      const included = listed.includes(name);
      if (included && !named) problems.push(`terms include ${name} but the cited chunk does not mention it`);
      if (named && !included) problems.push(`the cited chunk mentions ${name} but the terms leave it out`);
    }
    if (problems.length > 0) flag(field, problems.join("; "));
  };
  exactSet("numerator.deductions", nu.deductions, DEDUCTION_WORDS);
  exactSet("denominator.components", isObj(terms.denominator) ? terms.denominator.components : undefined, DENOMINATOR_WORDS);

  const ratioDefinition = chunkOf("numerator.deductions");
  if (ratioDefinition !== "" && typeof nu.base === "string" && !has(ratioDefinition, nu.base)) {
    flag("numerator.base", `base "${nu.base}" does not appear in the chunk cited for the deductions`);
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
  code: "amendment_not_cited" | "clause_amended" | "addback_not_in_terms";
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
  return (rows ?? []).map((r) => ({
    content: r.content,
    doc_type: r.metadata?.doc_type ?? null,
    doc_title: r.metadata?.doc_title ?? null,
    section: r.metadata?.section ?? null,
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
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code === UNIQUE_VIOLATION) return fail(409, "Another proposal for this facility was written at the same moment. Try again.");
      throw new TermsError(500, `insert covenant_terms: ${inserted.error.message}`);
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
        throw new TermsError(500, `approve covenant_terms: ${claimed.error.message}.${note}`);
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
