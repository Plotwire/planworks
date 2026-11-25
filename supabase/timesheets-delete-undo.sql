-- ============================================================================
-- UNDO supabase/timesheets-delete.sql
-- ----------------------------------------------------------------------------
-- Only if something goes wrong. Removes exactly the three functions that file
-- added; nothing else is touched. (It can't bring back anything already
-- deleted with them.) After this, the app's Delete buttons say the delete
-- didn't work, and nothing is deleted.
--
-- All or nothing: if timesheets-delete.sql was never run, it stops and
-- changes nothing.
-- ============================================================================
begin;
set local lock_timeout = '3s';

drop function public.timesheet_delete(text, uuid);
drop function public.timesheet_delete_preview(text, uuid);
drop function public.ts_delete_entries(uuid, text, uuid);

commit;

-- CHECK (counts only). Expect delete_functions 0.
select count(*) as delete_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('timesheet_delete_preview', 'timesheet_delete', 'ts_delete_entries');
