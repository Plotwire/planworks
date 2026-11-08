-- ============================================================================
-- Timesheets add-on: tables, rules and functions (Batch 1)
-- ----------------------------------------------------------------------------
-- ONLY ADDS. It creates six new tables, fifteen new functions, five triggers
-- on those new tables and the rules for those new tables. It has no DROP
-- statement, and no ALTER, INSERT, UPDATE or DELETE on anything that already
-- exists. The new tables link to auth.users, but no user row or column changes.
--
-- All or nothing: one transaction. If any step fails, nothing is applied.
-- Run it once. If Timesheets is already installed it stops and changes nothing.
-- Previews and production share this database, so it goes live when it is run.
-- It switches the add-on on for nobody.
-- ============================================================================

begin;
set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Stop before doing anything if a name is taken or something needed is missing
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_class c
               join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                                  'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes'))
     or exists (select 1 from pg_catalog.pg_proc p
                  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') then
    raise exception 'Timesheets is already installed, or one of its names is in use. Nothing was changed.';
  end if;
  if to_regclass('public.company_profile') is null then
    raise exception 'public.company_profile is missing. Nothing was changed.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Who has which add-on. Same idea as billing_exempt: no app access at all.
-- source and the Stripe column are ready for paid add-on billing later.
create table public.addon_entitlements (
  user_id    uuid not null references auth.users on delete cascade,
  addon      text not null check (addon in ('timesheets')),
  source     text not null default 'manual' check (source in ('manual', 'stripe')),
  ends_at    timestamptz,                    -- empty means no end date
  stripe_subscription_id text,               -- unused until Stripe is added
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, addon)
);

-- One row per operative. Only the server route writes here.
create table public.timesheet_operatives (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users on delete cascade,
  name           text not null check (char_length(trim(name)) between 1 and 80),
  email          text,                       -- blanked when removed
  user_id        uuid unique references auth.users on delete set null,
  status         text not null default 'invited'
                 check (status in ('invited', 'active', 'removed')),
  invited_at     timestamptz not null default now(),
  activated_at   timestamptz,
  notice_version text,
  removed_at     timestamptz,
  unique (id, owner_id),
  check (status <> 'removed' or (email is null and user_id is null)),
  check (user_id <> owner_id)
);
create unique index timesheet_operatives_email_unique
  on public.timesheet_operatives (lower(email)) where email is not null;
create index timesheet_operatives_owner on public.timesheet_operatives (owner_id);

create table public.timesheet_work_types (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index timesheet_work_types_name_unique
  on public.timesheet_work_types (owner_id, lower(trim(name)));

create table public.timesheet_jobs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users on delete cascade,
  job_number   text not null check (char_length(trim(job_number)) between 1 and 30),
  job_name     text not null check (char_length(trim(job_name)) between 1 and 120),
  site_address text check (char_length(site_address) <= 200),
  default_work_type_id uuid,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (default_work_type_id, owner_id)
    references public.timesheet_work_types (id, owner_id) deferrable initially deferred
);
create unique index timesheet_jobs_number_unique
  on public.timesheet_jobs (owner_id, lower(trim(job_number)));

