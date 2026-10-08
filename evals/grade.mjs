/**
 * CreditScout — eval grading, as pure functions.
 *
 * No I/O here. `run.mjs` reads the oracle and the database and calls these;
 * `node --test` exercises every rule without either.
 *
 * The oracle is `data/expected-values-template.csv`: one row per case, every
 * expected value computed and signed by the owner — never by the calculator
 * under test. Spec §8.2. Two kinds of grade come out of this module:
 *
 *   gradeCalculation  the deterministic layer against the oracle: our DSCR on
 *                     the boarded terms (as tested), on the unboarded amendment
 *                     where one exists (remapped), and the code-only outcome
 *                     the quarterly test must reach. Free, runs anywhere.
 *   gradeLive         one case's live result — the quarterly test's outcome and,
 *                     where an exception was raised, the agent's recommendation
 *                     — against the oracle. Produces the false-resolve gate.
 *
 * Metric keys match `components/scoreboardModel.ts` exactly: that file is the
 * contract the Governance scoreboard reads. A metric this run cannot measure is
 * `null`, and the scoreboard renders it as an em dash — never as a measured 0.
 */

/** Oracle outcomes that run an investigation; the others are decided by code alone. */
export const AGENT_OUTCOMES = ["resolve", "escalate", "request", "abstain"];

/** What the quarterly test (code) must do for each oracle outcome. */
export function expectedCodePath(expectedOutcome) {
  switch (expectedOutcome) {
    case "compliant_no_action":
      return "compliant";
    case "variance_logged_no_investigation":
      return "variance_logged";
    case "resolve":
    case "escalate":
    case "request":
    case "abstain":
      return "exception";
    default:
      throw new Error(`unknown expected_outcome in the oracle: "${expectedOutcome}"`);
  }
}

// ------------------------------------------------------------------- oracle

/** A small RFC-4180 reader: quoted fields may hold commas and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const num = (v) => (v === "" || v === "n/a" ? null : Number(v));

/**
 * Parse and validate the oracle. Refuses — by throwing — while any row is
 * unsigned: sign-off is per row, and an unsigned expectation is not a key.
 */
export function loadOracle(text) {
  const rows = parseCsv(text).map((r) => ({
    case_id: r.case_id,
    facility: r.facility,
    borrower: r.borrower,
    test_period_end: r.test_period_end,
    threshold: num(r.threshold),
    terms_version_boarded: Number(r.terms_version_boarded),
    reported_dscr: num(r.reported_dscr),
    expected_dscr_as_tested: num(r.expected_dscr_as_tested),
    expected_dscr_remapped: num(r.expected_dscr_remapped),
    expected_outcome: r.expected_outcome,
    expected_tag: r.expected_tag === "n/a" ? null : r.expected_tag,
    owner_signed_off: r.owner_signed_off,
  }));
  const unsigned = rows.filter((r) => r.owner_signed_off !== "YES").map((r) => r.case_id);
  if (unsigned.length > 0) {
    throw new Error(`The oracle has unsigned rows: ${unsigned.join(", ")}. The eval refuses to run until every row is owner_signed_off=YES.`);
  }
  for (const r of rows) {
    if (r.expected_dscr_as_tested === null || !Number.isFinite(r.expected_dscr_as_tested)) {
      throw new Error(`${r.case_id}: expected_dscr_as_tested is not a number`);
    }
    expectedCodePath(r.expected_outcome);
  }
  return rows;
}

// --------------------------------------------------------- fixture lookup

/** The fixture facility and quarter an oracle row describes, or an error naming what is missing. */
export function fixtureFor(row, facilities) {
  const facility = facilities.find((f) => f.id === row.facility);
  if (!facility) return { error: `${row.case_id}: no fixture facility "${row.facility}"` };
  const quarter = facility.quarters.find((q) => q.period_end === row.test_period_end);
  if (!quarter) return { error: `${row.case_id}: fixture ${row.facility} has no quarter ending ${row.test_period_end}` };
  return { facility, quarter };
}

/** The terms version the oracle says governed the test (its `terms_version_boarded`). */
function boardedVersion(row, facility) {
  return facility.terms_versions.find((v) => v.version === row.terms_version_boarded) ?? null;
}

