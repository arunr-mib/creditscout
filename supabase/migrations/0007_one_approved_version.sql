-- At most ONE approved covenant_terms row per facility.
--
-- UNIQUE (facility_id, version) cannot stop two analysts approving two different
-- proposals for one facility at the same moment: each gets a different version
-- number, so neither collides and the facility ends up with two live approved
-- versions. This makes that a unique_violation (23505), which the approve route
-- reports as HTTP 409. The route supersedes the previous version BEFORE
-- approving the new one, so the normal path never trips it.
--
-- Safe on current data: each facility has exactly one approved row.
create unique index if not exists covenant_terms_one_approved_per_facility
  on covenant_terms (facility_id)
  where status = 'approved';
