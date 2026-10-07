import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ingestFromForm } from "./ingest-form.ts";
import { requireToolKey, TOOL_KEY_HEADER } from "./agent/auth.ts";

// Pre-deploy security pass: the two write routes were reachable by any visitor.
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const GATED = ["app/api/ingest/route.ts", "app/api/covenant-terms/approve/route.ts"];

for (const route of GATED) {
  test(`${route} checks the tool key first, before reading the request`, () => {
    const s = src(route);
    const call = s.indexOf("requireToolKey(req)");
    assert.ok(call > -1, "route never calls requireToolKey");
    for (const read of ["req.json", "req.formData", "req.headers"]) {
      const at = s.indexOf(read);
      assert.ok(at === -1 || call < at, `${route} reads ${read} before the key check`);
    }
    assert.match(s, /if \(denied\) return denied;/);
  });
}

// Behavioural: the exact check those routes run fails closed for each bad case.
const GOOD = "k".repeat(48);
const real = process.env.CREDITSCOUT_TOOL_KEY;
beforeEach(() => {
  process.env.CREDITSCOUT_TOOL_KEY = GOOD;
});
afterEach(() => {
  if (real === undefined) delete process.env.CREDITSCOUT_TOOL_KEY;
  else process.env.CREDITSCOUT_TOOL_KEY = real;
});
const req = (h = {}) => new Request("http://x/api/ingest", { method: "POST", headers: h });

test("unset, empty, missing and wrong keys all yield 401 for the write routes' check", () => {
  delete process.env.CREDITSCOUT_TOOL_KEY;
  assert.equal(requireToolKey(req()).status, 401);
  assert.equal(requireToolKey(req({ [TOOL_KEY_HEADER]: "" })).status, 401);
  process.env.CREDITSCOUT_TOOL_KEY = "";
  assert.equal(requireToolKey(req({ [TOOL_KEY_HEADER]: "" })).status, 401);
  process.env.CREDITSCOUT_TOOL_KEY = GOOD;
  assert.equal(requireToolKey(req()).status, 401);
  assert.equal(requireToolKey(req({ [TOOL_KEY_HEADER]: "wrong" })).status, 401);
  assert.equal(requireToolKey(req({ [TOOL_KEY_HEADER]: GOOD })), null);
});

// The UI must use Server Actions, never a browser fetch to the gated routes.
test("UploadPackage and CovenantSetup do not fetch the gated routes; they call Server Actions", () => {
  const up = src("components/UploadPackage.tsx");
  const cs = src("components/CovenantSetup.tsx");
  assert.doesNotMatch(up, /fetch\(\s*["'`]\/api\/ingest/);
  assert.doesNotMatch(cs, /fetch\(\s*["'`]\/api\/covenant-terms\/approve/);
  assert.match(up, /uploadPackage\(/);
  assert.match(cs, /approveTerms\(/);
});

test("the Server Actions live in a 'use server' file and never touch a NEXT_PUBLIC key", () => {
  const a = src("app/actions.ts");
  assert.match(a, /^"use server";/);
  assert.match(a, /export async function uploadPackage/);
  assert.match(a, /export async function approveTerms/);
  assert.doesNotMatch(a, /NEXT_PUBLIC|TOOL_KEY|SERVICE_ROLE/);
});

test("no Client Component imports the service-role module or the tool key", () => {
  for (const f of ["UploadPackage", "CovenantSetup"]) {
    assert.doesNotMatch(src(`components/${f}.tsx`), /supabase\/server|CREDITSCOUT_TOOL_KEY/);
  }
});

// Shared upload handler: validation before ingest, DocumentError mapped to status.
test("ingestFromForm rejects a missing file with 400 and never calls ingest", async () => {
  let called = false;
  const r = await ingestFromForm(new FormData(), { ingest: async () => { called = true; } });
  assert.equal(r.status, 400);
  assert.equal(called, false);
});

test("ingestFromForm maps a DocumentError to its status and a result to ids only", async () => {
  const { DocumentError } = await import("./pdf.ts");
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.pdf"));
  const bad = await ingestFromForm(form, { ingest: async () => { throw new DocumentError("scanned", 422); } });
  assert.deepEqual(bad, { status: 422, body: { error: "scanned" } });
  const ok = await ingestFromForm(form, { ingest: async () => ({ document_id: "d", chunks_created: 3, reused_document: true }) });
  assert.deepEqual(ok, { status: 200, body: { document_id: "d", chunks_created: 3 } });
});
