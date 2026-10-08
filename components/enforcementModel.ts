/**
 * The checks that run on every investigation, whatever the policy says.
 *
 * These are NOT the policy table. A Risk Officer can change the step cap or the
 * escalation margin; none of these can be changed by anyone short of a code
 * change, because they are what makes the product's claim true: a figure with
 * no logged calculation behind it never reaches an analyst as a recommendation.
 *
 * Governance showed only the configurable half, which left the screen implying
 * the dials were the whole control set. The names and actions here are the ones
 * the code actually emits into `casefiles.guardrail_notes` — if a check is
 * renamed in `guardrails/`, the test on this list fails.
 */

export type EnforcementAction = "abstain" | "escalate" | "flag" | "retry";

export interface EnforcementRule {
  check: string;
  title: string;
  detail: string;
  action: EnforcementAction;
  /** Which layer emits it: the casefile guardrail, or evidence assembly. */
  layer: "guardrail" | "evidence";
}

export const ENFORCEMENT_ACTION_LABEL: Record<EnforcementAction, string> = {
  abstain: "Forces abstain",
  escalate: "Forces escalate",
  flag: "Flags for review",
  retry: "Retries once",
};

export const ENFORCEMENT_RULES: readonly EnforcementRule[] = [
  {
    check: "figure_traceable",
    title: "Every figure must trace to a calculation or a quote",
    detail:
      "A number in the explanation that matches no logged calculation and no quoted clause is unverified, and the recommendation becomes an abstain.",
    action: "abstain",
    layer: "guardrail",
  },
  {
    check: "resolve_requires_evidence",
    title: "A resolve needs a passing governing calculation",
    detail:
      "The last calculation logged is the one that decides. If it does not pass, a resolve is downgraded to escalate — an earlier pass does not earn it.",
    action: "escalate",
    layer: "guardrail",
  },
  {
    check: "quote_verbatim",
    title: "Quotes must appear verbatim in the cited clause",
    detail: "A supporting claim whose quote cannot be found in the document it cites is removed before the analyst sees it.",
    action: "abstain",
    layer: "guardrail",
  },
  {
    check: "terms_differ_from_approved",
    title: "Terms that differ from the approved version are flagged",
    detail:
      "When the governing calculation used terms the approved version does not carry, every difference must be backed by a quoted clause, and the casefile says so.",
    action: "flag",
    layer: "guardrail",
  },
  {
    check: "calc_id_unknown",
    title: "A cited calculation must belong to this casefile",
    detail: "A calc_id the answer names but this investigation never logged is flagged; the shown ids come from the log, not the answer.",
    action: "flag",
    layer: "evidence",
  },
  {
    check: "schema",
    title: "The answer must match the required shape",
    detail:
      "A malformed answer is asked for once more on the same thread. At the step cap there is no retry left, and it becomes an abstain.",
    action: "retry",
    layer: "guardrail",
  },
] as const;