/** The newest later version in force for the period — the unboarded amendment, when the oracle expects a remap. */
function remapVersion(row, facility) {
  return (
    facility.terms_versions
      .filter((v) => v.version > row.terms_version_boarded && v.effective_from <= row.test_period_end)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

const money = (cents) => Math.round(cents * 100);
const toCents = (v) => (typeof v === "number" ? Math.round(v * 100) : null);

/**
 * The quarterly test's reconciliation rule (lib/tests/run.ts `reconcile`),
 * restated here in integer cents so the deterministic grade asks exactly what
 * the product asks: ours fails -> exception; ours passes and theirs differs by
 * more than the tolerance -> variance logged; otherwise compliant.
 */
export function codePathFor({ dscr, pass, reported, tolerance }) {
  if (!pass) return "exception";
  if (reported === null || reported === undefined) return "compliant";
  const gap = Math.abs(toCents(reported) - toCents(dscr));
  return gap > money(tolerance) ? "variance_logged" : "compliant";
}

// ------------------------------------------------- deterministic grading

/**
 * Grade one oracle row against the calculator.
 *
 * @param row         a parsed oracle row
 * @param fixture     {facility, quarter} from `fixtureFor`
 * @param deps        {computeDscr, termsFor, tolerance}
 */
export function gradeCalculation(row, fixture, deps) {
  const { computeDscr, termsFor, tolerance } = deps;
  const { facility, quarter } = fixture;
  const notes = [];

  const boarded = boardedVersion(row, facility);
  if (!boarded) {
    return { case_id: row.case_id, error: `no terms version ${row.terms_version_boarded} in fixture ${facility.id}` };
  }
  const asTested = computeDscr(termsFor(boarded, quarter), quarter.financials, { calcId: `eval-${row.case_id}-as-tested` });
  if (asTested.error) {
    return { case_id: row.case_id, error: `calculator refused as-tested inputs: ${asTested.error}` };
  }

  const asTestedMatch = asTested.dscr === row.expected_dscr_as_tested;
  if (!asTestedMatch) notes.push(`as-tested: computed ${asTested.dscr}, oracle ${row.expected_dscr_as_tested}`);
  if (asTested.threshold !== row.threshold) notes.push(`threshold: terms ${asTested.threshold}, oracle ${row.threshold}`);

  let remapped = null;
  if (row.expected_dscr_remapped !== null) {
    const version = remapVersion(row, facility);
    if (!version) {
      notes.push("oracle expects a remapped figure but the fixture has no later version in force");
    } else {
      const r = computeDscr(termsFor(version, quarter), quarter.financials, { calcId: `eval-${row.case_id}-remapped` });
      if (r.error) {
        notes.push(`calculator refused remapped inputs: ${r.error}`);
      } else {
        remapped = { version: version.version, dscr: r.dscr, pass: r.pass, expected: row.expected_dscr_remapped, match: r.dscr === row.expected_dscr_remapped };
        if (!remapped.match) notes.push(`remapped: computed ${r.dscr}, oracle ${row.expected_dscr_remapped}`);
      }
    }
  }

  const codePath = codePathFor({ dscr: asTested.dscr, pass: asTested.pass, reported: row.reported_dscr, tolerance });
  const expectedPath = expectedCodePath(row.expected_outcome);
  if (codePath !== expectedPath) notes.push(`code path: ours ${codePath}, oracle implies ${expectedPath}`);

  return {
    case_id: row.case_id,
    as_tested: { version: boarded.version, dscr: asTested.dscr, pass: asTested.pass, expected: row.expected_dscr_as_tested, match: asTestedMatch },
    remapped,
    code_path: { actual: codePath, expected: expectedPath, match: codePath === expectedPath },
    notes,
  };
}

/**
 * Roll the deterministic grades up. `calc_accuracy` counts every DSCR the
 * oracle expects (as-tested for all rows, plus remapped where present): a
 * figure is right or it is not. A row the calculator refused counts as wrong.
 */
export function summariseCalculation(grades) {
  let checks = 0;
  let matched = 0;
  let pathChecks = 0;
  let pathMatched = 0;
  const mismatches = [];
  for (const g of grades) {
    if (g.error) {
      checks += 1;
      pathChecks += 1;
      mismatches.push(`${g.case_id}: ${g.error}`);
      continue;
    }
    checks += 1;
    if (g.as_tested.match) matched += 1;
    if (g.remapped) {
      checks += 1;
      if (g.remapped.match) matched += 1;
    }
    pathChecks += 1;
    if (g.code_path.match) pathMatched += 1;
    for (const n of g.notes) mismatches.push(`${g.case_id}: ${n}`);
  }
  return {
    calc_accuracy: checks === 0 ? null : matched / checks,
    calc_checks: checks,
    calc_matched: matched,
    code_path_accuracy: pathChecks === 0 ? null : pathMatched / pathChecks,
    mismatches,
  };
}

// ---------------------------------------------------------- live grading

/**
 * Grade one case's live result against the oracle.
 *
 * @param row     a parsed oracle row
 * @param result  {test_outcome, recommendation, suggested_tag, steps, casefile_status, skipped}
 *                test_outcome is the quarterly test's ("compliant" | "variance_logged" |
 *                "exception" | "calc_error"); the rest are null when no investigation ran.
 */
export function gradeLive(row, result) {
  const expectedPath = expectedCodePath(row.expected_outcome);
  if (result.skipped) {
    return { case_id: row.case_id, skipped: result.skipped, counted: false };
  }
  const pathMatch = result.test_outcome === expectedPath;
  const investigated = result.test_outcome === "exception";
  const rec = investigated ? result.recommendation : null;

  // THE GATE. A `resolve` on any case the owner did not label resolve.
  const falseResolve = rec === "resolve" && row.expected_outcome !== "resolve";

  // Outcome accuracy: a code-only case is right when the code took the expected
  // path and started nothing; an agent case when the recommendation matches.
  const outcomeMatch = AGENT_OUTCOMES.includes(row.expected_outcome) ? rec === row.expected_outcome : pathMatch && !investigated;

  const tagMatch = row.expected_tag === null || !investigated ? null : result.suggested_tag === row.expected_tag;

  return {
    case_id: row.case_id,
    counted: true,
    investigated,
    test_outcome: result.test_outcome,
    expected_path: expectedPath,
    recommendation: rec,
    expected_outcome: row.expected_outcome,
    casefile_status: result.casefile_status ?? null,
    steps: investigated ? (result.steps ?? null) : null,
    false_resolve: falseResolve,
    outcome_match: outcomeMatch,
    tag_match: tagMatch,
  };
}

/**
 * Roll the live grades up into the scoreboard's metric keys.
 *
 * `abstain_accuracy` and `citation_hit_rate` are null: the signed set has no
 * incomplete-evidence case and no expected key citation column, so neither is
 * measured — and an unmeasured metric must read as missing, not as 0.
 */
export function summariseLive(grades) {
  const counted = grades.filter((g) => g.counted);
  const investigated = counted.filter((g) => g.investigated);
  const stepped = investigated.filter((g) => typeof g.steps === "number");
  return {
    false_resolves: counted.length === 0 ? null : counted.filter((g) => g.false_resolve).length,
    outcome_accuracy: counted.length === 0 ? null : counted.filter((g) => g.outcome_match).length / counted.length,
    abstain_accuracy: null,
    citation_hit_rate: null,
    avg_steps: stepped.length === 0 ? null : stepped.reduce((s, g) => s + g.steps, 0) / stepped.length,
    cases_counted: counted.length,
    cases_investigated: investigated.length,
    cases_skipped: grades.filter((g) => !g.counted).map((g) => g.case_id),
  };
}

// ---------------------------------------------------------------- HHH view

/** The scoreboard's keys grouped by the cohort's HHH pillars, in render order. */
export const HHH = [
  { pillar: "Honest", keys: ["calc_accuracy", "citation_hit_rate", "groundedness"] },
  { pillar: "Harmless", keys: ["false_resolves", "abstain_accuracy"] },
  { pillar: "Helpful", keys: ["outcome_accuracy", "avg_steps"] },
];

const LABELS = {
  false_resolves: ["Zero false resolves", "0"],
  calc_accuracy: ["Calculation accuracy", "100%"],
  outcome_accuracy: ["Outcome accuracy", "≥ 85%"],
  abstain_accuracy: ["Correct abstain / request", "≥ 90%"],
  citation_hit_rate: ["Citation hit rate", "≥ 90%"],
  groundedness: ["Groundedness (Foundry judge)", "reported"],
  avg_steps: ["Avg steps / case (memory effect)", "visible reduction"],
};

const fmt = (key, v) => {
  if (v === null || v === undefined) return "—";
  if (key === "false_resolves") return String(v);
  if (key === "avg_steps") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return `${Math.round(v * 100)}%`;
};

// --------------------------------------------------------------- renderers

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** results.csv: one line per case per pass, the oracle's expectations beside the actuals. */
export function renderResultsCsv({ oracle, calcGrades, live = {} }) {
  const header = [
    "case_id", "pass", "expected_dscr_as_tested", "computed_dscr_as_tested", "calc_match",
    "expected_dscr_remapped", "computed_dscr_remapped", "remapped_match",
    "expected_outcome", "test_outcome", "recommendation", "outcome_match", "false_resolve", "steps", "casefile_status", "notes",
  ];
  const byCase = new Map(calcGrades.map((g) => [g.case_id, g]));
  const lines = [header.join(",")];
  const passes = Object.keys(live).length > 0 ? Object.keys(live) : ["deterministic"];
  for (const pass of passes) {
    const liveByCase = new Map((live[pass] ?? []).map((g) => [g.case_id, g]));
    for (const row of oracle) {
      const c = byCase.get(row.case_id);
      const l = liveByCase.get(row.case_id);
      lines.push(
        [
          row.case_id, pass,
          row.expected_dscr_as_tested, c?.as_tested?.dscr ?? "", c ? (c.error ? "ERROR" : c.as_tested.match) : "",
          row.expected_dscr_remapped ?? "", c?.remapped?.dscr ?? "", c?.remapped ? c.remapped.match : "",
          row.expected_outcome, l?.test_outcome ?? "", l?.recommendation ?? "", l?.counted ? l.outcome_match : "", l?.counted ? l.false_resolve : "",
          l?.steps ?? "", l?.casefile_status ?? "",
          [c?.error, ...(c?.notes ?? []), l?.skipped ? `skipped: ${l.skipped}` : null].filter(Boolean).join("; "),
        ].map(csvCell).join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** report.md: the HHH scoreboard, cold beside warm, then the per-case tables. */
export function renderReport({ when, oracle, calcSummary, calcGrades, metrics, live = {}, notes = [] }) {
  const out = [];
  out.push(`# CreditScout eval report — ${when}`);
  out.push("");
  out.push(`Oracle: \`data/expected-values-template.csv\`, ${oracle.length} cases, every row owner-signed.`);
  out.push("");
  out.push("## Scoreboard (HHH)");
  out.push("");
  out.push("| Pillar | Metric | Target | Cold | Warm |");
  out.push("|---|---|---|---|---|");
  for (const group of HHH) {
    for (const key of group.keys) {
      const [label, target] = LABELS[key];
      out.push(`| ${group.pillar} | ${label} | ${target} | ${fmt(key, metrics.cold?.[key])} | ${fmt(key, metrics.warm?.[key])} |`);
    }
  }
  out.push("");
  out.push("“—” means not measured in this run — never a measured zero.");
  out.push("");
  out.push("## Calculation accuracy (deterministic, no model)");
  out.push("");
  out.push(`${calcSummary.calc_matched} of ${calcSummary.calc_checks} expected figures matched to 2 dp; code path matched on ${Math.round((calcSummary.code_path_accuracy ?? 0) * 100)}% of cases.`);
  out.push("");
  out.push("| Case | Terms v | As tested (ours / oracle) | Remapped (ours / oracle) | Code path (ours / oracle) | Notes |");
  out.push("|---|---|---|---|---|---|");
  for (const g of calcGrades) {
    if (g.error) {
      out.push(`| ${g.case_id} | — | ERROR | — | — | ${g.error} |`);
      continue;
    }
    const mark = (ok) => (ok ? "✓" : "✗");
    const remap = g.remapped ? `${g.remapped.dscr} / ${g.remapped.expected} ${mark(g.remapped.match)}` : "n/a";
    out.push(
      `| ${g.case_id} | ${g.as_tested.version} | ${g.as_tested.dscr} / ${g.as_tested.expected} ${mark(g.as_tested.match)} | ${remap} | ${g.code_path.actual} / ${g.code_path.expected} ${mark(g.code_path.match)} | ${g.notes.join("; ")} |`,
    );
  }
  for (const pass of Object.keys(live)) {
    out.push("");
    out.push(`## Live pass — ${pass}`);
    out.push("");
    out.push("| Case | Test outcome | Expected | Recommendation | Outcome match | False resolve | Steps | Casefile |");
    out.push("|---|---|---|---|---|---|---|---|");
    for (const g of live[pass]) {
      if (!g.counted) {
        out.push(`| ${g.case_id} | skipped | — | — | — | — | — | ${g.skipped} |`);
        continue;
      }
      out.push(
        `| ${g.case_id} | ${g.test_outcome} | ${g.expected_outcome} | ${g.recommendation ?? "—"} | ${g.outcome_match ? "✓" : "✗"} | ${g.false_resolve ? "**YES**" : "no"} | ${g.steps ?? "—"} | ${g.casefile_status ?? "—"} |`,
      );
    }
  }
  if (notes.length > 0) {
    out.push("");
    out.push("## Notes");
    out.push("");
    for (const n of notes) out.push(`- ${n}`);
  }
  out.push("");
  return out.join("\n");
}

/** foundry.jsonl rows for Azure AI Foundry Evaluations (groundedness): one per investigated case. */
export function renderFoundryJsonl(items) {
  return items
    .map((it) => JSON.stringify({ query: it.query, response: it.response, context: it.context, ground_truth: it.ground_truth }))
    .join("\n")
    .concat(items.length > 0 ? "\n" : "");
}
