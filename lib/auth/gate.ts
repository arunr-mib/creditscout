/**
 * The demo access gate.
 *
 * The spec puts multi-user auth out of scope; this is NOT that. It is a single
 * shared credential that keeps the deployed demo from being open to the whole
 * internet — one username/password, set in the environment, checked in
 * middleware. It does not touch the app's data model: reads still run under the
 * anon RLS policy and writes under the service role exactly as before.
 *
 * The session cookie carries an opaque SHA-256 of the credential, never the
 * password itself. Everything here is Web-Crypto only, so it runs unchanged in
 * the Edge middleware and in a Node server action.
 */

export const AUTH_COOKIE = "cs_demo_session";
export const LANDING_PATH = "/welcome";
export const LOGIN_PATH = "/login";

/** Dev defaults so `npm run dev` works with no setup; production sets real values. */
const DEFAULT_USERNAME = "analyst";
const DEFAULT_PASSWORD = "creditscout-demo";
const DEFAULT_DISPLAY_NAME = "Arun Rajendiran";
const DEFAULT_ROLE = "Credit Analyst";

/**
 * Who the rail shows as signed in. One shared demo credential means one person;
 * it is a label on the session, not an identity this app verified, and nothing
 * anywhere should read it as one.
 */
export function demoUser(env: Record<string, string | undefined> = process.env): { name: string; role: string } {
  const name = env.DEMO_USER_NAME?.trim();
  const role = env.DEMO_USER_ROLE?.trim();
  return { name: name || DEFAULT_DISPLAY_NAME, role: role || DEFAULT_ROLE };
}

export function demoCredentials(env: Record<string, string | undefined> = process.env): { username: string; password: string } {
  return {
    username: env.DEMO_USERNAME || DEFAULT_USERNAME,
    password: env.DEMO_PASSWORD || DEFAULT_PASSWORD,
  };
}

/** The cookie value a valid session carries: an opaque digest of the credential. */
export async function expectedToken(env: Record<string, string | undefined> = process.env): Promise<string> {
  const { username, password } = demoCredentials(env);
  const data = new TextEncoder().encode(`creditscout:v1:${username}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * API routes Azure AI Foundry calls server-to-server, with no browser cookie.
 *
 * EVERY ONE OF THESE ENFORCES `CREDITSCOUT_TOOL_KEY` ITSELF. That is the whole
 * reason they may skip the session gate, and the two must be kept in step: a
 * route added here without `requireToolKey` is an unauthenticated endpoint on a
 * public deployment.
 *
 * `/api/tools/openapi` is the exception, deliberately: Foundry fetches it to
 * register the tools BEFORE it can present a key, and it returns a schema —
 * no borrower data, no writes.
 */
export const AGENT_API_PATHS: readonly string[] = [
  "/api/tools/openapi",
  "/api/tools/search-documents",
  "/api/tools/search-past-cases",
  "/api/tools/dscr-calculator",
  "/api/ingest",
  "/api/investigate",
  "/api/investigate/sync",
  "/api/covenant-terms/approve",
  "/api/review",
];

/**
 * Paths reachable without a session: the landing and login pages, the tab icon,
 * and the agent's own routes above.
 *
 * THE DEFECT THIS FIXES: the gate exempted `/api/*` wholesale. The browser-
 * facing routes under it — `/api/tests/run`, `/api/tests/run-quarter`,
 * `/api/covenant-terms/propose`, `/api/casefiles/[id]/trace` — carry no tool
 * key either, so on the deployed demo anyone could run covenant tests, spend a
 * model call proposing terms, or read any casefile's trace without signing in.
 * They are called from the browser, which has a cookie, so gating them costs
 * the product nothing.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === LANDING_PATH || pathname === LOGIN_PATH) return true;
  if (AGENT_API_PATHS.includes(pathname)) return true;
  // The tab icon. `app/icon.svg` is served from the app route tree, not from
  // _next/static, so the matcher's asset exemptions miss it and the gate
  // answered the browser's icon request with a redirect to the landing page —
  // leaving the landing page and sign-in screen with no favicon at all.
  if (pathname === "/icon.svg") return true;
  return false;
}

/**
 * A safe internal path to return to after login.
 *
 * THE HOLE THIS CLOSES: the old check was `startsWith("/") && !startsWith("//")`,
 * which admits `/\\evil.com`. Browsers normalise the backslash to a slash, so
 * the redirect leaves the origin — an open redirect on the sign-in flow, which
 * is the one page an attacker can reasonably get someone to click.
 *
 * Anything that is not a plain, single-slash, same-origin path falls back to
 * the root. A scheme, a host, a backslash and a control character all fail.
 */
export function safeNext(next: unknown): string {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/")) return "/";
  // Any second leading separator is protocol-relative once the browser is done
  // with it, whichever slash was written.
  if (/^[/\\]{2}/.test(value.replace(/\\/g, "/"))) return "/";
  if (value.includes("\\") || /[\x00-\x1f]/.test(value)) return "/";
  try {
    // A relative URL resolved against a throwaway origin must STAY on it.
    const url = new URL(value, "https://creditscout.invalid");
    if (url.origin !== "https://creditscout.invalid") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
