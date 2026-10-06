-- =====================================================================================================================
-- AutoMax Admin 4/5 - read functions for the dashboard and lists. Everything is paginated and filtered IN THE DATABASE
-- (limit <= 100, only the needed columns), so the browser never receives a whole table.
-- Run after 20261006000300_admin_actions.sql. Idempotent. Callable only by service_role (through the Edge Function).
-- =====================================================================================================================

-- escapes % _ \ so user input is matched literally by ILIKE
create or replace function public.admin_like(p text)
returns text language sql immutable set search_path = '' as $$
    select '%' || replace(replace(replace(btrim(p), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

create or replace function public.admin_list_plans(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'support');
    return coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'price_cents', price_cents, 'currency', currency,
                                                         'max_devices', max_devices, 'is_active', is_active) order by price_cents, code)
                       from public.plans), '[]'::jsonb);
end $$;

-- ---- dashboard --------------------------------------------------------------------------------------------------------
create or replace function public.admin_dashboard(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_role text;
begin
    v_role := public.admin_assert(p_admin, 'support');
    return jsonb_build_object(
        'total_users',            (select count(*) from auth.users),
        'active_users_30d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
        'active_subscriptions',   (select count(distinct s.user_id) from public.subscriptions s
                                    where s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())),
        'lifetime_users',         (select count(distinct s.user_id) from public.subscriptions s
                                    where s.is_lifetime and s.status in ('active', 'trialing')),
        'talent_users',           (select count(distinct s.user_id) from public.subscriptions s
                                    where s.provider = 'talent' and s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())),
        'registered_devices',     (select count(*) from public.devices),
        'payments_count',         (select count(*) from public.payments where status = 'paid'),
        'payments_total_cents',   (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid'),
        'pending_registrations',  (select count(*) from public.registration_requests where status = 'new'),
        'disabled_users',         (select count(*) from public.profiles where is_disabled),
        'recent_registrations',   coalesce((select jsonb_agg(to_jsonb(r)) from (
                                      select id, created_at, customer_type, first_name, last_name, business_name, email, status
                                        from public.registration_requests order by created_at desc limit 6) r), '[]'::jsonb),
        'recent_payments',        coalesce((select jsonb_agg(to_jsonb(x)) from (
                                      select p.id, p.user_id, u.email, p.amount_cents, p.currency, p.status, p.provider, p.paid_at
                                        from public.payments p left join auth.users u on u.id = p.user_id
                                       order by p.paid_at desc limit 6) x), '[]'::jsonb),
        'recent_users',           coalesce((select jsonb_agg(to_jsonb(x)) from (
                                      select u.id, u.email, pr.full_name, u.created_at from auth.users u
                                        left join public.profiles pr on pr.id = u.id order by u.created_at desc limit 6) x), '[]'::jsonb),
        'recent_admin_actions',   case when public.admin_role_rank(v_role) >= 2 then
                                      coalesce((select jsonb_agg(to_jsonb(x)) from (
                                          select id, created_at, action, admin_email, target_email from public.admin_audit_log
                                           order by created_at desc limit 6) x), '[]'::jsonb)
                                  else null end);
end $$;

