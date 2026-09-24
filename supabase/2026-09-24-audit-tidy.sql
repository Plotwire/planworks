-- ============================================================================
-- Pre-launch security audit tidy-up -- 24 Sep 2026
-- ----------------------------------------------------------------------------
-- >>> ALREADY APPLIED -- do not run. <<<
--
-- Joe ran these statements in the live database on 24 Sep 2026, following
-- the pre-launch security audit. Recorded here so the repo matches the
-- database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pin planner_shared()'s search_path
-- ---------------------------------------------------------------------------
-- planner_shared() is SECURITY DEFINER (it is the anonymous door behind the
-- /planner/view share link). With search_path = public, an object someone
-- managed to create earlier on the path could be picked up in place of the
-- real one. An empty search_path removes that risk.
alter function public.planner_shared(text) set search_path = '';

-- ---------------------------------------------------------------------------
-- 2. Drop duplicate per-command planner policies
-- ---------------------------------------------------------------------------
-- These duplicated the "Users manage their own planner jobs" and "Users manage
-- their own planner settings" ALL policies (supabase/planner-rls-setup.sql),
-- which remain in place and are now the only policies on those tables.
drop policy planner_jobs_select on public.planner_jobs;
drop policy planner_jobs_insert on public.planner_jobs;
drop policy planner_jobs_update on public.planner_jobs;
drop policy planner_jobs_delete on public.planner_jobs;

drop policy planner_settings_select on public.planner_settings;
drop policy planner_settings_insert on public.planner_settings;
drop policy planner_settings_update on public.planner_settings;
drop policy planner_settings_delete on public.planner_settings;

-- ----------------------------------------------------------------------------
-- CHECK. Expect one ALL policy per planner table, and planner_shared with
-- proconfig = {search_path=""}.
-- ----------------------------------------------------------------------------
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('planner_jobs', 'planner_settings');
--   select proname, prosecdef, proconfig from pg_proc where proname = 'planner_shared';