create table public.timesheet_entries (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  operative_id  uuid not null,
  work_date     date not null,
  job_id        uuid,                        -- empty means Other
  job_number    text,                        -- copy, filled in by the database
  job_name      text not null,               -- copy, or 'Other'
  other_note    text check (char_length(other_note) <= 120 and other_note !~ '[\r\n]'),
  work_type_id  uuid not null,
  work_type     text not null,               -- copy, filled in by the database
  start_time    time not null,
  finish_time   time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  minutes       integer generated always as
                ((extract(epoch from finish_time - start_time) / 60)::integer - break_minutes) stored,
  description   text not null check (char_length(description) between 1 and 150
                                     and description ~ '\S'
                                     and description !~ '[\r\n]'),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_role text not null check (created_by_role in ('owner', 'operative', 'system')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_role text not null check (updated_by_role in ('owner', 'operative', 'system')),
  check (finish_time > start_time),
  check (break_minutes < extract(epoch from finish_time - start_time) / 60),
  check (extract(second from start_time) = 0 and extract(second from finish_time) = 0),
  check (job_id is not null or coalesce(other_note ~ '\S', false)),
  foreign key (operative_id, owner_id)
    references public.timesheet_operatives (id, owner_id) on delete cascade,
  foreign key (job_id, owner_id)
    references public.timesheet_jobs (id, owner_id) deferrable initially deferred,
  foreign key (work_type_id, owner_id)
    references public.timesheet_work_types (id, owner_id) deferrable initially deferred
);
create index timesheet_entries_owner_date on public.timesheet_entries (owner_id, work_date);
create index timesheet_entries_operative_date on public.timesheet_entries (operative_id, work_date);

-- One row per add, change or delete. Written only by the database.
create table public.timesheet_entry_changes (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references auth.users on delete cascade,
  entry_id        uuid not null,             -- no link, so it outlives a deleted entry
  action          text not null check (action in ('added', 'changed', 'deleted')),
  changed_at      timestamptz not null default now(),
  changed_by      uuid,
  changed_by_role text not null check (changed_by_role in ('owner', 'operative', 'system')),
  changed_by_name text not null,
  before_values   jsonb,
  after_values    jsonb
);
create index timesheet_entry_changes_entry on public.timesheet_entry_changes (entry_id, changed_at);
create index timesheet_entry_changes_owner on public.timesheet_entry_changes (owner_id, changed_at);

-- ---------------------------------------------------------------------------
-- 2. Security switched on (enabled, never forced)
-- ---------------------------------------------------------------------------
alter table public.addon_entitlements       enable row level security;
alter table public.timesheet_operatives     enable row level security;
alter table public.timesheet_work_types     enable row level security;
alter table public.timesheet_jobs           enable row level security;
alter table public.timesheet_entries        enable row level security;
alter table public.timesheet_entry_changes  enable row level security;

-- ---------------------------------------------------------------------------
-- 3. What each kind of login may attempt. The rules in section 7 narrow it.
-- ---------------------------------------------------------------------------
revoke all on table public.addon_entitlements      from anon, authenticated;
revoke all on table public.timesheet_operatives    from anon, authenticated;
revoke all on table public.timesheet_work_types    from anon, authenticated;
revoke all on table public.timesheet_jobs          from anon, authenticated;
revoke all on table public.timesheet_entries       from anon, authenticated;
revoke all on table public.timesheet_entry_changes from anon, authenticated, service_role;
revoke all on sequence public.timesheet_entry_changes_id_seq from anon, authenticated, service_role;

grant select, insert, update, delete on table public.addon_entitlements   to service_role;
grant select, insert, update, delete on table public.timesheet_operatives to service_role;
grant select, insert, update, delete on table public.timesheet_work_types to service_role;
grant select, insert, update, delete on table public.timesheet_jobs       to service_role;
grant select, insert, update, delete on table public.timesheet_entries    to service_role;

grant select                         on table public.timesheet_operatives    to authenticated;
grant select, insert, update         on table public.timesheet_work_types    to authenticated;
grant select, insert, update         on table public.timesheet_jobs          to authenticated;
grant select, insert, update, delete on table public.timesheet_entries       to authenticated;
grant select                         on table public.timesheet_entry_changes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Functions the rules use
-- ---------------------------------------------------------------------------

-- Does this account have the add-on? Internal: not callable from the app.
create function public.ts_addon_active(p_account uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.addon_entitlements e
     where e.user_id = p_account
       and e.addon = 'timesheets'
       and (e.ends_at is null or e.ends_at > now())
  );
$$;

-- Today, and Monday of this week, in UK time by the database clock.
create function public.ts_today()
returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Europe/London')::date; $$;

create function public.ts_week_start()
returns date
language sql stable set search_path = ''
as $$ select (date_trunc('week', public.ts_today()::timestamp))::date; $$;

-- The earliest date an operative may add, edit or delete. Normally Monday of
-- this week. On a Monday, last week stays open until midnight UK time.
create function public.ts_earliest_date()
returns date
language sql stable set search_path = ''
as $$
  select case when public.ts_today() = public.ts_week_start()
              then public.ts_week_start() - 7
              else public.ts_week_start()
         end;
$$;

-- Does the signed-in account have the add-on?
create function public.ts_i_have_addon()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.ts_addon_active(auth.uid()); $$;

-- The signed-in operative's record, or nothing if they aren't one.
create function public.ts_operative_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.id from public.timesheet_operatives o
   where o.user_id = auth.uid() and o.status in ('invited', 'active');
$$;

-- May the signed-in operative write this entry? Their own, set-up finished,
-- add-on on, and dated from the earliest open date to today. No future dates.
create function public.ts_may_write(p_operative uuid, p_owner uuid, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.timesheet_operatives o
     where o.id = p_operative
       and o.owner_id = p_owner
       and o.user_id = auth.uid()
       and o.status = 'active'
       and public.ts_addon_active(o.owner_id)
       and p_date between public.ts_earliest_date() and public.ts_today()
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Functions the app calls
-- ---------------------------------------------------------------------------

-- Who am I, as far as Timesheets is concerned?
create function public.timesheets_context()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  op as (
    select o.owner_id, o.name, o.status, o.notice_version
      from public.timesheet_operatives o, me
     where o.user_id = me.uid and o.status in ('invited', 'active')
  )
  select case
    when exists (select 1 from op) then (
      select jsonb_build_object(
        'role',           'operative',
        'addon',          public.ts_addon_active(op.owner_id),
        'name',           op.name,
        'company',        (select cp.company_name from public.company_profile cp
                            where cp.user_id = op.owner_id),
        'status',         op.status,
        'notice_version', op.notice_version,
        'week_start',     public.ts_week_start(),
        'earliest_date',  public.ts_earliest_date(),
        'today',          public.ts_today())
      from op)
    else (
      select jsonb_build_object(
        'role',       'owner',
        'addon',      public.ts_addon_active(me.uid),
        'week_start', public.ts_week_start(),
        'today',      public.ts_today())
      from me)
  end;
$$;

-- The form's lists for an operative: their own owner's active jobs and work
-- types, and only these fields.
create function public.timesheets_pick_lists()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with me as (
    select o.owner_id from public.timesheet_operatives o
     where o.user_id = auth.uid()
       and o.status = 'active'
       and public.ts_addon_active(o.owner_id)
  )
  select jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',                   j.id,
               'job_number',           j.job_number,
               'job_name',             j.job_name,
               'site_address',         j.site_address,
               'default_work_type_id', j.default_work_type_id) order by j.job_number)
        from public.timesheet_jobs j
        join me on me.owner_id = j.owner_id
       where j.status = 'active'), '[]'::jsonb),
    'work_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.sort_order, w.name)
        from public.timesheet_work_types w
        join me on me.owner_id = w.owner_id
       where w.active), '[]'::jsonb)
  );
