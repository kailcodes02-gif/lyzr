-- 026: clear the blueprint dummy data, and make the Lyzr vertical permanent.
-- Data + trigger only; idempotent, safe to re-run.
--
-- 1) Every task currently live is blueprint-seeded demo data (126 rows,
--    planning_fields->>'bp_id' set, zero user-created, zero status changes —
--    verified and backed up to tracker/backups/2026-09-28T08-28-18-444Z).
--    Kailash wants a clean start: people and the channel tree stay, tasks go.
--    All task children (assignments, pending assignments, checklists,
--    comments, dependencies, mentions, watchers, suggestions) cascade.
delete from public.tasks
where planning_fields->>'bp_id' is not null;

-- 2) The Lyzr vertical is the across-workspace view. It is always there:
--    nobody can delete it, deactivate it, or take its slug.
create or replace function public.protect_lyzr_vertical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.slug = 'lyzr' then
      raise exception 'The Lyzr company-wide vertical is permanent and cannot be deleted.';
    end if;
    return old;
  end if;
  -- UPDATE: block deactivation and slug changes
  if old.slug = 'lyzr' and (new.is_active = false or new.slug is distinct from 'lyzr') then
    raise exception 'The Lyzr company-wide vertical is permanent — it cannot be deactivated or renamed.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_lyzr_vertical on public.verticals;
create trigger trg_protect_lyzr_vertical
  before update or delete on public.verticals
  for each row execute function public.protect_lyzr_vertical();

-- 3) Verify: task counts should be zero, Lyzr present and active.
select
  (select count(*) from public.tasks)               as tasks_left,
  (select count(*) from public.task_assignments)    as assignments_left,
  (select count(*) from public.pending_assignments) as pending_assignments_left,
  (select count(*) from public.verticals where slug = 'lyzr' and is_active) as lyzr_active,
  (select count(*) from public.channels)            as channels_kept,
  (select count(*) from public.channel_owners)      as channel_owners_kept;
