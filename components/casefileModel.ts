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

export type ReviewMode = "active" | "read_only" | "history" | "not_ready";

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
  // A superseded casefile is HISTORY, not an empty page. It showed only a
  // "kept as history" notice, which meant a completed investigation's findings,
  // calculations and agent activity became unreachable the moment a later run
  // replaced it — odd in a product whose claim is that every figure is
  // traceable. It renders in full, read-only, with no actions.
  if (status === "superseded") return "history";
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

/** The decision as an action the analyst is taking, with what recording it means. */
export const OUTCOME_CHOICE: Record<(typeof CORRECTED_OUTCOMES)[number], { title: string; detail: string }> = {
  resolve: { title: "Resolve exception", detail: "Record that the evidence supports resolution." },
  escalate: { title: "Escalate for review", detail: "Record that further credit review is required." },
  request: { title: "Defer decision", detail: "Record that additional evidence or assessment is needed." },
};

export const TAGS: readonly string[] = PATTERN_TAGS as string[];

/**
 * The analyst-facing name for each pattern tag.
 *
 * The identifier is the data layer's and must not change — `guardrails/
 * casefile-schema.js` owns the enum and the agent emits it. But an analyst
 * confirming a category should not be asked to read `amendment_addback`; that
 * is the model's vocabulary leaking onto a credit screen.
 */
export const TAG_LABEL: Record<string, string> = {
  amendment_addback: "Amendment-related add-back",
  period_mismatch: "Test-period mismatch",
  missing_waiver: "Missing or unexecuted waiver",
  borrower_calc_error: "Borrower calculation error",
  true_breach: "Genuine covenant breach",
  other: "Other",
};

/** Never leaks an unlabelled identifier: an unmapped tag reads as itself, humanised. */
export function tagLabel(tag: string): string {
  return TAG_LABEL[tag] ?? tag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

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

// ------------------------------------------------- the investigation summary

/** One numbered finding, built from the calculation log — never from a model. */
export interface FoundStep {
  n: number;
  title: string;
  detail: string;
  /** What this finding opens: a logged calculation, or the amendment evidence. */
  kind: "initial" | "addback" | "recalculation";
  /** The calculation to reveal; null for the evidence step, which has none. */
  calcId: string | null;
}

export interface ComparisonRow {
  basis: string;
  dscr: number | null;
  /** `provisional` means the figure rests on terms the approved version does not carry. */
  status: "below_minimum" | "meets_minimum" | "provisional" | "unknown";
}

export interface InvestigationSummary {
  /** The first calculation logged: the test as the approved terms produce it. */
  initial: { calcId: string; dscr: number | null } | null;
  /** The calculation the policy judged — what the recommendation rests on. */
  governing: { calcId: string; dscr: number | null; passes: boolean | null } | null;
  required: number | null;
  /** The governing calculation used terms the approved version does not carry. */
  onAmendedTerms: boolean;
  /** The add-back the amendment permits, when the guardrail named one. */
  addback: { name: string; cap: number | null } | null;
  steps: FoundStep[];
  comparison: ComparisonRow[];
  /** One plain sentence for the recommendation card. Composed, never written. */
  headline: string | null;
}

/**
 * The amendment's add-back, read out of the guardrail's own note.
 *
 * The note is written by `guardrails/guardrail.js` in a fixed shape, so this
 * parse is tight and fails closed: no match returns null and the screen simply
 * says less. It never invents a cap, and an uncapped add-back (no `cap`) stays
 * null rather than becoming 0 — reading an uncapped add-back as zero is the
 * known trap that flips a correct resolve into a false escalation.
 */
export function addbackFromNote(detail: string): { name: string; cap: number | null } | null {
  const m = /added add-back "([^"]+)"(?:\s*\(cap\s*([0-9]+)\))?/i.exec(detail);
  if (!m) return null;
  return { name: m[1], cap: m[2] === undefined ? null : Number(m[2]) };
}

const dscrOf = (s: CalcSection): number | null => s.rows.find((r) => r.key === "dscr")?.value ?? null;

/**
 * What the investigation found, assembled from the calculation log and the
 * guardrail's notes.
 *
 * EVERY FIGURE HERE IS READ, NEVER WRITTEN. The screen this feeds reads as a
 * narrative, which is exactly why it must not be one: the review forbids a
 * second unconstrained model summary, so the sentences are assembled from the
 * logged calculations and the guardrail's own words.
 */
