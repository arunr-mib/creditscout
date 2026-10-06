/**
 * CreditScout — casefile output schema.
 *
 * Validates the SHAPE of what the orchestrator returns, before any guardrail
 * reasons about its contents. A malformed output is never rendered as a
 * recommendation: the caller retries once, then abstains.
 *
 * Zero dependencies. No import, no require.
 */

export const RECOMMENDATIONS = ["resolve", "request", "escalate", "abstain"];

export const PATTERN_TAGS = [
  "amendment_addback",
  "period_mismatch",
  "missing_waiver",
  "borrower_calc_error",
  "true_breach",
  "other",
];

const MAX_EXPLANATION_WORDS = 150;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateCasefileOutput(obj) {
  const errors = [];

  if (!isPlainObject(obj)) {
    return { valid: false, errors: ["output must be an object"] };
  }

  if (!RECOMMENDATIONS.includes(obj.recommendation)) {
    errors.push(
      `recommendation must be one of ${RECOMMENDATIONS.join(", ")} (got ${JSON.stringify(obj.recommendation)})`,
    );
  }

  if (typeof obj.confidence_basis !== "string" || obj.confidence_basis.trim() === "") {
    errors.push("confidence_basis must be a non-empty string");
  }

  if (typeof obj.explanation !== "string" || obj.explanation.trim() === "") {
    errors.push("explanation must be a non-empty string");
  } else {
    const words = obj.explanation.trim().split(/\s+/).length;
    if (words > MAX_EXPLANATION_WORDS) {
      errors.push(`explanation must be <= ${MAX_EXPLANATION_WORDS} words (got ${words})`);
    }
  }

  if (!Array.isArray(obj.claims)) {
    errors.push("claims must be an array");
  } else {
    obj.claims.forEach((c, i) => {
      if (!isPlainObject(c)) {
        errors.push(`claims[${i}] must be an object`);
        return;
      }
      for (const field of ["text", "citation", "quote"]) {
        if (typeof c[field] !== "string" || c[field].trim() === "") {
          errors.push(`claims[${i}].${field} must be a non-empty string`);
        }
      }
    });
  }

  if (!Array.isArray(obj.calculations)) {
    errors.push("calculations must be an array");
  } else {
    obj.calculations.forEach((c, i) => {
      if (!isPlainObject(c) || typeof c.calc_id !== "string" || c.calc_id === "") {
        errors.push(`calculations[${i}].calc_id must be a non-empty string`);
      }
    });
  }

  if (!Array.isArray(obj.missing_evidence)) {
    errors.push("missing_evidence must be an array");
  } else {
    obj.missing_evidence.forEach((m, i) => {
      if (typeof m !== "string") errors.push(`missing_evidence[${i}] must be a string`);
    });
  }

  if (!PATTERN_TAGS.includes(obj.suggested_tag)) {
    errors.push(
      `suggested_tag must be one of ${PATTERN_TAGS.join(", ")} (got ${JSON.stringify(obj.suggested_tag)})`,
    );
  }

  return { valid: errors.length === 0, errors };
}
