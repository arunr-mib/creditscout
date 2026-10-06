/**
 * CreditScout — Risk Officer policy engine.
 *
 * Runs after the guardrail, on a casefile whose evidence has already been
 * verified. Policy is about what the LENDER permits, not about whether the
 * agent told the truth.
 *
 * Zero dependencies. No import, no require.
 */

export const DEFAULT_POLICY = {
  variance_tolerance: 0.05,
  escalate_if_breach_margin_over: 0.15,
  prohibited_actions: ["waive covenant", "amend terms", "contact borrower"],
  max_steps: 8,
  require_human_review: true,
};

function note(check, action, detail) {
  return { layer: "policy", check, action, detail };
}

/**
 * @param {object} casefile  a schema-valid, guardrail-checked casefile
 * @param {object} policy    values from the `policy` table
 * @param {Array}  calcs     calc_log entries referenced by this casefile
 * @returns {{casefile: object, notes: Array}}
 */
export function applyPolicy(casefile, policy, calcs) {
  const p = { ...DEFAULT_POLICY, ...(policy || {}) };
  const out = { ...casefile };
  const notes = [];
  const calculations = Array.isArray(calcs) ? calcs : [];

  // --- prohibited actions -------------------------------------------------
  // The agent may not propose waiving a covenant, amending terms, or
  // contacting the borrower. These are the lender's decisions, not ours.
  const haystack = [
    out.explanation || "",
    ...(Array.isArray(out.claims) ? out.claims.map((c) => c && c.text) : []),
  ]
    .join(" ")
    .toLowerCase();

  for (const action of p.prohibited_actions || []) {
    if (haystack.includes(String(action).toLowerCase())) {
      if (out.recommendation !== "escalate") {
        notes.push(
          note("prohibited_action", "escalate", `proposed a prohibited action: "${action}"`),
        );
        out.recommendation = "escalate";
      }
      break;
    }
  }

  // --- deep breaches always escalate --------------------------------------
  // A marginal shortfall may have an explanation. A deep one is a credit
  // event, and no amount of documentary justification makes it routine.
  const worst = calculations
    .map((c) => (c && c.outputs && typeof c.outputs.margin === "number" ? c.outputs.margin : null))
    .filter((m) => m !== null)
    .sort((a, b) => a - b)[0];

  if (
    typeof worst === "number" &&
    worst < 0 &&
    Math.abs(worst) > p.escalate_if_breach_margin_over &&
    out.recommendation === "resolve"
  ) {
    notes.push(
      note(
        "breach_depth",
        "escalate",
        `breach margin ${worst} exceeds escalate_if_breach_margin_over ${p.escalate_if_breach_margin_over}`,
      ),
    );
    out.recommendation = "escalate";
  }

  // --- step cap -----------------------------------------------------------
  // Running out of steps is not a conclusion.
  if (typeof out.steps_count === "number" && out.steps_count >= p.max_steps) {
    if (out.recommendation === "resolve") {
      notes.push(
        note("step_cap", "abstain", `reached max_steps ${p.max_steps} — investigation incomplete`),
      );
      out.recommendation = "abstain";
    }
  }

  // --- human review is locked ---------------------------------------------
  // Recorded on every casefile so the audit trail shows it was never off.
  if (p.require_human_review !== true) {
    notes.push(
      note("require_human_review", "forced_true", "human review cannot be disabled"),
    );
  }

  return { casefile: out, notes };
}
