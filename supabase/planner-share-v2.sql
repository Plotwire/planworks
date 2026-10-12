-- ============================================================================
-- PLANNER SHARE LINK: multi-day jobs on every day they cover
-- Run AFTER supabase/planner-v2.sql. Safe on the live database: it only ADDS
-- one function. No table, policy or existing function is changed, and
-- planner_shared() is left exactly as it is.
-- ============================================================================
--
-- Why: planner_shared() (the view-only link) builds each job from a fixed list
-- of columns that predates planner-v2.sql, so the link gets no end_date and
-- shows a multi-day job on its first day only. Its body isn't recorded in this
-- repo, so rather than re-create it, this adds planner_shared_v2(), which:
--   1. calls planner_shared() first and returns its answer unchanged when the
--      link isn't valid (null). Access stays decided in ONE place: whatever
--      planner_shared() allows or refuses, v2 does the same, including any
--      later change to it (see docs/post-launch-tidy-up.md, "Planner share
--      links keep working after the owner lapses").
--   2. keeps planner_shared()'s settings, and swaps in the owner's jobs with
--      end_date (the job's last day) and sort_order (its place in the day).
--      The job fields are the ones the link already shows; the owner's
--      user_id is not included.
--
-- The app calls planner_shared_v2() and falls back to planner_shared() until
-- this file has been run, so nothing breaks in between.
--
-- Re-running is safe: it replaces only planner_shared_v2 itself.
-- ============================================================================

create or replace function public.planner_shared_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base     jsonb;
  owner_id public.planner_settings.user_id%type;
begin
  -- The original decides whether this link works, and what settings it shows.
  base := public.planner_shared(p_token)::jsonb;
  if base is null or length(coalesce(p_token, '')) < 16 then
    return base;
  end if;

  select ps.user_id into owner_id
    from public.planner_settings ps
   where ps.data ->> 'shareToken' = p_token
   limit 1;
  if owner_id is null then
    return base;
  end if;

  -- Roughly the four weeks the board shows, with a few days' slack either side
  -- for time zones (the app trims to the exact window). A job that started
  -- earlier but is still running is included.
  return jsonb_set(base, '{jobs}', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',         j.id,
             'job_date',   j.job_date,
             'end_date',   j.end_date,
             'sort_order', j.sort_order,
             'contractor', j.contractor,
             'start_time', j.start_time,
             'site',       j.site,
             'job_type',   j.job_type,
             'addr',       j.addr,
             'cust',       j.cust,
             'status',     j.status,
             'notes',      j.notes,
             'important',  j.important)
           order by j.job_date, j.start_time)
      from public.planner_jobs j
     where j.user_id = owner_id
       and j.job_date is not null
       and j.job_date <= current_date + 40
       and coalesce(j.end_date, j.job_date) >= current_date - 10
  ), '[]'::jsonb));
end;
$$;

-- Callable by anyone with the link (signed in or not), like planner_shared().
revoke all on function public.planner_shared_v2(text) from public;
grant execute on function public.planner_shared_v2(text) to anon, authenticated;

-- ============================================================================
-- CHECK 1. Expect two rows. planner_shared_v2: security_definer true,
-- config {search_path=""}, anon_can_call true.
-- ============================================================================
select p.proname                                       as function,
       p.prosecdef                                     as security_definer,
       p.proconfig                                     as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_call
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('planner_shared', 'planner_shared_v2');

-- ============================================================================
-- CHECK 2 (read-only, shows no job or link details). For every account that
-- has a share link: same_access must be true on every row (the new function
-- opens exactly the links the old one does), and multi_day_jobs counts that
-- account's multi-day jobs the link can now show across their days.
-- ============================================================================
select (public.planner_shared(ps.data ->> 'shareToken') is null)
         = (public.planner_shared_v2(ps.data ->> 'shareToken') is null) as same_access,
       (select count(*)
          from jsonb_array_elements(coalesce(public.planner_shared_v2(ps.data ->> 'shareToken') -> 'jobs', '[]'::jsonb)) e
         where e ->> 'end_date' is not null)                             as multi_day_jobs
  from public.planner_settings ps
 where ps.data ? 'shareToken';
