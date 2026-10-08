import { test } from "node:test";
import assert from "node:assert/strict";

import { LANDING_PATH, LOGIN_PATH, demoUser, isPublicPath } from "./gate.ts";

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
