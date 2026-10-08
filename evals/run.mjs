/**
 * CreditScout — the eval harness (spec §8.2).
 *
 *   npm run eval                          deterministic: grade the calculator against the signed oracle
 *   npm run eval -- --write               ...and record an `eval_runs` row so the Governance scoreboard shows it
 *   npm run eval -- --live                ...plus COLD and WARM passes through the real Credit-scout Agent (BILLABLE)
 *   npm run eval -- --live --only F1-2026Q2,F3-2026Q2
 *
 * The oracle is `data/expected-values-template.csv`, every row owner-signed;
 * the run refuses to start while any row is not. Grading is deterministic code
 * (`grade.mjs`), never a model: the safety numbers are computed against a
 * human-signed key. Only groundedness goes to a judge — this writes the
 * `foundry.jsonl` that Azure AI Foundry Evaluations consumes for it.
 *
 * Outputs, under evals/out/: results.csv, report.md, foundry.jsonl (live only).
 *
 * Needs `.env` for --write and --live (Supabase service role; for --live also
 * the Azure credentials, PUBLIC_BASE_URL and CREDITSCOUT_TOOL_KEY, exactly as
 * the deployed app has them — the agent's tool calls go to that URL).
 *
 * Run through `npm run eval`: the script passes `--conditions=react-server`,
 * which resolves the libs' `server-only` guard to its empty build outside Next.
 *
 * The live passes:
 *   cold   a fresh run_id, no reviews — the agent works with no lessons.
 *   warm   a fresh run_id in which each investigated case is REVIEWED by this
 *          script before the next one runs (approve when the agent matched the
 *          oracle, override to the oracle's outcome when it did not), so later
 *          cases see earlier lessons. The step delta across the two columns is
 *          the memory effect. Both run_ids are `eval-*`, so nothing lands in
 *          the demo's `demo` run.
 *
 * A loan the oracle names that is not in the database (the onboarding
 * packages, until someone onboards them) is SKIPPED and reported as such —
 * never scored as a miss.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { computeDscr } from "../calc/dscr.js";
import { FACILITIES, ONBOARDING_DEMO_FACILITIES, VARIANCE_TOLERANCE, termsFor } from "../data/facilities.js";
import {
  fixtureFor,
  gradeCalculation,
  gradeLive,
  loadOracle,
  renderFoundryJsonl,
  renderReport,
  renderResultsCsv,
  summariseCalculation,
  summariseLive,
  HHH,
} from "./grade.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORACLE = path.join(here, "..", "data", "expected-values-template.csv");
const OUT = path.join(here, "out");

/** One sync drives the run for up to 25s; this bounds the whole investigation. */
const CASE_TIMEOUT_MS = 15 * 60_000;
const POLL_GAP_MS = 2_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run with --env-file=.env)");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ------------------------------------------------------------ live passes

/** Drive one investigation to a terminal casefile status, or time out. */
async function driveToEnd(client, casefileId, syncRun, log) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < CASE_TIMEOUT_MS) {
    last = await syncRun(casefileId, { client });
    if (last.casefile_status !== "investigating") return last;
    log(`    … ${last.steps}/${last.max_steps} steps, run ${last.run_status}`);
    await sleep(POLL_GAP_MS);
  }
  throw new Error(`casefile ${casefileId} still investigating after ${CASE_TIMEOUT_MS / 60000} minutes (last run status: ${last?.run_status})`);
}

