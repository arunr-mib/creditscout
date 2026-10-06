-- Row Level Security.
--
-- The browser reads Supabase directly with the anon key, so this file is load
-- bearing. anon gets SELECT and nothing else; every write goes through a
-- server-side route handler on the service role, which bypasses RLS.
--
-- USING (true) is correct ONLY because this is single-tenant with synthetic
-- data. Multi-tenant requires a lender_id on every table and
-- USING (lender_id = auth.jwt() ->> 'lender_id'). That is a Launch-gate change
-- — do not mistake this policy for a production one.

do $$
declare t text;
begin
  foreach t in array array[
    'facilities','documents','doc_chunks','covenant_terms','tests',
    'exceptions','casefiles','calc_log','reviews','policy','eval_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_read on %I', t);
    execute format('create policy anon_read on %I for select to anon using (true)', t);
  end loop;
end $$;

-- Deliberately absent: any insert, update or delete policy for anon.
-- There is no browser write path. If one ever appears, this file is wrong.
