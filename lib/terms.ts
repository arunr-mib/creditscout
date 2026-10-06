import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyTermsProvenance } from "../guardrails/guardrail.js";
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
    if (Array.isArray(nu.deductions) && nu.deductions.length > 0) fields.push("numerator.deductions");
    if (Array.isArray(nu.addbacks)) nu.addbacks.forEach((_, i) => fields.push(`numerator.addbacks[${i}].cap`));
  }
  if (Array.isArray(terms.effective_amendments)) terms.effective_amendments.forEach((_, i) => fields.push(`effective_amendments[${i}].effective`));
  return fields;
}

/**
 * THE S-1 CHECK. Runs `verifyTermsProvenance` (every numeric value appears in
 * the quote it cites, and that quote is in the cited chunk) and then closes what
 * it leaves open:
 *
 *   - a required non-numeric field with no citation at all (a deduction list, a
 *     denominator, an amendment date) would pass the guardrail, which only walks
 *     numbers
 *   - a non-numeric citation whose quote is not in its chunk likewise
 *   - an amendment's effective date feeds `effective_from`, so it must be written
 *     in its own quote
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
    else if (c.field === "threshold.min_dscr") {
      // "less than 1.25 to 1.00": both figures are IN the quote, so the
      // guardrail's value-in-quote test would accept 1.00. The minimum is the
      // figure before "to 1.00", and a threshold of 1.00 is a different covenant.
      const value = getAtPath(terms, c.field);
      const ratios = [...foldText(c.quote).matchAll(/(\d+(?:\.\d+)?)\s*(?:to|:)\s*1(?:\.0+)?(?!\d|\.\d)/gi)].map((m) => Number(m[1]));
      if (ratios.length > 0 && !ratios.includes(value as number)) {
        flag(c.field, `value ${String(value)} is not the minimum in its cited quote (the ratio reads ${ratios.join(", ")} to 1)`);
      }
    } else if (/\.effective$/.test(c.field)) {
      const date = getAtPath(terms, c.field);
      if (typeof date !== "string" || !quoteContainsDate(c.quote, date)) {
        flag(c.field, `date ${String(date)} does not appear in its cited quote`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
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
 *
 * `exceptId` is the row being approved, which already carries status approved by
 * the time this runs (approve claims its version first, so a race on the unique
 * version key fails before anything is superseded).
 */
export async function supersede(
  client: Db,
  facilityId: string,
  newEffectiveFrom: string,
  opts: { exceptId?: string } = {},
): Promise<{ id: string; version: number }[]> {
  const effectiveTo = dayBefore(newEffectiveFrom);
  const approved = (await loadVersions(client, facilityId)).filter((r) => r.status === "approved" && r.id !== opts.exceptId);
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

// -------------------------------------------------------------- handlers

export interface TermsDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  now?: () => string;
  /** Propose: the definition agent. Defaults to the real one. */
  propose?: (facilityId: string) => Promise<ProposeResult>;
}

export type ProposeResult =
  | { found: true; terms: Obj; source_citations: SourceCitation[] }
  | { found: false; reason: string };

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
    if (!proposal.found) return { status: 200, body: { found: false, reason: proposal.reason } };

    const shape = validateTerms(proposal.terms);
    if (!shape.valid) return fail(502, "The definition agent returned terms that fail validation.", { errors: shape.errors });

    const client = deps.client ?? (await defaultClient());
    const chunks = await loadSourceChunks(client, facilityId);
    const provenance = checkTermsProvenance(proposal.terms, proposal.source_citations, chunks);
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
      },
    };
  } catch (err) {
    return asResult(err);
  }
}

/**
 * POST /api/covenant-terms/approve. THE CONTROL. Nothing is written until every
 * check has passed, and every check runs here regardless of what the client
 * already did:
 *
 *   1. an approver is named (a rubber stamp with no name on it is not four-eyes)
 *   2. edits are applied, each marked analyst-corrected
 *   3. the shape is valid
 *   4. provenance holds, against chunks loaded from the database, not the client
 *   5. the version is claimed (unique key; a race is a 409), then the previous
 *      version is superseded. It is never overwritten.
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

    // Claim the version first. The unique key makes the second of two racing
    // approvals fail here, before anything has been superseded.
    const claimed = await client
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
    if (claimed.error) {
      if (claimed.error.code === UNIQUE_VIOLATION) return fail(409, "Another approval for this facility landed first. Reload and review again.");
      throw new TermsError(500, `approve covenant_terms: ${claimed.error.message}`);
    }
    if (!claimed.data) return fail(409, "These terms changed while you were approving them. Reload and review again.");

    try {
      await supersede(client, found.facility_id, effectiveFrom, { exceptId: found.id });
    } catch (err) {
      // The new version is approved and correct; the old one still carries no end date.
      // termsInForce resolves the newer version for any period it covers, so nothing
      // is mis-governed, but the record is incomplete and a person must finish it.
      console.error("supersede failed after approval", found.id, err);
      return fail(500, `Version ${version} is approved, but the previous version could not be marked superseded. Report this; do not approve again.`, { terms_id: found.id, version });
    }

    const row = claimed.data as { id: string; version: number; effective_from: string; status: string };
    return { status: 200, body: { terms_id: row.id, version: row.version, effective_from: row.effective_from, status: row.status } };
  } catch (err) {
    return asResult(err);
  }
}
