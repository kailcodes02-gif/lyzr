-- Campaign Analytics: Claude's reading of each GSI lead's form message.
-- Run after 002. Adds columns to ca_hs_contacts only; nothing else changes.
-- Filled by functions/api/ca/hubspot/classify.js (claude-sonnet-5), once per message.
alter table ca_hs_contacts add column if not exists ai_cluster text;      -- one of the 10 message categories
alter table ca_hs_contacts add column if not exists ai_use_case text;     -- what they want, in a few words
alter table ca_hs_contacts add column if not exists ai_intent text;       -- high | medium | low
alter table ca_hs_contacts add column if not exists ai_summary text;      -- one sentence
alter table ca_hs_contacts add column if not exists ai_spam boolean;      -- test, vendor pitch or gibberish
alter table ca_hs_contacts add column if not exists ai_model text;
alter table ca_hs_contacts add column if not exists ai_at timestamptz;    -- null = not read yet
create index if not exists ca_hs_contacts_ai_todo on ca_hs_contacts(ai_at) where ai_at is null and lsa_message is not null;
