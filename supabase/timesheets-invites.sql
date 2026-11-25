-- ============================================================================
-- Timesheets invites: invite a worker by email, resend, cancel, remove
-- ----------------------------------------------------------------------------
-- For Joe to run in the Supabase SQL editor, once, after supabase/timesheets.sql
-- and supabase/timesheets-week.sql (both live). Previews and production share
-- this database, so it goes live when it is run. The app on master keeps
-- working with it: nothing it uses is removed, renamed or changed, and nothing
-- here can be reached from the app (only from Plotwire's server).
--
-- WHAT IT CHANGES
--   1. ADDS a table, timesheet_invites: one row per invite waiting to be
--      accepted: which worker, a fingerprint of the emailed link's code (the
--      code itself is never stored), when it runs out (7 days) and when it was
--      last sent. Only the server can read or write it.
--   2. ADDS six functions, for the server only (never callable from the app):
--        timesheet_invite_create   invite someone (or send a waiting invite again)
--        timesheet_invite_resend   send a waiting invite again (new link)
--        timesheet_invite_cancel   cancel an invite that hasn't been accepted
--        timesheet_invite_lookup   what an invite link is for, without using it
--        timesheet_invite_accept   link the worker's new login to the team
--        timesheet_remove_worker   take a worker off the team (hours stay)
--      They refuse an email that already has a Plotwire customer login, your
--      own email, and someone already on a team.
--   3. ADDS a rule on timesheet_operatives: a worker row can only be linked to
--      a login marked as a worker (app_metadata plotwire_kind = operative).
--      supabase/timesheets-week-test-workers.sql already marks the login
--      before linking it, so it still works.
--
-- NOTHING IS DELETED. No existing row changes. It counts every entry, minute
-- and worker before and after, and stops (changing nothing) if any differ. It
-- also stops first if any worker is already linked to a login without the
-- marker.
--
-- All or nothing: one transaction. If any step fails, nothing is applied.
-- Run it once. If it has already been run it stops and changes nothing.
-- To undo it: supabase/timesheets-invites-undo.sql.
-- ============================================================================

begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.timesheet_weeks') is null then
    raise exception 'Run supabase/timesheets-week.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.timesheet_invites') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('timesheet_invite_create', 'timesheet_invite_resend', 'timesheet_invite_cancel',
                                     'timesheet_invite_lookup', 'timesheet_invite_accept', 'timesheet_remove_worker',
                                     'ts_require_operative_login')) then
    raise exception 'timesheets-invites.sql has already been run. Nothing was changed.';
  end if;
  if exists (select 1 from public.timesheet_operatives o
               join auth.users u on u.id = o.user_id
              where coalesce(u.raw_app_meta_data ->> 'plotwire_kind', '') <> 'operative') then
    raise exception 'A worker is linked to a login that isn''t marked as a worker. Nothing was changed.';
  end if;
end;
$$;

-- What's there now, to prove nothing is lost.
create temporary table ts_invites_before on commit drop as
  select (select count(*) from public.timesheet_entries) as entries,
         (select coalesce(sum(minutes), 0) from public.timesheet_entries) as minutes,
         (select count(*) from public.timesheet_operatives) as workers;

-- ---------------------------------------------------------------------------
-- 1. Invites waiting to be accepted
-- ---------------------------------------------------------------------------
create table public.timesheet_invites (
  operative_id uuid primary key,
  owner_id     uuid not null,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  sent_at      timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  foreign key (operative_id, owner_id)
    references public.timesheet_operatives (id, owner_id) on delete cascade
);
create index timesheet_invites_owner_sent on public.timesheet_invites (owner_id, sent_at);

alter table public.timesheet_invites enable row level security;
revoke all on table public.timesheet_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.timesheet_invites to service_role;
-- No rules (policies): the app can't see or change it at all.

-- ---------------------------------------------------------------------------
-- 2. A worker row only ever links to a worker login
-- ---------------------------------------------------------------------------
create function public.ts_require_operative_login()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is not null and not exists (
       select 1 from auth.users u
        where u.id = new.user_id
          and u.raw_app_meta_data ->> 'plotwire_kind' = 'operative') then
    raise exception 'TS_LOGIN_NOT_OPERATIVE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger ts_require_operative_login
  before insert or update of user_id on public.timesheet_operatives
  for each row execute function public.ts_require_operative_login();

-- ---------------------------------------------------------------------------
-- 3. Invite functions (server only)
-- ---------------------------------------------------------------------------

