/**
 * The casefile review screen, as pure functions. No React, no I/O: the Client
 * Components only draw what this decides, and `node --test` can exercise it.
 *
 * What lives here is what must not be wrong on this screen: which badge a
 * recommendation gets, whether a figure was QUOTED from a document or COMPUTED
 * by code, whether a claim has a citation, whether the "seen similar" badge
 * appears, whether the screen is still active or read-only, and what an
 * override needs before it can be sent.
 *
 * Nothing here is the control. `submitReview` re-checks every rule the server
 * owns; this is the analyst's early warning, never permission.
 */
import { PATTERN_TAGS } from "../guardrails/casefile-schema.js";
import { lessonsLoaded } from "../lib/agent/trace.ts";
import { clauseFor, type Clause } from "./termsReview.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ------------------------------------------------------ recommendation badge

export type Recommendation = "resolve" | "request" | "escalate" | "abstain";

export interface BadgeView {
  /** Writing style (design.md section 8): a recommendation is a recommendation, never "Resolved". */
  label: string;
  icon: string;
  /** Tailwind token classes. Colour is never the only carrier: the label and the icon say the same. */
  tone: string;
}

/**
 * design.md 5.1. `abstain` is the muted token, deliberately NOT danger:
 * abstaining is correct behaviour, and colouring it as an error would train
 * analysts to see caution as malfunction. Typed as a Record over the union, so
 * a fifth recommendation is a compile error here and not a blank badge.
 */
export const RECOMMENDATION_BADGE: Record<Recommendation, BadgeView> = {
  resolve: { label: "Recommends resolve", icon: "✓", tone: "bg-success-bg text-success" },
  request: { label: "Recommends request docs", icon: "?", tone: "bg-human-bg text-human" },
  escalate: { label: "Recommends escalate", icon: "↑", tone: "bg-danger-bg text-danger" },
  abstain: { label: "Abstains", icon: "—", tone: "border border-border-strong text-text-muted" },
};

export function isRecommendation(v: unknown): v is Recommendation {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RECOMMENDATION_BADGE, v);
}

// ----------------------------------------------------------------- claims

export interface Claim {
  text: string;
  citation: string;
  quote: string;
}

export type CitationState = "cited" | "missing";

/** A claim whose citation is empty, whitespace or not a string has none. */
export function citationState(citation: unknown): CitationState {
  return typeof citation === "string" && citation.trim() !== "" ? "cited" : "missing";
}

/**
 * What `CitationChip` is handed. `undefined` is its "no citation" state, which
 * renders the danger chip: the absence is shown, never hidden (design.md 5.3,
 * integration I-6). There is deliberately no path that returns "nothing to draw".
 */
export function chipCitation(citation: unknown): string | undefined {
  return citationState(citation) === "cited" ? (citation as string).trim() : undefined;
}

/**
 * Every claim, in order, none dropped. A claim without a citation stays in the
 * list and is marked, so it cannot render as sound.
 */
export type ClaimView = Claim & { cited: boolean };

export function claimsOf(raw: unknown): ClaimView[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(isObj).map((c) => ({
    text: str(c.text),
    citation: str(c.citation).trim(),
    quote: str(c.quote),
    cited: citationState(c.citation) === "cited",
  }));
}

// ------------------------------------------------------------ calc table

/** One row of `calc_log`, as the page reads it. */
export interface CalcLogRow {
  calc_id: string;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  created_at?: string;
}

/**
 * Where a figure came from. This is the guardrail's own basis (a number in an
 * explanation must match a calculation or a quoted figure), so the analyst sees
 * it per row:
 *
 *   computed  code produced it; it carries the calc_id of the log row
 *   quoted    an input read from a document; it carries the citation and quote
 *   term      a human-approved covenant term (the required minimum), not a code
 *             output and not a document input. Plain, never amber.
 *   uncited   an input with no citation in the log. Drawn as "no citation".
 */
export type FigureSource =
  | { kind: "computed"; calcId: string }
  | { kind: "quoted"; citation: string; quote: string }
  | { kind: "term" }
  | { kind: "uncited" };

export type FigureFormat = "ratio" | "signed-ratio" | "amount";

export interface CalcRowView {
  key: string;
  label: string;
  value: number;
  format: FigureFormat;
  source: FigureSource;
  /** A word, never a number: a figure in a note would have no provenance of its own. */
  note?: string;
}

