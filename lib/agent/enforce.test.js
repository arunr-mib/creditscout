import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { computeDscr } from "../../calc/dscr.js";
import { FACILITIES } from "../../data/facilities.js";
import { chunkBySection } from "../chunk.ts";
import { enforceCasefile, parseAgentOutput, readAnswer, retryMessage } from "./enforce.ts";
import { AT, CASEFILE_ID, EXCEPTION_ID, FACILITY_ID, OTHER_FACILITY, TEST_ID, casefileRow, fakeDb, fakeFoundry, message, requiresAction } from "./fakes.js";
import { runDscrCalculator } from "./tools/dscr-calculator.ts";
import { syncRun, toolRequestBody } from "./orchestrator.ts";

// No network, no database. The chunks are the REAL corpus put through the REAL
// chunker, and every calc_log row is the REAL calculator's output, so a rule
// that holds here holds on the text and the numbers the live runs see.

const ROOT = join(import.meta.dirname, "..", "..");
const FACILITY_OF = { F1: FACILITY_ID, F3: OTHER_FACILITY };

function corpus(code) {
  const f = FACILITIES.find((x) => x.id === code);
  return f.documents.flatMap((d) =>
    chunkBySection(readFileSync(join(ROOT, "data", "facilities", code, d.file), "utf8"), {
      facility_id: FACILITY_OF[code],
      document_id: `${code}:${d.title}`,
      doc_type: d.doc_type,
      doc_title: d.title,
    }),
  );
}
// Both facilities' documents in one table, always: every test is also a test
// that the other borrower's text never leaks in.
const DOC_CHUNKS = [...corpus("F1"), ...corpus("F3")];

/** The approved v1 terms as boarded live for F1 and F3. */
const APPROVED = {
  numerator: { base: "Consolidated EBITDA", addbacks: [], deductions: ["unfinanced_capex", "cash_taxes"] },
  threshold: { citation: "CA §7.11", min_dscr: 1.25 },
  denominator: { citation: "CA §1.01", components: ["scheduled_principal", "cash_interest"] },
  test_period: { basis: "TTM", period_end: "2026-06-30" },
  effective_amendments: [],
};
const FIN = {
  F1: { ebitda: 4020000, unfinanced_capex: 300000, cash_taxes: 250000, scheduled_principal: 2000000, cash_interest: 1100000 },
  F3: { ebitda: 2884000, unfinanced_capex: 220000, cash_taxes: 180000, scheduled_principal: 1600000, cash_interest: 700000 },
};
const withAddback = (ab) => ({ ...APPROVED, numerator: { ...APPROVED.numerator, addbacks: [ab] } });

const ORIGIN = "11111111-0000-4000-8000-000000000001";
const C1 = "22222222-0000-4000-8000-000000000001";
const C2 = "22222222-0000-4000-8000-000000000002";
const at = (s) => new Date(AT * 1000 + s * 1000).toISOString();

/** One calc_log row, computed by the real calculator. */
function calcRow(calcId, terms, financials, { casefileId = CASEFILE_ID, testId = null, created }) {
  const outputs = computeDscr(terms, financials, { calcId });
  assert.ok(!("error" in outputs), JSON.stringify(outputs));
  return { calc_id: calcId, casefile_id: casefileId, test_id: testId, inputs: { terms, financials }, outputs, created_at: created };
}

const POLICY = [
  { key: "variance_tolerance", value: 0.05 },
  { key: "escalate_if_breach_margin_over", value: 0.15 },
  { key: "prohibited_actions", value: ["waive covenant", "amend terms", "contact borrower"] },
  { key: "require_human_review", value: true },
  { key: "max_steps", value: 8 },
];

/** A casefile at the end of its run, about to be enforced. */
function world({ code = "F1", output, calcs = [], steps = 5, captured, notes, policy = POLICY, extraTests = [], extraCalcs = [] }) {
  const facility = FACILITY_OF[code];
  const origin = calcRow(ORIGIN, APPROVED, FIN[code], { casefileId: null, testId: TEST_ID, created: at(-3600) });
  return fakeDb({
    exceptions: [{ id: EXCEPTION_ID, facility_id: facility, test_id: TEST_ID, test_period_end: "2026-06-30", status: "investigating" }],
    tests: [{ id: TEST_ID, facility_id: facility, test_period_end: "2026-06-30", calc_id: ORIGIN }, ...extraTests],
    calc_log: [origin, ...calcs, ...extraCalcs],
    covenant_terms: [{ id: "terms-v1", facility_id: facility, version: 1, effective_from: "2023-09-20", effective_to: null, status: "approved", terms: APPROVED }],
    policy,
    doc_chunks: DOC_CHUNKS,
    casefiles: [
      casefileRow({
        agent_output: typeof output === "string" ? output : JSON.stringify(output),
        steps_count: steps,
        ...(captured ? { terms: { proposed_terms: {}, source_citations: captured } } : {}),
        ...(notes ? { guardrail_notes: notes } : {}),
      }),
    ],
  });
}

