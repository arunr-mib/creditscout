-- 0010: a reviewed casefile can be superseded by a fresh investigation.
--
-- The demo's F1 exception carries a reviewed casefile (an abstain), yet the
-- investigation can now resolve it correctly. Re-investigating must not destroy
-- the prior casefile's history, so the prior one is marked `superseded`, not
-- deleted. `casefiles_one_live_per_exception` (0009) kept exactly one non-failed
-- casefile per exception; a superseded casefile must also free that slot, or the
-- re-investigation cannot take it.
--
-- Additive and safe to apply before the code uses it: no row is `superseded`
-- yet, so the index behaves exactly as before until a supersede happens.

alter table casefiles drop constraint casefiles_status_check;
alter table casefiles add constraint casefiles_status_check
  check (status in ('investigating','pending_review','approved','overridden','awaiting_docs','failed','superseded'));

drop index if exists casefiles_one_live_per_exception;
create unique index casefiles_one_live_per_exception
  on casefiles (exception_id)
  where status not in ('failed','superseded');