-- ---- users --------------------------------------------------------------------------------------------------------------
create or replace function public.admin_list_users(
    p_admin uuid, p_search text default null, p_plan text default null, p_status text default null,
    p_sort text default 'created_at', p_dir text default 'desc', p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim    integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off    integer := greatest(coalesce(p_offset, 0), 0);
    v_search text := nullif(btrim(p_search), '');
    v_order  text;
    v_dir    text := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
    v_result jsonb;
begin
    perform public.admin_assert(p_admin, 'support');
    v_order := case p_sort when 'email' then 'f.email' when 'last_sign_in' then 'f.last_sign_in_at' when 'devices' then 'f.device_count'
                           when 'plan' then 'f.plan_code' else 'f.created_at' end;
    execute format($q$
        with base as (
            select u.id, u.email, p.full_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
                   (coalesce(p.is_disabled, false) or (u.banned_until is not null and u.banned_until > now())) as is_disabled,
                   s.status as sub_status, s.is_lifetime, s.current_period_end, s.cancel_at_period_end,
                   pl.code as plan_code, pl.name as plan_name,
                   coalesce(s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now()), false) as license_valid,
                   (select count(*) from public.devices d where d.user_id = u.id) as device_count,
                   exists (select 1 from public.admin_users a where a.user_id = u.id and a.is_active) as is_admin
              from auth.users u
              left join public.profiles p on p.id = u.id
              left join lateral (select * from public.admin_current_subscription(u.id)) s on true
              left join public.plans pl on pl.id = s.plan_id
             where ($1 is null or u.email ilike $2 or p.full_name ilike $2 or u.id::text = lower($1))
        ), f as (
            select * from base
             where ($3 is null or plan_code = $3)
               and ($4 is null or ($4 = 'none' and sub_status is null) or ($4 = 'disabled' and is_disabled)
                    or ($4 = 'valid' and license_valid) or ($4 not in ('none', 'disabled', 'valid') and sub_status = $4))
        )
        select jsonb_build_object(
            'total', (select count(*) from f),
            'rows', coalesce((select jsonb_agg(to_jsonb(t) order by t.rn) from (
                        select f.*, row_number() over (order by %s %s nulls last, f.id) as rn from f order by rn limit $5 offset $6) t), '[]'::jsonb))
    $q$, v_order, v_dir)
    into v_result
    using v_search, case when v_search is null then null else public.admin_like(v_search) end, nullif(p_plan, ''), nullif(p_status, ''), v_lim, v_off;
    return v_result;
end $$;

create or replace function public.admin_get_user(p_admin uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_acc    jsonb;
    v_email  text;
    v_role   text := public.admin_assert(p_admin, 'support');
begin
    select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                              'email_confirmed_at', u.email_confirmed_at, 'banned_until', u.banned_until), u.email
      into v_acc, v_email from auth.users u where u.id = p_user;
    if v_acc is null then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    return jsonb_build_object(
        'account', v_acc,
        'profile', (select jsonb_build_object('full_name', full_name, 'email', email, 'created_at', created_at, 'updated_at', updated_at,
                                              'is_disabled', is_disabled, 'disabled_at', disabled_at, 'disabled_reason', disabled_reason)
                      from public.profiles where id = p_user),
        'is_admin', exists (select 1 from public.admin_users where user_id = p_user and is_active),
        'subscriptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
            select s.id, pl.code as plan_code, pl.name as plan_name, pl.max_devices, s.status, s.current_period_start, s.current_period_end,
                   s.cancel_at_period_end, s.provider, s.is_lifetime, s.created_at,
                   (s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())) as is_valid
              from public.subscriptions s join public.plans pl on pl.id = s.plan_id where s.user_id = p_user) x), '[]'::jsonb),
        'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.paid_at desc) from (
            select id, amount_cents, currency, status, provider, provider_payment_id, paid_at, created_at
              from public.payments where user_id = p_user order by paid_at desc limit 50) x), '[]'::jsonb),
        'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen desc) from (
            select id, device_id, device_name, first_seen, last_seen from public.devices where user_id = p_user) x), '[]'::jsonb),
        'talent_grants', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
            select g.id, g.email, g.months, g.is_lifetime, g.note, g.created_at, g.applied_at, g.revoked_at,
                   case when g.revoked_at is not null then 'revoked' when g.applied_at is null then 'pending' else 'applied' end as status,
                   (select a.admin_email from public.admin_audit_log a where a.target_resource_type = 'talent_grant' and a.target_resource_id = g.id::text
                     order by a.created_at limit 1) as granted_by
              from public.talent_grants g where g.user_id = p_user or g.email = lower(v_email)) x), '[]'::jsonb),
        'legal_acceptances', coalesce((select jsonb_agg(to_jsonb(x) order by x.accepted_at desc) from (
            select version, sha256, context, app_version, accepted_at from public.legal_acceptances where user_id = p_user order by accepted_at desc limit 20) x), '[]'::jsonb),
        'audit', case when public.admin_role_rank(v_role) >= 2 then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
            select id, created_at, action, admin_email, metadata from public.admin_audit_log where target_user_id = p_user order by created_at desc limit 30) x), '[]'::jsonb)
            else '[]'::jsonb end,
        'registration', (select to_jsonb(r) from (select id, created_at, customer_type, status, phone_e164, city, country_code
                                                    from public.registration_requests where email = lower(v_email) order by created_at desc limit 1) r));
