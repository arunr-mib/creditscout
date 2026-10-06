import { createClient } from "@supabase/supabase-js";

/**
 * SERVER ONLY. Holds the service-role key, which bypasses RLS.
 *
 * Never import this from a Client Component. Every write in CreditScout goes
 * through a route handler using this client — there is no browser write path,
 * which is what makes the permissive anon SELECT policy acceptable.
 */
import "server-only";

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only)",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
