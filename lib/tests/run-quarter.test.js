import { test } from "node:test";
import assert from "node:assert/strict";

import { RunTestError, runQuarter } from "./run.ts";

// No network and no database: the facility list, the terms loader and the
// per-facility test are all injected, so the loop is exercised in isolation.

const FACILITIES = [
  { id: "f1", borrower_name: "Harbor Logistics" },
  { id: "f2", borrower_name: "No-Terms Co" },
  { id: "f3", borrower_name: "Northgate Foods" },
];

const approved = { status: "approved" };

function deps(over = {}) {
  return {
    client: {},
    listFacilities: async () => FACILITIES,
    loadTerms: async (_client, facilityId) => (facilityId === "f2" ? null : approved),
    runOne: async (facilityId, periodEnd) => {
      if (facilityId === "f3") throw new Error("Foundry run timed out");
      return { test_id: `t-${facilityId}`, facility_id: facilityId, test_period_end: periodEnd, computed_dscr: 1.12, passed: false };
    },
    ...over,
  };
}

test("runQuarter tests the approved-terms facilities, skips the one with no terms, and records the one that errors", async () => {
  const r = await runQuarter("2026-06-30", "demo", deps());
  assert.equal(r.test_period_end, "2026-06-30");
  assert.equal(r.run_id, "demo");
  assert.equal(r.entries.length, 3, "every facility is accounted for, none dropped");

  const byId = Object.fromEntries(r.entries.map((e) => [e.facility_id, e]));
  assert.equal(byId.f1.status, "tested");
  assert.equal(byId.f1.result.computed_dscr, 1.12);
  assert.equal(byId.f1.borrower_name, "Harbor Logistics");

  assert.equal(byId.f2.status, "skipped");
  assert.match(byId.f2.reason, /approve covenant terms first/i);

  assert.equal(byId.f3.status, "errored");
  assert.match(byId.f3.error, /Foundry run timed out/);
});

test("runQuarter does not let one facility's test failure stop the others", async () => {
  // f3 errors, but f1 (listed first) is still tested and f2 still skipped.
  const r = await runQuarter("2026-06-30", undefined, deps());
  assert.equal(r.run_id, "demo", "defaults to the demo run when none is given");
  assert.deepEqual(
    r.entries.map((e) => e.status),
    ["tested", "skipped", "errored"],
  );
});

test("runQuarter skips a facility whose only terms are proposed (a proposed row never governs)", async () => {
  const r = await runQuarter("2026-06-30", "demo", deps({ loadTerms: async () => ({ status: "proposed" }) }));
  assert.ok(r.entries.every((e) => e.status === "skipped"));
});

test("runQuarter records, rather than throws, when loading a facility's terms fails", async () => {
  const r = await runQuarter(
    "2026-06-30",
    "demo",
    deps({ loadTerms: async (_c, id) => { if (id === "f1") throw new Error("covenant_terms read failed"); return approved; } }),
  );
  const f1 = r.entries.find((e) => e.facility_id === "f1");
  assert.equal(f1.status, "errored");
  assert.match(f1.error, /covenant_terms read failed/);
});

test("runQuarter refuses a period that is not a quarter end before reading anything", async () => {
  let listed = false;
  await assert.rejects(
    runQuarter("2026-05-15", "demo", deps({ listFacilities: async () => { listed = true; return FACILITIES; } })),
    (e) => e instanceof RunTestError && e.status === 400,
  );
  assert.equal(listed, false, "nothing is read when the period is invalid");
});
