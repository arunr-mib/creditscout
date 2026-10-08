import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDscr } from "../calc/dscr.js";
import { PATTERN_TAGS } from "../guardrails/casefile-schema.js";
import {
  FACILITIES,
  VARIANCE_TOLERANCE,
  boardedVersionFor,
  termsFor,
  unboardedVersionFor,
} from "./facilities.js";

const CALC_ID = "calc_test_fixed";

// Policy `escalate_if_breach_margin_over` (supabase/migrations/0003_policy_seed.sql).
// A breach deeper than this auto-escalates, so a case meant to RESOLVE (F1, F5-Q2)
// must stay shallower, or it could never resolve.
const ESCALATE_MARGIN = 0.15;

const byId = (id) => FACILITIES.find((f) => f.id === id);
const quarter = (f, periodEnd) => f.quarters.find((q) => q.period_end === periodEnd);
const version = (f, n) => f.terms_versions.find((v) => v.version === n);

function run(terms, financials) {
  const r = computeDscr(terms, financials, { calcId: CALC_ID });
  assert.equal(r.error, undefined, `calculator returned an error: ${r.error}`);
  return r;
}

/** Test a quarter against a specific terms version. */
function runVersion(v, q) {
  return run(termsFor(v, q), q.financials);
}

/**
 * The borrower's own arithmetic: every add-back they certified, uncapped, at the
 * amount they certified. Reproduces the figure on their compliance certificate.
 */
function borrowerRun(f, q) {
  const terms = termsFor(version(f, 1), q);
  terms.numerator.addbacks = Object.keys(q.certificate_addbacks).map((name) => ({
    name,
    amount_source: "financials",
    cap: null,
    citation: "borrower",
  }));
  return run(terms, { ...q.financials, addback_amounts: q.certificate_addbacks });
}

// ------------------------------------------------------------------ shape

test("six facilities: the three with a twist, then the three performing, with the owner's names", () => {
  assert.deepEqual(FACILITIES.map((f) => f.id), ["F1", "F3", "F5", "F7", "F8", "F9"]);
  assert.deepEqual(FACILITIES.map((f) => f.borrower_name), [
    "Harbor Logistics",
    "Northgate Foods",
    "Coastal Marine",
    "Dokusign Inc",
    "Peat's Coffee Company",
    "Costko Wholesale",
  ]);
});

// F2/F4/F6 are reserved for the abstain/request cases (parking-lot 4.1). The
// performing loans must not consume those ids.
test("no facility claims a reserved id", () => {
  for (const id of ["F2", "F4", "F6"]) {
    assert.equal(FACILITIES.find((f) => f.id === id), undefined, `${id} is reserved`);
  }
});

test("every facility carries the metadata, tag and outcome the product needs", () => {
  const outcomes = ["resolve", "request", "escalate", "abstain", "compliant"];
  for (const f of FACILITIES) {
    assert.ok(f.industry, `${f.id} industry`);
    assert.match(f.sender_domain, /\.example$/, `${f.id} sender_domain is a reserved .example domain`);
    assert.ok(f.twist.length > 20, `${f.id} twist`);
    // "none" is not a PATTERN_TAG and must never become one: PATTERN_TAGS is the
    // enum the agent may emit, and a performing loan produces no casefile at all.
    const tagged = f.pattern_tag === "none" || PATTERN_TAGS.includes(f.pattern_tag);
    assert.ok(tagged, `${f.id} pattern_tag ${f.pattern_tag}`);
    assert.equal(f.pattern_tag === "none", f.expected_outcome === "compliant", `${f.id} tag and outcome agree`);
    assert.ok(outcomes.includes(f.expected_outcome), `${f.id} expected_outcome`);
    assert.ok(f.terms_versions.length >= 1, `${f.id} terms_versions`);
    assert.ok(f.quarters.length >= 1, `${f.id} quarters`);
    // A performing loan has no amendment and one quarter, so three documents
    // is its floor; a facility with a twist carries at least four.
    assert.ok(f.documents.length >= 3, `${f.id} documents`);
  }
  assert.deepEqual(FACILITIES.map((f) => [f.pattern_tag, f.expected_outcome]), [
    ["amendment_addback", "resolve"],
    ["true_breach", "escalate"],
    ["amendment_addback", "resolve"],
    ["none", "compliant"],
    ["none", "compliant"],
    ["none", "compliant"],
  ]);
});

test("document counts: 4 for F1, 4 for F3, 8 for F5, 3 for each performing loan", () => {
  assert.deepEqual(FACILITIES.map((f) => f.documents.length), [4, 4, 8, 3, 3, 3]);
});

