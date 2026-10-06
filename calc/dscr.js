/**
 * CreditScout — DSCR calculator.
 *
 * The calculation layer. It produces every number in the product and decides
 * nothing. A model may ask it for a ratio; a model may never compute one.
 *
 * HARD CONSTRAINTS (see CLAUDE.md):
 *   - Zero dependencies. No `import`, no `require`. Plain ESM `export` only.
 *   - Never defaults a missing value to zero and never infers. A missing input
 *     is missing evidence, and evidence cannot be invented.
 *   - `calcId` is injected by the caller, never generated here, so tests are
 *     deterministic and every number in the product traces to a logged id.
 *   - Rounds HALF-UP to 2dp. Not banker's rounding.
 */

export const CALCULATOR_VERSION = "1.0.0";

/** Money is held in integer cents for all arithmetic. 2^53 cents is ~$90tn. */
const CENTS = 100;

function fail(error) {
  return { error };
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Half-up rounding to `dp` decimal places.
 *
 * `Math.round(value * 100) / 100` is wrong here: 1.005 * 100 is 100.49999…
 * in binary floating point, so it rounds DOWN and a borrower loses a cent of
 * covenant headroom. Rounding the decimal string instead avoids the
 * representation error entirely.
 */
export function roundHalfUp(value, dp = 2) {
  if (!isFiniteNumber(value)) return NaN;
  const neg = value < 0;
  const s = Math.abs(value).toFixed(dp + 4);
  const [intPart, fracPart = ""] = s.split(".");
  const keep = fracPart.slice(0, dp);
  const nextDigit = Number(fracPart[dp] ?? "0");
  let scaled = Number(intPart + (keep.padEnd(dp, "0") || ""));
  if (nextDigit >= 5) scaled += 1;
  const out = scaled / Math.pow(10, dp);
  return neg ? -out : out;
}

/** Dollars -> integer cents, rejecting anything that isn't a finite number. */
function toCents(value) {
  if (!isFiniteNumber(value)) return null;
  return Math.round(value * CENTS);
}

/**
 * Compute DSCR from executable covenant terms and the period's financials.
 *
 * @param {object} terms       threshold, numerator (base/addbacks/deductions), denominator
 * @param {object} financials  {ebitda, addback_amounts{}, unfinanced_capex,
 *                              cash_taxes, scheduled_principal, cash_interest}
 * @param {object} options     {calcId} — REQUIRED
 * @returns {object} {calc_id, components, dscr, threshold, pass, margin,
 *                    calculator_version} | {error}
 */
export function computeDscr(terms, financials, options) {
  // ---- caller contract -----------------------------------------------------
  if (!options || typeof options.calcId !== "string" || options.calcId === "") {
    return fail("calcId is required: the calculator does not generate ids");
  }
  if (!terms || typeof terms !== "object") return fail("terms is required");
  if (!financials || typeof financials !== "object") {
    return fail("financials is required");
  }

  const threshold = terms.threshold && terms.threshold.min_dscr;
  if (!isFiniteNumber(threshold)) {
    return fail("terms.threshold.min_dscr is required and must be a number");
  }

  const numeratorSpec = terms.numerator || {};
  const denominatorSpec = terms.denominator || {};

  // ---- numerator: base -----------------------------------------------------
  // EBITDA may legitimately be negative. A struggling borrower is a result,
  // not an error.
  const ebitdaCents = toCents(financials.ebitda);
  if (ebitdaCents === null) {
    return fail("missing input: financials.ebitda");
  }

  const components = {
    base: financials.ebitda,
    addbacks: {},
    deductions: {},
    denominator_parts: {},
  };

  let numeratorCents = ebitdaCents;

  // ---- numerator: add-backs ------------------------------------------------
  const addbacks = Array.isArray(numeratorSpec.addbacks)
    ? numeratorSpec.addbacks
    : [];
  const supplied = financials.addback_amounts || {};

  for (const addback of addbacks) {
    const name = addback && addback.name;
    if (typeof name !== "string" || name === "") {
      return fail("terms.numerator.addbacks[] entries require a name");
    }

    // `financials.addback_amounts` is keyed by name, so a name listed twice
    // cannot mean two different figures — it is a mapping error. Adding the
    // figure twice would overstate the numerator while logging a single entry,
    // leaving `components` unable to reconcile with `numerator_total`, which is
    // the only thing the guardrail has to verify a figure against.
    if (Object.prototype.hasOwnProperty.call(components.addbacks, name)) {
      return fail(`duplicate add-back in terms: "${name}"`);
    }

    // Silently treating an unsupplied add-back as zero would understate the
    // numerator and fabricate a breach.
    const rawCents = toCents(supplied[name]);
    if (rawCents === null) {
      return fail(`missing input: financials.addback_amounts["${name}"]`);
    }

    // An absent or null `cap` means UNCAPPED. Reading absent-as-zero would wipe
    // out the add-back and turn a correct resolve into a false escalation.
    const hasCap =
      Object.prototype.hasOwnProperty.call(addback, "cap") &&
      addback.cap !== null &&
      addback.cap !== undefined;

    let appliedCents = rawCents;
    let capped = false;

    if (hasCap) {
      const capCents = toCents(addback.cap);
      if (capCents === null) {
        return fail(`terms.numerator.addbacks["${name}"].cap must be a number or null`);
      }
      if (rawCents > capCents) {
        appliedCents = capCents;
        capped = true;
      }
    }

    numeratorCents += appliedCents;
    components.addbacks[name] = {
      claimed: rawCents / CENTS,
      applied: appliedCents / CENTS,
      cap: hasCap ? addback.cap : null,
      capped,
    };
  }

  // ---- numerator: deductions ----------------------------------------------
  const DEDUCTIONS = {
    unfinanced_capex: "unfinanced_capex",
    cash_taxes: "cash_taxes",
  };
  const deductions = Array.isArray(numeratorSpec.deductions)
    ? numeratorSpec.deductions
    : [];

  for (const name of deductions) {
    const field = DEDUCTIONS[name];
    // Refuse rather than guess what the drafter meant.
    if (!field) return fail(`unknown deduction component: "${name}"`);
    if (Object.prototype.hasOwnProperty.call(components.deductions, name)) {
      return fail(`duplicate deduction in terms: "${name}"`);
    }

    const cents = toCents(financials[field]);
    if (cents === null) return fail(`missing input: financials.${field}`);

    numeratorCents -= cents;
    components.deductions[name] = cents / CENTS;
  }

  // ---- denominator ---------------------------------------------------------
  const DENOMINATOR = {
    scheduled_principal: "scheduled_principal",
    cash_interest: "cash_interest",
  };
  const parts = Array.isArray(denominatorSpec.components)
    ? denominatorSpec.components
    : [];

  if (parts.length === 0) {
    return fail("terms.denominator.components must list at least one component");
  }

  let denominatorCents = 0;
  for (const name of parts) {
    const field = DENOMINATOR[name];
    if (!field) return fail(`unknown denominator component: "${name}"`);
    if (Object.prototype.hasOwnProperty.call(components.denominator_parts, name)) {
      return fail(`duplicate denominator component in terms: "${name}"`);
    }

    const cents = toCents(financials[field]);
    if (cents === null) return fail(`missing input: financials.${field}`);

    denominatorCents += cents;
    components.denominator_parts[name] = cents / CENTS;
  }

  // Division by zero must never silently produce Infinity, and a negative
  // denominator is not a covenant that can be tested.
  if (denominatorCents <= 0) {
    return fail(
      `denominator must be greater than zero (got ${denominatorCents / CENTS})`,
    );
  }

  // ---- result --------------------------------------------------------------
  const dscr = roundHalfUp(numeratorCents / denominatorCents, 2);
  const roundedThreshold = roundHalfUp(threshold, 2);

  components.numerator_total = numeratorCents / CENTS;
  components.denominator_total = denominatorCents / CENTS;

  return {
    calc_id: options.calcId,
    components,
    dscr,
    threshold: roundedThreshold,
    pass: dscr >= roundedThreshold,
    margin: roundHalfUp(dscr - roundedThreshold, 2),
    calculator_version: CALCULATOR_VERSION,
  };
}