async function livePass(mode, { oracle, client, log }) {
  const [{ runTest, RunTestError }, { startInvestigation, syncRun }, { submitReview }] = await Promise.all([
    import("../lib/tests/run.ts"),
    import("../lib/agent/orchestrator.ts"),
    import("../lib/review.ts"),
  ]);

  const runId = `eval-${stamp()}-${mode}`;
  log(`\n== ${mode.toUpperCase()} pass — run_id ${runId}`);

  const facilities = check(await client.from("facilities").select("id, borrower_name"), "select facilities");
  const byName = new Map(facilities.map((f) => [f.borrower_name, f.id]));

  const grades = [];
  const foundry = [];

  for (const row of oracle) {
    const facilityId = byName.get(row.borrower);
    if (!facilityId) {
      log(`  ${row.case_id}: skipped — ${row.borrower} is not in the database (not onboarded yet)`);
      grades.push(gradeLive(row, { skipped: `${row.borrower} is not in the database` }));
      continue;
    }

    let test;
    try {
      test = await runTest(facilityId, row.test_period_end, runId, { client });
    } catch (err) {
      if (err instanceof RunTestError) {
        log(`  ${row.case_id}: skipped — ${err.message}`);
        grades.push(gradeLive(row, { skipped: err.message }));
        continue;
      }
      throw err;
    }
    log(`  ${row.case_id}: test → ${test.outcome} (ours ${test.computed_dscr ?? "n/a"}, borrower ${test.reported_dscr ?? "n/a"}, threshold ${test.threshold})`);

    if (test.outcome !== "exception") {
      grades.push(gradeLive(row, { test_outcome: test.outcome }));
      continue;
    }

    const start = await startInvestigation(test.exception_id, { client, runId });
    log(`    investigating — casefile ${start.casefileId}${start.reused ? " (reused)" : ""}`);
    await driveToEnd(client, start.casefileId, syncRun, log);

    const cf = check(
      await client
        .from("casefiles")
        .select("id, status, recommendation, suggested_tag, explanation, claims, steps_count, guardrail_notes")
        .eq("id", start.casefileId)
        .single(),
      "read casefile",
    );
    const grade = gradeLive(row, {
      test_outcome: "exception",
      recommendation: cf.recommendation,
      suggested_tag: cf.suggested_tag,
      steps: cf.steps_count,
      casefile_status: cf.status,
    });
    grades.push(grade);
    log(`    → ${cf.recommendation ?? "no recommendation"} (${cf.status}, ${cf.steps_count} steps) — expected ${row.expected_outcome}${grade.false_resolve ? "  ** FALSE RESOLVE **" : ""}`);

    foundry.push({
      query: `Investigate the ${row.test_period_end} DSCR exception for ${row.borrower}: our figure ${test.computed_dscr} against a required ${test.threshold}; the borrower reports ${test.reported_dscr ?? "no figure"}.`,
      response: cf.explanation ?? "",
      context: JSON.stringify(cf.claims ?? []),
      ground_truth: `${row.expected_outcome}; DSCR as tested ${row.expected_dscr_as_tested}${row.expected_dscr_remapped !== null ? `, remapped ${row.expected_dscr_remapped}` : ""}; pattern ${row.expected_tag ?? "n/a"}`,
    });

    // The warm pass teaches as it goes: the analyst's decision on this case is
    // the lesson the next similar case retrieves.
    if (mode === "warm" && cf.status === "pending_review") {
      const review = grade.outcome_match
        ? { casefileId: cf.id, decision: "approve", reason: `Eval script: ${row.expected_tag ?? row.expected_outcome} confirmed against the signed oracle.` }
        : {
            casefileId: cf.id,
            decision: "override",
            reason: `Eval script: the signed oracle expects ${row.expected_outcome} (${row.expected_tag ?? "no tag"}), not ${cf.recommendation ?? "nothing"}.`,
            correctedOutcome: row.expected_outcome,
            confirmedTag: row.expected_tag ?? "other",
          };
      const r = await submitReview(review, { client });
      log(`    review: ${review.decision} → ${r.status}${r.status !== 200 ? ` ${JSON.stringify(r.body)}` : ""}`);
    }
  }

  return { runId, grades, foundry };
}

// ---------------------------------------------------------------- main