export interface CalcSection {
  calcId: string;
  /** "Calculation 1 of 2" */
  title: string;
  /** The last calculation is the one the policy judged. */
  governing: boolean;
  rows: CalcRowView[];
}

/** A citation as a log stores it: a bare string (the agent's calculator call) or `{citation, quote}` (the quarterly test). */
function readCitation(v: unknown): { citation: string; quote: string } | null {
  if (typeof v === "string") return v.trim() === "" ? null : { citation: v.trim(), quote: "" };
  if (isObj(v) && typeof v.citation === "string" && v.citation.trim() !== "") {
    return { citation: v.citation.trim(), quote: str(v.quote) };
  }
  return null;
}

const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

const at = (root: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => own(v, k), root);

/** The log's citation for one financial input, in either of the two shapes the writers use. */
function inputCitation(inputs: Record<string, unknown> | null, field: string, addback: boolean) {
  return addback
    ? (readCitation(at(inputs, "financial_citations", "addback_amounts", field)) ?? readCitation(at(inputs, "citations", "addbacks", field)))
    : (readCitation(at(inputs, "financial_citations", field)) ?? readCitation(at(inputs, "citations", field)));
}

/**
 * The classifier. An INPUT figure (EBITDA, a deduction, a denominator part, an
 * add-back as stated) was read from a document, so it is `quoted` when the log
 * holds its citation and `uncited` when it does not. A DERIVED figure (a total,
 * the DSCR, the threshold, the margin, an add-back after its cap) was produced
 * by code, so it is `computed` and carries the calc_id. Which a row is follows
 * from where the figure sits in the log row, not from anything set by hand, and
 * an input is never presented as computed or the other way round.
 */
export function sourceFor(
  origin: { input: false } | { input: true; field: string; addback: boolean },
  row: Pick<CalcLogRow, "calc_id" | "inputs">,
): FigureSource {
  if (!origin.input) return { kind: "computed", calcId: row.calc_id };
  const cite = inputCitation(row.inputs, origin.field, origin.addback);
  return cite ? { kind: "quoted", citation: cite.citation, quote: cite.quote } : { kind: "uncited" };
}

const humanise = (name: string): string => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The rows one `calc_log` entry contributes. A figure the log does not hold is not a row: nothing is defaulted to zero. */
export function calcRowsFor(row: CalcLogRow): CalcRowView[] {
  const out: CalcRowView[] = [];
  const o = row.outputs ?? {};
  const components = isObj(o.components) ? o.components : {};
  const input = (field: string, addback = false) => ({ input: true as const, field, addback });
  const derived = { input: false as const };

  const push = (key: string, label: string, value: unknown, format: FigureFormat, origin: Parameters<typeof sourceFor>[0], note?: string) => {
    if (!isNum(value)) return;
    out.push({ key, label, value, format, source: sourceFor(origin, row), ...(note ? { note } : {}) });
  };

  push("ebitda", "EBITDA", components.base, "amount", input("ebitda"));

  const addbacks = isObj(components.addbacks) ? components.addbacks : {};
  for (const [name, raw] of Object.entries(addbacks)) {
    if (!isObj(raw)) continue;
    push(`addback:${name}:stated`, `Add-back · ${name} (as stated)`, raw.claimed, "amount", input(name, true));
    const note = raw.cap === null || raw.cap === undefined ? "uncapped" : raw.capped === true ? "cap applied" : "within cap";
    push(`addback:${name}:applied`, `Add-back · ${name} (as applied)`, raw.applied, "amount", derived, note);
  }

  const deductions = isObj(components.deductions) ? components.deductions : {};
  for (const [name, v] of Object.entries(deductions)) push(`deduction:${name}`, `Less · ${humanise(name)}`, v, "amount", input(name));

  push("numerator_total", "Numerator total", components.numerator_total, "amount", derived);

  const parts = isObj(components.denominator_parts) ? components.denominator_parts : {};
  for (const [name, v] of Object.entries(parts)) push(`denominator:${name}`, `Debt service · ${humanise(name)}`, v, "amount", input(name));

  push("denominator_total", "Denominator total", components.denominator_total, "amount", derived);
  push("dscr", "Calculated DSCR", o.dscr, "ratio", derived, o.pass === true ? "passes" : o.pass === false ? "breach" : undefined);

  // The required minimum is a human-approved covenant TERM, not a code output:
  // it must never render amber "computed by code". It is `quoted` when the log
  // carries its covenant citation (`terms.threshold.citation`), otherwise a plain
  // `term`. Never `derived`/computed.
  if (isNum(o.threshold)) {
    const cite = readCitation(at(row.inputs, "terms", "threshold", "citation"));
    out.push({
      key: "threshold",
      label: "Required minimum",
      value: o.threshold,
      format: "ratio",
      source: cite ? { kind: "quoted", citation: cite.citation, quote: cite.quote } : { kind: "term" },
    });
  }

  push("margin", "Margin", o.margin, "signed-ratio", derived);

  // The borrower's own figure, where the quarterly test logged it. A figure the
  // borrower stated is quoted from their certificate, never computed by us.
  const reported = own(row.inputs, "reported");
  if (isObj(reported) && isNum(reported.dscr)) {
    const cite = readCitation(reported);
    out.push({
      key: "reported",
      label: "Borrower reported DSCR",
      value: reported.dscr,
      format: "ratio",
      source: cite ? { kind: "quoted", citation: cite.citation, quote: cite.quote } : { kind: "uncited" },
    });
  }
  return out;
}