$$;

-- An operative has finished set-up and seen the notice.
create function public.timesheet_activate(p_notice_version text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_notice_version is null or char_length(trim(p_notice_version)) not between 1 and 40 then
    raise exception 'TS_BAD_NOTICE_VERSION' using errcode = 'P0001';
  end if;
  update public.timesheet_operatives o
     set status = 'active',
         notice_version = p_notice_version,
         activated_at = coalesce(o.activated_at, now())
   where o.user_id = auth.uid() and o.status in ('invited', 'active');
  if not found then
    raise exception 'TS_NOT_OPERATIVE' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Automatic checks (triggers, all on the new tables)
-- ---------------------------------------------------------------------------

-- Starter work types, added once when the add-on is switched on for an account.
-- They are ordinary rows: each account can rename or archive them.
-- One login, one role: an operative's login can never hold the add-on.
create function public.ts_seed_work_types()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.timesheet_operatives o
              where o.user_id = new.user_id and o.status in ('invited', 'active')) then
    raise exception 'TS_OPERATIVE_CANNOT_HAVE_ADDON' using errcode = 'P0001';
  end if;
  if new.addon = 'timesheets' then
    insert into public.timesheet_work_types (owner_id, name, sort_order)
    values (new.user_id, 'Price work', 1),
           (new.user_id, 'Day work', 2),
           (new.user_id, 'Variation', 3),
           (new.user_id, 'Snagging/callback', 4)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger ts_seed_work_types
  after insert on public.addon_entitlements
  for each row execute function public.ts_seed_work_types();