async function main() {
  const oracle = loadOracle(readFileSync(ORACLE, "utf8"));
  const only = option("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const selected = only ? oracle.filter((r) => only.includes(r.case_id)) : oracle;
  if (only && selected.length !== only.length) {
    const known = new Set(oracle.map((r) => r.case_id));
    throw new Error(`--only names unknown cases: ${only.filter((c) => !known.has(c)).join(", ")}`);
  }
  const log = (s) => console.log(s);

  // ---- 1. the deterministic layer, always ---------------------------------
  const fixtures = [...FACILITIES, ...ONBOARDING_DEMO_FACILITIES];
  const calcGrades = selected.map((row) => {
    const fx = fixtureFor(row, fixtures);
    return fx.error ? { case_id: row.case_id, error: fx.error } : gradeCalculation(row, fx, { computeDscr, termsFor, tolerance: VARIANCE_TOLERANCE });
  });
  const calcSummary = summariseCalculation(calcGrades);
  log(`Oracle: ${selected.length} signed cases. Calculator: ${calcSummary.calc_matched}/${calcSummary.calc_checks} figures match; code path ${Math.round((calcSummary.code_path_accuracy ?? 0) * 100)}%.`);
  for (const m of calcSummary.mismatches) log(`  MISMATCH ${m}`);

  const deterministic = {
    calc_accuracy: calcSummary.calc_accuracy,
    calc_checks: calcSummary.calc_checks,
    calc_matched: calcSummary.calc_matched,
    code_path_accuracy: calcSummary.code_path_accuracy,
  };

  // ---- 2. the live passes, on request -------------------------------------
  const metrics = { cold: null, warm: null };
  const live = {};
  const notes = [];
  let client = null;

  if (flag("--live")) {
    client = await supabase();
    for (const mode of ["cold", "warm"]) {
      const pass = await livePass(mode, { oracle: selected, client, log });
      live[mode] = pass.grades;
      const summary = summariseLive(pass.grades);
      metrics[mode] = { ...deterministic, ...summary, run_id: pass.runId, pass: "live", cases: pass.grades };
      if (summary.cases_skipped.length > 0) notes.push(`${mode}: skipped ${summary.cases_skipped.join(", ")} — not in the database.`);
      if (pass.foundry.length > 0) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(path.join(OUT, `foundry-${mode}.jsonl`), renderFoundryJsonl(pass.foundry));
      }
    }
    notes.push("abstain/request accuracy and citation hit rate are not measured by this set (no incomplete-evidence case; no key-citation column) and read as —.");
  } else {
    metrics.cold = { ...deterministic, pass: "deterministic" };
    notes.push("Deterministic pass only: the calculator was graded against the signed oracle; no investigation ran. Agent-level metrics read as — until a --live run.");
  }

  // ---- 3. outputs -----------------------------------------------------------
  mkdirSync(OUT, { recursive: true });
  const when = new Date().toISOString();
  writeFileSync(path.join(OUT, "results.csv"), renderResultsCsv({ oracle: selected, calcGrades, live }));
  writeFileSync(path.join(OUT, "report.md"), renderReport({ when, oracle: selected, calcSummary, calcGrades, metrics, live, notes }));

  log("\nScoreboard (HHH)");
  for (const group of HHH) {
    for (const key of group.keys) {
      const show = (v) => (v === null || v === undefined ? "—" : key === "false_resolves" ? String(v) : key === "avg_steps" ? v.toFixed(1) : `${Math.round(v * 100)}%`);
      log(`  ${group.pillar.padEnd(8)} ${key.padEnd(18)} cold ${show(metrics.cold?.[key]).padEnd(6)} warm ${show(metrics.warm?.[key])}`);
    }
  }
  log(`\nWrote ${path.relative(process.cwd(), OUT)}/results.csv and report.md`);

  // ---- 4. the scoreboard row, on request ----------------------------------
  if (flag("--write") || flag("--live")) {
    client = client ?? (await supabase());
    for (const mode of ["cold", "warm"]) {
      if (!metrics[mode]) continue;
      // `cases` is the per-case detail; the scoreboard reads only the metric keys.
      check(await client.from("eval_runs").insert({ mode, metrics: metrics[mode] }), `insert eval_runs (${mode})`);
      log(`Recorded eval_runs row: mode=${mode}`);
    }
  }

  const gate = metrics.cold?.false_resolves ?? metrics.warm?.false_resolves ?? null;
  if (gate !== null && gate > 0) {
    log(`\nFALSE-RESOLVE GATE FAILED: ${gate}`);
    process.exit(2);
  }
  if (calcSummary.calc_accuracy !== 1) {
    log("\nCALCULATION ACCURACY BELOW 100%");
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
