-- Two changes to `casefiles`, both from the stage-8a review.
--
-- NOT YET APPLIED. Hand to the owner for the dashboard SQL editor, as with
-- 0007 and 0008. The application code works with or without it: the unique
-- index only narrows a race the code already reorders around, and the terminal
-- write falls back to `summary` while `agent_output` is absent. Once this is
-- applied, that fallback should be deleted (lib/agent/orchestrator.ts).

-- ---------------------------------------------------------------- 1. the claim
-- At most ONE live casefile per exception.
--
-- `startInvestigation` reads for an existing casefile, then inserts. Two
-- near-simultaneous POSTs can both read nothing and both insert, and the
-- expensive consequence is not the duplicate row: it is TWO Foundry runs
-- investigating one exception, producing two traces and two recommendations for
-- one question, each costing orchestration tokens. The code now makes its claim
-- before the slow work, which narrows the window to a few milliseconds; this
-- closes it.
--
-- `status <> 'failed'` rather than a plain unique constraint, because a failed
-- investigation MUST be re-startable — that is the Retry path (spec §6.3), and
-- it works by not reusing a failed casefile. Many failures may accumulate; only
-- one live casefile may exist.
--
-- A unique_violation (23505) here means someone else claimed the exception
-- first; the route reports it as the existing casefile, never as an error.
--
-- Safe on current data: no exception has more than one casefile.
create unique index if not exists casefiles_one_live_per_exception
  on casefiles (exception_id)
  where status <> 'failed';

-- -------------------------------------------------------- 2. the raw output
-- Where the agent's unparsed final answer goes.
--
-- Stage 8a had nowhere to put it and used `summary`. That is the MEMORY
-- surface: `match_lessons` returns `casefiles.summary` as `case_summary`, and
-- `buildInvestigationPrompt` prints it under "LESSONS FROM PAST ANALYST
-- REVIEWS". So once an analyst reviewed a casefile, a later investigation's
-- prompt could receive a block of raw agent JSON presented to it as a lesson
-- the lender had learned. A prompt that cannot be trusted to describe its own
-- evidence is the one input nothing downstream can repair.
--
-- Separating them also makes each field mean one thing: `agent_output` is what
-- the model said and nothing has checked, `summary` is the one-line case
-- summary a human's review produces and memory is allowed to read.
alter table casefiles add column if not exists agent_output text;

comment on column casefiles.agent_output is
  'The orchestrator''s raw final answer, exactly as returned and not parsed. Written by the investigation sync; read by the casefile guardrail. Never embedded and never shown to another investigation.';
