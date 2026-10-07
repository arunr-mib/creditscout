"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, LANDING_PATH, demoCredentials, expectedToken } from "@/lib/auth/gate";

/** A safe internal path to return to after login: same-origin, no protocol-relative escape. */
function safeNext(next: unknown): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export interface SignInState {
  error: string | null;
}

/**
 * Validate the submitted credential against the environment's demo credential
 * and, on a match, set the session cookie. The cookie is httpOnly and holds an
 * opaque digest, never the password. On failure it returns a message rather
 * than throwing, so the form can show it inline.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const expected = demoCredentials();

  if (username !== expected.username || password !== expected.password) {
    return { error: "Those credentials were not recognised." };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // a demo working session
  });

  redirect(safeNext(formData.get("next")));
}

/** Clear the session and return to the landing page. */
export async function signOut(): Promise<void> {
  (await cookies()).delete(AUTH_COOKIE);
  redirect(LANDING_PATH);
}
