import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_KEY_LENGTH,
  TOOL_KEY_HEADER,
  VERCEL_PROTECTION_BYPASS_HEADER,
  constantTimeEqual,
  protectionBypassHeaders,
  requireToolKey,
} from "./auth.ts";

// Security finding S-2: the check must fail CLOSED. Every test here builds a
// real Request and a real environment; nothing about the check is mocked.

const GOOD_KEY = "k".repeat(16) + "A".repeat(16) + "0123456789abcdef"; // 48 chars
const realKey = process.env.CREDITSCOUT_TOOL_KEY;

const request = (headers = {}) => new Request("http://localhost/api/tools/x", { method: "POST", headers });
const withKey = (key) => request({ [TOOL_KEY_HEADER]: key });

async function assertUnauthorized(res) {
  assert.ok(res instanceof Response, "expected a rejection Response, got null (request was let through)");
  assert.equal(res.status, 401);
  // Exactly this body and nothing else: no hint whether the key was missing, wrong or unset.
  assert.equal(await res.text(), '{"error":"unauthorized"}');
}

beforeEach(() => {
  process.env.CREDITSCOUT_TOOL_KEY = GOOD_KEY;
});
afterEach(() => {
  if (realKey === undefined) delete process.env.CREDITSCOUT_TOOL_KEY;
  else process.env.CREDITSCOUT_TOOL_KEY = realKey;
});

// ------------------------------------------------------ S-2: fail closed

test("S-2: with CREDITSCOUT_TOOL_KEY unset, a request with NO header is rejected", async () => {
  delete process.env.CREDITSCOUT_TOOL_KEY;
  await assertUnauthorized(requireToolKey(request()));
});

test("S-2: with the key unset, no header value is accepted, including ones that look like 'undefined'", async () => {
  delete process.env.CREDITSCOUT_TOOL_KEY;
  for (const value of ["", "undefined", "null", GOOD_KEY, " "]) {
    await assertUnauthorized(requireToolKey(withKey(value)));
  }
});

test("S-2: an EMPTY key (the .env.example default) rejects an empty or missing header", async () => {
  process.env.CREDITSCOUT_TOOL_KEY = "";
  await assertUnauthorized(requireToolKey(request()));
  await assertUnauthorized(requireToolKey(withKey("")));
});

test("a key shorter than 32 characters is too weak to trust: rejected even when the header matches it", async () => {
  const weak = "x".repeat(MIN_KEY_LENGTH - 1);
  process.env.CREDITSCOUT_TOOL_KEY = weak;
  await assertUnauthorized(requireToolKey(withKey(weak)));
});

test("a key of exactly 32 characters is accepted when the header matches", () => {
  const key = "y".repeat(MIN_KEY_LENGTH);
  process.env.CREDITSCOUT_TOOL_KEY = key;
  assert.equal(requireToolKey(withKey(key)), null);
});

// ------------------------------------------------------ ordinary rejection

test("no header is rejected", async () => {
  await assertUnauthorized(requireToolKey(request()));
});

test("a wrong header is rejected", async () => {
  await assertUnauthorized(requireToolKey(withKey("not-the-key")));
});

test("a header differing only in the last character is rejected", async () => {
  await assertUnauthorized(requireToolKey(withKey(GOOD_KEY.slice(0, -1) + "X")));
});

test("a prefix of the key, and the key with something appended, are rejected", async () => {
  await assertUnauthorized(requireToolKey(withKey(GOOD_KEY.slice(0, 40))));
  await assertUnauthorized(requireToolKey(withKey(GOOD_KEY + "x")));
});

test("an empty header is rejected", async () => {
  await assertUnauthorized(requireToolKey(withKey("")));
});

test("all rejections are indistinguishable: same status, headers and body", async () => {
  const wrong = requireToolKey(withKey("wrong"));
  const missing = requireToolKey(request());
  delete process.env.CREDITSCOUT_TOOL_KEY;
  const unset = requireToolKey(request());

  const shape = async (r) => ({
    status: r.status,
    body: await r.text(),
    headers: [...r.headers].sort(),
  });
  const [a, b, c] = await Promise.all([shape(wrong), shape(missing), shape(unset)]);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

// ------------------------------------------------------ acceptance

test("the right key is let through (null means authorised)", () => {
  assert.equal(requireToolKey(withKey(GOOD_KEY)), null);
});

test("the header name is case-insensitive, as HTTP requires", () => {
  const req = request({ "X-CreditScout-Tool-Key": GOOD_KEY });
  assert.equal(requireToolKey(req), null);
});

test("the key is read from the environment on every call, not captured at import", async () => {
  assert.equal(requireToolKey(withKey(GOOD_KEY)), null);
  process.env.CREDITSCOUT_TOOL_KEY = "z".repeat(40);
  await assertUnauthorized(requireToolKey(withKey(GOOD_KEY)));
});

// ------------------------------------------------------ constant-time compare

test("constantTimeEqual agrees with === for equal, unequal and different-length strings, without throwing", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("", "abc"), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("é".repeat(40), "e".repeat(80)), false);
});

// Vercel Protection Bypass header: present only when the secret is set, so a
// public deploy and local dev send nothing, while a protected deploy gets past
// the protection wall (the tool key still does the real authorising).
test("protectionBypassHeaders is empty unless the bypass secret is set", () => {
  const prior = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    assert.deepEqual(protectionBypassHeaders(), {});

    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-secret-value";
    assert.deepEqual(protectionBypassHeaders(), { [VERCEL_PROTECTION_BYPASS_HEADER]: "bypass-secret-value" });

    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "";
    assert.deepEqual(protectionBypassHeaders(), {}, "an empty secret sends no header");
  } finally {
    if (prior === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = prior;
  }
});