export function investigationSummary(
  sections: readonly CalcSection[],
  notes: readonly Notice[],
): InvestigationSummary {
  const head = headlineFor(sections);
  const first = sections[0] ?? null;
  const gov = sections.find((s) => s.governing) ?? sections[sections.length - 1] ?? null;
  const required = head?.required ?? null;

  const termsNote = notes.find((n) => n.check === "terms_differ_from_approved") ?? null;
  const onAmendedTerms = termsNote !== null;
  const addback = termsNote ? addbackFromNote(termsNote.detail) : null;

  const initial = first ? { calcId: first.calcId, dscr: dscrOf(first) } : null;
  const governing = gov ? { calcId: gov.calcId, dscr: dscrOf(gov), passes: head?.passes ?? null } : null;

  const x = (v: number | null): string => (v == null ? "—" : `${v.toFixed(2)}x`);
  const steps: FoundStep[] = [];

  if (initial) {
    const below = initial.dscr != null && required != null && initial.dscr < required;
    steps.push({
      n: steps.length + 1,
      kind: "initial",
      calcId: initial.calcId,
      title: below ? "Initial test below minimum" : "Initial test calculated",
      detail: `The original calculation returned ${x(initial.dscr)} against a ${x(required)} minimum.`,
    });
  }

  if (addback) {
    steps.push({
      n: steps.length + 1,
      kind: "addback",
      calcId: null,
      title: "Additional add-back identified",
      detail:
        addback.cap == null
          ? `An amendment permits an add-back for ${addback.name}, with no cap stated.`
          : `An amendment permits an add-back for ${addback.name}, capped at $${addback.cap.toLocaleString("en-US")}.`,
    });
  }

  // Only worth a third step when the recalculation actually moved the figure.
  if (governing && initial && governing.calcId !== initial.calcId && governing.dscr !== initial.dscr) {
    const above = governing.dscr != null && required != null && governing.dscr >= required;
    steps.push({
      n: steps.length + 1,
      kind: "recalculation",
      calcId: governing.calcId,
      title: above ? "Recalculation above minimum" : "Recalculation still below minimum",
      detail: onAmendedTerms
        ? `Applying the amendment produced ${x(governing.dscr)}. The amendment basis still requires review.`
        : `The recalculation produced ${x(governing.dscr)}.`,
    });
  }

  const comparison: ComparisonRow[] = [];
  if (initial) {
    comparison.push({
      basis: "Initial test",
      dscr: initial.dscr,
      status:
        initial.dscr == null || required == null ? "unknown" : initial.dscr < required ? "below_minimum" : "meets_minimum",
    });
  }
  if (governing && initial && governing.calcId !== initial.calcId) {
    comparison.push({
      basis: onAmendedTerms ? "Amendment scenario" : "Recalculation",
      dscr: governing.dscr,
      status: onAmendedTerms
        ? "provisional"
        : governing.dscr == null || required == null
          ? "unknown"
          : governing.dscr < required
            ? "below_minimum"
            : "meets_minimum",
    });
  }

  // A sentence an analyst would say, assembled from the same facts as the
  // steps. It is composed from branches, not generated, so it cannot assert
  // anything the calculation log does not already support.
  const movedAbove =
    governing?.dscr != null && required != null && governing.dscr >= required;
  const movedAtAll = governing != null && initial != null && governing.dscr !== initial.dscr;
  let headline: string | null = null;
  if (addback && movedAtAll) {
    headline = movedAbove
      ? "The agent identified an additional permitted add-back and recalculated the DSCR above the minimum."
      : "The agent identified an additional permitted add-back, and the recalculated DSCR is still below the minimum.";
  } else if (steps.length > 0) {
    headline = steps[steps.length - 1].detail;
  }

  return { initial, governing, required, onAmendedTerms, addback, steps, comparison, headline };
}

// -------------------------------------------------- why THIS recommendation

/**
 * The decision narrative: why the recommendation stands, given everything else
 * on the screen.
 *
 * The screen was showing an escalation beside a pending amendment, two
 * validation notices and a rejected agent draft, and saying nothing about how
 * those relate. For a credit analyst that gap matters more than any amount of
 * visual polish: without it they cannot tell whether the amendment undermines
 * the recommendation or is the very reason for it.
 *
 * Every field here is DERIVED from the guardrail notes and the calculation log.
 * Nothing is written by the model and nothing is inferred — if the data does not
 * support a sentence, the field is null and the UI shows nothing rather than a
 * plausible-sounding one.
 */
