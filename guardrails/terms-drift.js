/**
 * CreditScout — terms drift.
 *
 * Was the calculation a recommendation rests on run on the terms a human
 * approved, and if not, does a clause in the borrower's agreement say it may be?
 *
 * THE FINDING THIS FILE EXISTS FOR (A-1 / E-2). A live run rebuilt the
 * borrower's unauthorised add-back, reached 1.31 and called the case resolved.
 * The guardrail traced every figure (they were all in a logged calculation) and
 * the policy engine judged the last calculation, which passed. Nothing compared
 * the terms that calculation was run on with the terms a human approved, so a
 * fabricated pass read as a clean resolve with zero notes. A prompt rule
 * suppressed it; a prompt is not a control. This is.
 *
 * THE RULING — both halves of HANDOFF 9.4, and neither is optional:
 *
 *   equal                          no note
 *   different, EVERY difference    note `terms_differ_from_approved`, action
 *     backed by a quoted clause    `flag`. The recommendation stands. This is
 *                                  what lets F1's legitimate re-mapping (an
 *                                  unboarded amendment's capped add-back) resolve.
 *   different, ANY difference      note `terms_unverified`, action `escalate`,
 *     not backed                   and a `resolve` becomes `escalate`. Never
 *                                  flag-only: a term no clause permits, used to
 *                                  reach a passing number, is a fabricated pass.
 *
 * WHAT IS COMPARED: what the calculator executes, plus the amendments the terms
 * claim. The threshold; each add-back by name, and its cap; the deduction set;
 * the denominator component set; each effective amendment's document and date.
 * NOT compared, because the calculator never reads them and a difference in
 * them cannot move a figure: citation labels, `amount_source`, `numerator.base`,
 * `test_period`. A cap that is absent and a cap that is `null` are the same
 * thing — uncapped — exactly as `calc/dscr.js` reads them; reading absent as
 * anything else is the documented trap.
 *
 * WHAT "BACKED BY A QUOTED CLAUSE" MEANS. Not a second notion: the verbatim-quote
 * discipline `verifyTermsProvenance` and `checkTermsProvenance` already apply on
 * the boarding path, held to the same standard here. A source citation
 * `{citation, quote}` backs a difference only when ALL of these hold:
 *
 *   1. its citation names a chunk the caller fetched for THIS facility. The
 *      caller resolves the citation string to a chunk and keys the chunk by the
 *      string as written (`lib/agent/evidence.ts`); no resolver lives here.
 *   2. that chunk is from an agreement or an amendment — the only documents that
 *      can grant a term. A compliance certificate, the financials or a waiver
 *      REQUEST can state the borrower's add-back; none of them can permit it.
 *      Without this, F3's certificate line "owner compensation normalisation:
 *      530,000" would back a capped version of the very add-back it is evidence
 *      against.
 *   3. its quote appears verbatim (after the guardrail's whitespace and
 *      punctuation folding) in that chunk.
 *   4. the quote says the thing — per element:
 *        threshold     the value is stated AS a ratio ("1.25 to 1.00", "1.25x"),
 *                      as `verifyTermsProvenance` requires of `min_dscr`
 *        add-back      the quote names it; a numeric cap is a figure in the
 *                      quote and does not sit only in the item of a different
 *                      add-back (`checkNamedTerms`'s pairing rule); a null cap
 *                      needs words saying uncapped, and no item of the chunk
 *                      naming the add-back may state a limit
 *        deduction /   the quote names the component in the words
 *        component     `lib/terms.ts` recognises for it
 *        amendment     the chunk is that amendment, and the quote states the date
 *
 * A REMOVED EXECUTABLE TERM IS NEVER BACKED. A quote can show what a clause
 * permits; it cannot show that an approved term has stopped applying, and a
 * dropped deduction or denominator component raises the ratio exactly as a
 * fabricated add-back does. A dropped or omitted effective-amendment entry is
 * recorded but needs no quote: the calculator never reads that list, and every
 * executable consequence of an amendment is compared on its own.
 *
 * Numbers are compared after normalisation, never as text.
 *
 * DUPLICATED, ON PURPOSE. This file is held to the same standard as its
 * siblings — zero dependencies, import-free — so the figure and text readings
 * below are copies of `guardrails/guardrail.js` and the component vocabulary is
 * a copy of `lib/terms.ts`. `terms-drift.test.js` pins the figure readings to
 * agree with the guardrail's on a shared corpus, so a change to one that is not
 * made to the other fails a test rather than drifting silently.
 *
 * Zero dependencies. No import, no require.
 */

