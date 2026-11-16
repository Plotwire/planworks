-- ============================================================================
-- Activation queries: SELECT only, for Joe to paste into the Supabase SQL
-- editor. Nothing here changes any data. Not run by Claude.
--
-- HOW TO RUN: the editor shows only the last result, so highlight ONE query
-- (from its "with" or "select" down to its ";") and press Run.
-- Run 0 first: it checks that everything the others rely on is there.
--
-- WHO IS LEFT OUT of every query (query 0b counts each group):
--   * any address @wattsonelectrical.co.uk   (your own)
--   * any address @plotwire.uk                (admin@, billing@ and any tests)
--   * made-up test domains: example.com / example.co.uk / example.anything,
--     and anything ending .invalid, .test or .localhost
--   * accounts listed in public.billing_test_accounts (Stripe test preview)
--   * Timesheets operative logins (made by an owner, not sign-ups; marked
--     plotwire_kind = operative in the account's app metadata)
--   * accounts with no email address
-- info@fentonselectrical.co.uk is NOT left out: it's billing-exempt but
-- looks like a real business rather than yours. Any other address of yours
-- (a personal Gmail used for testing, say) needs adding to every query.
--
-- WHAT THE WORDS MEAN:
--   sign-up    an account in auth.users that isn't left out above
--   drawing    a row in public.projects. A drawing someone deleted is gone,
--              so "never made a drawing" means "has no drawing now"
--   paying     the app's own rule, public.access_level() = 'full': a LIVE
--              Stripe subscription that's active, trialing, or past_due
--              within the 7-day grace. Stripe test-mode rows from the test
--              preview never count. Billing-exempt accounts aren't "paying"
--   days/weeks UK time (Europe/London); weeks start on Monday
--
-- QUERIES 9 AND 10 (detail), read from each drawing's saved data:
--   symbols    projects.symbol_count: the database works it out from the
--              drawing itself on every save (placed symbols on every sheet;
--              not furniture, notes or lines). The preview's own count
--              (data.preview.count) uses the same rule but is written by the
--              browser, so the database's count is used
--   lines      wire and duct lines: each sheet's "wires" list (a duct is a
--              wire saved with type "duct"), or the old single-sheet
--              drawing's top-level "wires"
--   sheets     the drawing's sheets (floors); an old single-sheet drawing is 1
--   plan       a background plan (bgImage) on at least one sheet
--   quote      "no", "yes, no prices yet" or "yes, priced" (a line with a
--              rate above 0). A quote saves itself the moment the Quote
--              screen is opened, so "yes, no prices yet" can mean only that
--   last login auth.users.last_sign_in_at: the last time they signed in with
--              their password (or a confirmation link). Staying signed in on
--              a device doesn't update it, so the last drawing edit is the
--              better sign of activity
--   last edit  projects.updated_at, or created if never saved again
--   status     "billing exempt"; "paying"; "lapsed" (a subscription that
--              ended or stopped paying); otherwise "Try mode" while billing
--              is switched on (app_flags enforce_billing), or "free (billing
--              off)" while it's off
-- ============================================================================


-- 0. Setup check: every answer should be true. If one is false, the queries that use it stop with an error (nothing changes); tell Claude which.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'projects'
             and column_name = 'created_at')                     as projects_has_created_at,   -- queries 4, 8, 9, 10
  to_regclass('public.billing_exempt') is not null              as has_billing_exempt,        -- queries 1, 2, 5
  to_regclass('public.billing_test_accounts') is not null       as has_billing_test_accounts, -- every query
  to_regprocedure('public.access_level(uuid)') is not null      as has_access_level,          -- queries 1, 2, 5, 9
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'projects'
             and column_name = 'symbol_count')                   as projects_has_symbol_count, -- queries 9 and 10
  to_regprocedure('public.billing_enforced()') is not null      as has_billing_switch;        -- query 9


