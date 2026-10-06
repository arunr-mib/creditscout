/**
 * CreditScout — ingest the synthetic documents through the real pipeline.
 *
 *   node --env-file=.env data/ingest-demo.mjs F1      one facility
 *   node --env-file=.env data/ingest-demo.mjs         all three
 *
 * Reads data/facilities/<id>/<file> for every document listed in
 * data/facilities.js, so doc_type and title come from the fixture, never from
 * a filename guess. Calls ingestDocument directly: no Next server needed.
 * Needs the facilities to be seeded first (data/seed.mjs).
 *
 * Re-running is safe: documents are reused and their chunks replaced.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FACILITIES } from "./facilities.js";
import { ingestDocument } from "../lib/ingest.ts";

const FACILITY_DIR = join(dirname(fileURLToPath(import.meta.url)), "facilities");

async function ingestFacility(client, fixture, { log = console.log } = {}) {
  const { data: row, error } = await client
    .from("facilities")
    .select("id")
    .eq("borrower_name", fixture.borrower_name)
    .maybeSingle();
  if (error) throw new Error(`select facilities: ${error.message}`);
  if (!row) throw new Error(`${fixture.id} (${fixture.borrower_name}) is not seeded. Run data/seed.mjs first.`);

  let total = 0;
  for (const d of fixture.documents) {
    const r = await ingestDocument({
      client,
      facilityId: row.id,
      docType: d.doc_type,
      title: d.title,
      effectiveDate: d.effective_date,
      bytes: readFileSync(join(FACILITY_DIR, fixture.id, d.file)),
      filename: d.file,
    });
    total += r.chunks_created;
    log(
      `${fixture.id}  ${d.title.padEnd(40)} ${String(r.chunks_created).padStart(3)} chunks  ${r.reused_document ? "document row reused" : "document row created"}`,
    );
  }
  return total;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Run: node --env-file=.env data/ingest-demo.mjs [F1|F3|F5]",
    );
    process.exit(1);
  }
  const wanted = process.argv[2];
  const fixtures = wanted ? FACILITIES.filter((f) => f.id === wanted) : FACILITIES;
  if (fixtures.length === 0) {
    console.error(`Unknown facility "${wanted}". Choose one of: ${FACILITIES.map((f) => f.id).join(", ")}`);
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false } });
  let total = 0;
  for (const f of fixtures) total += await ingestFacility(client, f);
  console.log(`Total: ${total} chunks across ${fixtures.length} facilit${fixtures.length === 1 ? "y" : "ies"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