/** One section per logged calculation, oldest first; the last is the governing one. */
export function calcSectionsOf(rows: readonly CalcLogRow[]): CalcSection[] {
  return rows.map((row, i) => ({
    calcId: row.calc_id,
    title: `Calculation ${i + 1} of ${rows.length}`,
    governing: i === rows.length - 1,
    rows: calcRowsFor(row),
  }));
}

export interface CasefileHeadline {
  calcId: string;
  dscr: number | null;
  passes: boolean | null;
  required: number | null;
  margin: number | null;
}

/**
 * The governing calculation's key figures, for the casefile decision banner:
 * the DSCR the recommendation rests on, the covenant requirement, and the
 * margin — so the analyst sees the numbers that matter without reading the whole
 * table (audit 3.3). Null when there is no calculation to summarise.
 */
export function headlineFor(sections: readonly CalcSection[]): CasefileHeadline | null {
  const gov = sections.find((s) => s.governing) ?? sections[sections.length - 1];
  if (!gov) return null;
  const byKey = (k: string): CalcRowView | undefined => gov.rows.find((r) => r.key === k);
  const dscrRow = byKey("dscr");
  return {
    calcId: gov.calcId,
    dscr: dscrRow ? dscrRow.value : null,
    passes: dscrRow?.note === "passes" ? true : dscrRow?.note === "breach" ? false : null,
    required: byKey("threshold")?.value ?? null,
    margin: byKey("margin")?.value ?? null,
  };
}

export interface AmendmentStatus {
  title: string;
  effectiveDate: string | null;
  /** Effective on or before the test period end, so it should bear on this test. */
  effectiveForPeriod: boolean;
  /** Reflected in the governing (approved) terms' `effective_amendments`. */
  boarded: boolean;
}

/**
 * The amendment-status strip for the casefile (credit-review ask: show whether
 * an amendment is on file, effective for the period, and reflected in the
 * governing terms). An amendment effective for the period but NOT in the
 * approved terms' `effective_amendments` is the boarding lag the whole
 * investigation hinges on — surfaced here so the analyst sees it before reading
 * a narrative that may lean on it.
 *
 * Pure: the page supplies the facility's amendment documents and the governing
 * terms' `effective_amendments`. Titles are matched case/space-insensitively
 * because the documents row and the terms citation can format the same title
 * slightly differently.
 */
export function amendmentStatuses(
  documents: readonly { doc_type: string | null; title: string; effective_date: string | null }[],
  effectiveAmendments: unknown,
  testPeriodEnd: string | null,
): AmendmentStatus[] {
  const norm = (s: string): string => s.trim().toLowerCase();
  const boarded = new Set<string>(
    (Array.isArray(effectiveAmendments) ? effectiveAmendments : [])
      .map((a) => (isObj(a) && typeof a.doc === "string" ? norm(a.doc) : ""))
      .filter(Boolean),
  );
  return documents
    .filter((d) => d.doc_type === "amendment")
    .map((d) => ({
      title: d.title,
      effectiveDate: d.effective_date ?? null,
      effectiveForPeriod: d.effective_date != null && testPeriodEnd != null && d.effective_date <= testPeriodEnd,
      boarded: boarded.has(norm(d.title)),
    }));
}

const AMOUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatFigure(value: number, format: FigureFormat): string {
  if (format === "amount") return AMOUNT.format(value);
  const fixed = value.toFixed(2);
  return format === "signed-ratio" && value > 0 ? `+${fixed}` : fixed;
}

// ------------------------------------------------------------- guardrail notes

export interface Notice {
  layer: string;
  check: string;
  action: string;
  detail: string;
}

/**
 * Every note, in the order written. `guardrail_notes` is an array of
 * `{layer, check, action, detail}` (`lib/agent/notes.ts`); anything that is not
 * an object is skipped, and a missing field is an empty string rather than a
 * dropped note. An empty array is no notices, never an empty box.
 */
export function noticesOf(raw: unknown): Notice[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter(isObj)
    .map((n) => ({ layer: str(n.layer), check: str(n.check), action: str(n.action), detail: str(n.detail) }));
}

/** "forced abstain" for `abstain`, otherwise the action in words. */
export function noticeHeading(n: Notice): string {
  const layer = n.layer === "policy" ? "Policy" : n.layer === "guardrail" ? "Guardrail" : humanise(n.layer || "Code");
  const action = n.action === "abstain" ? "forced abstain" : n.action.replace(/_/g, " ");
  return action ? `${layer} · ${action}` : layer;
}

/**
 * Did enforcement overrule the recommendation the agent drafted?
 *
 * `abstain` and `escalate` are the only two actions that REPLACE the agent's
 * recommendation (`guardrails/guardrail.js`); `forced_true`, `not_checked` and
 * the orchestrator's `end_run` record something else. When one of them fired,
 * the explanation on screen is arguing for a conclusion that was rejected, and
 * the casefile must say so rather than let the prose read as the live answer.
 *
 * Keyed on the action alone, not the layer: a new layer that forces an abstain
 * should be caught by default, and the two actions are unambiguous on their own.
 */
export function recommendationOverridden(notes: readonly Notice[]): boolean {
  return notes.some((n) => n.action === "abstain" || n.action === "escalate");
}

// --------------------------------------------------------------- seen similar

/**
 * The count behind the badge: the lessons the investigation was handed at its
 * start, as recorded in `casefiles.trace` by `startInvestigation`. Never a
 * recomputation at render, which would count lessons that did not exist then.
 * 0 for a cold run and for one whose memory was unavailable.
 */
export function seenSimilarCount(trace: unknown): number {
  return lessonsLoaded(trace);
}

/** `null` means the badge does not render: never empty, never "0 prior cases". */
export function seenSimilarLabel(count: unknown): string | null {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return null;
  return `seen similar · ${count} prior ${count === 1 ? "case" : "cases"}`;
}

// ------------------------------------------------------------- review state

export type ReviewMode = "active" | "read_only" | "not_ready";

export const DECIDED_STATUSES = ["approved", "overridden", "awaiting_docs"] as const;

/**
 * Only `pending_review` has an active action bar. A decided casefile is
 * read-only (a review is read-only once made); one still investigating, failed
 * or in any status this screen does not know has nothing to decide yet, and
 * an unknown status never defaults to being actionable.
 */
export function reviewMode(status: unknown): ReviewMode {
  if (status === "pending_review") return "active";
  if ((DECIDED_STATUSES as readonly unknown[]).includes(status)) return "read_only";
  return "not_ready";
}

/**
 * An approved or overridden casefile whose exception is still `pending_review` is
 * the A-4 drift a failed exception close leaves behind (`submitReview` answers
 * 500 WITH a `review_id`: the decision is recorded, the close is not). The
 * read-only view has to surface it and offer the repair, because the active
 * action bar that carried that warning has unmounted.
 *
 * Deliberately the exact mirror state, not a bare `!== "closed"`: F7 reopens a
 * CLOSED exception to `new` when a later quarter breaches, which is a live
 * exception rather than drift, and `repairException` leaves `new` alone so a
 * stale review can never false-resolve it. Only `pending_review` is repairable,
 * so only `pending_review` is surfaced. `awaiting_docs` never reaches here (its
 * casefile status is not approved/overridden) and its exception stays open by
 * design.
 */