-- 0b. How many accounts each "left out" rule removes, and how many are counted (counts only).
select reason, count(*) as accounts
  from (
    select case
             when u.email is null                                                      then 'Left out: no email address'
             when split_part(lower(u.email), '@', 2) = 'wattsonelectrical.co.uk'       then 'Left out: @wattsonelectrical.co.uk'
             when split_part(lower(u.email), '@', 2) = 'plotwire.uk'                   then 'Left out: @plotwire.uk'
             when split_part(lower(u.email), '@', 2)
                    ~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'               then 'Left out: made-up test domain'
             when exists (select 1 from public.billing_test_accounts t
                           where t.user_id = u.id)                                     then 'Left out: billing test account'
             when coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') = 'operative'  then 'Left out: Timesheets operative'
             else 'Counted'
           end as reason
      from auth.users u
  ) x
 group by reason
 order by reason = 'Counted', reason;


-- 1. Totals: sign-ups, with at least one drawing, with none, paying, and billing-exempt.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
drawings as (
  select d.user_id, count(*) as n
    from public.projects d
   group by d.user_id
)
select count(*)                                                                       as signups,
       count(*) filter (where d.n > 0)                                                as with_a_drawing,
       count(*) filter (where d.n is null)                                            as no_drawings,
       count(*) filter (where public.access_level(p.id) = 'full' and e.user_id is null) as paying,
       count(*) filter (where e.user_id is not null)                                  as billing_exempt
  from people p
  left join drawings d on d.user_id = p.id
  left join public.billing_exempt e on e.user_id = p.id;


-- 2. Activation by week: for each sign-up week (Monday), how many signed up, made a drawing, and pay now.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
drawers as (
  select distinct d.user_id from public.projects d
)
select date_trunc('week', p.signup_day::timestamp)::date                                         as week_starting,
       count(*)                                                                         as signed_up,
       count(*) filter (where dr.user_id is not null)                                   as made_a_drawing,
       round(100.0 * count(*) filter (where dr.user_id is not null) / count(*), 0)      as pct_made_a_drawing,
       count(*) filter (where public.access_level(p.id) = 'full' and e.user_id is null) as paying
  from people p
  left join drawers dr on dr.user_id = p.id
  left join public.billing_exempt e on e.user_id = p.id
 group by 1
 order by 1 desc;


-- 3. Drawings per user: how many users have 0, 1, 2-5 and 6+ drawings.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
drawings as (
  select d.user_id, count(*) as n
    from public.projects d
   group by d.user_id
),
banded as (
  select case
           when coalesce(d.n, 0) = 0 then '0'
           when d.n = 1              then '1'
           when d.n <= 5             then '2-5'
           else                           '6+'
         end as band
    from people p
    left join drawings d on d.user_id = p.id
)
select b.band          as drawings,
       count(x.band)   as users
  from (values (1, '0'), (2, '1'), (3, '2-5'), (4, '6+')) as b (sort, band)
  left join banded x on x.band = b.band
 group by b.sort, b.band
 order by b.sort;


-- 4. Time to first drawing: first drawing on the sign-up day, within 7 days after, later, or never.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
first_drawing as (
  select d.user_id, (min(d.created_at) at time zone 'Europe/London')::date as first_day
    from public.projects d
   group by d.user_id
),
timed as (
  select case
           when f.first_day is null              then 'Never'
           when f.first_day <= p.signup_day      then 'Same day'
           when f.first_day <= p.signup_day + 7  then 'Within 7 days'
           else                                       'Later'
         end as bucket
    from people p
    left join first_drawing f on f.user_id = p.id
)
select b.bucket        as first_drawing,
       count(x.bucket) as users
  from (values (1, 'Same day'), (2, 'Within 7 days'), (3, 'Later'), (4, 'Never')) as b (sort, bucket)
  left join timed x on x.bucket = b.bucket
 group by b.sort, b.bucket
 order by b.sort;


-- 5. Paying vs drawing: of users who made a drawing, how many pay; of users who never did, how many pay.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
drawers as (
  select distinct d.user_id from public.projects d
),
marked as (
  select (dr.user_id is not null)                                       as made_a_drawing,
         (public.access_level(p.id) = 'full' and e.user_id is null)     as pays
    from people p
    left join drawers dr on dr.user_id = p.id
    left join public.billing_exempt e on e.user_id = p.id
)
select case when made_a_drawing then 'Made a drawing' else 'Never made a drawing' end  as users,
       count(*)                                                                      as total,
       count(*) filter (where pays)                                                  as paying,
       round(100.0 * count(*) filter (where pays) / count(*), 1)                     as pct_paying
  from marked
 group by made_a_drawing
 order by made_a_drawing desc;


