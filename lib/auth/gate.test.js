import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_API_PATHS, LANDING_PATH, LOGIN_PATH, demoUser, isPublicPath, safeNext } from "./gate.ts";

// ------------------------------------------------------------- public paths

test("the landing page, the login page and the tool routes are reachable without a session", () => {
  assert.equal(isPublicPath(LANDING_PATH), true);
  assert.equal(isPublicPath(LOGIN_PATH), true);
  // Foundry calls these server-to-server with no browser cookie; they carry
  // their own CREDITSCOUT_TOOL_KEY. Gating them breaks every agent run.
  assert.equal(isPublicPath("/api/tools/dscr-calculator"), true);
  assert.equal(isPublicPath("/api/investigate"), true);
});

test("the tab icon is public: the gate used to answer the browser with a redirect", () => {
  // `app/icon.svg` is served from the app route tree, not _next/static, so the
  // middleware matcher's asset exemptions do not cover it. Without this the
  // landing and sign-in screens render with no favicon.
  assert.equal(isPublicPath("/icon.svg"), true);
});

test("everything else stays behind the gate", () => {
  for (const path of ["/", "/governance", "/documents", "/terms", "/lessons", "/casefiles/abc"]) {
    assert.equal(isPublicPath(path), false, `${path} must require a session`);
  }
});

test("a path that merely starts with a public path's text is not public", () => {
  // "/apidocs" is not "/api/...", and "/welcome-admin" is not the landing page.
  assert.equal(isPublicPath("/apidocs"), false);
  assert.equal(isPublicPath(`${LANDING_PATH}-admin`), false);
  assert.equal(isPublicPath("/icon.svg.map"), false);
});

// --------------------------------------------------------------- demo user

test("the demo user falls back to a default, and blank env values do not blank the rail", () => {
  const fallback = demoUser({});
  assert.ok(fallback.name.length > 0);
  assert.ok(fallback.role.length > 0);

  assert.deepEqual(demoUser({ DEMO_USER_NAME: "Dana Okafor", DEMO_USER_ROLE: "Portfolio Manager" }), {
    name: "Dana Okafor",
    role: "Portfolio Manager",
  });

  // Whitespace is not a name. An env var set to "   " must not render an empty
  // label where a person is supposed to be.
  assert.deepEqual(demoUser({ DEMO_USER_NAME: "   ", DEMO_USER_ROLE: "" }), fallback);
});

// ------------------------------------------------- what may skip the session

test("every agent-exempt API route enforces the tool key itself", async () => {
  // THE RULE THIS PINS: the session gate lets these through because they
  // authenticate themselves. A route added to the list without
  // `requireToolKey` is an unauthenticated endpoint on a public deployment.
  const { readFileSync } = await import("node:fs");
  const FILE = {
    "/api/tools/search-documents": "app/api/tools/search-documents/route.ts",
    "/api/tools/search-past-cases": "app/api/tools/search-past-cases/route.ts",
    "/api/tools/dscr-calculator": "app/api/tools/dscr-calculator/route.ts",
    "/api/ingest": "app/api/ingest/route.ts",
    "/api/investigate": "app/api/investigate/route.ts",
    "/api/investigate/sync": "app/api/investigate/sync/route.ts",
    "/api/covenant-terms/approve": "app/api/covenant-terms/approve/route.ts",
    "/api/review": "app/api/review/route.ts",
  };
  for (const path of AGENT_API_PATHS) {
    // The OpenAPI schema is the one deliberate exception: Foundry reads it to
    // register the tools before it can present a key, and it returns no data.
    if (path === "/api/tools/openapi") continue;
    const file = FILE[path];
    assert.ok(file, `${path} is exempt from the session gate but this test does not know its file`);
    assert.match(readFileSync(file, "utf8"), /requireToolKey/, `${path} is exempt from the session gate and does not require the tool key`);
  }
});

test("the browser's own API routes are NOT public", () => {
  // They were, under a blanket `/api/*` exemption: anyone could run covenant
  // tests, spend a model call proposing terms, or read a casefile's trace.
  for (const path of [
    "/api/tests/run",
    "/api/tests/run-quarter",
    "/api/covenant-terms/propose",
    "/api/casefiles/7a0a3e6e-0000-0000-0000-000000000000/trace",
  ]) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test("a path under an exempt prefix is not itself exempt", () => {
  // Matching is exact, so `/api/ingest-everything` cannot ride in on `/api/ingest`.
  assert.equal(isPublicPath("/api/ingest"), true);
  assert.equal(isPublicPath("/api/ingest-everything"), false);
  assert.equal(isPublicPath("/api/"), false);
});

// ------------------------------------------------------------ the open redirect

test("safeNext keeps the redirect on this origin", () => {
  assert.equal(safeNext("/casefiles/abc?x=1#y"), "/casefiles/abc?x=1#y");
  assert.equal(safeNext("/"), "/");
});

test("safeNext rejects the backslash escape browsers normalise to //", () => {
  // THE HOLE: `/\evil.com` starts with "/" and not "//", so the old check
  // passed it. The browser then reads it as `//evil.com` and leaves the site.
  assert.equal(safeNext("/\\evil.com"), "/");
  assert.equal(safeNext("/\\\\evil.com"), "/");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext("javascript:alert(1)"), "/");
  assert.equal(safeNext(""), "/");
  assert.equal(safeNext(undefined), "/");
  assert.equal(safeNext("/\u0000x"), "/");
});