export function exceptionNeedsClosing(casefileStatus: unknown, exceptionStatus: unknown): boolean {
  if (casefileStatus !== "approved" && casefileStatus !== "overridden") return false;
  return exceptionStatus === "pending_review";
}

/** What the recorded decision says, in the words the analyst used. */
export function decidedHeadline(status: string): string {
  if (status === "approved") return "Approved by an analyst";
  if (status === "overridden") return "Overridden by an analyst";
  if (status === "awaiting_docs") return "Awaiting documents";
  return `Casefile is ${status}`;
}

// ------------------------------------------------------------------ override

export const CORRECTED_OUTCOMES = ["resolve", "request", "escalate"] as const;
export const OUTCOME_LABEL: Record<(typeof CORRECTED_OUTCOMES)[number], string> = {
  resolve: "Resolve: the exception is not a breach",
  request: "Request: documents are needed first",
  escalate: "Escalate: this is a breach",
};

export const TAGS: readonly string[] = PATTERN_TAGS as string[];

export interface OverrideDraft {
  reason: string;
  confirmedTag: string;
  correctedOutcome: string;
}

/**
 * What an override still lacks, in the order the dialog asks for it (reason,
 * then the tag, then the corrected outcome), as the sentences shown beside the
 * disabled button. Mirrors the 400s `submitReview` would give.
 *
 * The reason is the product's learning input: whitespace is not a reason. It is
 * checked trimmed here and sent UNTRIMMED, verbatim.
 */
export function overrideBlockers(d: OverrideDraft): string[] {
  const out: string[] = [];
  if (d.reason.trim() === "") out.push("Write your reason. It becomes the lesson.");
  if (!TAGS.includes(d.confirmedTag)) out.push("Confirm a pattern tag.");
  if (!(CORRECTED_OUTCOMES as readonly string[]).includes(d.correctedOutcome)) out.push("Choose the corrected outcome.");
  return out;
}

// -------------------------------------------------------------- clause lookup

/**
 * Each distinct citation resolved to its clause on file, or `null` when it
 * resolves to none. Resolved on the server so the browser never receives every
 * chunk of the facility; `null` is what makes `ClausePanel` say so instead of
 * showing a blank.
 */
export function clauseMap(citations: readonly string[], chunks: readonly Clause[]): Record<string, Clause | null> {
  const out: Record<string, Clause | null> = {};
  for (const c of citations) {
    if (c.trim() === "" || c in out) continue;
    out[c] = clauseFor(c, chunks);
  }
  return out;
}

/** Every citation the screen can open a clause for: each claim's and each quoted figure's. */
export function citationsOnScreen(claims: readonly { citation: string }[], sections: readonly CalcSection[]): string[] {
  const out = new Set<string>();
  for (const c of claims) if (c.citation !== "") out.add(c.citation);
  for (const s of sections) for (const r of s.rows) if (r.source.kind === "quoted") out.add(r.source.citation);
  return [...out];
}

// ---------------------------------------------------------------- the policy

/** The value of `require_human_review` as the policy table holds it; null when the row is missing or not a boolean. */
export function humanReviewPolicy(rows: readonly { key: string; value: unknown }[] | null | undefined): boolean | null {
  const row = (rows ?? []).find((r) => r.key === "require_human_review");
  return typeof row?.value === "boolean" ? row.value : null;
}

export interface HumanReviewNotice {
  /** True only when the policy value is positively `true`: the only case that may claim mandatory. */
  mandatory: boolean;
  text: string;
}

/**
 * The sentence shown beside the actions, driven by the ACTUAL policy value — never
 * a hard-coded "mandatory". `true` is the locked-mandatory boundary; `false` says
 * so plainly and does not pretend otherwise; `null` (the row is missing or not a
 * boolean) says the policy is not readable and is NOT treated as mandatory. In
 * every case the agent still never resolves itself — an analyst decides here.
 */
export function humanReviewNotice(value: boolean | null): HumanReviewNotice {
  if (value === true) {
    return { mandatory: true, text: "Human sign-off is mandatory by policy. The agent recommends; an analyst decides." };
  }
  if (value === false) {
    return { mandatory: false, text: "Policy does not require human sign-off, but the agent never resolves itself; an analyst decides here." };
  }
  return { mandatory: false, text: "The human-review policy is not readable, so it is not treated as mandatory. The agent never resolves itself; an analyst decides here." };
}