-- 6. Email confirmation: how many sign-ups never opened the confirmation link (all time, and in the last 30 days).
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
)
select count(*)                                                                               as signups,
       count(*) filter (where p.email_confirmed_at is not null)                               as confirmed,
       count(*) filter (where p.email_confirmed_at is null)                                   as never_confirmed,
       round(100.0 * count(*) filter (where p.email_confirmed_at is null) / nullif(count(*), 0), 1) as pct_never_confirmed,
       count(*) filter (where p.created_at > now() - interval '30 days')                      as signups_last_30_days,
       count(*) filter (where p.created_at > now() - interval '30 days'
                          and p.email_confirmed_at is null)                                   as never_confirmed_last_30_days
  from people p;


-- 7. Follow-up list: signed up in the last 30 days, confirmed their email, no drawing yet; email and sign-up date, newest first. SHOWS EMAIL ADDRESSES.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
)
select p.email,
       p.signup_day as signed_up
  from people p
 where p.created_at > now() - interval '30 days'
   and p.email_confirmed_at is not null
   and not exists (select 1 from public.projects d where d.user_id = p.id)
 order by p.created_at desc;


-- 8. Recent activity: drawings created per day (UK time) for the last 30 days, today first; days with none show 0.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
days as (
  select g::date as day
    from generate_series(((now() at time zone 'Europe/London')::date - 29)::timestamp,
                         ((now() at time zone 'Europe/London')::date)::timestamp,
                         interval '1 day') as g
),
made as (
  select (d.created_at at time zone 'Europe/London')::date as day, count(*) as n
    from public.projects d
    join people p on p.id = d.user_id
   where d.created_at >= now() - interval '31 days'
   group by 1
)
select days.day,
       coalesce(made.n, 0) as drawings_created
  from days
  left join made on made.day = days.day
 order by days.day desc;