end $$;

-- ---- subscriptions --------------------------------------------------------------------------------------------------
create or replace function public.admin_list_subscriptions(
    p_admin uuid, p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
    v_st  text := nullif(p_status, '');
begin
    perform public.admin_assert(p_admin, 'support');
    if v_st is not null and v_st not in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'valid') then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    return (with f as (
                select s.id, s.user_id, u.email, pl.code as plan_code, pl.name as plan_name, s.status, s.current_period_start, s.current_period_end,
                       s.cancel_at_period_end, s.provider, s.is_lifetime, s.created_at,
                       (s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())) as is_valid
                  from public.subscriptions s
                  join public.plans pl on pl.id = s.plan_id
                  left join auth.users u on u.id = s.user_id
                 where (v_st is null or (v_st = 'valid' and s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())) or s.status = v_st)
                   and (v_pat is null or u.email ilike v_pat or s.user_id::text = lower(v_s))
            )
            select jsonb_build_object('total', (select count(*) from f),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by created_at desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

-- ---- payments (live + archive of deleted accounts) ----------------------------------------------------------------------
create or replace function public.admin_list_payments(
    p_admin uuid, p_status text default null, p_search text default null, p_provider text default null,
    p_archived boolean default false, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
    v_st  text := nullif(p_status, '');
begin
    perform public.admin_assert(p_admin, 'support');
    if v_st is not null and v_st not in ('paid', 'failed', 'refunded') then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    if coalesce(p_archived, false) then
        return (with f as (
                    select a.id, a.user_id, a.user_email as email, a.amount_cents, a.currency, a.status, a.provider, a.provider_payment_id, a.paid_at, a.created_at, true as archived
                      from public.payments_archive a
                     where (v_st is null or a.status = v_st) and (nullif(p_provider, '') is null or a.provider = p_provider)
                       and (v_pat is null or a.user_email ilike v_pat or a.provider_payment_id ilike v_pat)
                )
                select jsonb_build_object('total', (select count(*) from f), 'paid_total_cents', (select coalesce(sum(amount_cents), 0) from f where status = 'paid'),
                       'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by paid_at desc nulls last, id limit v_lim offset v_off) t), '[]'::jsonb)));
    end if;
    return (with f as (
                select p.id, p.user_id, u.email, p.amount_cents, p.currency, p.status, p.provider, p.provider_payment_id, p.paid_at, p.created_at, false as archived
                  from public.payments p left join auth.users u on u.id = p.user_id
                 where (v_st is null or p.status = v_st) and (nullif(p_provider, '') is null or p.provider = p_provider)
                   and (v_pat is null or u.email ilike v_pat or p.provider_payment_id ilike v_pat or p.user_id::text = lower(v_s))
            )
            select jsonb_build_object('total', (select count(*) from f), 'paid_total_cents', (select coalesce(sum(amount_cents), 0) from f where status = 'paid'),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by paid_at desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

-- ---- devices ------------------------------------------------------------------------------------------------------------
create or replace function public.admin_list_devices(
    p_admin uuid, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
begin
    perform public.admin_assert(p_admin, 'support');
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    return (with f as (
                select d.id, d.user_id, u.email, d.device_id, d.device_name, d.first_seen, d.last_seen
                  from public.devices d left join auth.users u on u.id = d.user_id
                 where v_pat is null or u.email ilike v_pat or d.device_id ilike v_pat or d.device_name ilike v_pat or d.user_id::text = lower(v_s)
            )
            select jsonb_build_object('total', (select count(*) from f),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by last_seen desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

-- ---- talent -------------------------------------------------------------------------------------------------------------
create or replace function public.admin_list_talent(
    p_admin uuid, p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
    v_st  text := nullif(p_status, '');
begin
    perform public.admin_assert(p_admin, 'support');
    if v_st is not null and v_st not in ('pending', 'applied', 'revoked') then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    return (with f as (
                select g.id, g.email, g.user_id, g.months, g.is_lifetime, g.note, g.created_at, g.applied_at, g.revoked_at,
                       case when g.revoked_at is not null then 'revoked' when g.applied_at is null then 'pending' else 'applied' end as status,
                       case when g.is_lifetime then null else s.current_period_end end as expires_at,
                       (select a.admin_email from public.admin_audit_log a where a.target_resource_type = 'talent_grant' and a.target_resource_id = g.id::text
                         order by a.created_at limit 1) as granted_by
                  from public.talent_grants g
                  left join lateral (select s2.current_period_end from public.subscriptions s2
                                      where s2.user_id = g.user_id and s2.provider = 'talent' order by s2.current_period_end desc limit 1) s on true
                 where (v_pat is null or g.email ilike v_pat or g.note ilike v_pat)
            ), g2 as (select * from f where v_st is null or status = v_st)
            select jsonb_build_object('total', (select count(*) from g2),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from g2 order by created_at desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

-- ---- registrations ------------------------------------------------------------------------------------------------------
create or replace function public.admin_list_registrations(
    p_admin uuid, p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
    v_st  text := nullif(p_status, '');
begin
    perform public.admin_assert(p_admin, 'support');
    if v_st is not null and v_st not in ('new', 'contacted', 'approved', 'rejected', 'spam') then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    return (with f as (
                select r.id, r.created_at, r.status, r.customer_type, r.first_name, r.last_name, r.business_name, r.company_number, r.email, r.phone_e164,
                       r.country_name, r.country_code, r.city, r.street, r.house_number, r.apartment, r.postal_code, r.language, r.app_version,
                       r.admin_notes, (r.notified_at is not null) as mail_sent,
                       exists (select 1 from auth.users u where lower(u.email) = r.email) as has_account
                  from public.registration_requests r
                 where (v_st is null or r.status = v_st)
                   and (v_pat is null or r.email ilike v_pat or (r.first_name || ' ' || r.last_name) ilike v_pat or r.business_name ilike v_pat or r.phone_e164 ilike v_pat)
            )
            select jsonb_build_object('total', (select count(*) from f),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by created_at desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

-- ---- releases / legal ----------------------------------------------------------------------------------------------------
create or replace function public.admin_list_releases(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'support');
    return coalesce((select jsonb_agg(to_jsonb(r) order by r.version_num desc) from (
        select id, version, version_num, download_url, sha256, size_bytes, notes, mandatory, is_published, published_at
          from public.app_releases order by version_num desc limit 100) r), '[]'::jsonb);
end $$;

create or replace function public.admin_list_legal(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'support');
    return coalesce((select jsonb_agg(to_jsonb(d) order by d.published_at desc) from (
        select ld.version, ld.sha256, ld.title, ld.published_at, ld.is_current,
               (select count(*) from public.legal_acceptances a where a.sha256 = ld.sha256) as acceptances
          from public.legal_documents ld order by ld.published_at desc limit 100) d), '[]'::jsonb);
end $$;

-- ---- audit log (admin and up) ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_audit(
    p_admin uuid, p_action text default null, p_search text default null, p_target_user uuid default null,
    p_admin_user uuid default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_off integer := greatest(coalesce(p_offset, 0), 0);
    v_s   text := nullif(btrim(p_search), '');
    v_pat text;
begin
    perform public.admin_assert(p_admin, 'admin');
    v_pat := case when v_s is null then null else public.admin_like(v_s) end;
    return (with f as (
                select id, created_at, admin_user_id, admin_email, action, target_user_id, target_email, target_resource_type,
                       target_resource_id, metadata, ip_address, user_agent
                  from public.admin_audit_log
                 where (nullif(p_action, '') is null or action = p_action)
                   and (p_target_user is null or target_user_id = p_target_user)
                   and (p_admin_user is null or admin_user_id = p_admin_user)
                   and (v_pat is null or admin_email ilike v_pat or target_email ilike v_pat or target_resource_id ilike v_pat)
            )
            select jsonb_build_object('total', (select count(*) from f),
                   'rows', coalesce((select jsonb_agg(to_jsonb(t)) from (select * from f order by created_at desc, id limit v_lim offset v_off) t), '[]'::jsonb)));
end $$;

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
