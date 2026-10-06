-- Vector indexes. ivfflat needs rows to train on; with a 3-facility demo corpus
-- the planner will often seq-scan anyway, which is fine at this size.
create index if not exists doc_chunks_embedding_idx
  on doc_chunks using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 10);
create index if not exists casefiles_summary_embedding_idx
  on casefiles using ivfflat (summary_embedding extensions.vector_cosine_ops) with (lists = 10);
create index if not exists reviews_lesson_embedding_idx
  on reviews using ivfflat (lesson_embedding extensions.vector_cosine_ops) with (lists = 10);

-- facility scoping is the hot path on every retrieval
create index if not exists doc_chunks_facility_idx
  on doc_chunks ((metadata->>'facility_id'));

create index if not exists tests_facility_period_idx on tests (facility_id, test_period_end desc);
create index if not exists casefiles_exception_idx   on casefiles (exception_id);
create index if not exists exceptions_facility_idx   on exceptions (facility_id, status);
create index if not exists covenant_terms_lookup_idx on covenant_terms (facility_id, status, effective_from desc);
create index if not exists documents_facility_idx    on documents (facility_id, doc_type);
