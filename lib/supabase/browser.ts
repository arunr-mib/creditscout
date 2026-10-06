import { createClient } from "@supabase/supabase-js";

/**
 * Browser client. Anon key, READ ONLY under RLS.
 *
 * Used for the 1-second investigation-trace poll and for display reads. It
 * cannot write — there is deliberately no anon INSERT/UPDATE/DELETE policy.
 */
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