-- 9. One row per account: email, sign-up, confirmed, last login, drawings, symbols, lines, sheets, first drawing, last edit, quote, status; most recently active first. SHOWS EMAIL ADDRESSES.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
),
facts as (
  select d.user_id,
         d.created_at,
         coalesce(d.updated_at, d.created_at)                                          as last_edited,
         coalesce(d.symbol_count, 0)                                                   as symbols,
         case when sh.list is not null then
                (select coalesce(sum(case when jsonb_typeof(s -> 'wires') = 'array'
                                          then jsonb_array_length(s -> 'wires') else 0 end), 0)
                   from jsonb_array_elements(sh.list) s)
              when jsonb_typeof(d.data -> 'wires') = 'array' then jsonb_array_length(d.data -> 'wires')
              else 0 end                                                               as lines,
         coalesce(jsonb_array_length(sh.list), 1)                                      as sheets,
         coalesce(jsonb_typeof(d.data -> 'boq') = 'object', false)                     as has_quote,
         exists (select 1
                   from jsonb_array_elements(case when jsonb_typeof(d.data -> 'boq' -> 'sections') = 'array'
                                                  then d.data -> 'boq' -> 'sections' else '[]'::jsonb end) sec
                  cross join lateral
                        jsonb_array_elements(case when jsonb_typeof(sec -> 'items') = 'array'
                                                  then sec -> 'items' else '[]'::jsonb end) it
                  where case when (it ->> 'rate') ~ '^\s*[0-9]*\.?[0-9]+\s*$'
                             then trim(it ->> 'rate')::numeric > 0 else false end)       as quote_priced
    from public.projects d
    join people p on p.id = d.user_id
   cross join lateral (
         select case when jsonb_typeof(d.data -> 'sheets') = 'array' and (d.data -> 'sheets' -> 0) is not null
                     then d.data -> 'sheets' end as list) sh
),
per_account as (
  select f.user_id,
         count(*)                as drawings,
         sum(f.symbols)          as symbols,
         sum(f.lines)            as lines,
         sum(f.sheets)           as sheets,
         min(f.created_at)       as first_drawing,
         max(f.last_edited)      as last_edit,
         bool_or(f.has_quote)    as has_quote,
         bool_or(f.quote_priced) as quote_priced
    from facts f
   group by f.user_id
)
select p.email,
       p.signup_day                                                                   as signed_up,
       case when p.email_confirmed_at is not null then 'yes' else 'no' end            as email_confirmed,
       to_char(u.last_sign_in_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI')  as last_login,
       coalesce(a.drawings, 0)                                                        as drawings,
       coalesce(a.symbols, 0)                                                         as symbols,
       coalesce(a.lines, 0)                                                           as wire_duct_lines,
       coalesce(a.sheets, 0)                                                          as sheets,
       (a.first_drawing at time zone 'Europe/London')::date                           as first_drawing,
       to_char(a.last_edit at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI')        as last_drawing_edit,
       case when a.quote_priced then 'yes, priced'
            when a.has_quote    then 'yes, no prices yet'
            else 'no' end                                                             as saved_quote,
       case when e.user_id is not null                then 'billing exempt'
            when public.access_level(p.id) = 'full'   then 'paying'
            when public.access_level(p.id) = 'lapsed' then 'lapsed'
            when public.billing_enforced()            then 'Try mode'
            else 'free (billing off)' end                                             as status
  from people p
  join auth.users u on u.id = p.id
  left join per_account a on a.user_id = p.id
  left join public.billing_exempt e on e.user_id = p.id
 order by greatest(u.last_sign_in_at, a.last_edit, p.created_at) desc nulls last;


-- 10. One row per drawing: account email, drawing name, created, last edited, symbols, lines, sheets, background plan, quote; last edited first. SHOWS EMAIL ADDRESSES AND DRAWING NAMES.
with people as (
  select u.id, u.email, u.created_at, u.email_confirmed_at,
         (u.created_at at time zone 'Europe/London')::date as signup_day
    from auth.users u
   where u.email is not null
     and split_part(lower(u.email), '@', 2) not in ('wattsonelectrical.co.uk', 'plotwire.uk')
     and split_part(lower(u.email), '@', 2) !~ '(^|\.)(example\.[a-z.]+|invalid|test|localhost)$'
     and not exists (select 1 from public.billing_test_accounts t where t.user_id = u.id)
     and coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative'
)
select p.email,
       d.name                                                                         as drawing,
       to_char(d.created_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI')       as created,
       to_char(coalesce(d.updated_at, d.created_at) at time zone 'Europe/London',
               'YYYY-MM-DD HH24:MI')                                                  as last_edited,
       coalesce(d.symbol_count, 0)                                                    as symbols,
       case when sh.list is not null then
              (select coalesce(sum(case when jsonb_typeof(s -> 'wires') = 'array'
                                        then jsonb_array_length(s -> 'wires') else 0 end), 0)
                 from jsonb_array_elements(sh.list) s)
            when jsonb_typeof(d.data -> 'wires') = 'array' then jsonb_array_length(d.data -> 'wires')
            else 0 end                                                                as wire_duct_lines,
       coalesce(jsonb_array_length(sh.list), 1)                                       as sheets,
       case when (case when sh.list is not null
                       then exists (select 1 from jsonb_array_elements(sh.list) s
                                     where jsonb_typeof(s -> 'bgImage') = 'object')
                       else jsonb_typeof(d.data -> 'bgImage') = 'object' end)
            then 'yes' else 'no' end                                                  as background_plan,
       case when exists (select 1
                           from jsonb_array_elements(case when jsonb_typeof(d.data -> 'boq' -> 'sections') = 'array'
                                                          then d.data -> 'boq' -> 'sections' else '[]'::jsonb end) sec
                          cross join lateral
                                jsonb_array_elements(case when jsonb_typeof(sec -> 'items') = 'array'
                                                          then sec -> 'items' else '[]'::jsonb end) it
                          where case when (it ->> 'rate') ~ '^\s*[0-9]*\.?[0-9]+\s*$'
                                     then trim(it ->> 'rate')::numeric > 0 else false end)
                 then 'yes, priced'
            when jsonb_typeof(d.data -> 'boq') = 'object' then 'yes, no prices yet'
            else 'no' end                                                             as quote
  from public.projects d
  join people p on p.id = d.user_id
 cross join lateral (
       select case when jsonb_typeof(d.data -> 'sheets') = 'array' and (d.data -> 'sheets' -> 0) is not null
                   then d.data -> 'sheets' end as list) sh
 order by coalesce(d.updated_at, d.created_at) desc nulls last;