export interface DecisionBasis {
  /** True when a code rule replaced what the agent proposed. */
  policyDirected: boolean;
  /** What the agent itself put forward, when a rule overrode it. */
  draft: string | null;
  /** The rule that overrode it, in the analyst's words. */
  overrideReason: string | null;
  /** The numbers the recommendation rests on. */
  basis: string | null;
  /** How the unboarded amendment bears on the result — the missing link. */
  amendmentEffect: string | null;
  /** What is still open, counted not characterised. */
  outstanding: string | null;
}

const OVERRIDE_REASON: Record<string, string> = {
  resolve_requires_evidence:
    "the calculation the recommendation must rest on does not pass, so a resolve was not earned",
  figure_traceable: "a figure in the explanation traces to no calculation and no cited quote",
  quote_verbatim: "a supporting claim quoted text that is not in the document it cited",
  schema: "the answer did not match the required shape after one retry",
};

export function decisionBasis(
  summary: InvestigationSummary,
  notes: readonly Notice[],
  draftRecommendation: string | null,
  openItems: number,
  /** Amendments on file. An unboarded one that bears on this period is the fact
   *  the analyst most needs connected to the recommendation. */
  amendments: readonly AmendmentStatus[] = [],
): DecisionBasis {
  const override = notes.find((n) => n.action === "escalate" || n.action === "abstain") ?? null;
  const policyDirected = override !== null;

  const gov = summary.governing;
  const basis =
    gov && gov.dscr != null && summary.required != null
      ? `${gov.dscr.toFixed(2)}x calculated against a ${summary.required.toFixed(2)}x minimum.`
      : null;

  // The link the analyst actually needs. An amendment on file but not boarded
  // does not soften the breach — it is the reason the governing terms still
  // produce one, and therefore the thing to review. Only said when the
  // guardrail actually flagged the drift.
  // Driven by the amendment list as well as the drift note. Keying only off the
  // note left the commonest case silent: the panel beside the recommendation
  // says "Amendment No. 2 — not reflected in approved terms" while the
  // recommendation says nothing about it, which is the gap that made the
  // escalation hard to assess.
  const pending = amendments.find((a) => a.effectiveForPeriod && !a.boarded) ?? null;
  const tail =
    "The covenant test must run on the terms in force, so it does not change this period's result until someone boards it — which is what there is to review.";
  const amendmentEffect = pending
    ? summary.addback
      ? `${pending.title} permits an add-back (${summary.addback.name}) that approved terms do not carry. ${tail}`
      : `${pending.title} is on file but is not reflected in the approved terms. ${tail}`
    : summary.onAmendedTerms
      ? `The governing calculation used terms the approved version does not carry. ${tail}`
      : null;

  return {
    policyDirected,
    draft: policyDirected && draftRecommendation ? draftRecommendation : null,
    overrideReason: override ? OVERRIDE_REASON[override.check] ?? null : null,
    basis,
    amendmentEffect,
    outstanding: openItems > 0 ? `${openItems} item${openItems === 1 ? "" : "s"} to review before recording a decision.` : null,
  };
}

// ------------------------------------------- what a notice actually demands

/**
 * Notices grouped by what they ask of the analyst.
 *
 * Every notice was rendered with the same weight, so a recommendation that a
 * code rule had CHANGED sat beside an informational flag and read identically.
 * They demand different things: one altered the outcome, one needs
 * acknowledging, one is context.
 *
 * Derived from the recorded `action`, which the guardrail wrote — never from
 * the check's name, so a new check inherits the right grouping automatically.
 */
export type NoticeWeight = "changed_the_outcome" | "needs_acknowledgement" | "informational";

export const NOTICE_WEIGHT_LABEL: Record<NoticeWeight, string> = {
  changed_the_outcome: "Changed the recommendation",
  needs_acknowledgement: "Needs acknowledgement before deciding",
  informational: "Information",
};

export function noticeWeight(notice: Notice): NoticeWeight {
  // `abstain` and `escalate` are the guardrail overriding the model's answer.
  if (notice.action === "abstain" || notice.action === "escalate") return "changed_the_outcome";
  // A removed claim and a retry changed what the analyst is reading, without
  // changing the outcome — they have to know, and nothing is blocked.
  if (notice.action === "claim_removed" || notice.action === "retry") return "needs_acknowledgement";
  return "informational";
}

/** Notices in weight order, heaviest first, with empty groups omitted. */
export function groupNotices(notes: readonly Notice[]): { weight: NoticeWeight; notices: Notice[] }[] {
  const order: NoticeWeight[] = ["changed_the_outcome", "needs_acknowledgement", "informational"];
  return order
    .map((weight) => ({ weight, notices: notes.filter((n) => noticeWeight(n) === weight) }))
    .filter((g) => g.notices.length > 0);
}
