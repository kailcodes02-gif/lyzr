-- ============================================================
-- Weekly-refreshed knowledge base (Lyzr blogs/case studies, Slack, Drive,
-- meeting notes, internal emails) feeding the Sonnet-only topic-suggestion
-- and draft-generation flow. Run after 006_projects_and_roles.sql.
-- ============================================================

CREATE TYPE knowledge_source_type AS ENUM (
  'lyzr_blog', 'lyzr_case_study', 'slack', 'drive', 'meeting_notes', 'internal_email'
);

-- One row per distinct piece of content per source (a blog post, a Slack
-- message/thread, a Drive file, an email). content_hash drives diff-based
-- re-processing during weekly ingestion -- only content whose hash changed
-- gets re-summarized, since Sonnet calls are the expensive part, not the
-- fetch itself.
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type knowledge_source_type NOT NULL,
  source_ref TEXT NOT NULL,
  title TEXT,
  content_md TEXT,
  summary TEXT,
  content_hash TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_ref)
);

CREATE INDEX knowledge_documents_source_fetched_idx ON knowledge_documents (source_type, fetched_at DESC);

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON knowledge_documents FOR SELECT TO authenticated USING (true);
-- Writes are sync-owned (service-role client, same as accounts/people/etc.) --
-- no authenticated-write policy needed.

-- Audit/cost log for every Sonnet call this app makes (suggestions + drafts) --
-- exists mainly so token spend is visible somewhere, given the explicit
-- low-token-consumption requirement behind this whole feature.
CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  generation_type TEXT NOT NULL CHECK (generation_type IN ('suggestions', 'draft')),
  model TEXT NOT NULL,
  input_tokens INT,
  output_tokens INT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_generations_project_idx ON ai_generations (project_id, created_at DESC);

ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON ai_generations FOR SELECT TO authenticated USING (true);