test("doc_type values are ones the schema accepts", () => {
  const allowed = ["agreement", "amendment", "waiver", "compliance_certificate", "financials"];
  for (const f of FACILITIES) {
    for (const d of f.documents) assert.ok(allowed.includes(d.doc_type), `${f.id} ${d.doc_type}`);
  }
});

test("terms use the §4.2 schema, a per-loan threshold, TTM, standard deductions and denominator", () => {
  // The minimum is negotiated per loan. It is NOT a constant, and a test that
  // pinned it to 1.25 would quietly forbid ever boarding another number.
  const thresholds = new Map([["F1", 1.25], ["F3", 1.25], ["F5", 1.25], ["F7", 1.4], ["F8", 1.1], ["F9", 1.35]]);
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      const t = termsFor(v, f.quarters[0]);
      assert.deepEqual(Object.keys(t), [
        "test_period", "threshold", "numerator", "denominator", "effective_amendments",
      ]);
      assert.equal(t.test_period.basis, "TTM");
      assert.equal(t.threshold.min_dscr, thresholds.get(f.id), `${f.id} min_dscr`);
      assert.deepEqual(t.numerator.deductions, ["unfinanced_capex", "cash_taxes"]);
      assert.deepEqual(t.denominator.components, ["scheduled_principal", "cash_interest"]);
    }
  }
});

// ----------------------------------------------------------- boarding lag

test("F1 and F5 are the only facilities with an unboarded version; the rest are fully boarded", () => {
  const fullyBoarded = FACILITIES.filter((f) => f.terms_versions.every((v) => v.boarded));
  assert.deepEqual(fullyBoarded.map((f) => f.id), ["F3", "F7", "F8", "F9"]);
  for (const id of ["F1", "F5"]) {
    const unboarded = byId(id).terms_versions.filter((v) => !v.boarded);
    assert.deepEqual(unboarded.map((v) => v.version), [2], `${id} unboarded versions`);
    assert.equal(unboarded[0].effective_from, "2026-04-01");
  }
});

test("the unboarded amendment's effective date falls inside the test quarter it governs", () => {
  // Amendment effective dates must fall inside the period they govern, or the
  // investigation path is unreachable.
  for (const [id, periodEnd] of [["F1", "2026-06-30"], ["F5", "2026-06-30"]]) {
    const f = byId(id);
    const amendment = f.documents.find((d) => d.doc_type === "amendment");
    assert.equal(amendment.effective_date, "2026-04-01");
    assert.ok(amendment.effective_date > "2026-03-31" && amendment.effective_date <= periodEnd);
  }
});

test("a quarter is tested against the newest BOARDED version in force", () => {
  assert.equal(boardedVersionFor(byId("F1"), quarter(byId("F1"), "2026-06-30")).version, 1);
  assert.equal(unboardedVersionFor(byId("F1"), quarter(byId("F1"), "2026-06-30")).version, 2);
  // Q4 2025 and Q1 2026 predate the amendment: no unboarded version in force.
  assert.equal(unboardedVersionFor(byId("F5"), quarter(byId("F5"), "2025-12-31")), null);
  assert.equal(unboardedVersionFor(byId("F5"), quarter(byId("F5"), "2026-03-31")), null);
  assert.equal(unboardedVersionFor(byId("F5"), quarter(byId("F5"), "2026-06-30")).version, 2);
  assert.equal(unboardedVersionFor(byId("F3"), quarter(byId("F3"), "2026-06-30")), null);
});

// ---------------------------------------------------------- locked results

test("F1 Q2 2026 as tested (v1): 1.12, fail, margin -0.13 — the same failing number the borrower reports", () => {
  const f = byId("F1");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(boardedVersionFor(f, q), q);
  assert.equal(r.dscr, 1.12);
  assert.equal(r.pass, false);
  assert.equal(r.margin, -0.13);
  assert.equal(q.reported_dscr, 1.12);
});

test("F1 Q2 2026 remapped under the unboarded v2: 1.28, pass", () => {
  const f = byId("F1");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(unboardedVersionFor(f, q), q);
  assert.equal(r.dscr, 1.28);
  assert.equal(r.pass, true);
});

test("F1's actual restructuring charge exceeds the cap, so the cap binds", () => {
  const f = byId("F1");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(version(f, 2), q);
  assert.equal(r.components.addbacks["restructuring charges"].claimed, 620000);
  assert.equal(r.components.addbacks["restructuring charges"].applied, 500000);
  assert.equal(r.components.addbacks["restructuring charges"].capped, true);
});

