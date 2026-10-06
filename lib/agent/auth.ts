import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared-key check for the agent tool endpoints (security finding S-2).
 *
 * It FAILS CLOSED. The naive `header !== process.env.KEY` passes when both are
 * undefined, which would leave every tool route publicly callable on a deployed
 * URL that forgot to set the key. Here an unset, empty or short key rejects
 * every request, whatever header it carries.
 */
export const TOOL_KEY_HEADER = "x-creditscout-tool-key";

/** `openssl rand -hex 32` gives 64 characters; anything under 32 is too weak to trust. */
export const MIN_KEY_LENGTH = 32;

/** The 401 body is fixed: no hint whether the key was missing, wrong, or unset on the server. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Constant-time string equality that does not leak length either.
 *
 * `timingSafeEqual` throws on unequal lengths, and checking the length first
 * would leak it. Hashing both sides gives two 32-byte buffers whatever the
 * input lengths, so the comparison is always the same shape.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns `null` when the request carries the right key, otherwise the 401 to
 * send back. Call it first in every tool route, before reading the body:
 *
 *   const denied = requireToolKey(req);
 *   if (denied) return denied;
 */
export function requireToolKey(req: Request): Response | null {
  const expected = process.env.CREDITSCOUT_TOOL_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) return unauthorized(); // unset or too weak
  const provided = req.headers.get(TOOL_KEY_HEADER);
  if (provided === null || !constantTimeEqual(provided, expected)) return unauthorized();
  return null;
}
