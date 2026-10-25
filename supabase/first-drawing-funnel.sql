-- ============================================================================
-- First-drawing guide: where new accounts drop off -- READ ONLY, COUNTS ONLY
-- ----------------------------------------------------------------------------
-- Safe to run at any time in the Supabase dashboard (SQL Editor): it only
-- reads, and returns ONE row of numbers. No emails, names, ids or drawings.
--
-- Nothing to apply first: no database change was needed. The guide keeps
-- each account's progress in its existing settings record
-- (user_settings.data -> 'firstDrawing'), each step with the time it was
-- first done (lib/firstDrawing.js).
--
-- To count only accounts made since a date (say the day the guide went
-- live), change the date on the "since" line. As it is, it counts everyone.
--
-- The columns, in order:
--   signed up                   accounts made since the date
--   saw the first-drawing page  shown "Let's do your first drawing" (no
--                               drawings yet when they opened the dashboard)
--   added a plan                a plan on a drawing (uploaded, drawn in the
--                               Floor Plan tool, or the sample house)
--   placed a symbol             first symbol on a drawing
--   opened the quote            opened Quote with symbols on the drawing
--   downloaded or printed       downloaded the drawing PDF or pressed Print
--   pressed Download (try)      a try account pressed Download and was shown
--                               that downloads come with a subscription
--   finished the guide          all four steps ticked
--   hid the guide               pressed "Hide guide"
--   have a saved drawing        at least one drawing saved to the account
--   paying now                  subscription status 'active'
-- Joe's own and other billing-exempt accounts are counted like anyone else
-- if they were made since the date.
-- ============================================================================

with since as (
  select timestamptz '2000-01-01' as t            -- <- change the date here
),
accounts as (
  select u.id
  from auth.users u, since
  where u.created_at >= since.t
),
guide as (
  select s.data -> 'firstDrawing' as g
  from public.user_settings s
  join accounts a on a.id = s.user_id
  where s.data ? 'firstDrawing'
)
select
  (select count(*) from accounts)                                         as "signed up",
  (select count(*) from guide where g ? 'started')                        as "saw the first-drawing page",
  (select count(*) from guide where g -> 'steps' ? 'plan')                as "added a plan",
  (select count(*) from guide where g -> 'steps' ? 'symbol')              as "placed a symbol",
  (select count(*) from guide where g -> 'steps' ? 'quote')               as "opened the quote",
  (select count(*) from guide where g -> 'steps' ? 'download')            as "downloaded or printed",
  (select count(*) from guide where g -> 'steps' ? 'downloadLocked')      as "pressed Download (try)",
  (select count(*) from guide where g ? 'finished')                       as "finished the guide",
  (select count(*) from guide where g ? 'hidden')                         as "hid the guide",
  (select count(distinct p.user_id)
     from public.projects p join accounts a on a.id = p.user_id)          as "have a saved drawing",
  (select count(*)
     from public.subscriptions sub join accounts a on a.id = sub.user_id
     where sub.status = 'active')                                         as "paying now";
