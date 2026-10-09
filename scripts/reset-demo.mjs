#!/usr/bin/env node
/**
 * Put the demo queue back to its recording state.
 *
 *   node --env-file=.env scripts/reset-demo.mjs
 *
 * Every investigation leaves its loan on "Review", so this is needed between
 * takes. It:
 *   1. retires Coastal Marine's live casefile and reopens its exception, so the
 *      row offers INVESTIGATE again,
 *   2. deletes stray loans created by onboarding rehearsals — anything not in
 *      the seeded six. Onboarding genuinely creates a loan, so one appears
 *      every time that flow is run.
 *
 * Only ever touches the `demo` run. Eval runs (`eval-*`) are left alone.
 *
 * It deliberately does NOT restore Harbor Logistics to "Review". Doing that
 * means writing `pending_review` onto a casefile, and `lib/agent/enforce.ts` is
 * the ONLY place allowed to do that — a structural invariant pinned by a test
 * in lib/agent/enforce.test.js, because a second writer is a second, unpoliced
 * path to the analyst. Harbor needs no help anyway: it is already in review,
 * and a completed investigation puts a casefile there through enforcement. If
 * Harbor is ever approved or overridden during a rehearsal, re-stage it by
 * re-running the investigation rather than by writing the status.
 */
import { createClient } from "@supabase/supabase-js";

const SEEDED = ["Harbor Logistics", "Northgate Foods", "Coastal Marine",
                "Dokusign Inc", "Peat's Coffee Company", "Costko Wholesale"];
const COASTAL = "Coastal Marine";
const HARBOR = "Harbor Logistics";
/** Statuses that hold the one-live-casefile slot. */
const LIVE = ["pending_review", "approved", "overridden", "awaiting_docs"];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — run with --env-file=.env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const ok = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

/** The exception the portfolio screen actually renders: this period, demo run. */
async function demoException(borrower) {
  const f = ok(await db.from("facilities").select("id").eq("borrower_name", borrower).maybeSingle(), `find ${borrower}`);
  if (!f) return null;
  const tests = ok(await db.from("tests").select("id").eq("run_id", "demo").eq("facility_id", f.id), "tests");
  const ids = new Set(tests.map((t) => t.id));
  const exs = ok(await db.from("exceptions").select("id, test_id").eq("facility_id", f.id), "exceptions");
  // A facility accumulates one exception per eval run; only the demo-run one is shown.
  return exs.find((e) => ids.has(e.test_id)) ?? null;
}

const coastal = await demoException(COASTAL);
if (coastal) {
  ok(await db.from("casefiles").update({ status: "superseded" }).eq("exception_id", coastal.id).in("status", LIVE), "retire");
  // A run abandoned mid-flight never finished, so "failed" is the honest record.
  ok(await db.from("casefiles").update({ status: "failed" }).eq("exception_id", coastal.id).eq("status", "investigating"), "clear stuck");
  ok(await db.from("exceptions").update({ status: "new" }).eq("id", coastal.id), "reopen");
  console.log(`${COASTAL}: Investigate`);
}

// Harbor is reported, not touched — see the note above.
const harbor = await demoException(HARBOR);
if (harbor) {
  const cfs = ok(await db.from("casefiles").select("status").eq("exception_id", harbor.id).eq("run_id", "demo"), "harbor casefiles");
  const inReview = cfs.some((c) => c.status === "pending_review");
  console.log(`${HARBOR}: ${inReview ? "Review (unchanged)" : "NOT in review — re-run its investigation to restore it"}`);
}

const all = ok(await db.from("facilities").select("id, borrower_name"), "facilities");
for (const f of all.filter((x) => !SEEDED.includes(x.borrower_name))) {
  const docs = ok(await db.from("documents").select("id").eq("facility_id", f.id), "docs");
  for (const d of docs) ok(await db.from("doc_chunks").delete().eq("document_id", d.id), "chunks");
  ok(await db.from("documents").delete().eq("facility_id", f.id), "documents");
  ok(await db.from("tests").delete().eq("facility_id", f.id), "tests");
  ok(await db.from("covenant_terms").delete().eq("facility_id", f.id), "terms");
  ok(await db.from("facilities").delete().eq("id", f.id), "facility");
  console.log(`removed onboarding leftover: ${f.borrower_name}`);
}
console.log("demo queue reset.");
