-- CreditScout — schema
-- Covenant exception investigation. Decision support; a human always approves.
-- Embeddings are 1536-dimensional (text-embedding-3-small). Load-bearing.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- facilities
create table if not exists facilities (
  id            uuid primary key default gen_random_uuid(),
  borrower_name text not null,
  industry      text,
  sender_domain text,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------- documents
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references facilities(id) on delete cascade,
  doc_type       text not null check (doc_type in
                   ('agreement','amendment','waiver','compliance_certificate','financials')),
  title          text not null,
  effective_date date,
  source         text not null default 'upload' check (source in ('upload','email')),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- doc_chunks
create table if not exists doc_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  content     text not null,
  embedding   extensions.vector(1536),
  metadata    jsonb not null
);

-- ------------------------------------------------------------ covenant_terms
-- Flow A output. Versioned and effective-dated: a Q1 test must stay
-- reproducible against the terms in force in Q1, so an amendment creates a new
-- version and supersedes the old one. It never overwrites.
create table if not exists covenant_terms (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references facilities(id) on delete cascade,
  version          int  not null,
  effective_from   date not null,
  effective_to     date,
  terms            jsonb not null,
  source_citations jsonb not null,
  status           text not null default 'proposed'
                     check (status in ('proposed','approved','superseded')),
  approved_by      text,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint covenant_terms_facility_version_key unique (facility_id, version),
  -- four-eyes: approved rows must carry who approved them and when
  constraint covenant_terms_approval_complete check (
    status <> 'approved' or (approved_by is not null and approved_at is not null)
  )
);

-- --------------------------------------------------------------------- tests
-- Flow B output. One row per borrower per quarter, whether or not it fails.
-- This table is what makes the product end-to-end rather than exception triage.
create table if not exists tests (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references facilities(id) on delete cascade,
  covenant_terms_id uuid not null references covenant_terms(id),
  test_period_end   date not null,
  computed_dscr     numeric(10,4),          -- OUR number. null only on calc_error.
  reported_dscr     numeric(10,4),          -- the borrower's. evidence, not trigger.
  threshold         numeric(10,4) not null,
  passed            boolean,                -- against computed_dscr, never reported
  variance          numeric(10,4),
  variance_flagged  boolean not null default false,
  calc_id           uuid,
  calc_error        text,                   -- set when an input was missing. never zero.
  run_id            text not null default 'demo',
  created_at        timestamptz not null default now(),
  constraint tests_facility_period_run_key unique (facility_id, test_period_end, run_id),
  -- a test either produced a number or recorded why it could not
  constraint tests_number_or_error check (computed_dscr is not null or calc_error is not null)
);

-- ---------------------------------------------------------------- exceptions
create table if not exists exceptions (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references facilities(id) on delete cascade,
  test_id         uuid references tests(id) on delete cascade,
  test_period_end date not null,
  computed_dscr   numeric(10,4),
  reported_dscr   numeric(10,4),
  required_dscr   numeric(10,4),
  status          text not null default 'new'
                    check (status in ('new','investigating','pending_review','closed','needs_filing')),
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------- casefiles
create table if not exists casefiles (
  id                uuid primary key default gen_random_uuid(),
  exception_id      uuid not null references exceptions(id) on delete cascade,
  status            text not null default 'investigating'
                      check (status in ('investigating','pending_review','approved',
                                        'overridden','awaiting_docs','failed')),
  trace             jsonb not null default '[]'::jsonb,
  terms             jsonb,
  recommendation    text check (recommendation in ('resolve','request','escalate','abstain')),
  confidence_basis  text,
  explanation       text,
  claims            jsonb,
  calc_ids          uuid[],
  missing_evidence  jsonb,
  suggested_tag     text check (suggested_tag in
                      ('amendment_addback','period_mismatch','missing_waiver',
                       'borrower_calc_error','true_breach','other')),
  guardrail_notes   jsonb,
  steps_count       int not null default 0,
  summary           text,
  summary_embedding extensions.vector(1536),
  run_id            text not null default 'demo',
  foundry_thread_id text,
  foundry_run_id    text,
  last_step_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------------ calc_log
-- Every calculation ever run. The evidence base for the whole trust claim:
-- a number in an explanation must match a row here or a verbatim quote.
create table if not exists calc_log (
  calc_id            uuid primary key,        -- injected by the caller, never generated inside
  casefile_id        uuid references casefiles(id) on delete set null,
  test_id            uuid references tests(id) on delete set null,
  inputs             jsonb not null,
  outputs            jsonb not null,
  calculator_version text not null,
  created_at         timestamptz not null default now()
);

alter table tests
  add constraint tests_calc_id_fkey foreign key (calc_id) references calc_log(calc_id)
  deferrable initially deferred;

-- ------------------------------------------------------------------- reviews
-- Append-only. A wrong lesson is superseded, never deleted: the audit trail
-- is the product.
create table if not exists reviews (
  id                uuid primary key default gen_random_uuid(),
  casefile_id       uuid not null references casefiles(id) on delete cascade,
  decision          text not null check (decision in ('approve','override','request_docs')),
  reason            text,
  corrected_outcome text,
  pattern_tag       text,
  lesson_text       text,
  lesson_embedding  extensions.vector(1536),
  created_at        timestamptz not null default now(),
  -- an override without reasoning teaches the system nothing
  constraint reviews_override_requires_reason check (
    decision <> 'override' or (reason is not null and corrected_outcome is not null)
  )
);

-- -------------------------------------------------------------------- policy
create table if not exists policy (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- eval_runs
create table if not exists eval_runs (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('cold','warm')),
  metrics    jsonb not null,
  created_at timestamptz not null default now()
);
