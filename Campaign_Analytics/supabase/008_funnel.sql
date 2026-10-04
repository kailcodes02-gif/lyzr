-- Campaign Analytics: the Leads funnel (scope + replies). Run after 007.
-- Only adds columns and an index to ca_hs_contacts; safe to run twice.
--
-- in_scope: false for contacts the last full HubSpot sync no longer matched
-- (left over from the first, wider pull rules). They are kept, not deleted, and
-- the dashboard hides them unless ?all=1 is asked for.
-- replies_*: incoming emails logged in HubSpot, split into human replies and
-- automatic ones (out of office, bounces, "no longer with the company").
alter table ca_hs_contacts add column if not exists replies_human int default 0;
alter table ca_hs_contacts add column if not exists replies_auto int default 0;
alter table ca_hs_contacts add column if not exists first_human_reply_at timestamptz;
alter table ca_hs_contacts add column if not exists last_human_reply_at timestamptz;
alter table ca_hs_contacts add column if not exists last_auto_reply_at timestamptz;
alter table ca_hs_contacts add column if not exists in_scope boolean default true;
alter table ca_hs_contacts add column if not exists scope_checked_at timestamptz;
create index if not exists ca_hs_contacts_in_scope on ca_hs_contacts(in_scope);
