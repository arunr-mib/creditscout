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
 * Pull every figure out of free text.
 *
 * Deliberately strips things that LOOK numeric but are not figures — section
 * references and years. Treating "§7.11" or "Q2 2026" as unverified figures
 * would abstain on correct work, which is the failure mode this whole file is
 * built to avoid.
 *
 * `knownRatios` decides which "N to 1" pairs are ratios. Omitted, every one is:
 * the right mode for a DOCUMENT's text, where "1.25 to 1.00" is a ratio by its
 * form. Given a list, only a pair whose N is in it is: the right mode for text a
 * MODEL wrote, where its choice of verb or wording must decide nothing. A "1.00"
 * after a number that is not a ratio the documents or calculations state
 * ("from 0.92 to 1.00", "improved 0.92 to 1.00") is an ordinary figure and is
 * traced like any other. Accepted residue: "from 1.31 to 1.00" with 1.31 the
 * logged DSCR reads as a ratio pair.
 */
export function extractFigures(text, knownRatios) {
  if (typeof text !== "string" || text === "") return [];

  const cleaned = text
    // section / article references: §7.11, Section 1.01, Art. 5, Amd 2 §3(a)
    .replace(/§\s*\d+(\.\d+)*(\([a-z0-9]+\))?/gi, " ")
    .replace(/\b(section|article|art\.?|clause|amendment|amd\.?|exhibit|schedule)\s+(no\.?\s*)?\d+(\.\d+)*/gi, " ")
    // The "1.00" in "1.25 to 1.00" (or "1.25:1") is the ratio's denominator, not a
    // figure of its own. Left in, a claim of "requires 1.00x" would verify against
    // any clause that states a minimum ratio in that form. See `knownRatios`.
    .replace(TO_ONE, (whole, n) =>
      knownRatios === undefined || knownRatios.some((k) => sameNumber(k, Number(n))) ? `${n} ` : whole,
    )
    // ISO and common dates
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    // bare years and quarter labels
    .replace(/\bq[1-4]\s*(19|20)\d{2}\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");

  // The scale suffix must be ATTACHED to the figure. Allowing a space before it
  // lets the first letter of the next word act as a multiplier — "$500,000 may
  // be added back" reads as $500bn, "1.08 below" as 1.08bn, "12 months" as
  // 12,000,000 — and an inflated figure matches nothing, so correct work
  // abstains. b/k/m/x start too many words in this corpus for that to be safe.
  const tokens = cleaned.match(/\(?\$?\s?-?\d[\d,]*(\.\d+)?(bn|mm|[kmbx])?\)?/gi) || [];

  const out = [];
  for (const t of tokens) {
    const n = normaliseNumber(t);
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
  const knownRatios = [];
  for (const entry of calcs) {
    const o = entry && entry.outputs;
    for (const k of ["dscr", "threshold"]) {
      if (o && typeof o[k] === "number" && Number.isFinite(o[k])) knownRatios.push(o[k]);
    }
  }
  for (const content of chunkByCitation.values()) knownRatios.push(...statedRatios(content));

  const stated = [
    ...extractFigures(out.explanation || "", knownRatios),
    ...out.claims.flatMap((c) => extractFigures(c.text || "", knownRatios)),
  ];

  const untraceable = stated.filter((n) => !allowed.some((a) => sameNumber(a, n)));

  if (untraceable.length > 0) {
    notes.push(
      note(
        "figure_traceable",
        "abstain",
        `unverified figure(s): ${[...new Set(untraceable)].join(", ")} — not in any calculation for this casefile and not quoted in a cited document`,
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
  if (out.recommendation === "resolve") {
    const hasPassingCalc = calcs.some((c) => c && c.outputs && c.outputs.pass === true);
    const hasCitedTerms = out.claims.length > 0;

    if (!hasPassingCalc || !hasCitedTerms) {
      notes.push(
        note(
          "resolve_requires_evidence",
          "escalate",
          !hasPassingCalc
            ? "resolve without a passing calculation"
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
