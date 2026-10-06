-- =====================================================================================================================
-- AutoMax Admin 1/5 - core: admin_users, admin_audit_log, rate limiting, authorization helpers.
--
-- Run AFTER the existing AutoMax-Server-Setup.sql (schema.sql + registration.sql). Safe to run more than once.
-- Supabase dashboard -> SQL Editor -> paste -> Run   (or: supabase db push)
--
-- Security model: every table here has RLS ON and NO policy and NO grant for anon/authenticated, so no browser key can read or
-- write it. Every public.admin_* function is executable ONLY by service_role (the Edge Function). Each function re-checks that
-- the acting user is an active admin with a sufficient role, so a bug in the Edge Function cannot grant more than the role allows.
-- Rollback: see supabase/rollback/.
-- =====================================================================================================================

do $$
begin
    if to_regclass('public.plans') is null or to_regprocedure('public.check_license(text,text)') is null
       or to_regclass('public.registration_requests') is null then
        raise exception 'The AutoMax base schema is missing. Run AutoMax-Server-Setup.sql (schema.sql + registration.sql) first.';
    end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. admin_users: who is an admin. Only the DB owner (SQL editor / migration) and service_role can write it.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.admin_users (
    user_id     uuid primary key references auth.users (id) on delete cascade,
    role        text not null default 'admin' check (role in ('super_admin', 'admin', 'support')),
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    created_by  uuid references auth.users (id) on delete set null,
    updated_at  timestamptz not null default now()
);

-- Never lock yourself out: the last active super_admin cannot be demoted, deactivated or deleted.
create or replace function public.admin_users_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.role = 'super_admin' and old.is_active
       and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.is_active)
       and not exists (select 1 from public.admin_users x where x.user_id <> old.user_id and x.role = 'super_admin' and x.is_active) then
        raise exception 'admin:last_super_admin' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' then new.updated_at := now(); return new; end if;
    return old;
end $$;

drop trigger if exists admin_users_guard_trg on public.admin_users;
create trigger admin_users_guard_trg before update or delete on public.admin_users
    for each row execute function public.admin_users_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. admin_audit_log: append-only. No foreign keys on purpose (the history must survive deleted accounts).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
    id                    uuid primary key default gen_random_uuid(),
    admin_user_id         uuid,
    admin_email           text,
    action                text not null check (action ~ '^[A-Z][A-Z0-9_]{2,47}$'),
    target_user_id        uuid,
    target_email          text,
    target_resource_type  text,
    target_resource_id    text,
    metadata              jsonb not null default '{}'::jsonb,
    ip_address            text,
    user_agent            text,
    created_at            timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_admin_idx    on public.admin_audit_log (admin_user_id, created_at desc);
create index if not exists admin_audit_log_target_idx   on public.admin_audit_log (target_user_id, created_at desc);
create index if not exists admin_audit_log_action_idx   on public.admin_audit_log (action, created_at desc);

create or replace function public.admin_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'admin_audit_log is append-only' using errcode = 'P0001';
end $$;

drop trigger if exists admin_audit_no_update on public.admin_audit_log;
create trigger admin_audit_no_update before update or delete on public.admin_audit_log
    for each row execute function public.admin_audit_immutable();
drop trigger if exists admin_audit_no_truncate on public.admin_audit_log;
create trigger admin_audit_no_truncate before truncate on public.admin_audit_log
    for each statement execute function public.admin_audit_immutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Rate limiting (server side, fixed window). The Edge Function calls admin_rate_hit(); the counters live in the database,
--    so they cannot be bypassed from the browser.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.admin_rate_limits (
    bucket        text not null,
    window_start  timestamptz not null,
    hits          integer not null default 0,
    primary key (bucket, window_start)
);
create index if not exists admin_rate_limits_window_idx on public.admin_rate_limits (window_start);

create or replace function public.admin_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    v_window timestamptz;
    v_hits   integer;
