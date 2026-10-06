-- Record the omission warnings ON the covenant_terms row.
--
-- The point of this subsystem is that a covenant's provenance is auditable after
-- the fact. Until now `termsWarnings` was computed, returned to the screen, and
-- then lost: nothing in the stored row said which machine checks ran. The worst
-- case is `definition_not_located` — the completeness check DID NOT RUN, and a
-- year later an auditor reading the row could not tell that from a clean pass.
-- Silence that reads as success is the same failure shape as a wrong number with
-- a real citation.
--
-- NULLABLE ON PURPOSE, with no default. Three values, three meanings:
--   null  the row predates this column; no warning record was kept
--   []    the checks ran and raised nothing
--   [...] the checks ran and raised these
-- A `not null default '[]'` would backfill the three rows approved before this
-- column existed with "checked, nothing found", which is the very claim this
-- column exists to stop anyone making silently.
--
-- The approve route recomputes the warnings from the chunks in THIS database
-- before writing them; it does not store what the propose response carried,
-- because the client sits in between.
alter table covenant_terms
  add column if not exists warnings jsonb;

comment on column covenant_terms.warnings is
  'Omission/advisory warnings recorded at propose and recomputed at approve. null = not recorded (row predates the column); [] = checks ran, nothing raised.';
