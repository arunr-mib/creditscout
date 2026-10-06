/**
 * CreditScout — seed the three synthetic facilities into Supabase.
 *
 *   node --env-file=.env data/seed.mjs
 *
 * Inserts, per facility: the `facilities` row, its `documents` rows, and the
 * BOARDED `covenant_terms` versions as approved. Unboarded versions are never
 * written. That omission is the twist: F1's and F5's Amendment No. 2 is a
 * document on file with no matching terms row, and the agent must notice.
 *
 * Idempotent. Facilities match on borrower_name, documents on (facility, title),
 * terms on (facility, version). Existing rows are left alone, never overwritten.
 *
 * Not run as part of stage 2. Stage 4 runs it first, where ingest can verify the
 * rows. Supabase must be the cloud project: n8n/Foundry cannot reach localhost.
 */
import { pathToFileURL } from "node:url";
import { FACILITIES, termsFor } from "./facilities.js";

export const SEED_APPROVER = "seed: synthetic demo approver";

function check({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** Return the id of the row matching `match`, inserting `row` first if there is none. */
async function ensure(client, table, match, row) {
  let q = client.from(table).select("id");
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const found = check(await q.maybeSingle(), `select ${table}`);
  if (found) return { id: found.id, created: false };
  const made = check(
    await client.from(table).insert(row).select("id").single(),
    `insert ${table}`,
  );
  return { id: made.id, created: true };
}

/**
 * @param client       a Supabase client (service role)
 * @param facilities   defaults to the three fixture facilities
 * @param now          ISO timestamp recorded as approved_at; injectable for tests
 * @returns            counts of rows created, so a re-run reports zeros
 */
export async function seedFacilities(client, { facilities = FACILITIES, now = new Date().toISOString() } = {}) {
  const created = { facilities: 0, documents: 0, covenant_terms: 0 };

  for (const f of facilities) {
    const fac = await ensure(
      client,
      "facilities",
      { borrower_name: f.borrower_name },
      { borrower_name: f.borrower_name, industry: f.industry, sender_domain: f.sender_domain },
    );
    if (fac.created) created.facilities += 1;

    for (const d of f.documents) {
      const row = await ensure(
        client,
        "documents",
        { facility_id: fac.id, title: d.title },
        {
          facility_id: fac.id,
          doc_type: d.doc_type,
          title: d.title,
          effective_date: d.effective_date,
        },
      );
      if (row.created) created.documents += 1;
    }

    // Boarded versions only. An unboarded version is never written.
    for (const v of f.terms_versions.filter((x) => x.boarded)) {
      const latest = f.quarters[f.quarters.length - 1];
      const row = await ensure(
        client,
        "covenant_terms",
        { facility_id: fac.id, version: v.version },
        {
          facility_id: fac.id,
          version: v.version,
          effective_from: v.effective_from,
          terms: termsFor(v, latest),
          source_citations: v.source_citations,
          status: "approved",
          approved_by: SEED_APPROVER,
          approved_at: now,
        },
      );
      if (row.created) created.covenant_terms += 1;
    }
  }

  return created;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env, then run: node --env-file=.env data/seed.mjs",
    );
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const created = await seedFacilities(client);
  console.log(
    `Seeded ${created.facilities} facilities, ${created.documents} documents, ${created.covenant_terms} approved covenant_terms rows (0 means already present)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
