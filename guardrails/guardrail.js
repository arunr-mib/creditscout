/**
 * CreditScout — output guardrail.
 *
 * Code checking a model's work. This is what makes "zero false resolves" mean
 * something: the model cannot put a number in front of an analyst unless that
 * number came from a logged calculation or was quoted verbatim from a cited
 * document.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID:
 *   A guardrail that accepts only CALCULATED numbers abstains on every
 *   well-formed explanation, because legitimate explanations quote figures from
 *   the covenant ("the covenant requires 1.25x"). The false-resolve metric
 *   would read a perfect zero while the product did nothing at all. Quoted
 *   figures are valid evidence, and numbers are compared after normalisation,
 *   never as text.
 *
 * Zero dependencies. No import, no require.
 */

/** Scale suffixes seen in credit documents. */
const SCALES = { k: 1e3, m: 1e6, mm: 1e6, bn: 1e9, b: 1e9 };

/** Floats are not exact; 1.31 from a quote and 1.31 from a division differ. */
const EPSILON = 1e-6;

/**
 * Turn one figure-like token into a number.
 * "1,250,000" -> 1250000 | "1.25x" -> 1.25 | "$4.25m" -> 4250000
 * @returns {number|null}
 */
export function normaliseNumber(token) {
  if (typeof token === "number") return Number.isFinite(token) ? token : null;
  if (typeof token !== "string") return null;

  let s = token.trim().toLowerCase();
  if (s === "") return null;

  let negative = false;
  // Accounting negatives: (1,200) means -1200
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
    const unit = suffix[1];
    if (unit !== "x") scale = SCALES[unit] ?? 1;
    s = s.slice(0, -unit.length);
  }

  if (!/^\d*\.?\d+$/.test(s)) return null;

  const value = Number(s) * scale;
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * "N to 1", "N to 1.00", "N:1": a ratio stated as a pair, N its left operand.
 * N is a standalone number (not the tail of a grouped or decimal one, so
 * "2,400,000 to 1,900,000" never matches) and the "1" does not run on into more
 * digits or a ",ddd" / ".d" group.
 */
const TO_ONE = /(?<![\d,.])(\d+(?:\.\d+)?)(\s*(?:to\b|:)\s*)1(?:\.0+)?(?!\d|[.,]\d)/gi;

/** The N of every "N to 1" in a text. */
function statedRatios(text) {
  const out = [];
  for (const m of String(text).matchAll(TO_ONE)) out.push(Number(m[1]));
  return out;
}

/**
 * IDENTIFIERS ARE NOT FIGURES. Each rule removes a number that names something
 * rather than measures it, before any figure is read. Every rule is narrow and
 * decided by CONTEXT — the words around the digits — never by the size of the
 * number, because an identifier rule is also a way to make a figure invisible:
 * one written too wide is a bypass, which is worse than the false abstain it
 * cures. So each states what it refuses (stops reading as a figure) and what it
 * must keep allowing (still reads as one), and both are tested.
 *
 * Two of these the orchestrator's own prompt makes the model write: "report it
 * with its calc_id", and "re-board the covenant terms as version 2". A live F1
 * run abstained on its own calc_id, read as twelve figures (76, 4, 1, 2, -75…).
 */
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)";
/** A day of the month — 1 to 31, optional ordinal suffix. Nothing larger is a day. */
const DAY = "(?:3[01]|[12]\\d|0?[1-9])(?:st|nd|rd|th)?";
/** A calc id as the calculator mints and the trace prints it: hex and hyphens, six or more, at least one hex letter or hyphen. */
const HEX_ID = "(?=[0-9a-f-]*[a-f-])[0-9a-f][0-9a-f-]{5,}(?!\\w)";