const casefile = (db) => db.tables.casefiles[0];
const checks = (db) => (casefile(db).guardrail_notes ?? []).map((n) => `${n.layer}:${n.check}:${n.action}`);
/** On EVERY enforced casefile, whatever path it took (E-7). */
function assertStepCapRan(db) {
  assert.ok(!casefile(db).guardrail_notes.some((n) => n.action === "not_checked"), `a safety check did not run: ${checks(db).join(", ")}`);
}

// ------------------------------------------------------------- F1 and A-1

const F1_CITATIONS = [
  {
    field: "numerator.addbacks[0].cap",
    citation: "Amd 2 §3(a)",
    quote: "the Borrower may add back restructuring charges, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period.",
  },
  { field: "effective_amendments[0].effective", citation: "Amd 2 §1", quote: "This Amendment No. 2 is effective as of April 1, 2026" },
  { field: "threshold.min_dscr", citation: "CA §7.11(a)", quote: "to be less than 1.25 to 1.00." },
];
const F1_REMAPPED = {
  ...withAddback({ name: "restructuring charges", amount_source: "financials", cap: 500000, citation: "Amd 2 §3(a)" }),
  effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01", citation: "Amd 2 §1" }],
};
const F1_CALCS = [
  calcRow(C1, APPROVED, FIN.F1, { created: at(10) }),
  calcRow(C2, F1_REMAPPED, { ...FIN.F1, addback_amounts: { "restructuring charges": 620000 } }, { created: at(60) }),
];
const F1_OUTPUT = {
  recommendation: "resolve",
  confidence_basis: "A second calculation on terms that include Amendment No. 2 passes.",
  explanation:
    "On the approved terms our DSCR is 1.12 against the 1.25 minimum. Amendment No. 2, effective 2026-04-01, permits restructuring charges to be added back up to $500,000; the period's charges were 620,000. With the capped add-back the DSCR is 1.28, which passes. The approved terms predate the amendment and should be re-boarded for analyst approval.",
  claims: [
    { text: "Amendment No. 2 permits a restructuring add-back capped at $500,000.", citation: "Amd 2 §3(a)", quote: "the Borrower may add back restructuring charges, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period." },
    { text: "The covenant minimum is 1.25 to 1.00.", citation: "CA §7.11(a)", quote: "to be less than 1.25 to 1.00." },
    { text: "Restructuring charges for the period were 620,000.", citation: "Fin Q2 2026 §2", quote: "Restructuring charges: 620,000" },
  ],
  calculations: [{ calc_id: C1, dscr: 1.12 }, { calc_id: C2, dscr: 1.28 }],
  missing_evidence: [],
  suggested_tag: "amendment_addback",
};

test("MIRROR F1: a legitimate re-mapping, quoted from Amendment No. 2, is FLAGGED and still resolves", async () => {
  const db = world({ output: F1_OUTPUT, calcs: F1_CALCS, captured: F1_CITATIONS });
  const result = await enforceCasefile(CASEFILE_ID, { client: db });

  const cf = casefile(db);
  assert.equal(result.status, "pending_review");
  assert.equal(cf.status, "pending_review");
  assert.equal(cf.recommendation, "resolve", checks(db).join(", "));
  assert.deepEqual(checks(db), ["guardrail:terms_differ_from_approved:flag"]);
  // E-4: sub-clause citations resolved through the resolver; every claim survives.
  assert.deepEqual(cf.claims.map((c) => c.citation), ["Amd 2 §3(a)", "CA §7.11(a)", "Fin Q2 2026 §2"]);
  // E-3 / E-1: from the rows queried, originating test first, governing last.
  assert.deepEqual(cf.calc_ids, [ORIGIN, C1, C2]);
  assert.deepEqual(cf.terms.terms, F1_REMAPPED);
  assert.equal(cf.terms.calc_id, C2);
  assert.deepEqual(cf.terms.source_citations, F1_CITATIONS, "the captured citations were not kept beside the terms");
  assert.equal(db.tables.exceptions[0].status, "pending_review");
  assert.equal(cf.summary, undefined, "summary is the memory surface; a human review writes it");
  assertStepCapRan(db);
});

