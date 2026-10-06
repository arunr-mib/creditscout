-- Facility-scoped similarity search.
--
-- The facility filter lives INSIDE the function on purpose: a caller cannot
-- forget it. Cross-facility leakage — citing one borrower's agreement in
-- another borrower's casefile — is the worst bug available in this system.
create or replace function match_doc_chunks(
  query_embedding extensions.vector(1536),
  p_facility_id   uuid,
  match_count     int default 8,
  p_doc_types     text[] default null
)
returns table (
  id          uuid,
  content     text,
  document_id uuid,
  doc_title   text,
  section     text,
  doc_type    text,
  similarity  float
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.document_id,
    c.metadata->>'doc_title' as doc_title,
    c.metadata->>'section'   as section,
    c.metadata->>'doc_type'  as doc_type,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from doc_chunks c
  where c.metadata->>'facility_id' = p_facility_id::text
    and (p_doc_types is null or c.metadata->>'doc_type' = any(p_doc_types))
    and c.embedding is not null
  order by c.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;
