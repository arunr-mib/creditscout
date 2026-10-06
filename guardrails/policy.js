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
  //
  // Judged on the GOVERNING calculation — the last one run — not the worst in
  // the casefile. On the unboarded-amendment path (F1, F5) the casefile holds a
  // failing calc on terms that turn out to be superseded, followed by a passing
  // calc on the terms actually in force. A discarded attempt is not a breach.
  const governing = calculations
    .filter((c) => c && c.outputs && typeof c.outputs.margin === "number")
    .slice(-1)[0];
  const margin = governing ? governing.outputs.margin : null;

  // `abstain` is the guardrail's verdict that the output could not be verified.
  // Policy does not promote it: an escalation resting on unverified figures
  // reads more confident than the evidence behind it.
  const escalatable = out.recommendation === "resolve" || out.recommendation === "request";

  if (
    typeof margin === "number" &&
    margin < 0 &&
    Math.abs(margin) > p.escalate_if_breach_margin_over &&
    escalatable
  ) {
    notes.push(
      note(
        "breach_depth",
        "escalate",
        `breach margin ${margin} exceeds escalate_if_breach_margin_over ${p.escalate_if_breach_margin_over}`,
      ),
    );
    out.recommendation = "escalate";
  }

  // --- step cap -----------------------------------------------------------
  // Running out of steps is not a conclusion.
  if (typeof out.steps_count === "number") {
    if (out.steps_count >= p.max_steps && out.recommendation === "resolve") {
      notes.push(
        note("step_cap", "abstain", `reached max_steps ${p.max_steps} — investigation incomplete`),
      );
      out.recommendation = "abstain";
    }
  } else {
    // `steps_count` is not part of the §6.1 orchestrator output contract, so a
    // caller that forwards the model's object verbatim disables this check.
    // Record that rather than letting a safety check pass silently.
    notes.push(
      note("step_cap", "not_checked", "steps_count absent — step cap not applied"),
    );
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