const A1_CALCS = [
  calcRow(C1, APPROVED, FIN.F3, { created: at(10) }),
  calcRow(C2, withAddback({ name: "owner compensation normalisation", cap: null }), { ...FIN.F3, addback_amounts: { "owner compensation normalisation": 530000 } }, { created: at(60) }),
];
const A1_OUTPUT = {
  recommendation: "resolve",
  confidence_basis: "The recalculated DSCR passes.",
  explanation: "The covenant requires 1.25 to 1.00. Adding back owner compensation normalisation without limit gives 1.31, which passes.",
  claims: [{ text: "The covenant requires 1.25 to 1.00.", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00." }],
  calculations: [{ calc_id: C1 }, { calc_id: C2 }],
  missing_evidence: [],
  suggested_tag: "other",
};

test("MIRROR A-1: the live false-resolve — an uncapped add-back no clause permits, reaching 1.31 — ESCALATES", async () => {
  // The branch review reproduced this passing applyGuardrail and applyPolicy
  // with ZERO notes. Every figure is in a logged calculation, the claim is a
  // verified quote, and the last calculation passes.
  const db = world({ code: "F3", output: A1_OUTPUT, calcs: A1_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  const cf = casefile(db);
  assert.equal(cf.recommendation, "escalate", `a fabricated pass reached review as ${cf.recommendation}`);
  assert.deepEqual(checks(db), ["guardrail:terms_unverified:escalate"]);
  assert.match(cf.guardrail_notes[0].detail, /owner compensation normalisation/);
  assert.equal(cf.claims.length, 1, "the verified claim survives: the escalation is about the terms, not the quote");
  assert.equal(cf.status, "pending_review");
  assertStepCapRan(db);
});

test("A-1: quoting the borrower's OWN certificate for the add-back does not make it permitted", async () => {
  const captured = [{ field: "numerator.addbacks[0].cap", citation: "CC Q2 2026 §3", quote: "Add-back applied — owner compensation normalisation: 530,000" }];
  const db = world({ code: "F3", output: A1_OUTPUT, calcs: A1_CALCS, captured });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(casefile(db).recommendation, "escalate");
  assert.deepEqual(checks(db), ["guardrail:terms_unverified:escalate"]);
});

test("A-1: the definition agent's citations from ANOTHER facility back nothing here", async () => {
  // F1's Amendment No. 2 citations, captured on an F3 casefile, resolve to F3's
  // documents — which have no Amendment No. 2. The facility is the exception's.
  const db = world({ code: "F3", output: { ...F1_OUTPUT, explanation: "x", claims: F1_OUTPUT.claims.slice(1, 2) }, calcs: [calcRow(C2, F1_REMAPPED, { ...FIN.F3, addback_amounts: { "restructuring charges": 0 } }, { created: at(60) })], captured: F1_CITATIONS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.ok(checks(db).includes("guardrail:terms_unverified:escalate"), checks(db).join(", "));
  assert.notEqual(casefile(db).recommendation, "resolve");
});

// ------------------------------------------------------------ F3 and the trap

const F3_CALCS = [calcRow(C1, APPROVED, FIN.F3, { created: at(10) })];
const F3_OUTPUT = {
  recommendation: "escalate",
  confidence_basis: "Our calculation on the approved terms fails, and no executed waiver is on file.",
  explanation:
    "The covenant requires 1.25 to 1.00. The borrower's certificate reports 1.31 to 1.00 after an owner compensation normalisation add-back of 530,000 that no clause permits. On the approved terms our DSCR is 1.08. The waiver on file is a request the lender has not countersigned.",
  claims: [
    { text: "No add-back is permitted unless the agreement provides for it.", citation: "CA §7.11(b)", quote: "No add-back or other adjustment shall be made to Consolidated EBITDA for purposes of this Section 7.11, except as expressly provided in this Agreement as amended in writing." },
    { text: "The certificate reports 1.31 to 1.00.", citation: "CC Q2 2026 §2", quote: "Reported Debt Service Coverage Ratio: 1.31 to 1.00." },
    { text: "The borrower applied an owner compensation normalisation add-back of 530,000.", citation: "CC Q2 2026 §3", quote: "Add-back applied — owner compensation normalisation: 530,000" },
    { text: "The waiver letter is a request only.", citation: "WR §2", quote: "This letter is a request only. It does not waive, amend or modify any term of the Credit Agreement unless and until the Lender countersigns it in accordance with Section 8.02." },
  ],
  calculations: [{ calc_id: C1 }],
  missing_evidence: ["A waiver countersigned by the lender"],
  suggested_tag: "true_breach",
};

test("F3 shape: escalate on the approved terms, the waiver-request claim verified, no terms note", async () => {
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  const cf = casefile(db);
  assert.equal(cf.recommendation, "escalate", JSON.stringify(cf.guardrail_notes));
  assert.equal(cf.suggested_tag, "true_breach");
  assert.deepEqual(checks(db), [], "the agent did not re-map, so there is nothing to note");
  assert.ok(cf.claims.some((c) => c.citation === "WR §2"), "the waiver-request claim did not survive quote verification");
  assert.equal(cf.claims.length, 4);
  assertStepCapRan(db);
});

test("THE TRAP, keeps allowing: a figure quoted from a cited chunk is evidence, not an unverified number", async () => {
  // 1.31 is in no calculation here. It is in the cited certificate, and that is enough.
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.ok(!checks(db).includes("guardrail:figure_traceable:abstain"));
  assert.ok(!casefile(db).calc_ids.some((id) => db.tables.calc_log.find((r) => r.calc_id === id)?.outputs.dscr === 1.31));
});

test("THE TRAP, refuses: a fabricated 1.47 abstains", async () => {
  const db = world({ code: "F3", output: { ...F3_OUTPUT, explanation: `${F3_OUTPUT.explanation} Coverage was 1.47 last year.` }, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(casefile(db).recommendation, "abstain");
  assert.match(casefile(db).guardrail_notes.find((n) => n.check === "figure_traceable").detail, /1\.47/);
});

test("E-5 through the pipeline: a floor stated in brackets is seen, and an untraceable one abstains", async () => {
  const db = world({ code: "F3", output: { ...F3_OUTPUT, explanation: "The covenant floor is (0.50 to 1.00) and our DSCR is 1.08." }, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(casefile(db).recommendation, "abstain");
  assert.match(casefile(db).guardrail_notes.find((n) => n.check === "figure_traceable").detail, /0\.5/);
});

// --------------------------------------------------------- E-1: whose calcs

test("E-1 keeps allowing: the originating test's figure is traceable without the agent re-computing it", async () => {
  // The prompt hands the model the exception's three figures. No baseline
  // calculator call here at all: the brief's figures must still trace.
  const output = { ...F3_OUTPUT, explanation: "On the approved terms our DSCR is 1.08 against the 1.25 minimum.", claims: F3_OUTPUT.claims.slice(0, 1), calculations: [] };
  const db = world({ code: "F3", output, calcs: [] });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(casefile(db).recommendation, "escalate", checks(db).join(", "));
  assert.deepEqual(casefile(db).calc_ids, [ORIGIN]);
});

test("E-1 refuses: the same facility's OTHER quarter, an older re-run of this test, and an orphan row are not this casefile's", async () => {
  const OTHER_TEST = "33333333-0000-4000-8000-000000000001";
  const extraTests = [{ id: OTHER_TEST, facility_id: OTHER_FACILITY, test_period_end: "2026-03-31", calc_id: "44444444-0000-4000-8000-000000000001" }];
  const extraCalcs = [
    // the facility's Q1 test: 1.41
    calcRow("44444444-0000-4000-8000-000000000001", APPROVED, { ...FIN.F3, ebitda: 3643000 }, { casefileId: null, testId: OTHER_TEST, created: at(-7200) }),
    // an earlier run of THIS test, superseded by tests.calc_id: 1.15
    calcRow("44444444-0000-4000-8000-000000000002", APPROVED, { ...FIN.F3, ebitda: 3045000 }, { casefileId: null, testId: TEST_ID, created: at(-5400) }),
    // a row that traces to nothing at all: 1.33
    calcRow("44444444-0000-4000-8000-000000000003", APPROVED, { ...FIN.F3, ebitda: 3459000 }, { casefileId: null, testId: null, created: at(-5000) }),
  ];
  const dscrs = extraCalcs.map((r) => r.outputs.dscr);
  assert.deepEqual(dscrs, [1.41, 1.15, 1.33], "fixture: the rows must carry the figures the test asserts on");

  for (const figure of dscrs) {
    const output = { ...F3_OUTPUT, explanation: `Our DSCR is 1.08; it was ${figure} on another calculation.`, claims: F3_OUTPUT.claims.slice(0, 1) };
    const db = world({ code: "F3", output, calcs: F3_CALCS, extraTests, extraCalcs });
    await enforceCasefile(CASEFILE_ID, { client: db });
    assert.equal(casefile(db).recommendation, "abstain", `${figure} was admitted as this casefile's evidence`);
    assert.deepEqual(casefile(db).calc_ids, [ORIGIN, C1], `${figure}: calc_ids widened`);
  }
});

test("E-1: the governing calculation is the LAST by created_at, whatever order the rows arrive in", async () => {
  // A failing calc logged after a passing one governs: the resolve is not earned.
  const late = [calcRow(C2, APPROVED, FIN.F1, { created: at(90) }), calcRow(C1, F1_REMAPPED, { ...FIN.F1, addback_amounts: { "restructuring charges": 620000 } }, { created: at(30) })];
  const db = world({ output: F1_OUTPUT, calcs: late, captured: F1_CITATIONS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.deepEqual(casefile(db).calc_ids, [ORIGIN, C1, C2]);
  assert.equal(casefile(db).terms.calc_id, C2);
  assert.deepEqual(checks(db), [], "the governing calc is on the approved terms, so there is no drift to flag");
});

// ------------------------------------------------- E-3: the model's calc_ids

test("E-3: calc_ids come from the queried rows; an id the model invented is a note, not a crash", async () => {
  const invented = "99999999-0000-4000-8000-000000000009";
  const output = { ...F3_OUTPUT, calculations: [{ calc_id: C1 }, { calc_id: C1 }, { calc_id: invented }] };
  const db = world({ code: "F3", output, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.deepEqual(casefile(db).calc_ids, [ORIGIN, C1]);
  assert.deepEqual(checks(db), ["guardrail:calc_id_unknown:flag"]);
  assert.match(casefile(db).guardrail_notes[0].detail, new RegExp(invented));
  assert.equal(casefile(db).recommendation, "escalate");
});

// -------------------------------------------- E-4: facility-scoped citations

test("E-4: a claim citing ANOTHER facility's clause gets no chunk and is removed", async () => {
  // Both agreements have a §9.01; only F3's names Northgate Foods. An F1
  // casefile quoting it must not verify against anything.
  const theirs = DOC_CHUNKS.find((c) => c.metadata.facility_id === OTHER_FACILITY && c.metadata.section === "§9.01").content.split("\n")[1];
  assert.match(theirs, /Northgate Foods/);
  const output = {
    ...F1_OUTPUT,
    claims: [...F1_OUTPUT.claims, { text: "Notices go to the CFO.", citation: "CA §9.01", quote: theirs }, { text: "The waiver is a request.", citation: "WR §2", quote: "This letter is a request only." }],
    // a model naming the other facility changes nothing: it is never read
    facility_id: OTHER_FACILITY,
  };
  const db = world({ output, calcs: F1_CALCS, captured: F1_CITATIONS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  const removed = casefile(db).guardrail_notes.filter((n) => n.action === "claim_removed").map((n) => n.detail);
  assert.equal(removed.length, 2, removed.join(" | "));
  assert.match(removed.join(" | "), /quote not found in CA §9\.01/);
  assert.match(removed.join(" | "), /no chunk supplied for citation WR §2/);
  assert.deepEqual(casefile(db).claims.map((c) => c.citation), ["Amd 2 §3(a)", "CA §7.11(a)", "Fin Q2 2026 §2"]);
});

test("E-4: an unresolvable citation (a preamble, a bare section) is removed, fail-closed (D-2 stays deferred)", async () => {
  const output = {
    ...F3_OUTPUT,
    claims: [
      { text: "Synthetic.", citation: "CA PREAMBLE", quote: "SYNTHETIC — FOR DEMONSTRATION" },
      { text: "Floor.", citation: "§7.11", quote: "to be less than 1.25 to 1.00." },
    ],
  };
  const db = world({ code: "F3", output, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.deepEqual(casefile(db).claims, []);
  assert.equal(casefile(db).recommendation, "abstain");
});

// ---------------------------------------- E-7: steps_count is always present

test("E-7: steps_count comes from the casefile row, so the step cap always runs and downgrades a resolve", async () => {
  // At the cap with a resolve: policy.js must SEE steps_count to abstain.
  const policy = POLICY.map((p) => (p.key === "max_steps" ? { ...p, value: 5 } : p));
  const db = world({ output: { ...F1_OUTPUT, steps_count: 0 }, calcs: F1_CALCS, captured: F1_CITATIONS, steps: 5, policy });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(casefile(db).recommendation, "abstain");
  assert.ok(checks(db).includes("policy:step_cap:abstain"), checks(db).join(", "));
  assertStepCapRan(db);
});

// ------------------------------------------------------- malformed output

const retryFoundry = (retry) =>
  fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }], steps: [[]], retry });
const fast = { now: (() => { let t = AT * 1000; return () => (t += 100); })(), sleep: async () => {}, agentId: "asst_test" };

test("malformed output: ONE retry on the same thread, with no tools, and the second answer is the one enforced", async () => {
  const foundry = retryFoundry({ states: [{ status: "in_progress" }, { status: "completed" }], messages: [message(JSON.stringify(F3_OUTPUT), "run_retry_1")] });
  const db = world({ code: "F3", output: "Here is my answer: {recommendation: escalate", calcs: F3_CALCS });
  const result = await enforceCasefile(CASEFILE_ID, { client: db, foundry, ...fast });

  const posts = foundry.fetchImpl.seen.filter((c) => c.method === "POST" && /\/threads\/thread_1\/runs\?/.test(c.url));
  assert.equal(posts.length, 1, "exactly one retry");
  assert.equal(posts[0].body.assistant_id, "asst_test");
  assert.equal(posts[0].body.tool_choice, "none");
  assert.equal(posts[0].body.additional_messages[0].role, "user");
  assert.match(posts[0].body.additional_messages[0].content, /did not match the required output shape/);
  assert.equal(result.retried, true);
  assert.equal(casefile(db).recommendation, "escalate");
  assert.equal(casefile(db).agent_output, JSON.stringify(F3_OUTPUT), "the enforced answer is the one stored");
  assert.deepEqual(checks(db), ["guardrail:schema:retry"]);
  assert.equal(casefile(db).status, "pending_review");
});

test("malformed output twice: abstain at pending_review, NEVER failed, and no second retry", async () => {
  const foundry = retryFoundry({ states: [{ status: "completed" }], messages: [message("still not json", "run_retry_1")] });
  const db = world({ code: "F3", output: "not json", calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db, foundry, ...fast });
  const cf = casefile(db);
  assert.equal(cf.status, "pending_review");
  assert.equal(cf.recommendation, "abstain");
  assert.ok(cf.guardrail_notes.some((n) => n.layer === "guardrail" && n.check === "schema" && n.action === "abstain" && n.detail === "malformed output after one retry"));
  assert.equal(foundry.fetchImpl.seen.filter((c) => c.method === "POST" && /\/threads\/thread_1\/runs\?/.test(c.url)).length, 1);
  assert.equal(cf.agent_output, "not json", "a malformed second answer does not replace the first");
  assert.equal(db.tables.exceptions[0].status, "pending_review");
  assertStepCapRan(db);
});

test("a retry that fails, hangs, wants a tool or cannot be made is still ONE retry and an abstain", async () => {
  const cases = {
    failed: { states: [{ status: "failed", last_error: { message: "throttled" } }] },
    "wants a tool": { states: [{ ...requiresAction("search_documents"), id: undefined }] },
    "never answers": { states: [{ status: "in_progress" }] },
    "cannot be made": { states: [], fail: "service unavailable" },
  };
  for (const [name, retry] of Object.entries(cases)) {
    const foundry = retryFoundry({ ...retry, messages: [] });
    const db = world({ code: "F3", output: "not json", calcs: F3_CALCS });
    await enforceCasefile(CASEFILE_ID, { client: db, foundry, ...fast, retryTimeoutMs: 1_000 });
    assert.equal(casefile(db).status, "pending_review", name);
    assert.equal(casefile(db).recommendation, "abstain", name);
    assert.ok(checks(db).includes("guardrail:schema:retry_failed"), `${name}: ${checks(db).join(", ")}`);
    assert.ok(checks(db).includes("guardrail:schema:abstain"), name);
  }
});

test("a casefile already retried is not retried again, even if an earlier enforcement died after asking", async () => {
  const foundry = retryFoundry({ states: [{ status: "completed" }], messages: [] });
  const asked = { layer: "guardrail", check: "schema", action: "retry", detail: "asked once more" };
  const db = world({ code: "F3", output: "not json", calcs: F3_CALCS, notes: [asked] });
  await enforceCasefile(CASEFILE_ID, { client: db, foundry, ...fast });
  assert.deepEqual(foundry.fetchImpl.seen, [], "a second retry was bought");
  assert.equal(casefile(db).recommendation, "abstain");
  assert.deepEqual(casefile(db).guardrail_notes[0], asked);
});

test("a fenced answer is unwrapped, not retried; prose around JSON is malformed", () => {
  assert.deepEqual(parseAgentOutput('```json\n{"a":1}\n```'), { value: { a: 1 } });
  assert.deepEqual(parseAgentOutput('```\n{"a":1}\n```'), { value: { a: 1 } });
  assert.ok("error" in parseAgentOutput('Answer:\n```json\n{"a":1}\n```'));
  assert.ok("error" in parseAgentOutput('{"a":1} trailing'));
  assert.ok("error" in parseAgentOutput(""));
  assert.ok("error" in parseAgentOutput(null));
  assert.ok("casefile" in readAnswer("```json\n" + JSON.stringify(F3_OUTPUT) + "\n```"));
  assert.deepEqual(readAnswer(JSON.stringify({ ...F3_OUTPUT, recommendation: "approve" })).errors.length, 1);
  assert.match(retryMessage(["a", "b"]), /a; b/);
});

test("the step cap with no answer is an abstain ('investigation incomplete'), with no retry past the cap", async () => {
  const foundry = retryFoundry({ states: [{ status: "completed" }], messages: [] });
  const capNote = { layer: "policy", check: "max_steps", action: "end_run", detail: "the investigation reached the step cap of 2 after 2 steps and was stopped" };
  for (const output of [null, "half an answer {"]) {
    const db = world({ code: "F3", output: output ?? "", calcs: F3_CALCS, notes: [capNote], steps: 2 });
    if (output === null) casefile(db).agent_output = null;
    await enforceCasefile(CASEFILE_ID, { client: db, foundry, ...fast });
    const cf = casefile(db);
    assert.equal(cf.status, "pending_review");
    assert.equal(cf.recommendation, "abstain");
    assert.deepEqual(cf.guardrail_notes[0], capNote, "the cap note was not kept first");
    assertStepCapRan(db);
  }
  assert.deepEqual(foundry.fetchImpl.seen, []);
});

// --------------------------------------------------- one path, end of pipeline

test("the policy runs on EVERY path to review, including the answers code writes", async () => {
  // require_human_review=false makes policy.js leave a forced_true note on every
  // casefile it sees. If any path skipped the policy, its casefile lacks one.
  const policy = POLICY.map((p) => (p.key === "require_human_review" ? { ...p, value: false } : p));
  const capNote = { layer: "policy", check: "max_steps", action: "end_run", detail: "capped" };
  const paths = {
    normal: world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS, policy }),
    "malformed after retry": world({ code: "F3", output: "not json", calcs: F3_CALCS, policy }),
    "capped, no answer": world({ code: "F3", output: "", calcs: F3_CALCS, policy, notes: [capNote] }),
  };
  for (const [name, db] of Object.entries(paths)) {
    await enforceCasefile(CASEFILE_ID, { client: db, foundry: retryFoundry({ states: [{ status: "completed" }], messages: [] }), ...fast });
    assert.equal(casefile(db).status, "pending_review", name);
    assert.ok(checks(db).includes("policy:require_human_review:forced_true"), `${name} skipped the policy: ${checks(db).join(", ")}`);
  }
});

test("exactly one writer of pending_review in the codebase, and it is enforce.ts", () => {
  // A structural pin, deliberately blunt: a second writer would be a second,
  // unpoliced path to the analyst.
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (!["node_modules", ".next"].includes(name)) walk(p); continue; }
      if (!/\.(ts|tsx|js|mjs)$/.test(name) || /\.test\.js$|fakes\.js$/.test(name)) continue;
      if (/status:\s*["']pending_review["']/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(ROOT.length + 1));
    }
  };
  for (const dir of ["lib", "app", "components", "scripts"]) walk(join(ROOT, dir));
  assert.deepEqual(offenders, ["lib/agent/enforce.ts"]);
});

test("enforcement is idempotent and never touches a casefile that is not investigating", async () => {
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
  await enforceCasefile(CASEFILE_ID, { client: db });
  const after = structuredClone(casefile(db));
  const writes = db.writes.length;
  const again = await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(again.status, "pending_review");
  assert.deepEqual(again.notes, []);
  assert.equal(db.writes.length, writes, "a second pass wrote again");
  assert.deepEqual(casefile(db), after);

  for (const status of ["approved", "overridden", "failed", "awaiting_docs"]) {
    const other = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
    casefile(other).status = status;
    await enforceCasefile(CASEFILE_ID, { client: other });
    assert.equal(casefile(other).status, status);
    assert.equal(other.writes.length, 0, status);
  }
});

test("enforcement never writes summary, tests or covenant_terms, and appends to the notes already there", async () => {
  const prior = { layer: "run", check: "something", action: "noted", detail: "earlier" };
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS, notes: [prior] });
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.deepEqual(db.writes.filter((w) => w.table === "tests" || w.table === "covenant_terms"), []);
  assert.ok(db.writes.every((w) => !("summary" in (w.payload ?? {}))));
  assert.deepEqual(casefile(db).guardrail_notes[0], prior);
});

test("an exception an analyst already closed is not reopened into review", async () => {
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
  db.tables.exceptions[0].status = "closed";
  await enforceCasefile(CASEFILE_ID, { client: db });
  assert.equal(db.tables.exceptions[0].status, "closed");
});

// ------------------------------------- end to end: capture survives to the end

test("END TO END: definition_agent's citations are captured while servicing the call and back the re-mapping at enforcement", async () => {
  // No callTool injection: the real dispatch, the real calculator route logic
  // writing calc_log through the fake, the real capture, the real enforcement.
  const db = world({ output: "", calcs: [], captured: undefined, steps: 0 });
  casefile(db).agent_output = null;
  const definition = JSON.stringify({ terms: F1_REMAPPED, source_citations: F1_CITATIONS });
  let n = 0;
  const callRoute = async (name, args, ctx) => {
    const body = toolRequestBody(name, args, ctx);
    const r = await runDscrCalculator(body, { client: db, newId: () => [C1, C2][n++] });
    return JSON.stringify(r.body);
  };
  const calc = (terms, financials) => JSON.stringify({ terms, financials, casefile_id: "00000000-0000-4000-8000-00000000dead" });
  const foundry = fakeFoundry({
    states: [
      requiresAction("dscr_calculator", calc(APPROVED, FIN.F1)),
      requiresAction("definition_agent", "{}"),
      requiresAction("dscr_calculator", calc(F1_REMAPPED, { ...FIN.F1, addback_amounts: { "restructuring charges": 620000 } })),
      { id: "run_1", thread_id: "thread_1", status: "completed" },
    ],
    steps: [[], [], [], []],
    messages: [message(JSON.stringify(F1_OUTPUT))],
  });
  const result = await syncRun(CASEFILE_ID, {
    client: db,
    foundry,
    now: () => AT * 1000,
    sleep: async () => {},
    callRoute,
    specialists: { definition_agent: async () => definition },
  });

  assert.equal(result.casefile_status, "pending_review");
  const cf = casefile(db);
  assert.deepEqual(cf.terms.source_citations, F1_CITATIONS, "the citations were not captured");
  assert.deepEqual(cf.terms.proposed_terms, F1_REMAPPED);
  // the model's casefile_id was overwritten: both calcs are this casefile's
  assert.deepEqual(db.tables.calc_log.filter((r) => r.casefile_id === CASEFILE_ID).map((r) => r.calc_id), [C1, C2]);
  assert.equal(cf.recommendation, "resolve", checks(db).join(", "));
  assert.deepEqual(checks(db), ["guardrail:terms_differ_from_approved:flag"]);
  assert.deepEqual(cf.calc_ids, [ORIGIN, C1, C2]);
});

test("a casefile an analyst acts on WHILE it is being enforced is not overwritten", async () => {
  // The early status check is not enough on its own: the status can change
  // between the read and the write. The write is guarded on `investigating`.
  const db = world({ code: "F3", output: F3_OUTPUT, calcs: F3_CALCS });
  const racing = {
    from(name) {
      const b = db.from(name);
      if (name === "calc_log") casefile(db).status = "approved";
      return b;
    },
  };
  const result = await enforceCasefile(CASEFILE_ID, { client: racing });
  assert.equal(result.status, "approved");
  assert.equal(casefile(db).status, "approved");
  assert.equal(casefile(db).recommendation, undefined, "the analyst's decision was written over");
  assert.equal(db.tables.exceptions[0].status, "investigating");
});