begin
    if p_bucket is null or length(p_bucket) > 200 or p_limit < 1 or p_window_seconds < 1 then
        raise exception 'admin:invalid_input' using errcode = 'P0001';
    end if;
    v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
    insert into public.admin_rate_limits as r (bucket, window_start, hits) values (p_bucket, v_window, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
    if random() < 0.02 then
        delete from public.admin_rate_limits where window_start < now() - interval '1 day';
    end if;
    return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Authorization helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_role_rank(p_role text)
returns integer language sql immutable set search_path = '' as $$
    select case p_role when 'super_admin' then 3 when 'admin' then 2 when 'support' then 1 else 0 end;
$$;

-- Raises 'admin:forbidden' unless p_admin is an ACTIVE admin whose role is at least p_min_role. Returns the role.
create or replace function public.admin_assert(p_admin uuid, p_min_role text default 'support')
returns text language plpgsql stable security definer set search_path = '' as $$
declare
    v_role   text;
    v_active boolean;
begin
    if p_admin is null then raise exception 'admin:forbidden' using errcode = '42501'; end if;
    select role, is_active into v_role, v_active from public.admin_users where user_id = p_admin;
    if not found or not v_active or public.admin_role_rank(v_role) < public.admin_role_rank(p_min_role) then
        raise exception 'admin:forbidden' using errcode = '42501';
    end if;
    return v_role;
end $$;

-- What the Edge Function asks first: is this user an admin? (null = not an admin)
create or replace function public.admin_whoami(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('user_id', a.user_id, 'role', a.role, 'is_active', a.is_active, 'email', u.email)
      from public.admin_users a join auth.users u on u.id = a.user_id
     where a.user_id = p_user;
$$;

-- Removes anything that looks like a secret from audit metadata (defence in depth: callers must not pass secrets anyway).
create or replace function public.admin_scrub(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
    k text;
    v jsonb;
    out jsonb;
begin
    if p is null then return '{}'::jsonb; end if;
    if jsonb_typeof(p) = 'object' then
        out := '{}'::jsonb;
        for k, v in select * from jsonb_each(p) loop
            if k ~* '(pass|secret|token|api_?key|credential|authorization|service_role|card|cvv)' then
                out := out || jsonb_build_object(k, '[removed]');
            else
                out := out || jsonb_build_object(k, public.admin_scrub(v));
            end if;
        end loop;
        return out;
    elsif jsonb_typeof(p) = 'array' then
        return coalesce((select jsonb_agg(public.admin_scrub(e)) from jsonb_array_elements(p) e), '[]'::jsonb);
    end if;
    return p;
end $$;

-- The one writer of the audit log. p_ctx = {"ip": "...", "user_agent": "..."} from the Edge Function.
create or replace function public.admin_audit_write(
    p_admin uuid, p_ctx jsonb, p_action text, p_target_user uuid default null, p_resource_type text default null,
    p_resource_id text default null, p_metadata jsonb default '{}'::jsonb, p_target_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
    insert into public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, target_email, target_resource_type,
                                        target_resource_id, metadata, ip_address, user_agent)
    values (p_admin, (select email from auth.users where id = p_admin), p_action, p_target_user,
            coalesce(p_target_email, (select email from auth.users where id = p_target_user)),
            left(p_resource_type, 60), left(p_resource_id, 200), public.admin_scrub(p_metadata),
            left(p_ctx ->> 'ip', 64), left(p_ctx ->> 'user_agent', 300))
    returning id into v_id;
    return v_id;
end $$;

-- Same, for the Edge Function to record an action it performed itself (Auth API calls, signed upload URLs, login/logout).
create or replace function public.admin_audit_record(
    p_admin uuid, p_ctx jsonb, p_action text, p_target_user uuid default null, p_resource_type text default null,
    p_resource_id text default null, p_metadata jsonb default '{}'::jsonb, p_target_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'support');
    return public.admin_audit_write(p_admin, p_ctx, p_action, p_target_user, p_resource_type, p_resource_id, p_metadata, p_target_email);
end $$;

-- A refused call (not an admin / role too low / MFA missing). Rate limited so it cannot flood the log.
create or replace function public.admin_audit_denied(p_user uuid, p_ctx jsonb, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if public.admin_rate_hit('denied:' || coalesce(p_user::text, coalesce(p_ctx ->> 'ip', 'unknown')), 20, 3600) then
        insert into public.admin_audit_log (admin_user_id, admin_email, action, target_resource_type, metadata, ip_address, user_agent)
        values (null, (select email from auth.users where id = p_user), 'ACCESS_DENIED', 'admin_api',
                jsonb_build_object('attempted_action', left(p_action, 60), 'reason', left(p_reason, 60), 'user_id', p_user),
                left(p_ctx ->> 'ip', 64), left(p_ctx ->> 'user_agent', 300));
    end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Row Level Security: ON, no policies, no grants. (service_role bypasses RLS; it only exists on the server.)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.admin_users       enable row level security;
alter table public.admin_audit_log   enable row level security;
alter table public.admin_rate_limits enable row level security;
revoke all on public.admin_users, public.admin_audit_log, public.admin_rate_limits from public, anon, authenticated;
grant select, insert, update on public.admin_users to service_role;
grant select, insert on public.admin_audit_log to service_role;
grant select, insert, update, delete on public.admin_rate_limits to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Function privileges: nothing named admin_* is callable by a browser key. (Repeated at the end of every admin migration.)
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
    for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'admin\_%' loop
        execute format('revoke all on function %s from public, anon, authenticated', f.sig);
        execute format('grant execute on function %s to service_role', f.sig);
    end loop;
end $$;