/** Documents that can grant a covenant term. Mirrors SOURCE_DOC_TYPES in lib/terms.ts. */
const SOURCE_DOC_TYPES = ["agreement", "amendment"];

const EPSILON = 1e-6;
const SCALES = { k: 1e3, m: 1e6, mm: 1e6, bn: 1e9, b: 1e9 };

/** How each calculator component is written in a clause. Copied from lib/terms.ts. */
const DEDUCTION_WORDS = {
  unfinanced_capex: /unfinanced\s+capital\s+expenditures?|unfinanced\s+capex/i,
  cash_taxes: /cash\s+taxes|taxes\s+paid/i,
};
const DENOMINATOR_WORDS = {
  scheduled_principal: /scheduled\s+principal/i,
  cash_interest: /cash\s+interest|interest\s+paid/i,
};
/** A clause saying an add-back has no limit. Copied from lib/terms.ts. */
const UNCAPPED = /\b(without\s+(?:any\s+)?(?:limit|limitation|cap)|no\s+(?:limit|cap|maximum)|not\s+(?:be\s+)?subject\s+to\s+(?:any\s+)?(?:limit|cap)|unlimited|uncapped|without\s+regard\s+to\s+(?:any\s+)?(?:limit|cap))/i;
/** Words that put a limit on an amount. Copied from lib/terms.ts. */
const CAPPING = /\$\s?\d|not\s+to\s+exceed|shall\s+not\s+exceed|no\s+more\s+than|up\s+to|at\s+most/i;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// ------------------------------------------------- readings (guardrail copies)