-- One login, one role, from the other side: a login that holds the add-on can
-- never be added as an operative. An add-on past its end date still counts,
-- because that account still owns its Timesheets records.
create function public.ts_refuse_addon_holder()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is not null
     and exists (select 1 from public.addon_entitlements e
                  where e.user_id = new.user_id and e.addon = 'timesheets') then
    raise exception 'TS_ADDON_HOLDER_CANNOT_BE_OPERATIVE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger ts_refuse_addon_holder
  before insert or update of user_id on public.timesheet_operatives
  for each row execute function public.ts_refuse_addon_holder();

create function public.ts_touch_job()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger ts_touch_job
  before update on public.timesheet_jobs
  for each row execute function public.ts_touch_job();

-- Runs on every save, before the rules are checked. Whatever the app sends:
-- an operative's entry is always their own, the job and work type copies come
-- from the database, and the who-and-when stamps are set here.
create function public.ts_prepare_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  caller       uuid := auth.uid();
  my_operative public.timesheet_operatives%rowtype;
  is_operative boolean := false;
  role_name    text;
  the_job      public.timesheet_jobs%rowtype;
  the_type     public.timesheet_work_types%rowtype;
begin
  if caller is not null then
    select * into my_operative from public.timesheet_operatives o
     where o.user_id = caller and o.status in ('invited', 'active');
    is_operative := found;
  end if;
  role_name := case when caller is null then 'system'
                    when is_operative then 'operative'
                    else 'owner' end;

  if is_operative then
    new.owner_id     := my_operative.owner_id;
    new.operative_id := my_operative.id;
  elsif role_name = 'owner' and tg_op = 'INSERT' then
    new.owner_id := caller;
  end if;

  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.owner_id        := old.owner_id;
    new.created_at      := old.created_at;
    new.created_by      := old.created_by;
    new.created_by_role := old.created_by_role;
  else
    new.created_at      := now();
    new.created_by      := caller;
    new.created_by_role := role_name;
  end if;

  -- The job copies are only refreshed when the job itself is set or changed.
  if new.job_id is null then
    new.job_number := null;
    new.job_name   := 'Other';
  elsif tg_op = 'INSERT' or new.job_id is distinct from old.job_id then
    select * into the_job from public.timesheet_jobs j
     where j.id = new.job_id and j.owner_id = new.owner_id;
    if not found then
      raise exception 'TS_JOB_NOT_FOUND' using errcode = 'P0001';
    end if;
    if is_operative and the_job.status <> 'active' then
      raise exception 'TS_JOB_ARCHIVED' using errcode = 'P0001';
    end if;
    new.job_number := the_job.job_number;
    new.job_name   := the_job.job_name;
  else
    new.job_number := old.job_number;
    new.job_name   := old.job_name;
  end if;

  -- A note only belongs on an Other entry.
  if new.job_id is not null then
    new.other_note := null;
  end if;

  -- The same for the work type.
  if tg_op = 'INSERT' or new.work_type_id is distinct from old.work_type_id then
    select * into the_type from public.timesheet_work_types w
     where w.id = new.work_type_id and w.owner_id = new.owner_id;
    if not found then
      raise exception 'TS_WORK_TYPE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if is_operative and not the_type.active then
      raise exception 'TS_WORK_TYPE_ARCHIVED' using errcode = 'P0001';
    end if;
    new.work_type := the_type.name;
  else
    new.work_type := old.work_type;
  end if;

  new.updated_at      := now();
  new.updated_by      := caller;
  new.updated_by_role := role_name;
  return new;
end;
$$;
create trigger ts_prepare_entry
  before insert or update on public.timesheet_entries
  for each row execute function public.ts_prepare_entry();

-- One history row per add, change or delete, with the values before and after.
create function public.ts_log_entry_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  caller      uuid := auth.uid();
  entry_owner uuid := coalesce(new.owner_id, old.owner_id);
  who_role    text;
  who_name    text;
