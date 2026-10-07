import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, LANDING_PATH, expectedToken, isPublicPath } from "@/lib/auth/gate";

/**
 * Gates every page behind the shared demo credential (lib/auth/gate.ts), and
 * passes the pathname to the root layout as `x-pathname` so the landing and
 * login pages can render full-bleed without the app's nav rail.
 *
 * An unauthenticated request to a gated page is sent to the landing page with
 * `?next=` so the login can return the analyst to where they were headed.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (isPublicPath(pathname)) return pass();

  const session = req.cookies.get(AUTH_COOKIE)?.value;
  if (session && session === (await expectedToken())) return pass();

  const url = req.nextUrl.clone();
  url.pathname = LANDING_PATH;
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Run on everything except Next's static assets and the favicon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
