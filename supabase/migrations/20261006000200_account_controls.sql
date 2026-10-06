-- =====================================================================================================================
-- AutoMax Admin 2/5 - disable / enable accounts, safe account deletion, e-mail change helpers.
-- Run after 20261006000100_admin_core.sql. Idempotent.
--
-- Changes to EXISTING objects (nothing else existing is touched):
--   * public.profiles gets 4 new columns (is_disabled, disabled_at, disabled_by, disabled_reason).
--   * public.check_license() is re-declared with ONE added guard (account_disabled). The rest of the body is the original text.
--     NOTE: re-running the old schema.sql re-creates the previous body - run this file again afterwards.
-- =====================================================================================================================

-- 1. Disabled flag -----------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists is_disabled     boolean not null default false;
alter table public.profiles add column if not exists disabled_at     timestamptz;
alter table public.profiles add column if not exists disabled_by     uuid;
alter table public.profiles add column if not exists disabled_reason text;

-- Accounts that exist in auth.users but have no profile row (should not happen; harmless to repair).
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name' from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- 2. check_license: a disabled account gets no licence, whatever its subscription says (enforced on the server) ------------
create or replace function public.check_license(p_device_id text, p_device_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_uid    uuid := auth.uid();
    v_sub    record;
    v_known  boolean;
    v_count  integer;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if p_device_id is null or length(p_device_id) < 8 then
        raise exception 'invalid device id' using errcode = '22023';
    end if;

    -- AutoMax Admin: a disabled (or Auth-banned) account cannot use the software. Data is kept.
    if exists (select 1 from public.profiles where id = v_uid and is_disabled)
       or exists (select 1 from auth.users where id = v_uid and banned_until is not null and banned_until > now()) then
        return jsonb_build_object('active', false, 'reason', 'account_disabled');
    end if;

    -- The current Terms of Use / Privacy Policy must have been accepted before anything else (nothing is registered or granted before).
    if public.terms_required(v_uid) then
        return jsonb_build_object('active', false, 'reason', 'terms_required',
            'terms_version', (select version from public.legal_documents where is_current),
            'terms_sha256', (select sha256 from public.legal_documents where is_current));
    end if;

    perform public.apply_pending_talent(v_uid);   -- a free-access grant made for this e-mail before the account existed

    select s.id, s.status, s.current_period_end, s.cancel_at_period_end, s.is_lifetime,
           p.code as plan_code, p.name as plan_name, p.max_devices, p.features
      into v_sub
      from public.subscriptions s
      join public.plans p on p.id = s.plan_id
     where s.user_id = v_uid
       and s.status in ('active', 'trialing')
       and (s.is_lifetime or s.current_period_end > now())
     order by s.is_lifetime desc, s.current_period_end desc
     limit 1;

    if not found then
        return jsonb_build_object('active', false, 'reason', 'no_active_subscription',
                                  'trial_available', public.trial_available(v_uid, p_device_id));
    end if;

    select exists (select 1 from public.devices where user_id = v_uid and device_id = p_device_id) into v_known;
    select count(*) into v_count from public.devices where user_id = v_uid;

    if not v_known then
        if v_count >= v_sub.max_devices then
            return jsonb_build_object('active', false, 'reason', 'device_limit',
                                      'max_devices', v_sub.max_devices, 'devices_used', v_count);
        end if;
        insert into public.devices (user_id, device_id, device_name) values (v_uid, p_device_id, left(p_device_name, 100));
        v_count := v_count + 1;
    else
        update public.devices
           set last_seen = now(), device_name = coalesce(left(p_device_name, 100), device_name)
         where user_id = v_uid and device_id = p_device_id;
    end if;

    return jsonb_build_object(
        'active', true,
        'status', v_sub.status,
        'plan', v_sub.plan_code,
        'plan_name', v_sub.plan_name,
        'expires_at', case when v_sub.is_lifetime then null else v_sub.current_period_end end,
        'lifetime', v_sub.is_lifetime,
        'cancel_at_period_end', v_sub.cancel_at_period_end,
        'max_devices', v_sub.max_devices,
        'devices_used', v_count,
        'features', v_sub.features,
        'server_time', now()
    );
end $$;
revoke execute on function public.check_license(text, text) from public, anon;
grant  execute on function public.check_license(text, text) to authenticated;

-- 3. Disable / enable ----------------------------------------------------------------------------------------------------
create or replace function public.admin_set_user_disabled(
    p_admin uuid, p_ctx jsonb, p_user uuid, p_disabled boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_email  text;
    v_before boolean;
begin
    perform public.admin_assert(p_admin, 'admin');
    select email into v_email from auth.users where id = p_user;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    if p_user = p_admin then raise exception 'admin:cannot_target_self' using errcode = 'P0001'; end if;
    if exists (select 1 from public.admin_users where user_id = p_user and is_active) then
        raise exception 'admin:target_is_admin' using errcode = 'P0001';
    end if;

    select coalesce(is_disabled, false) into v_before from public.profiles where id = p_user;
    insert into public.profiles (id, email) values (p_user, v_email) on conflict (id) do nothing;
    update public.profiles
       set is_disabled = p_disabled,
           disabled_at = case when p_disabled then now() else null end,
           disabled_by = case when p_disabled then p_admin else null end,
           disabled_reason = case when p_disabled then left(p_reason, 300) else null end
     where id = p_user;

    perform public.admin_audit_write(p_admin, p_ctx, case when p_disabled then 'DISABLE_USER' else 'ENABLE_USER' end, p_user,
        'user', p_user::text, jsonb_build_object('before', jsonb_build_object('is_disabled', coalesce(v_before, false)),
                                                  'after', jsonb_build_object('is_disabled', p_disabled), 'reason', left(p_reason, 300)));
    return jsonb_build_object('user_id', p_user, 'is_disabled', p_disabled);
end $$;

-- 4. Profile edit ----------------------------------------------------------------------------------------------------------
create or replace function public.admin_update_profile(p_admin uuid, p_ctx jsonb, p_user uuid, p_full_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before text;
begin
    perform public.admin_assert(p_admin, 'admin');
    if not exists (select 1 from auth.users where id = p_user) then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    if p_full_name is not null and char_length(p_full_name) > 120 then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    select full_name into v_before from public.profiles where id = p_user;
    insert into public.profiles (id, email) select id, email from auth.users where id = p_user on conflict (id) do nothing;
    update public.profiles set full_name = nullif(btrim(p_full_name), '') where id = p_user;
    perform public.admin_audit_write(p_admin, p_ctx, 'UPDATE_USER', p_user, 'user', p_user::text,
        jsonb_build_object('before', jsonb_build_object('full_name', v_before), 'after', jsonb_build_object('full_name', nullif(btrim(p_full_name), ''))));
    return jsonb_build_object('user_id', p_user, 'full_name', nullif(btrim(p_full_name), ''));
end $$;

-- 5. E-mail change: the pre-check (same guard the sign-up trigger uses) and the bookkeeping after the Auth update ----------
create or replace function public.admin_check_email(p_admin uuid, p_email text, p_user uuid default null)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'admin');
    return public.email_block_reason(p_email, true, p_user);   -- null = fine | invalid | disposable | duplicate
end $$;

create or replace function public.admin_after_email_change(
    p_admin uuid, p_ctx jsonb, p_user uuid, p_old_email text, p_new_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new text;
begin
    perform public.admin_assert(p_admin, 'admin');
    select email into v_new from auth.users where id = p_user;
    if v_new is null then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    update public.profiles set email = v_new where id = p_user;
    delete from public.email_identities where user_id = p_user;
    insert into public.email_identities (normalized_email, user_id) values (public.normalize_email(v_new), p_user) on conflict do nothing;
    perform public.admin_audit_write(p_admin, p_ctx, 'CHANGE_EMAIL', p_user, 'user', p_user::text,
        jsonb_build_object('before', jsonb_build_object('email', lower(p_old_email)), 'after', jsonb_build_object('email', v_new)));
end $$;

-- 6. Safe deletion --------------------------------------------------------------------------------------------------------
-- auth.users -> payments is ON DELETE CASCADE, i.e. deleting an account would erase the financial history. The existing FK is left
-- alone; instead the payments are copied here (with an e-mail snapshot) right before the Auth user is deleted.
create table if not exists public.payments_archive (
    id                   uuid primary key,
    user_id              uuid,
    user_email           text,
    subscription_id      uuid,
    amount_cents         integer not null,
    currency             text not null,
    status               text not null,
    provider             text not null,
    provider_payment_id  text,
    paid_at              timestamptz,
    created_at           timestamptz,
    archived_at          timestamptz not null default now(),
    archived_by          uuid,
    archive_reason       text not null default 'user_deleted'
);
create index if not exists payments_archive_email_idx on public.payments_archive (lower(user_email));
create index if not exists payments_archive_user_idx  on public.payments_archive (user_id);
alter table public.payments_archive enable row level security;
revoke all on public.payments_archive from public, anon, authenticated;
grant select, insert on public.payments_archive to service_role;

create or replace function public.admin_prepare_user_deletion(p_admin uuid, p_ctx jsonb, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_email text;
    v_n     integer;
    v_subs  integer;
    v_devs  integer;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    select email into v_email from auth.users where id = p_user;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    if p_user = p_admin then raise exception 'admin:cannot_target_self' using errcode = 'P0001'; end if;
    if exists (select 1 from public.admin_users where user_id = p_user and is_active) then
        raise exception 'admin:target_is_admin' using errcode = 'P0001';
    end if;

    insert into public.payments_archive (id, user_id, user_email, subscription_id, amount_cents, currency, status, provider,
                                         provider_payment_id, paid_at, created_at, archived_by)
    select p.id, p.user_id, v_email, p.subscription_id, p.amount_cents, p.currency, p.status, p.provider,
           p.provider_payment_id, p.paid_at, p.created_at, p_admin
      from public.payments p where p.user_id = p_user
    on conflict (id) do nothing;
    select count(*) into v_n from public.payments where user_id = p_user;
    select count(*) into v_subs from public.subscriptions where user_id = p_user;
    select count(*) into v_devs from public.devices where user_id = p_user;

    perform public.admin_audit_write(p_admin, p_ctx, 'DELETE_USER', p_user, 'user', p_user::text,
        jsonb_build_object('result', 'started', 'email', v_email, 'payments_archived', v_n, 'subscriptions', v_subs, 'devices', v_devs),
        v_email);
    return jsonb_build_object('email', v_email, 'payments_archived', v_n);
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
