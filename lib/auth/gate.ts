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

/**
 * The name shown as the signed-in analyst. One shared demo credential means one
 * name; it is a label on the session, not an identity this app verified, and
 * nothing anywhere should read it as one.
 */
export function demoDisplayName(env: Record<string, string | undefined> = process.env): string {
  const name = env.DEMO_USER_NAME?.trim();
  return name ? name : DEFAULT_DISPLAY_NAME;
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
 * Paths that must stay reachable without a session: the landing and login pages
 * themselves, and — critically — the `/api/*` tool routes. Azure AI Foundry
 * calls those server-to-server with no browser cookie; they carry their own
 * `CREDITSCOUT_TOOL_KEY` auth, so gating them here would break every agent run.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === LANDING_PATH || pathname === LOGIN_PATH) return true;
  if (pathname.startsWith("/api/")) return true;
  return false;
}
