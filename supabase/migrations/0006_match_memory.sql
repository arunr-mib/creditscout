-- Run-scoped lesson search (the memory side of retrieval).
--
-- Deliberately NOT facility-scoped. A lesson is the lender's own accumulated
-- judgement, and the demo's memory effect is exactly that an analyst's override
-- on one borrower teaches the system something it applies to the next. Document
-- search is the opposite: a chunk is one borrower's confidential agreement, so
-- match_doc_chunks filters by facility inside the function.
--
-- What IS filtered, inside the function so a caller cannot forget it, is run_id.
-- Eval runs and demo data share these tables; a cold eval pass that could see
-- warm lessons would silently invalidate the memory-effect measurement.
create or replace function match_lessons(
  query_embedding extensions.vector(1536),
  p_run_id        text default 'demo',
  match_count     int  default 3
)
returns table (
  lesson_text  text,
  pattern_tag  text,
  case_summary text,
  similarity   float
)
language sql stable
as $$
  select
    r.lesson_text,
    r.pattern_tag,
    c.summary as case_summary,
    1 - (r.lesson_embedding operator(extensions.<=>) query_embedding) as similarity
  from reviews r
  join casefiles c on c.id = r.casefile_id
  where c.run_id = p_run_id
    and r.lesson_embedding is not null
    and r.lesson_text is not null
  order by r.lesson_embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;
