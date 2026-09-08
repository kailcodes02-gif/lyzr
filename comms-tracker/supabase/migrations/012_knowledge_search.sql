-- ============================================================
-- Ranked full-text search over the knowledge base for the "type your own
-- topic" box in Generate & Send. A stored tsvector + GIN index keeps it
-- fast as the table grows, and ts_rank_cd orders by relevance (title hits
-- weigh more than body hits) instead of by date. The app falls back to a
-- plain PostgREST text filter if this function isn't present yet.
-- ============================================================

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(content_md, ''), 20000)), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_documents_search_idx ON knowledge_documents USING GIN (search_tsv);

CREATE OR REPLACE FUNCTION search_knowledge(q text, n int DEFAULT 8)
RETURNS TABLE (
  id uuid,
  source_type knowledge_source_type,
  source_ref text,
  title text,
  summary text,
  content_md text,
  published_at timestamptz,
  fetched_at timestamptz,
  rank real
)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.source_type, d.source_ref, d.title, d.summary, d.content_md, d.published_at, d.fetched_at,
         ts_rank_cd(d.search_tsv, websearch_to_tsquery('english', q)) AS rank
  FROM knowledge_documents d
  WHERE d.search_tsv @@ websearch_to_tsquery('english', q)
  ORDER BY rank DESC, coalesce(d.published_at, d.fetched_at) DESC
  LIMIT n;
$$;

GRANT EXECUTE ON FUNCTION search_knowledge(text, int) TO authenticated, service_role;