const IDENTIFIERS = [
  // ---- calc ids --------------------------------------------------------
  // REFUSES: a UUID anywhere ("76f4c1f2-75e3-437d-9254-71fd7fa74f53"), and the
  //   id right after "calc_id" / "calc id" / "calculation id", short form
  //   included ("calc_id 76f4c1f2"), or a list of them ("calc_ids 967d2b8f and
  //   76f4c1f2"). The prompt tells the model to report figures with their ids.
  // KEEPS ALLOWING: the figure after an id ("calc_id 76f4c1f2 gives 1.28"),
  //   and an all-digit number after the words ("calc_id: 1250000") — a calc id
  //   is hex, so a token with no hex letter and no hyphen is read as a figure.
  //   That fails closed on the rare all-digit id rather than hiding a number.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  new RegExp(`\\bcalc(?:ulation)?[\\s_-]?ids?\\b[\\s:=#\`'"(]*${HEX_ID}(?:[\`'")]*\\s*(?:,|and|&|/)\\s*[\`'"(]*${HEX_ID})*`, "gi"),

  // ---- dates -----------------------------------------------------------
  // REFUSES: ISO "2026-06-30" and "2026-06", and a day beside a month name in
  //   either order: "April 1, 2026", "June 30", "1 April 2026", "30th of June",
  //   "Sept. 3". Years are stripped below; the day is what used to survive.
  // KEEPS ALLOWING: a figure near a month that is not its day — "the DSCR of
  //   1.12 may fall" (month names are matched case-sensitively, so the verb is
  //   not May), "in June EBITDA was 4,020,000", "June 1,250,000" (a day is
  //   never followed by more digits), "1.12 March" (a day is never the tail of
  //   a decimal), "12 months" (a month is a name, not the word "months").
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])\b/g,
  new RegExp(`\\b${MONTH}\\.?\\s+${DAY}\\b(?![.,]\\d)`, "g"),
  new RegExp(`(?<![\\w.,$-])${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, "g"),

  // ---- ordinals and references -----------------------------------------
  // REFUSES: "version 2" (the prompt's own "re-board as version 2"), "v2",
  //   "Waiver No. 3", "Amendment No. 2", "§7.11", "§7.11(b)(2)", "Section
  //   1.01", "Section 7.11(b)(i)", "Art. 5", "Amd 2 §3(a)". Letter and roman
  //   enumerators — "(a)", "(i)", "(b)(i)" — carry no digit, so they were never
  //   figures; a digit sub-clause is consumed only as part of a reference.
  // KEEPS ALLOWING: a count or a measure written before the noun or with no
  //   reference word — "2 versions", "2 add-backs", "the margin is 2" — and
  //   "No." that starts a sentence ("...rejected. No. 2 add-backs were
  //   claimed" keeps its 2: "No. N" is a reference only after a noun).
  //   Plurals, lists and ranges ("Sections 7.10 and 7.11", "§§1-2") are NOT
  //   consumed: a listed section number is the same shape as a ratio, so
  //   consuming lists would let "Section 7.11 and 1.47" hide the 1.47. They
  //   abstain, fail-closed.
  // A version number is an INTEGER. "version 1.47" and "v1.47" are a ratio
  // wearing a hat, and stay figures: excluding them let "under the borrower's
  // version 1.47 coverage was higher" enforce as resolve where the same
  // sentence with a bare 1.47 abstains. "version 2." at a sentence end is
  // still a version: only a digit after the point makes it a decimal.
  /\bversions?\s+\d+\b(?![.,]\d)/gi,
  /\bv\d+\b(?![.,]\d)/gi,
  /(?<=[A-Za-z]\s)No\.\s*\d+\b/g,
  /§\s*\d+(\.\d+)*(\([a-z0-9]{1,4}\))*/gi,
  /\b(section|article|art\.?|clause|amendment|amd\.?|exhibit|schedule)\s+(no\.?\s*)?\d+(\.\d+)*(\([a-z0-9]{1,4}\))*/gi,
];

/** One figure-like token, with no surrounding parentheses: "$4.25m", "1,250,000", "-3", "1.25x". */
const FIGURE = String.raw`\$?\s?-?\d[\d,]*(?:\.\d+)?(?:bn|mm|[kmbx])?`;

/**
 * Pull every figure out of free text.
 *
 * Deliberately strips things that LOOK numeric but are not figures:
 * identifiers (`IDENTIFIERS` below — calc ids, dates, versions, references) and
 * years. Treating "§7.11", "Q2 2026" or "calc_id 76f4c1f2" as unverified
 * figures would abstain on correct work, which is the failure mode this whole
 * file is built to avoid.
 *
 * `knownRatios` decides which "N to 1" pairs are ratios. Omitted, every one is:
 * the right mode for a DOCUMENT's text, where "1.25 to 1.00" is a ratio by its
 * form. Given a list, only a pair whose N is in it is: the right mode for text a
 * MODEL wrote, where its choice of verb or wording must decide nothing.
 *
 * WHAT THIS REFUSES: a "1.00" written after a number that is NOT a ratio the
 * cited documents or the logged calculations state — "rose from 0.92 to 1.00",
 * "improved 0.92 to 1.00", "went from $1.17 to 1.00". That 1.00 is an ordinary
 * figure and is traced like any other, so an unsupported one forces an abstain.
 *
 * WHAT IT MUST KEEP ALLOWING: a figure a document states, written as a ratio —
 * "requires 1.25 to 1.00", "the floor is 1.25:1", "coverage is 1.31 to 1.00".
 * Refusing those is the trap at the top of this file: the metric would read a
 * perfect zero while every well-formed explanation abstained.
 *
 * ACCEPTED RESIDUE, stated plainly because it is wider than "the logged DSCR":
 * ANY N in `knownRatios` makes the "1.00" after it unchecked. The caller builds
 * that list from the threshold (present in every casefile, and usually the
 * clause's own ratio), every logged DSCR including prior quarters, and every
 * ratio figure a cited chunk states. So "DSCR fell from 1.25 to 1.00" and
 * "fell from 1.40 to 1.00" (1.40 a prior quarter's logged DSCR) both read as
 * ratio pairs, and the verb is irrelevant. The only figure that goes unchecked
 * is the trailing 1 / 1.00 itself, so the available false statement is "the
 * ratio is exactly 1.00x". That is inherent to a form-based rule — "from 1.25
 * to 1.00" IS textually the covenant ratio — and the zero-false-resolve claim
 * carries this caveat.
 */
export function extractFigures(text, knownRatios) {
  if (typeof text !== "string" || text === "") return [];

  let cleaned = text;
  for (const rule of IDENTIFIERS) cleaned = cleaned.replace(rule, " ");
  cleaned = cleaned
    // The "1.00" in "1.25 to 1.00" (or "1.25:1") is the ratio's denominator, not a
    // figure of its own. Left in, a claim of "requires 1.00x" would verify against
    // any clause that states a minimum ratio in that form. See `knownRatios`.
    .replace(TO_ONE, (whole, n) =>
      knownRatios === undefined || knownRatios.some((k) => sameNumber(k, Number(n))) ? `${n} ` : whole,
    )
    // numeric dates (ISO dates are an identifier, above)
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    // bare years and quarter labels
    .replace(/\bq[1-4]\s*(19|20)\d{2}\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");

  // The scale suffix must be ATTACHED to the figure. Allowing a space before it
  // lets the first letter of the next word act as a multiplier — "$500,000 may
  // be added back" reads as $500bn, "1.08 below" as 1.08bn, "12 months" as
  // 12,000,000 — and an inflated figure matches nothing, so correct work
  // abstains. b/k/m/x start too many words in this corpus for that to be safe.
  //
  // PARENTHESES NEVER MAKE A FIGURE INVISIBLE (E-5). A token is either a whole
  // figure wrapped in its own parentheses — "(1,200)", "(1.47)", "(1.25x)" — or
  // a bare figure; a parenthesis that does not close around the figure itself
  // is not part of the token. The old pattern took an unbalanced "(" or ")" into
  // the token, `normaliseNumber` then read "(0.50" and "1.00)" as nothing at
  // all, and the figure silently left the check.
  //
  // REFUSES: a figure stated inside parentheses that do not wrap it alone —
  // "(0.50 to 1.00)", "(the floor is 0.50)", "(coverage 1.47 at year end)".
  // Each figure in them is read exactly as it would be without the brackets, so
  // an untraceable one abstains like any other. This was a bypass: a model
  // could state any covenant floor in brackets and the traceability rule never
  // saw it.
  //
  // MUST KEEP ALLOWING: the accounting negative a financial statement writes —
  // "(1,200)" is -1200, as `normaliseNumber` has always read it, so a restated
  // negative still matches the chunk it came from; and a ratio in brackets —
  // "(1.25x)" is the ratio 1.25, not -1.25, because a ratio has no accounting
  // sign. Reading "minimum (1.25x)" as negative abstained on a correctly quoted
  // floor (HANDOFF 9.4). A parenthesised PLAIN number such as "(1.47)" keeps
  // the negative reading: it abstains, fail-closed, which is acceptable.
  const tokens = cleaned.match(new RegExp(`\\(${FIGURE}\\)|${FIGURE}`, "gi")) || [];

  const out = [];
  for (const t of tokens) {
    const n = /^\(.*x\)$/i.test(t) ? normaliseNumber(t.slice(1, -1)) : normaliseNumber(t);
    if (n !== null) out.push(n);
  }
  return out;
}

/** PDF extraction mangles whitespace and punctuation; words are the signal. */
function normaliseText(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The figures a quote states AS ratios: "1.25x", "1.25 times", "1.25 to 1.00", "1.25:1". */
function ratioFigures(text) {
  const out = statedRatios(text);
  for (const m of String(text).matchAll(/(?<![\d,.])(\d+(?:\.\d+)?)\s*(?:x\b|times\b)/gi)) out.push(Number(m[1]));
  return out;
}

function sameNumber(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= EPSILON * scale;
}

/** Every number a calculation produced, including its components. */
function figuresFromCalc(entry) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(entry && entry.outputs);
  return out;
}

function note(check, action, detail) {
  return { layer: "guardrail", check, action, detail };
}

/**
 * Apply the §6.1 checks, in order.
 *
 * @param {object} casefile        schema-valid orchestrator output
 * @param {Array}  calcLogEntries  [{calc_id, outputs}] for this casefile
 * @param {Array}  citedChunks     [{citation, content}] — the chunk text behind
 *                                 every citation the agent used. If this is
 *                                 empty, every quote fails verification and
 *                                 everything abstains, so the caller MUST
 *                                 fetch them.
 * @returns {{casefile: object, notes: Array}}
 */
export function applyGuardrail(casefile, calcLogEntries, citedChunks) {
  const out = { ...casefile, claims: [...(casefile.claims || [])] };
  const notes = [];
  const calcs = Array.isArray(calcLogEntries) ? calcLogEntries : [];
  const chunks = Array.isArray(citedChunks) ? citedChunks : [];

  const chunkByCitation = new Map();
  for (const c of chunks) {
    if (c && typeof c.citation === "string") {
      chunkByCitation.set(c.citation.trim(), normaliseText(c.content || ""));
    }
  }

  // ---- check: every claim's quote appears verbatim in its cited chunk ----
  const removed = [];
  const kept = [];
  for (const claim of out.claims) {
    const chunk = chunkByCitation.get(String(claim.citation).trim());
    const quote = normaliseText(claim.quote);
    if (chunk && chunk.includes(quote)) {
      kept.push(claim);
    } else {
      removed.push(claim);
      notes.push(
        note(
          "quote_verbatim",
          "claim_removed",
          chunk
            ? `quote not found in ${claim.citation}: "${quote.slice(0, 80)}"`
            : `no chunk supplied for citation ${claim.citation}`,
        ),
      );
    }
  }
  out.claims = kept;

  // ---- build the allowed figure set --------------------------------------
  // Calculated values AND figures quoted verbatim in cited documents. The
  // second half is what keeps this guardrail from abstaining on everything.
  const allowed = [];
  for (const entry of calcs) allowed.push(...figuresFromCalc(entry));
  for (const content of chunkByCitation.values()) allowed.push(...extractFigures(content));

  // ---- check: every figure in the explanation and claims is traceable ----
  // Which "N to 1" pairs the MODEL wrote are ratios: only those whose N a cited
  // document states as a ratio, or a logged calculation produced as the DSCR or
  // its threshold. Wording and verbs decide nothing.
  //
  // REFUSES: an "N to 1" whose N is not on this list, so its 1.00 stays traced.
  // KEEPS ALLOWING: every ratio form the corpus actually uses. `ratioFigures`,
  // not `statedRatios`, because documents write a floor as "1.25x" or
  // "1.25 times" as often as "1.25 to 1.00"; reading only the pair form made a
  // model that restated such a floor as "1.25 to 1.00" abstain on the `1`.
  // The widening is bounded: the N must still be a ratio a cited chunk states.
  const knownRatios = [];
  for (const entry of calcs) {
    const o = entry && entry.outputs;
    for (const k of ["dscr", "threshold"]) {
      if (o && typeof o[k] === "number" && Number.isFinite(o[k])) knownRatios.push(o[k]);
    }
  }
  for (const content of chunkByCitation.values()) knownRatios.push(...ratioFigures(content));

  // EVERY field an analyst reads is checked, not only the explanation and the
  // claims (controller ruling 2026-10-06 from the CLAUDE.md principle; owner
  // informed, not overruled). The rule in CLAUDE.md is that every
  // figure the analyst sees traces to a calculation or a quote; "missing
  // evidence: a waiver covering the $500,000 add-back" is a figure the analyst
  // reads, and so is a confidence basis that says "a DSCR of 1.31 passes".
  //
  // REFUSES: an untraceable figure in `confidence_basis` or in any
  // `missing_evidence` entry, exactly as in the explanation.
  // KEEPS ALLOWING: everything the explanation is allowed — logged figures,
  // figures a cited chunk states, and identifiers (a missing document named
  // as "Amendment No. 3", "the Q3 2026 certificate", "a waiver dated after
  // 2026-06-30" carries no figure). The note names the field, so the analyst
  // can see which sentence was the problem.
  const fields = [
    ["explanation", [out.explanation]],
    ["claims", out.claims.map((c) => c.text)],
    ["confidence_basis", [out.confidence_basis]],
    ["missing_evidence", Array.isArray(out.missing_evidence) ? out.missing_evidence : []],
  ];
  const untraceableIn = [];
  for (const [field, texts] of fields) {
    const stated = texts.flatMap((t) => extractFigures(typeof t === "string" ? t : "", knownRatios));
    const bad = stated.filter((n) => !allowed.some((a) => sameNumber(a, n)));
    if (bad.length > 0) untraceableIn.push([field, [...new Set(bad)]]);
  }
  const untraceable = untraceableIn.flatMap(([, bad]) => bad);

  if (untraceable.length > 0) {
    notes.push(
      note(
        "figure_traceable",
        "abstain",
        `unverified figure(s): ${[...new Set(untraceable)].join(", ")} — not in any calculation for this casefile and not quoted in a cited document (${untraceableIn.map(([field, bad]) => `${field}: ${bad.join(", ")}`).join("; ")})`,
      ),
    );
    out.recommendation = "abstain";
  }

  // ---- check: a removed claim the recommendation depended on -------------
  if (removed.length > 0 && out.claims.length === 0 && out.recommendation !== "abstain") {
    notes.push(
      note("quote_verbatim", "abstain", "every supporting claim failed quote verification"),
    );
    out.recommendation = "abstain";
  }

  // ---- check: resolve must be earned -------------------------------------
  // Earned by the GOVERNING calculation passing — the LAST one in
  // `calcLogEntries`, which the caller orders oldest first — not by ANY
  // calculation passing (proposed by the controller to close a false-resolve
  // path; owner confirmed 2026-10-06, spec §6.1 amended). One definition of "the
  // calculation the recommendation rests on" for every check: the policy's
  // deep-breach rule and the terms comparison already judge the last one, and
  // prompt rule 7 tells the model the same.
  //
  // REFUSES: a resolve resting on an earlier pass after a later fail. With
  // `some`, an unbacked add-back that passed, then a baseline re-run that
  // failed, then "resolve" went through with zero notes — the terms comparison
  // looked at the failed baseline and found nothing to compare, and this
  // check found a pass somewhere.
  // KEEPS ALLOWING: F1's shape — the boarded terms fail, the amended terms pass
  // last, resolve. The pass that governs is the one the recommendation cites.
  if (out.recommendation === "resolve") {
    const governing = calcs.filter((c) => c && c.outputs).slice(-1)[0];
    const governingPasses = governing !== undefined && governing.outputs.pass === true;
    const hasCitedTerms = out.claims.length > 0;

    if (!governingPasses || !hasCitedTerms) {
      notes.push(
        note(
          "resolve_requires_evidence",
          "escalate",
          !governingPasses
            ? governing === undefined
              ? "resolve without a passing calculation"
              : `resolve, but the governing calculation${governing.calc_id ? ` (${governing.calc_id})` : ""} — the last one logged — does not pass; an earlier pass does not earn it`
            : "resolve without cited effective terms",
        ),
      );
      out.recommendation = "escalate";
    }
  }

  return { casefile: out, notes };
}

/**
 * SECURITY FIX S-1 — provenance of covenant terms.
 *
 * A casefile's numbers are verified against calc_log or a quote. A covenant
 * TERM's numbers were verified by nobody: shape validation is not provenance
 * validation, and a citation that merely EXISTS is not evidence.
 *
 * A threshold of 0.85 citing a clause that reads 1.25 is the dangerous case,
 * precisely because it looks correct — and its blast radius is every future
 * test for that borrower, not one casefile.
 *
 * @param {object} terms            the executable terms
 * @param {Array}  sourceCitations  [{field, citation, quote}]
 * @param {Array}  chunks           [{citation, content}] to verify quotes against
 * @returns {{valid: boolean, violations: Array}}
 */
export function verifyTermsProvenance(terms, sourceCitations, chunks) {
  const violations = [];
  const cites = Array.isArray(sourceCitations) ? sourceCitations : [];
  const chunkList = Array.isArray(chunks) ? chunks : [];

  const chunkByCitation = new Map();
  for (const c of chunkList) {
    if (c && typeof c.citation === "string") {
      chunkByCitation.set(c.citation.trim(), normaliseText(c.content || ""));
    }
  }

  const citeByField = new Map();
  for (const c of cites) {
    if (c && typeof c.field === "string") citeByField.set(c.field, c);
  }

  // Collect every numeric leaf in `terms`, with its dotted path.
  const numericFields = [];
  const walk = (value, path) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      numericFields.push({ path, value });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(terms, "");

  for (const { path, value } of numericFields) {
    const cite = citeByField.get(path);

    if (!cite) {
      violations.push({ field: path, value, reason: "no citation for this term" });
      continue;
    }

    const chunk = chunkByCitation.get(String(cite.citation).trim());
    const quote = normaliseText(cite.quote || "");

    if (!chunk) {
      violations.push({ field: path, value, reason: `no chunk supplied for ${cite.citation}` });
      continue;
    }
    if (!chunk.includes(quote)) {
      violations.push({ field: path, value, reason: `quote not found in ${cite.citation}` });
      continue;
    }

    // The value must actually appear in the quote it claims to come from.
    const inQuote = extractFigures(quote).some((n) => sameNumber(n, value));
    if (!inQuote) {
      violations.push({
        field: path,
        value,
        reason: `value ${value} does not appear in its cited quote`,
      });
      continue;
    }

    // A minimum ratio is not just "a number in the quote". "not less than 1.25
    // to 1.00" contains 1.00 too, and a threshold of 1.00 is a different
    // covenant, so the value has to be stated AS a ratio ("1.25x", "1.25 to 1",
    // "1.25:1"). A quote with no ratio in it fails: absence of evidence is not
    // permission, and this must fail closed.
    if (/(^|\.)min_dscr$/.test(path)) {
      const stated = ratioFigures(quote);
      if (!stated.some((n) => sameNumber(n, value))) {
        violations.push({
          field: path,
          value,
          reason:
            stated.length === 0
              ? `value ${value} is not stated as a minimum ratio (e.g. "1.25 to 1.00" or "1.25x") in its cited quote`
              : `value ${value} is not the minimum ratio its cited quote states (${stated.join(", ")})`,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
