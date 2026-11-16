-- Login 400s: counts only, for Joe to review and run. Not run by Claude.
--
-- WHERE TO RUN: Supabase dashboard > Logs > Logs Explorer (the log search),
-- NOT the SQL editor. These read Supabase's request logs, not the database,
-- and change nothing. Untested: if a column name is refused, tell Claude the
-- error and it will adjust.
--
-- HOW FAR BACK: only as far as Supabase keeps logs. On the Free plan that's
-- about 1 day, on Pro about 7 days, so "last 30 days" will really mean
-- "everything still kept". Pick the longest range in the time picker too.
--
-- Both queries return counts only: no emails, names, IP addresses or user
-- agents come back.
--
-- Note: the password re-check before deleting a drawing uses the same sign-in
-- call, so its wrong passwords are counted here as well.


-- 1. Sign-in attempts refused with 400, by browser type.
select
  case
    when regexp_contains(h.user_agent, r'Instagram') then 'Instagram in-app'
    when regexp_contains(h.user_agent, r'MessengerForiOS|MessengerLite|Orca-Android') then 'Messenger in-app'
    when regexp_contains(h.user_agent, r'FBAN/|FBAV/|FB_IAB/|FB4A|FBIOS') then 'Facebook in-app'
    when regexp_contains(h.user_agent, r'musical_ly|BytedanceWebview|TikTok') then 'TikTok in-app'
    else 'Normal browser'
  end as browser,
  count(*) as login_400s
from edge_logs
  cross join unnest(metadata) as m
  cross join unnest(m.request) as request
  cross join unnest(m.response) as response
  cross join unnest(request.headers) as h
where request.path = '/auth/v1/token'
  and request.search like '%grant_type=password%'
  and response.status_code = 400
  and timestamp > timestamp_sub(current_timestamp(), interval 30 day)
group by browser
order by login_400s desc;


-- 2. Why sign-ins were refused, by Supabase's error code
--    (invalid_credentials = wrong password or no such account,
--     email_not_confirmed = confirmation link not opened yet,
--     captcha_failed = security check missing or refused).
--    Refresh-token codes (refresh_token_not_found etc.) are expired
--    sessions, not people typing a password; ignore those rows.
select
  regexp_extract(event_message, r'"error_code":"([a-z_]+)"') as reason,
  count(*) as refusals
from auth_logs
where regexp_contains(event_message, r'"path":"/token"')
  and regexp_contains(event_message, r'"error_code":"')
  and timestamp > timestamp_sub(current_timestamp(), interval 30 day)
group by reason
order by refusals desc;