-- Invite someone to the owner's team, or send a waiting invite again.
-- p_token_hash: the SHA-256 (hex) of the code in the emailed link.
create function public.timesheet_invite_create(p_owner uuid, p_name text, p_email text, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  em         text := lower(trim(coalesce(p_email, '')));
  nm         text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  login_id   uuid;
  login_kind text;
  op         public.timesheet_operatives%rowtype;
  inv        public.timesheet_invites%rowtype;
  new_id     uuid;
begin
  if not public.ts_addon_active(p_owner) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;
  if char_length(nm) not between 1 and 80 then
    raise exception 'TS_INVITE_BAD_NAME' using errcode = 'P0001';
  end if;
  if char_length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'TS_INVITE_BAD_EMAIL' using errcode = 'P0001';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'TS_INVITE_BAD_TOKEN' using errcode = 'P0001';
  end if;

  -- Has this email got a Plotwire login already?
  select u.id, u.raw_app_meta_data ->> 'plotwire_kind' into login_id, login_kind
    from auth.users u where lower(u.email) = em
   order by u.created_at limit 1;
  if login_id = p_owner then
    raise exception 'TS_INVITE_SELF' using errcode = 'P0001';
  end if;
  if login_id is not null and coalesce(login_kind, '') <> 'operative' then
    raise exception 'TS_INVITE_CUSTOMER' using errcode = 'P0001';
  end if;

  -- Already on a team, or invited?
  select * into op from public.timesheet_operatives o
   where o.status in ('invited', 'active')
     and (lower(o.email) = em or (login_id is not null and o.user_id = login_id))
   order by o.invited_at limit 1
   for update;
  if found then
    if op.owner_id <> p_owner then
      raise exception 'TS_INVITE_OTHER_COMPANY' using errcode = 'P0001';
    end if;
    if op.status = 'active' or op.user_id is not null then
      raise exception 'TS_INVITE_ALREADY_ON_TEAM' using errcode = 'P0001';
    end if;
    -- Invited and still waiting: a fresh link, sent again.
    select * into inv from public.timesheet_invites i where i.operative_id = op.id;
    if found and inv.sent_at > now() - interval '60 seconds' then
      raise exception 'TS_INVITE_TOO_SOON' using errcode = 'P0001';
    end if;
    insert into public.timesheet_invites as i (operative_id, owner_id, token_hash, expires_at, sent_at)
    values (op.id, op.owner_id, p_token_hash, now() + interval '7 days', now())
    on conflict (operative_id) do update
       set token_hash = excluded.token_hash, expires_at = excluded.expires_at, sent_at = excluded.sent_at;
    update public.timesheet_operatives o set invited_at = now() where o.id = op.id;
    return jsonb_build_object('operative_id', op.id, 'outcome', 'resent', 'name', op.name, 'email', op.email);
  end if;

  -- A brake on runaway sending: 30 invites a day per account.
  if (select count(*) from public.timesheet_invites i
       where i.owner_id = p_owner and i.sent_at > now() - interval '1 day') >= 30 then
    raise exception 'TS_INVITE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.timesheet_operatives (owner_id, name, email, status, invited_at)
  values (p_owner, nm, em, 'invited', now())
  returning id into new_id;
  insert into public.timesheet_invites (operative_id, owner_id, token_hash, expires_at, sent_at)
  values (new_id, p_owner, p_token_hash, now() + interval '7 days', now());
  return jsonb_build_object('operative_id', new_id, 'outcome', 'invited', 'name', nm, 'email', em);
end;
$$;

-- Send a waiting invite again, with a new link (the old one stops working).
create function public.timesheet_invite_resend(p_owner uuid, p_operative uuid, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  op  public.timesheet_operatives%rowtype;
  inv public.timesheet_invites%rowtype;
begin
  if not public.ts_addon_active(p_owner) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'TS_INVITE_BAD_TOKEN' using errcode = 'P0001';
  end if;
  select * into op from public.timesheet_operatives o
   where o.id = p_operative and o.owner_id = p_owner
   for update;
  if not found or op.status <> 'invited' or op.user_id is not null then
    raise exception 'TS_INVITE_NOT_PENDING' using errcode = 'P0001';
  end if;
  select * into inv from public.timesheet_invites i where i.operative_id = op.id;
  if found and inv.sent_at > now() - interval '60 seconds' then
    raise exception 'TS_INVITE_TOO_SOON' using errcode = 'P0001';
  end if;
  insert into public.timesheet_invites as i (operative_id, owner_id, token_hash, expires_at, sent_at)
  values (op.id, op.owner_id, p_token_hash, now() + interval '7 days', now())
  on conflict (operative_id) do update
     set token_hash = excluded.token_hash, expires_at = excluded.expires_at, sent_at = excluded.sent_at;
  update public.timesheet_operatives o set invited_at = now() where o.id = op.id;
  return jsonb_build_object('operative_id', op.id, 'name', op.name, 'email', op.email);
end;
$$;

-- Cancel an invite nobody has accepted yet. The row is kept as "removed",
-- the way a removed worker is.
create function public.timesheet_invite_cancel(p_owner uuid, p_operative uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  op public.timesheet_operatives%rowtype;
begin
  select * into op from public.timesheet_operatives o
   where o.id = p_operative and o.owner_id = p_owner
   for update;
  if not found or op.status <> 'invited' then
    raise exception 'TS_INVITE_NOT_PENDING' using errcode = 'P0001';
  end if;
  if op.user_id is not null then
    raise exception 'TS_INVITE_ACCEPTED' using errcode = 'P0001';
  end if;
  delete from public.timesheet_invites i where i.operative_id = op.id;
  update public.timesheet_operatives o
     set status = 'removed', email = null, removed_at = now()
   where o.id = op.id;
  return jsonb_build_object('operative_id', op.id);
end;
$$;

-- What an invite link is for, without using it up. state: ok, expired, used,
-- invalid or off (the company's Timesheets is switched off). For the server
-- only: login says whether the email has a Plotwire login already
-- (none, worker or other) and login_id is that login.
create function public.timesheet_invite_lookup(p_token_hash text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  inv        public.timesheet_invites%rowtype;
  op         public.timesheet_operatives%rowtype;
  company    text;
  login_id   uuid;
  login_kind text;
begin
  select * into inv from public.timesheet_invites i where i.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into op from public.timesheet_operatives o where o.id = inv.operative_id;
  select cp.company_name into company from public.company_profile cp where cp.user_id = op.owner_id;
  if op.status <> 'invited' or op.user_id is not null then
    return jsonb_build_object('state', 'used', 'company', company);
  end if;
  if inv.expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'company', company);
  end if;
  if not public.ts_addon_active(op.owner_id) then
    return jsonb_build_object('state', 'off', 'company', company);
  end if;
  select u.id, u.raw_app_meta_data ->> 'plotwire_kind' into login_id, login_kind
    from auth.users u where lower(u.email) = lower(op.email)
   order by u.created_at limit 1;
  return jsonb_build_object(
    'state', 'ok', 'operative_id', op.id, 'name', op.name, 'email', op.email, 'company', company,
    'login', case when login_id is null then 'none' when login_kind = 'operative' then 'worker' else 'other' end,
    'login_id', login_id);
end;
$$;

-- Accept an invite: link the worker's login (made by the server, marked as a
-- worker, for the invited email) to the team. Used once: the invite goes.
-- The worker becomes active when they've seen the privacy notice
-- (timesheet_activate).
create function public.timesheet_invite_accept(p_token_hash text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.timesheet_invites%rowtype;
  op  public.timesheet_operatives%rowtype;
begin
  select * into inv from public.timesheet_invites i where i.token_hash = p_token_hash for update;
  if not found then
    raise exception 'TS_INVITE_INVALID' using errcode = 'P0001';
  end if;
  if inv.expires_at <= now() then
    raise exception 'TS_INVITE_EXPIRED' using errcode = 'P0001';
  end if;
  select * into op from public.timesheet_operatives o where o.id = inv.operative_id for update;
  if op.status <> 'invited' or op.user_id is not null then
    raise exception 'TS_INVITE_INVALID' using errcode = 'P0001';
  end if;
  if not public.ts_addon_active(op.owner_id) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = lower(op.email)) then
    raise exception 'TS_INVITE_WRONG_LOGIN' using errcode = 'P0001';
  end if;
  update public.timesheet_operatives o set user_id = p_user where o.id = op.id;
  delete from public.timesheet_invites i where i.operative_id = op.id;
  return jsonb_build_object('operative_id', op.id, 'owner_id', op.owner_id);
end;
$$;

-- Take a worker off the team. The server deletes their login first (so they
-- can't sign in, and the email can be invited again); this marks the row
-- removed and blanks the email. Their name and hours stay in the owner's
-- records. Safe to run again if a step failed.
create function public.timesheet_remove_worker(p_owner uuid, p_operative uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  op public.timesheet_operatives%rowtype;
begin
  select * into op from public.timesheet_operatives o
   where o.id = p_operative and o.owner_id = p_owner
   for update;
  if not found or op.status = 'removed' then
    raise exception 'TS_NOT_ON_TEAM' using errcode = 'P0001';
  end if;
  if op.user_id is not null then
    raise exception 'TS_LOGIN_STILL_THERE' using errcode = 'P0001';
  end if;
  delete from public.timesheet_invites i where i.operative_id = op.id;
  update public.timesheet_operatives o
     set status = 'removed', email = null, user_id = null, removed_at = now()
   where o.id = op.id;
  return jsonb_build_object('operative_id', op.id);
end;
$$;

-- Server only: never callable from the app.
revoke all on function public.ts_require_operative_login()                      from public, anon, authenticated;
revoke all on function public.timesheet_invite_create(uuid, text, text, text)  from public, anon, authenticated;
revoke all on function public.timesheet_invite_resend(uuid, uuid, text)        from public, anon, authenticated;
revoke all on function public.timesheet_invite_cancel(uuid, uuid)              from public, anon, authenticated;
revoke all on function public.timesheet_invite_lookup(text)                    from public, anon, authenticated;
revoke all on function public.timesheet_invite_accept(text, uuid)              from public, anon, authenticated;
revoke all on function public.timesheet_remove_worker(uuid, uuid)              from public, anon, authenticated;
grant execute on function public.timesheet_invite_create(uuid, text, text, text) to service_role;
grant execute on function public.timesheet_invite_resend(uuid, uuid, text)       to service_role;
grant execute on function public.timesheet_invite_cancel(uuid, uuid)             to service_role;
grant execute on function public.timesheet_invite_lookup(text)                   to service_role;
grant execute on function public.timesheet_invite_accept(text, uuid)             to service_role;
grant execute on function public.timesheet_remove_worker(uuid, uuid)             to service_role;

-- ---------------------------------------------------------------------------
-- 4. Self-check: undo everything unless it all came out right
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  b ts_invites_before%rowtype;
  fn text;
begin
  select * into b from ts_invites_before;
  if (select count(*) from public.timesheet_entries) <> b.entries
     or (select coalesce(sum(minutes), 0) from public.timesheet_entries) <> b.minutes then
    problems := array_append(problems, 'the entries changed');
  end if;
  if (select count(*) from public.timesheet_operatives) <> b.workers then
    problems := array_append(problems, 'the workers changed');
  end if;

  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.timesheet_invites'::regclass) then
    problems := array_append(problems, 'security switch off on timesheet_invites');
  end if;
  if has_table_privilege('anon', 'public.timesheet_invites', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.timesheet_invites', 'select, insert, update, delete') then
    problems := array_append(problems, 'the app can reach timesheet_invites');
  end if;
  foreach fn in array array['public.timesheet_invite_create(uuid, text, text, text)', 'public.timesheet_invite_resend(uuid, uuid, text)',
                            'public.timesheet_invite_cancel(uuid, uuid)', 'public.timesheet_invite_lookup(text)',
                            'public.timesheet_invite_accept(text, uuid)', 'public.timesheet_remove_worker(uuid, uuid)'] loop
    if has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('anon', fn, 'execute') then
      problems := array_append(problems, 'the app can call ' || fn);
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.timesheet_operatives'::regclass
                    and t.tgname = 'ts_require_operative_login' and not t.tgisinternal) then
    problems := array_append(problems, 'the worker-login rule is missing');
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                           'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes',
                           'timesheet_weeks', 'timesheet_invites')) <> 18 then
    problems := array_append(problems, 'expected 18 rules');
  end if;
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') <> 25 then
    problems := array_append(problems, 'expected 25 functions');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Timesheets invites self-check failed: %. Nothing was applied.', array_to_string(problems, '; ');
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK (counts only). Expect one row: invites_table 1, worker_login_rule 1,
-- rules 18, functions 25, waiting_invites 0. entries and workers are how many
-- there are: the same numbers as before you ran this.
-- ============================================================================
select
  (select count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'timesheet_invites' and c.relkind = 'r') as invites_table,
  (select count(*) from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.timesheet_operatives'::regclass and t.tgname = 'ts_require_operative_login') as worker_login_rule,
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                        'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes',
                        'timesheet_weeks', 'timesheet_invites')) as rules,
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') as functions,
  (select count(*) from public.timesheet_invites) as waiting_invites,
  (select count(*) from public.timesheet_entries) as entries,
  (select count(*) from public.timesheet_operatives) as workers;