begin
  -- The owner's whole account is being closed: nothing left to keep a record for.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = entry_owner) then
    return null;
  end if;

  select o.name into who_name from public.timesheet_operatives o
   where o.user_id = caller and o.status in ('invited', 'active');
  if found then
    who_role := 'operative';
  elsif caller is null then
    who_role := 'system';
    who_name := 'System';
  else
    who_role := 'owner';
    who_name := 'Owner';
  end if;

  insert into public.timesheet_entry_changes
    (owner_id, entry_id, action, changed_by, changed_by_role, changed_by_name, before_values, after_values)
  values
    (entry_owner,
     coalesce(new.id, old.id),
     case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'deleted' end,
     caller, who_role, who_name,
     case when tg_op = 'INSERT' then null else to_jsonb(old) end,
     case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end;
$$;
create trigger ts_log_entry_change
  after insert or update or delete on public.timesheet_entries
  for each row execute function public.ts_log_entry_change();

-- Who may call each function.
revoke all on function public.ts_addon_active(uuid)    from public, anon, authenticated;
revoke all on function public.ts_today()               from public, anon, authenticated;
revoke all on function public.ts_week_start()          from public, anon, authenticated;
revoke all on function public.ts_earliest_date()       from public, anon, authenticated;
revoke all on function public.ts_seed_work_types()     from public, anon, authenticated;
revoke all on function public.ts_refuse_addon_holder() from public, anon, authenticated;
revoke all on function public.ts_touch_job()           from public, anon, authenticated;
revoke all on function public.ts_prepare_entry()       from public, anon, authenticated;
revoke all on function public.ts_log_entry_change()    from public, anon, authenticated;

revoke all on function public.ts_i_have_addon()                from public, anon;
revoke all on function public.ts_operative_id()                from public, anon;
revoke all on function public.ts_may_write(uuid, uuid, date)   from public, anon;
revoke all on function public.timesheets_context()             from public, anon;
revoke all on function public.timesheets_pick_lists()          from public, anon;
revoke all on function public.timesheet_activate(text)         from public, anon;

grant execute on function public.ts_i_have_addon()              to authenticated;
grant execute on function public.ts_operative_id()              to authenticated;
grant execute on function public.ts_may_write(uuid, uuid, date) to authenticated;
grant execute on function public.timesheets_context()           to authenticated;
grant execute on function public.timesheets_pick_lists()        to authenticated;
grant execute on function public.timesheet_activate(text)       to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The rules
-- ---------------------------------------------------------------------------

-- addon_entitlements: deliberately none. Supabase and the server only.

-- Team and change history: the owner reads. Nothing writes from the app.
create policy "owner reads team" on public.timesheet_operatives
  for select to authenticated using (owner_id = auth.uid());
create policy "owner reads history" on public.timesheet_entry_changes
  for select to authenticated using (owner_id = auth.uid());

-- Work types and jobs: the owner reads, adds and edits. Never deleted.
-- Operatives have no rule here: they use timesheets_pick_lists().
create policy "owner reads work types" on public.timesheet_work_types
  for select to authenticated using (owner_id = auth.uid());
create policy "owner adds work types" on public.timesheet_work_types
  for insert to authenticated
  with check (owner_id = auth.uid() and public.ts_i_have_addon());
create policy "owner edits work types" on public.timesheet_work_types
  for update to authenticated
  using (owner_id = auth.uid() and public.ts_i_have_addon())
  with check (owner_id = auth.uid() and public.ts_i_have_addon());

create policy "owner reads jobs" on public.timesheet_jobs
  for select to authenticated using (owner_id = auth.uid());
create policy "owner adds jobs" on public.timesheet_jobs
  for insert to authenticated
  with check (owner_id = auth.uid() and public.ts_i_have_addon());
create policy "owner edits jobs" on public.timesheet_jobs
  for update to authenticated
  using (owner_id = auth.uid() and public.ts_i_have_addon())
  with check (owner_id = auth.uid() and public.ts_i_have_addon());

-- Entries: the owner, any date.
create policy "owner reads entries" on public.timesheet_entries
  for select to authenticated using (owner_id = auth.uid());
create policy "owner adds entries" on public.timesheet_entries
  for insert to authenticated
  with check (owner_id = auth.uid() and public.ts_i_have_addon());
create policy "owner corrects entries" on public.timesheet_entries
  for update to authenticated
  using (owner_id = auth.uid() and public.ts_i_have_addon())
  with check (owner_id = auth.uid() and public.ts_i_have_addon());
create policy "owner deletes entries" on public.timesheet_entries
  for delete to authenticated
  using (owner_id = auth.uid() and public.ts_i_have_addon());

-- Entries: the operative, their own, and only from the earliest open date
-- (see ts_earliest_date) to today.
create policy "operative reads own" on public.timesheet_entries
  for select to authenticated using (operative_id = public.ts_operative_id());
create policy "operative adds" on public.timesheet_entries
  for insert to authenticated
  with check (public.ts_may_write(operative_id, owner_id, work_date));
create policy "operative edits" on public.timesheet_entries
  for update to authenticated
  using (public.ts_may_write(operative_id, owner_id, work_date))
  with check (public.ts_may_write(operative_id, owner_id, work_date));
create policy "operative deletes" on public.timesheet_entries
  for delete to authenticated
  using (public.ts_may_write(operative_id, owner_id, work_date));

-- ---------------------------------------------------------------------------
-- 8. Self-check: undo everything unless every safeguard is in place
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  t text;
begin
  foreach t in array array['addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                           'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes'] loop
    if not (select c.relrowsecurity and not c.relforcerowsecurity
              from pg_catalog.pg_class c where c.oid = ('public.' || t)::regclass) then
      problems := array_append(problems, format('security switch wrong on %s', t));
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete') then
      problems := array_append(problems, format('anonymous visitors have access to %s', t));
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.addon_entitlements', 'select, insert, update, delete') then
    problems := array_append(problems, 'the app can reach addon_entitlements');
  end if;
  if has_table_privilege('authenticated', 'public.timesheet_operatives', 'insert, update, delete') then
    problems := array_append(problems, 'the app can write timesheet_operatives');
  end if;
  if has_table_privilege('authenticated', 'public.timesheet_entry_changes', 'insert, update, delete') then
    problems := array_append(problems, 'the app can write the change history');
  end if;
  if has_table_privilege('authenticated', 'public.timesheet_jobs', 'delete')
     or has_table_privilege('authenticated', 'public.timesheet_work_types', 'delete') then
    problems := array_append(problems, 'the app can delete jobs or work types');
  end if;
  if has_function_privilege('authenticated', 'public.ts_addon_active(uuid)', 'execute') then
    problems := array_append(problems, 'the app can call ts_addon_active');
  end if;

  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                           'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes')) <> 16 then
    problems := array_append(problems, 'expected 16 rules');
  end if;
  if (select count(*) from pg_catalog.pg_trigger g
       where not g.tgisinternal and g.tgenabled <> 'D'
         and g.tgrelid in ('public.addon_entitlements'::regclass, 'public.timesheet_operatives'::regclass,
                           'public.timesheet_jobs'::regclass, 'public.timesheet_entries'::regclass)) <> 5 then
    problems := array_append(problems, 'expected 5 triggers');
  end if;
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') <> 15 then
    problems := array_append(problems, 'expected 15 functions');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Timesheets self-check failed: %. Nothing was applied.', array_to_string(problems, '; ');
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK. Expect one row: tables 6, rules 16, triggers 5, functions 15,
-- add_on_accounts 0.
-- ============================================================================
select
  (select count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                        'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes')) as tables,
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                        'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes')) as rules,
  (select count(*) from pg_catalog.pg_trigger g
    where not g.tgisinternal
      and g.tgrelid in ('public.addon_entitlements'::regclass, 'public.timesheet_operatives'::regclass,
                        'public.timesheet_jobs'::regclass, 'public.timesheet_entries'::regclass)) as triggers,
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') as functions,
  (select count(*) from public.addon_entitlements) as add_on_accounts;