/** Same folding as the guardrail's quote match (smart quotes, dashes, whitespace). */
function normaliseText(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sameNumber(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= EPSILON * scale;
}

function normaliseNumber(token) {
  let s = String(token).trim().toLowerCase();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$£€\s]/g, "").replace(/,/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  let scale = 1;
  const suffix = s.match(/(bn|mm|[kmb]|x)$/);
  if (suffix) {
    if (suffix[1] !== "x") scale = SCALES[suffix[1]] ?? 1;
    s = s.slice(0, -suffix[1].length);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const value = Number(s) * scale;
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const TO_ONE = /(?<![\d,.])(\d+(?:\.\d+)?)(\s*(?:to\b|:)\s*)1(?:\.0+)?(?!\d|[.,]\d)/gi;
const FIGURE = String.raw`\$?\s?-?\d[\d,]*(?:\.\d+)?(?:bn|mm|[kmbx])?`;
// The guardrail's IDENTIFIERS, verbatim: calc ids, dates, versions, references.
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)";
const DAY = "(?:3[01]|[12]\\d|0?[1-9])(?:st|nd|rd|th)?";
const HEX_ID = "(?=[0-9a-f-]*[a-f-])[0-9a-f][0-9a-f-]{5,}(?!\\w)";
const IDENTIFIERS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  new RegExp(`\\bcalc(?:ulation)?[\\s_-]?ids?\\b[\\s:=#\`'"(]*${HEX_ID}(?:[\`'")]*\\s*(?:,|and|&|/)\\s*[\`'"(]*${HEX_ID})*`, "gi"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])\b/g,
  new RegExp(`\\b${MONTH}\\.?\\s+${DAY}\\b(?![.,]\\d)`, "g"),
  new RegExp(`(?<![\\w.,$-])${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, "g"),
  /\bversions?\s+\d+\b(?![.,]\d)/gi,
  /\bv\d+\b(?![.,]\d)/gi,
  /(?<=[A-Za-z]\s)No\.\s*\d+\b/g,
  /§\s*\d+(\.\d+)*(\([a-z0-9]{1,4}\))*/gi,
  /\b(section|article|art\.?|clause|amendment|amd\.?|exhibit|schedule)\s+(no\.?\s*)?\d+(\.\d+)*(\([a-z0-9]{1,4}\))*/gi,
];

/**
 * Every figure a DOCUMENT's text states — `extractFigures(text)` in the
 * guardrail, with no known-ratio list (document mode). Exported only so the
 * test can pin the two readings together; not for other callers.
 */
export function figuresIn(text) {
  if (typeof text !== "string" || text === "") return [];
  let cleaned = text;
  for (const rule of IDENTIFIERS) cleaned = cleaned.replace(rule, " ");
  cleaned = cleaned
    .replace(TO_ONE, (whole, n) => `${n} `)
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\bq[1-4]\s*(19|20)\d{2}\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");
  const tokens = cleaned.match(new RegExp(`\\(${FIGURE}\\)|${FIGURE}`, "gi")) || [];
  const out = [];
  for (const t of tokens) {
    const n = /^\(.*x\)$/i.test(t) ? normaliseNumber(t.slice(1, -1)) : normaliseNumber(t);
    if (n !== null) out.push(n);
  }
  return out;
}

/** The figures a quote states AS ratios — the guardrail's `ratioFigures`. Exported for the same test. */
export function ratiosIn(text) {
  const out = [];
  for (const m of String(text).matchAll(TO_ONE)) out.push(Number(m[1]));
  for (const m of String(text).matchAll(/(?<![\d,.])(\d+(?:\.\d+)?)\s*(?:x\b|times\b)/gi)) out.push(Number(m[1]));
  return out;
}

const fold = (s) => normaliseText(s).toLowerCase();
/** Does `text` name `phrase`? Case- and whitespace-insensitive, as `lib/terms.ts` `has`. */
const names = (text, phrase) => String(phrase).trim() !== "" && fold(text).includes(fold(phrase));
/** The delimited items of a passage: lines, `;`, and ", and" / ", or". Copied from lib/terms.ts. */
const listItems = (raw) => String(raw).split(/;|\n|,\s+(?:and|or)\s+/i).map(normaliseText).filter(Boolean);

function isIsoDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The quote writes `iso` as 2026-04-01, "April 1, 2026" or "1 April 2026" — `quoteContainsDate` in lib/terms.ts. */
function statesDate(quote, iso) {
  if (!isIsoDate(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const q = fold(quote);
  return q.includes(iso) || q.includes(`${MONTHS[m - 1]} ${d}, ${y}`) || q.includes(`${d} ${MONTHS[m - 1]} ${y}`);
}

// ------------------------------------------------------------ the comparison

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The executable reading of a terms object, or `{error}` when it cannot be read.
 * `cap` absent or null is uncapped (null); anything else that is not a number is
 * malformed, never zero.
 */
function executable(terms) {
  if (!isObj(terms)) return { error: "the terms are not an object" };
  const th = isObj(terms.threshold) ? terms.threshold.min_dscr : undefined;
  if (!isNum(th)) return { error: "threshold.min_dscr is not a number" };
  const nu = isObj(terms.numerator) ? terms.numerator : {};
  const de = isObj(terms.denominator) ? terms.denominator : {};

  const addbacks = new Map();
  for (const ab of Array.isArray(nu.addbacks) ? nu.addbacks : []) {
    if (!isObj(ab) || typeof ab.name !== "string" || ab.name.trim() === "") return { error: "an add-back has no name" };
    const cap = ab.cap === undefined || ab.cap === null ? null : ab.cap;
    if (cap !== null && !isNum(cap)) return { error: `add-back "${ab.name}" has a cap that is not a number or null` };
    const key = fold(ab.name);
    if (addbacks.has(key)) return { error: `add-back "${ab.name}" is listed twice` };
    addbacks.set(key, { name: ab.name, cap });
  }
  const list = (v) => new Set((Array.isArray(v) ? v : []).map(String));

  // The amendment list is documentary. Absent means "not stated", and is then
  // not compared: the calculator never reads it, so leaving it out cannot move
  // a figure. A list that IS stated is compared entry by entry.
  let amendments = null;
  if (Array.isArray(terms.effective_amendments)) {
    amendments = new Map();
    for (const am of terms.effective_amendments) {
      if (!isObj(am) || typeof am.doc !== "string") return { error: "an effective amendment names no document" };
      amendments.set(fold(am.doc), { doc: am.doc, effective: am.effective });
    }
  }
  return { min_dscr: th, addbacks, deductions: list(nu.deductions), components: list(de.components), amendments };
}

const capText = (cap) => (cap === null ? "uncapped" : `cap ${cap}`);

/** Every way the governing terms differ from the approved ones. */
function differences(g, a) {
  const out = [];
  if (!sameNumber(g.min_dscr, a.min_dscr)) {
    out.push({ kind: "threshold", change: "changed", value: g.min_dscr, describe: `threshold changed from ${a.min_dscr} to ${g.min_dscr}` });
  }
  for (const [key, ab] of g.addbacks) {
    const was = a.addbacks.get(key);
    if (!was) out.push({ kind: "addback", change: "added", value: ab, describe: `added add-back "${ab.name}" (${capText(ab.cap)})` });
    else if ((was.cap === null) !== (ab.cap === null) || (ab.cap !== null && !sameNumber(ab.cap, was.cap))) {
      out.push({ kind: "addback", change: "changed", value: ab, describe: `add-back "${ab.name}" changed from ${capText(was.cap)} to ${capText(ab.cap)}` });
    }
  }
  for (const [key, ab] of a.addbacks) {
    if (!g.addbacks.has(key)) out.push({ kind: "addback", change: "removed", value: ab, describe: `removed approved add-back "${ab.name}"` });
  }
  for (const [kind, gSet, aSet, label] of [
    ["deduction", g.deductions, a.deductions, "deduction"],
    ["component", g.components, a.components, "denominator component"],
  ]) {
    for (const name of gSet) if (!aSet.has(name)) out.push({ kind, change: "added", value: name, describe: `added ${label} ${name}` });
    for (const name of aSet) if (!gSet.has(name)) out.push({ kind, change: "removed", value: name, describe: `removed approved ${label} ${name}` });
  }
  if (g.amendments !== null) {
    const aAm = a.amendments ?? new Map();
    for (const [key, am] of g.amendments) {
      const was = aAm.get(key);
      if (!was) out.push({ kind: "amendment", change: "added", value: am, describe: `added effective amendment "${am.doc}" (${am.effective})` });
      else if (was.effective !== am.effective) {
        out.push({ kind: "amendment", change: "changed", value: am, describe: `effective amendment "${am.doc}" dated ${am.effective} instead of ${was.effective}` });
      }
    }
    for (const [key, am] of aAm) {
      if (!g.amendments.has(key)) out.push({ kind: "amendment", change: "removed", value: am, describe: `dropped approved effective amendment "${am.doc}"` });
    }
  }
  return out;
}

/**
 * Does this one verified citation back this one difference? `cite` has already
 * passed rules 1–3 (a facility chunk from an agreement or amendment, quote
 * verbatim in it); this is rule 4.
 */
function backs(diff, cite, allAddbackNames) {
  const { quote, chunk } = cite;
  switch (diff.kind) {
    case "threshold":
      return ratiosIn(quote).some((n) => sameNumber(n, diff.value));
    case "addback": {
      const { name, cap } = diff.value;
      if (!names(quote, name)) return false;
      const items = listItems(quote);
      const mine = items.filter((it) => names(it, name));
      if (cap === null) {
        const chunkItems = listItems(chunk.content).filter((it) => names(it, name));
        return mine.some((it) => UNCAPPED.test(it)) && !chunkItems.some((it) => CAPPING.test(it));
      }
      const hasCap = (it) => figuresIn(it).some((n) => sameNumber(n, cap));
      if (!figuresIn(quote).some((n) => sameNumber(n, cap))) return false;
      // The pairing rule from checkNamedTerms: refuse a cap that sits only in
      // the item of a DIFFERENT add-back. "may add back A, up to $500,000; and B,
      // up to $800,000" does not back A at 800,000.
      const theirs = items.filter((it) => !names(it, name) && allAddbackNames.some((other) => fold(other) !== fold(name) && names(it, other)));
      return mine.some(hasCap) || !theirs.some(hasCap);
    }
    case "deduction": {
      const re = DEDUCTION_WORDS[diff.value];
      return re !== undefined && re.test(normaliseText(quote));
    }
    case "component": {
      const re = DENOMINATOR_WORDS[diff.value];
      return re !== undefined && re.test(normaliseText(quote));
    }
    case "amendment":
      return chunk.doc_type === "amendment" && chunk.doc_title === diff.value.doc && statesDate(quote, diff.value.effective);
    default:
      return false;
  }
}

function note(check, action, detail) {
  return { layer: "guardrail", check, action, detail };
}

/**
 * Compare the governing calculation's terms with the approved terms in force.
 *
 * @param {unknown} governingTerms  `calc_log.inputs.terms` of the governing (last) calculation
 * @param {unknown} approvedTerms   `covenant_terms.terms` of the version in force for the period, or null
 * @param {Array}  sourceCitations  [{field?, citation, quote}] captured from the definition agent
 * @param {Array}  chunks           [{citation, content, doc_type, doc_title}] — this facility's
 *                                  chunks, keyed by each citation string AS WRITTEN
 * @returns {{equal: boolean, verified: boolean, differences: Array, notes: Array}}
 */
export function compareTermsToApproved(governingTerms, approvedTerms, sourceCitations, chunks) {
  const g = executable(governingTerms);
  const a = approvedTerms === null || approvedTerms === undefined ? { error: "no approved terms are in force for the period" } : executable(approvedTerms);
  if (g.error || a.error) {
    // Nothing comparable is nothing verified. Fail closed.
    const why = g.error ? `the governing calculation's terms cannot be read: ${g.error}` : `the approved terms cannot be read: ${a.error}`;
    return {
      equal: false,
      verified: false,
      differences: [],
      notes: [note("terms_unverified", "escalate", `${why} — the governing calculation cannot be shown to rest on terms a clause supports`)],
    };
  }

  const diffs = differences(g, a);
  if (diffs.length === 0) return { equal: true, verified: true, differences: [], notes: [] };

  // Rules 1–3, once per citation: a facility chunk from a document that can
  // grant a term, with the quote verbatim in it.
  const chunkByCitation = new Map();
  for (const c of Array.isArray(chunks) ? chunks : []) {
    if (c && typeof c.citation === "string") chunkByCitation.set(c.citation.trim(), c);
  }
  const usable = [];
  for (const c of Array.isArray(sourceCitations) ? sourceCitations : []) {
    if (!isObj(c) || typeof c.citation !== "string" || typeof c.quote !== "string") continue;
    // An empty quote is "contained" in every chunk, so it passes this rule;
    // rule 4 refuses it, because every element check needs words or a figure
    // in the quote itself.
    const quote = normaliseText(c.quote);
    const chunk = chunkByCitation.get(c.citation.trim());
    if (!chunk || !SOURCE_DOC_TYPES.includes(chunk.doc_type)) continue;
    if (!normaliseText(chunk.content || "").includes(quote)) continue;
    usable.push({ citation: c.citation.trim(), quote, chunk });
  }

  const allAddbackNames = [...g.addbacks.values(), ...a.addbacks.values()].map((ab) => ab.name);
  const judged = diffs.map((d) => {
    if (d.change === "removed") {
      // Documentary: recorded, never needs a quote. Executable: never backed.
      if (d.kind === "amendment") return { ...d, backed_by: null, backed: true };
      return { ...d, backed_by: null, backed: false, reason: "a quote can show what a clause permits, never that an approved term has stopped applying" };
    }
    const hit = usable.find((c) => backs(d, c, allAddbackNames));
    return hit ? { ...d, backed_by: hit.citation, backed: true } : { ...d, backed_by: null, backed: false, reason: "no captured citation quotes an agreement or amendment clause that says so" };
  });

  const differencesOut = judged.map(({ kind, change, value, describe, backed, backed_by, reason }) => ({
    kind,
    change,
    value,
    describe,
    backed,
    backed_by,
    ...(reason ? { reason } : {}),
  }));
  const unbacked = judged.filter((d) => !d.backed);
  const backedList = judged.filter((d) => d.backed).map((d) => (d.backed_by ? `${d.describe} — ${d.backed_by}` : `${d.describe} (documentary; the calculator never reads it)`));

  if (unbacked.length === 0) {
    return {
      equal: false,
      verified: true,
      differences: differencesOut,
      notes: [
        note(
          "terms_differ_from_approved",
          "flag",
          `the governing calculation ran on terms that differ from the approved version, and every difference is backed by a quoted clause: ${backedList.join("; ")}. If this is right the approved terms are out of date; re-boarding them as a new version is an analyst's decision`,
        ),
      ],
    };
  }
  return {
    equal: false,
    verified: false,
    differences: differencesOut,
    notes: [
      note(
        "terms_unverified",
        "escalate",
        `the governing calculation ran on terms that differ from the approved version, and no quoted agreement or amendment clause supports: ${unbacked.map((d) => `${d.describe} (${d.reason})`).join("; ")}${backedList.length > 0 ? `. Backed: ${backedList.join("; ")}` : ""}. A calculation on terms no clause supports is not evidence the covenant was met`,
      ),
    ],
  };
}

/**
 * Apply the comparison to a casefile. Unverified terms turn a `resolve` into an
 * `escalate`; nothing else is promoted or demoted here (the ruling names only
 * `resolve`, and an `abstain` is never promoted by any layer). The note says
 * when it left a recommendation as it was, so its `escalate` is never read as an
 * action that did not happen.
 *
 * @returns {{casefile: object, notes: Array}}
 */
export function applyTermsDrift(casefile, drift) {
  const out = { ...casefile };
  const notes = (drift && Array.isArray(drift.notes) ? drift.notes : []).map((n) => ({ ...n }));
  for (const n of notes) {
    if (n.check !== "terms_unverified") continue;
    if (out.recommendation === "resolve") out.recommendation = "escalate";
    else n.detail = `${n.detail}. The recommendation was ${JSON.stringify(out.recommendation)}, which this check does not change: it downgrades only a resolve`;
  }
  return { casefile: out, notes };
}