test("F3 Q2 2026 as tested: 1.08, fail, margin -0.17", () => {
  const f = byId("F3");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(boardedVersionFor(f, q), q);
  assert.equal(r.dscr, 1.08);
  assert.equal(r.pass, false);
  assert.equal(r.margin, -0.17);
});

test("F3 false-compliant catch: the borrower's own add-back, uncapped, gives their 1.31; ours gives 1.08", () => {
  const f = byId("F3");
  const q = quarter(f, "2026-06-30");
  const theirs = borrowerRun(f, q);
  assert.equal(theirs.dscr, 1.31);
  assert.equal(theirs.pass, true);
  assert.equal(q.reported_dscr, 1.31);
  assert.equal(runVersion(boardedVersionFor(f, q), q).dscr, 1.08);
  assert.equal(q.financials.addback_amounts["owner compensation normalisation"], 530000);
});

test("F5 Q4 2025: 1.41, pass, agrees with the borrower", () => {
  const f = byId("F5");
  const q = quarter(f, "2025-12-31");
  const r = runVersion(boardedVersionFor(f, q), q);
  assert.equal(r.dscr, 1.41);
  assert.equal(r.pass, true);
  assert.equal(q.reported_dscr, 1.41);
});

test("F5 Q1 2026: capped gives 1.29 (pass); uncapped, as the borrower did, gives 1.38; variance exceeds tolerance", () => {
  const f = byId("F5");
  const q = quarter(f, "2026-03-31");
  const ours = runVersion(boardedVersionFor(f, q), q);
  assert.equal(ours.dscr, 1.29);
  assert.equal(ours.pass, true);
  assert.equal(ours.components.addbacks["dry-dock and vessel overhaul charges"].claimed, 900000);
  assert.equal(ours.components.addbacks["dry-dock and vessel overhaul charges"].applied, 500000);

  // Same add-back, cap removed.
  const uncappedTerms = termsFor(version(f, 1), q);
  uncappedTerms.numerator.addbacks[0].cap = null;
  assert.equal(run(uncappedTerms, q.financials).dscr, 1.38);
  assert.equal(q.reported_dscr, 1.38);

  assert.ok(Math.abs(ours.dscr - q.reported_dscr) > VARIANCE_TOLERANCE);
});

test("F5 Q2 2026 as tested (v1): 1.12, fail, margin -0.13; remapped under unboarded v2: 1.30, pass", () => {
  const f = byId("F5");
  const q = quarter(f, "2026-06-30");
  const asTested = runVersion(boardedVersionFor(f, q), q);
  assert.equal(asTested.dscr, 1.12);
  assert.equal(asTested.pass, false);
  assert.equal(asTested.margin, -0.13);

  const remapped = runVersion(unboardedVersionFor(f, q), q);
  assert.equal(remapped.dscr, 1.3);
  assert.equal(remapped.pass, true);
  assert.equal(q.reported_dscr, 1.3);
});

test("F5 Q2 2026: both add-back caps bind", () => {
  const f = byId("F5");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(version(f, 2), q);
  const dry = r.components.addbacks["dry-dock and vessel overhaul charges"];
  const fuel = r.components.addbacks["fuel hedging mark-to-market losses"];
  assert.deepEqual([dry.claimed, dry.applied, dry.capped], [520000, 500000, true]);
  assert.deepEqual([fuel.claimed, fuel.applied, fuel.capped], [950000, 800000, true]);
});

test("F5's $500,000 cap lives in the original agreement (v1), not in the amendment", () => {
  const f = byId("F5");
  const v1 = version(f, 1);
  assert.equal(v1.terms.numerator.addbacks[0].name, "dry-dock and vessel overhaul charges");
  assert.equal(v1.terms.numerator.addbacks[0].cap, 500000);
  assert.equal(v1.terms.numerator.addbacks[0].citation, "CA §7.11(b)(i)");
  assert.deepEqual(v1.terms.effective_amendments, []);
  const v2 = version(f, 2);
  assert.equal(v2.terms.numerator.addbacks[1].name, "fuel hedging mark-to-market losses");
  assert.equal(v2.terms.numerator.addbacks[1].cap, 800000);
  assert.equal(v2.terms.numerator.addbacks[1].citation, "Amd 2 §3(a)");
});

test("F5 debt service is identical in all three quarters", () => {
  for (const q of byId("F5").quarters) {
    assert.equal(q.financials.scheduled_principal, 3000000);
    assert.equal(q.financials.cash_interest, 1440000);
  }
});

// -------------------------------------------------------- policy interplay

