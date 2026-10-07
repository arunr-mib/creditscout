import { createClient } from "@supabase/supabase-js";

/**
 * Reads only, with the anon key under the RLS read policy. For Server
 * Components that draw a screen: every write goes through a route handler or a
 * Server Action on the service role, so there is no write path through this
 * client to get wrong. It reads the NEXT_PUBLIC_* names the browser client does
 * and also the server-side names, since this runs on the server.
 */
export function anonReader() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } });
}
