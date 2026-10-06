import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TOOL_KEY_HEADER } from "./auth.ts";
import { DEFAULT_BASE_URL, HEADER_NAME, SECURITY_SCHEME, buildOpenApi } from "./openapi.ts";
import { DOC_TYPES } from "../retrieval.ts";

// A tool spec that drifts from its routes fails at agent-registration time,
// far from here. These tests fail here instead.

const TOOLS_DIR = fileURLToPath(new URL("../../app/api/tools/", import.meta.url));
const doc = buildOpenApi({});
const routeSource = (name) => readFileSync(`${TOOLS_DIR}${name}/route.ts`, "utf8");

/** Every directory under app/api/tools that holds a route, except the public spec itself. */
const toolRoutes = readdirSync(TOOLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "openapi" && existsSync(`${TOOLS_DIR}${e.name}/route.ts`))
  .map((e) => e.name)
  .sort();

test("every path in the document is a route that exists and handles POST", () => {
  for (const path of Object.keys(doc.paths)) {
    assert.match(path, /^\/api\/tools\/[a-z-]+$/);
    const name = path.slice("/api/tools/".length);
    assert.ok(existsSync(`${TOOLS_DIR}${name}/route.ts`), `${path} has no route`);
    assert.match(routeSource(name), /export\s+(async\s+)?function\s+POST\b/, `${path} does not export POST`);
    assert.deepEqual(Object.keys(doc.paths[path]), ["post"]);
  }
});

test("every tool route is in the document: three paths, none undocumented", () => {
  assert.deepEqual(Object.keys(doc.paths).map((p) => p.slice("/api/tools/".length)).sort(), toolRoutes);
  assert.deepEqual(toolRoutes, ["dscr-calculator", "search-documents", "search-past-cases"]);
});

test("every operation declares the tool-key security scheme, and the scheme is the right header", () => {
  const scheme = doc.components.securitySchemes[SECURITY_SCHEME];
  assert.deepEqual(scheme, { type: "apiKey", in: "header", name: "X-CreditScout-Tool-Key" });
  assert.equal(HEADER_NAME.toLowerCase(), TOOL_KEY_HEADER, "the document and the auth check must name the same header");
  assert.deepEqual(doc.security, [{ [SECURITY_SCHEME]: [] }]);
  for (const [path, item] of Object.entries(doc.paths)) {
    assert.deepEqual(item.post.security, [{ [SECURITY_SCHEME]: [] }], `${path} does not declare the scheme`);
    assert.ok(item.post.responses["401"], `${path} does not document 401`);
  }
});

test("every documented route actually enforces the key, and the spec route does not", () => {
  for (const name of toolRoutes) {
    const src = routeSource(name);
    const call = src.indexOf("requireToolKey(req)");
    assert.ok(call > -1, `${name} never calls requireToolKey`);
    assert.ok(call < src.indexOf("req.json"), `${name} reads the body before checking the key`);
  }
  assert.doesNotMatch(routeSource("openapi"), /requireToolKey/);
  assert.match(routeSource("openapi"), /export\s+(async\s+)?function\s+GET\b/);
});

test("it is an OpenAPI 3.0 document with unique operation ids", () => {
  assert.match(doc.openapi, /^3\.0\.\d+$/);
  const ids = Object.values(doc.paths).map((p) => p.post.operationId);
  assert.deepEqual(ids.sort(), ["dscr_calculator", "search_documents", "search_past_cases"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("servers[0].url comes from PUBLIC_BASE_URL and defaults to localhost", () => {
  assert.equal(DEFAULT_BASE_URL, "http://localhost:3000");
  assert.equal(buildOpenApi({}).servers[0].url, "http://localhost:3000");
  assert.equal(buildOpenApi({ PUBLIC_BASE_URL: "" }).servers[0].url, "http://localhost:3000");
  assert.equal(buildOpenApi({ PUBLIC_BASE_URL: "https://creditscout.example/" }).servers[0].url, "https://creditscout.example");
});

test("request schemas require what the handlers require, and doc_types lists exactly the schema's types", () => {
  const body = (path) => doc.paths[path].post.requestBody.content["application/json"].schema;
  assert.deepEqual(body("/api/tools/dscr-calculator").required, ["terms", "financials", "financial_citations", "facility_id"]);
  assert.deepEqual(body("/api/tools/search-documents").required, ["facility_id", "query"]);
  assert.deepEqual(body("/api/tools/search-past-cases").required, ["facility_id", "exception_profile"]);
  assert.deepEqual(body("/api/tools/search-documents").properties.doc_types.items.enum, [...DOC_TYPES]);
});

test("the document is plain JSON (round-trips unchanged)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

test("financials figures are not mandatory: the schema agrees with the description to omit what you cannot cite", () => {
  const schema = doc.paths["/api/tools/dscr-calculator"].post.requestBody.content["application/json"].schema;
  const financials = schema.properties.financials;
  assert.equal(financials.required, undefined, "a required figure invites the model to send 0");
  assert.match(financials.description, /omit/i);
  assert.deepEqual(Object.keys(financials.properties).sort(), [
    "addback_amounts",
    "cash_interest",
    "cash_taxes",
    "ebitda",
    "scheduled_principal",
    "unfinanced_capex",
  ]);
  // terms are different: the wrapper rejects them without a numerator, add-backs and deductions.
  const numerator = schema.properties.terms.properties.numerator;
  assert.deepEqual(numerator.required, ["addbacks", "deductions"]);
  assert.ok(schema.properties.terms.required.includes("numerator"));
});

test("financial_citations mirrors financials key for key, and the route enforces it as documented", () => {
  // The route reads one citation per figure under the SAME key, add-backs by
  // name. A document whose keys drifted from financials would have the model
  // send citations the route never looks at, and every figure would read as
  // uncited — an investigation's worth of steps lost to a contract typo.
  const schema = doc.paths["/api/tools/dscr-calculator"].post.requestBody.content["application/json"].schema;
  const { financials, financial_citations: cites, facility_id } = schema.properties;
  assert.deepEqual(Object.keys(cites.properties).sort(), Object.keys(financials.properties).sort());
  for (const [key, value] of Object.entries(cites.properties)) {
    if (key === "addback_amounts") assert.deepEqual(value.additionalProperties, { type: "string" });
    else assert.deepEqual(value, { type: "string" }, key);
  }
  assert.equal(cites.required, undefined, "a figure left out needs no citation, so no key is mandatory");
  assert.match(cites.description, /financials chunk/);
  assert.match(cites.description, /HTTP 200/);
  assert.equal(facility_id.type, "string");
  assert.equal(facility_id.format, "uuid");

  // The route source agrees: the handler reads both fields by these names.
  const src = readFileSync(fileURLToPath(new URL("./tools/dscr-calculator.ts", import.meta.url)), "utf8");
  assert.match(src, /financial_citations/);
  assert.match(src, /facility_id is required/);
});