test("F1 and F5-Q2 breach margins are shallower than the escalation threshold", () => {
  // Deeper than 0.15 and policy auto-escalates, so these cases could never resolve.
  for (const [id, periodEnd] of [["F1", "2026-06-30"], ["F5", "2026-06-30"]]) {
    const f = byId(id);
    const q = quarter(f, periodEnd);
    const r = runVersion(boardedVersionFor(f, q), q);
    assert.ok(r.margin < 0, `${id} is a breach as tested`);
    assert.ok(-r.margin < ESCALATE_MARGIN, `${id} breach ${-r.margin} must be under ${ESCALATE_MARGIN}`);
  }
});

test("F3's breach is deeper than the escalation threshold, which is intended: escalate either way", () => {
  const f = byId("F3");
  const q = quarter(f, "2026-06-30");
  const r = runVersion(boardedVersionFor(f, q), q);
  assert.ok(-r.margin > ESCALATE_MARGIN);
  assert.equal(f.expected_outcome, "escalate");
});

// -------------------------------------------------- internal consistency

test("every quarter computes against its boarded terms with no error, matching its locked expectation", () => {
  for (const f of FACILITIES) {
    for (const q of f.quarters) {
      const r = runVersion(boardedVersionFor(f, q), q);
      assert.equal(r.dscr, q.expected.computed_dscr, `${f.id} ${q.period_end} dscr`);
      assert.equal(r.pass, q.expected.passed, `${f.id} ${q.period_end} pass`);
      assert.equal(q.expected.raises_exception, !r.pass, `${f.id} ${q.period_end} raises_exception`);
    }
  }
});

test("every quarter's remapped expectation matches the unboarded version, or is null when none is in force", () => {
  for (const f of FACILITIES) {
    for (const q of f.quarters) {
      const unboarded = unboardedVersionFor(f, q);
      if (!unboarded) {
        assert.equal(q.expected.remapped_dscr, null, `${f.id} ${q.period_end}`);
      } else {
        assert.equal(runVersion(unboarded, q).dscr, q.expected.remapped_dscr, `${f.id} ${q.period_end}`);
      }
    }
  }
});

test("the borrower's certified add-backs, uncapped, reproduce every reported DSCR", () => {
  // Proves each reported figure is the borrower's own arithmetic, not a free number.
  for (const f of FACILITIES) {
    for (const q of f.quarters) {
      assert.equal(borrowerRun(f, q).dscr, q.reported_dscr, `${f.id} ${q.period_end}`);
    }
  }
});

test("every add-back named in any terms version has a figure in every quarter that version governs", () => {
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      const governed = f.quarters.filter((q) => q.period_end >= v.effective_from);
      for (const q of governed) {
        for (const a of v.terms.numerator.addbacks) {
          assert.equal(
            typeof q.financials.addback_amounts[a.name],
            "number",
            `${f.id} v${v.version} add-back "${a.name}" missing in ${q.period_end}`,
          );
        }
      }
    }
  }
});

test("every quarter's variance_flagged agrees with |computed - reported| > 0.05, recomputed", () => {
  for (const f of FACILITIES) {
    for (const q of f.quarters) {
      const r = runVersion(boardedVersionFor(f, q), q);
      const flagged = Math.abs(r.dscr - q.reported_dscr) > VARIANCE_TOLERANCE;
      assert.equal(q.expected.variance_flagged, flagged, `${f.id} ${q.period_end}`);
    }
  }
  // Spot-check the three that matter to the story.
  assert.equal(quarter(byId("F5"), "2025-12-31").expected.variance_flagged, false);
  assert.equal(quarter(byId("F5"), "2026-03-31").expected.variance_flagged, true);
  assert.equal(quarter(byId("F3"), "2026-06-30").expected.variance_flagged, true);
});

test("F1 and F5-Q2 are not boarded anywhere: v1 is the only version the tests resolve to", () => {
  for (const [id, periodEnd] of [["F1", "2026-06-30"], ["F5", "2026-06-30"]]) {
    const f = byId(id);
    assert.equal(boardedVersionFor(f, quarter(f, periodEnd)).version, 1);
    assert.equal(version(f, 2).boarded, false);
  }
});

test("no amendment exists for F3", () => {
  const f = byId("F3");
  assert.equal(f.terms_versions.length, 1);
  assert.deepEqual(f.terms_versions[0].terms.effective_amendments, []);
  assert.equal(f.documents.filter((d) => d.doc_type === "amendment").length, 0);
});

test("F3's waiver request is a waiver-type document titled as a request, dated after the period", () => {
  const w = byId("F3").documents.find((d) => d.doc_type === "waiver");
  assert.equal(w.title, "Waiver Request Letter — unexecuted");
  assert.equal(w.effective_date, "2026-08-12");
  assert.ok(w.effective_date > quarter(byId("F3"), "2026-06-30").period_end);
});
