-- =====================================================================================================================
-- AutoMax Admin 3/5 - the write actions. Each one: (1) re-checks the acting admin and role, (2) validates, (3) calls the EXISTING
-- business function where one exists (apply_payment, grant_talent, revoke_talent, publish_release, unpublish_release,
-- publish_legal_document, set_registration_status), (4) writes the audit row in the same transaction.
-- Run after 20261006000200_account_controls.sql. Idempotent. Errors are 'admin:<code>' so the Edge Function can map them.
-- =====================================================================================================================

-- The subscription a customer "has": same preference order as check_license (a valid one first, then lifetime, then latest end).
create or replace function public.admin_current_subscription(p_user uuid)
returns public.subscriptions language sql stable security definer set search_path = '' as $$
    select s.* from public.subscriptions s
     where s.user_id = p_user
     order by (s.status in ('active', 'trialing') and (s.is_lifetime or s.current_period_end > now())) desc,
              s.is_lifetime desc, s.current_period_end desc
     limit 1;
$$;

-- ---- subscriptions --------------------------------------------------------------------------------------------------
create or replace function public.admin_change_plan(p_admin uuid, p_ctx jsonb, p_user uuid, p_plan_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_sub  public.subscriptions;
    v_plan public.plans;
    v_old  text;
    v_devs integer;
begin
    perform public.admin_assert(p_admin, 'admin');
    if not exists (select 1 from auth.users where id = p_user) then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    select * into v_plan from public.plans where code = p_plan_code and is_active;
    if not found then raise exception 'admin:unknown_plan' using errcode = 'P0001'; end if;
    v_sub := public.admin_current_subscription(p_user);
    if v_sub.id is null then raise exception 'admin:no_subscription' using errcode = 'P0001'; end if;
    select code into v_old from public.plans where id = v_sub.plan_id;
    update public.subscriptions set plan_id = v_plan.id where id = v_sub.id;
    select count(*) into v_devs from public.devices where user_id = p_user;
    perform public.admin_audit_write(p_admin, p_ctx, 'CHANGE_PLAN', p_user, 'subscription', v_sub.id::text,
        jsonb_build_object('before', jsonb_build_object('plan', v_old), 'after', jsonb_build_object('plan', v_plan.code)));
    return jsonb_build_object('subscription_id', v_sub.id, 'plan', v_plan.code, 'devices_over_limit', v_devs > v_plan.max_devices);
end $$;

create or replace function public.admin_extend_subscription(
    p_admin uuid, p_ctx jsonb, p_user uuid, p_plan_code text, p_months integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_sub    public.subscriptions;
    v_code   text := p_plan_code;
    v_before timestamptz;
    v_after  timestamptz;
    v_id     uuid;
begin
    perform public.admin_assert(p_admin, 'admin');
    if not exists (select 1 from auth.users where id = p_user) then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    if p_months is null or p_months < 1 or p_months > 36 then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    v_sub := public.admin_current_subscription(p_user);
    if v_code is null then
        if v_sub.id is null then raise exception 'admin:plan_required' using errcode = 'P0001'; end if;
        select code into v_code from public.plans where id = v_sub.plan_id;
    end if;
    if not exists (select 1 from public.plans where code = v_code and is_active) then raise exception 'admin:unknown_plan' using errcode = 'P0001'; end if;
    if v_sub.id is not null and v_sub.is_lifetime then raise exception 'admin:lifetime_account' using errcode = 'P0001'; end if;
    v_before := v_sub.current_period_end;

    -- existing logic: adds the months after the current period, never loses days (records a 0-amount 'manual' payment row, like grant_by_email)
    v_id := public.apply_payment(p_user, v_code, 0, 'ILS', 'manual', null, p_months);

    select current_period_end into v_after from public.subscriptions where id = v_id;
    perform public.admin_audit_write(p_admin, p_ctx, 'EXTEND_SUBSCRIPTION', p_user, 'subscription', v_id::text,
        jsonb_build_object('before', jsonb_build_object('period_end', v_before), 'after', jsonb_build_object('period_end', v_after),
                           'plan', v_code, 'months', p_months, 'note', left(p_note, 300)));
    return jsonb_build_object('subscription_id', v_id, 'current_period_end', v_after);
end $$;

create or replace function public.admin_cancel_subscription(p_admin uuid, p_ctx jsonb, p_user uuid, p_immediate boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sub public.subscriptions;
begin
    perform public.admin_assert(p_admin, 'admin');
    v_sub := public.admin_current_subscription(p_user);
    if v_sub.id is null or v_sub.status not in ('active', 'trialing', 'past_due') then
        raise exception 'admin:nothing_to_cancel' using errcode = 'P0001';
    end if;
    if p_immediate then
        update public.subscriptions
           set status = 'canceled', cancel_at_period_end = false, is_lifetime = false,
               current_period_end = least(current_period_end, now())
         where id = v_sub.id;
    else
        if v_sub.is_lifetime then raise exception 'admin:lifetime_account' using errcode = 'P0001'; end if;
        update public.subscriptions set cancel_at_period_end = true where id = v_sub.id;
    end if;
    perform public.admin_audit_write(p_admin, p_ctx, 'CANCEL_SUBSCRIPTION', p_user, 'subscription', v_sub.id::text,
        jsonb_build_object('immediate', coalesce(p_immediate, false),
                           'before', jsonb_build_object('status', v_sub.status, 'period_end', v_sub.current_period_end,
                                                        'cancel_at_period_end', v_sub.cancel_at_period_end, 'lifetime', v_sub.is_lifetime)));
    return jsonb_build_object('subscription_id', v_sub.id, 'immediate', coalesce(p_immediate, false));
end $$;

create or replace function public.admin_reactivate_subscription(p_admin uuid, p_ctx jsonb, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sub public.subscriptions;
begin
    perform public.admin_assert(p_admin, 'admin');
    v_sub := public.admin_current_subscription(p_user);
    if v_sub.id is null then raise exception 'admin:no_subscription' using errcode = 'P0001'; end if;
    if v_sub.status in ('active', 'trialing') and v_sub.cancel_at_period_end then
        update public.subscriptions set cancel_at_period_end = false where id = v_sub.id;
    elsif v_sub.status in ('canceled', 'expired', 'past_due') and (v_sub.is_lifetime or v_sub.current_period_end > now()) then
        update public.subscriptions set status = 'active', cancel_at_period_end = false where id = v_sub.id;
    else
        raise exception 'admin:period_ended' using errcode = 'P0001';   -- nothing left to reactivate: use Extend
    end if;
    perform public.admin_audit_write(p_admin, p_ctx, 'REACTIVATE_SUBSCRIPTION', p_user, 'subscription', v_sub.id::text,
        jsonb_build_object('before', jsonb_build_object('status', v_sub.status, 'cancel_at_period_end', v_sub.cancel_at_period_end),
                           'after', jsonb_build_object('status', 'active', 'cancel_at_period_end', false)));
    return jsonb_build_object('subscription_id', v_sub.id);
end $$;

-- ---- devices --------------------------------------------------------------------------------------------------------
-- The existing remove_device() acts on auth.uid() (the signed-in customer), so an admin needs this explicit, validated variant.
create or replace function public.admin_remove_device(p_admin uuid, p_ctx jsonb, p_user uuid, p_device_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_dev public.devices;
begin
    perform public.admin_assert(p_admin, 'support');
    if p_device_id is null or length(p_device_id) not between 8 and 128 then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    delete from public.devices where user_id = p_user and device_id = p_device_id returning * into v_dev;
    if v_dev.id is null then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    perform public.admin_audit_write(p_admin, p_ctx, 'REMOVE_DEVICE', p_user, 'device', v_dev.id::text,
        jsonb_build_object('device_id', v_dev.device_id, 'device_name', v_dev.device_name, 'last_seen', v_dev.last_seen));
    return jsonb_build_object('removed', true);
end $$;

-- ---- talent ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_grant_talent(
    p_admin uuid, p_ctx jsonb, p_email text, p_months integer default null, p_lifetime boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_email text := lower(btrim(p_email));
    v_res   jsonb;
    v_user  uuid;
begin
    perform public.admin_assert(p_admin, 'admin');
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'admin:invalid_email' using errcode = 'P0001'; end if;
    if coalesce(p_lifetime, false) then
        if p_months is not null then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    elsif p_months is null or p_months < 1 or p_months > 120 then
        raise exception 'admin:invalid_input' using errcode = 'P0001';
    end if;
    v_res := public.grant_talent(v_email, case when coalesce(p_lifetime, false) then null else p_months end, coalesce(p_lifetime, false), left(p_note, 300));
    select id into v_user from auth.users where lower(email) = v_email;
    perform public.admin_audit_write(p_admin, p_ctx, case when coalesce(p_lifetime, false) then 'GRANT_LIFETIME' else 'GRANT_TALENT' end,
        v_user, 'talent_grant', v_res ->> 'grant_id',
        jsonb_build_object('email', v_email, 'months', p_months, 'lifetime', coalesce(p_lifetime, false), 'status', v_res ->> 'status', 'note', left(p_note, 300)),
        v_email);
    return v_res;
end $$;

-- "Grant Lifetime" from the user page: the lifetime grant of the existing Talent mechanism, addressed by user id.
create or replace function public.admin_grant_lifetime(p_admin uuid, p_ctx jsonb, p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
    perform public.admin_assert(p_admin, 'admin');
    select email into v_email from auth.users where id = p_user;
    if v_email is null then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    return public.admin_grant_talent(p_admin, p_ctx, v_email, null, true, p_note);
end $$;

create or replace function public.admin_revoke_talent(p_admin uuid, p_ctx jsonb, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_email text := lower(btrim(p_email));
    v_n     integer;
    v_user  uuid;
begin
    perform public.admin_assert(p_admin, 'admin');
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'admin:invalid_email' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.talent_grants where email = v_email and revoked_at is null) then
        raise exception 'admin:not_found' using errcode = 'P0001';
    end if;
    v_n := public.revoke_talent(v_email);
    select id into v_user from auth.users where lower(email) = v_email;
    perform public.admin_audit_write(p_admin, p_ctx, 'REVOKE_TALENT', v_user, 'talent_grant', v_email,
        jsonb_build_object('email', v_email, 'subscriptions_canceled', v_n), v_email);
    return jsonb_build_object('subscriptions_canceled', v_n);
end $$;

-- ---- registrations --------------------------------------------------------------------------------------------------
create or replace function public.admin_set_registration_status(p_admin uuid, p_ctx jsonb, p_id uuid, p_status text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.registration_requests;
begin
    perform public.admin_assert(p_admin, 'support');
    if p_status is null or p_status not in ('new', 'contacted', 'approved', 'rejected', 'spam') then
        raise exception 'admin:invalid_input' using errcode = 'P0001';
    end if;
    select * into r from public.registration_requests where id = p_id;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    perform public.set_registration_status(p_id, p_status, left(p_notes, 1000));
    perform public.admin_audit_write(p_admin, p_ctx, 'CHANGE_REGISTRATION_STATUS',
        (select id from auth.users where lower(email) = r.email), 'registration', p_id::text,
        jsonb_build_object('before', jsonb_build_object('status', r.status), 'after', jsonb_build_object('status', p_status), 'notes_changed', p_notes is not null),
        r.email);
    return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- ---- releases (super_admin: this ships code to every customer's computer) -------------------------------------------------
create or replace function public.admin_publish_release(
    p_admin uuid, p_ctx jsonb, p_version text, p_download_url text, p_sha256 text, p_size_bytes bigint,
    p_notes text default null, p_mandatory boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_id      uuid;
    v_existed boolean;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    if p_version is null or p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' then raise exception 'admin:invalid_version' using errcode = 'P0001'; end if;
    if p_download_url is null or p_download_url !~ '^https://[a-z0-9.-]+\.supabase\.co/storage/v1/object/public/releases/[A-Za-z0-9._-]+$' then
        raise exception 'admin:invalid_download_url' using errcode = 'P0001';
    end if;
    if p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$' or p_size_bytes is null or p_size_bytes < 1 then
        raise exception 'admin:invalid_input' using errcode = 'P0001';
    end if;
    select exists (select 1 from public.app_releases where version = p_version) into v_existed;
    v_id := public.publish_release(p_version, p_download_url, lower(p_sha256), p_size_bytes, left(p_notes, 4000), coalesce(p_mandatory, false));
    perform public.admin_audit_write(p_admin, p_ctx, 'PUBLISH_RELEASE', null, 'release', p_version,
        jsonb_build_object('version', p_version, 'sha256', lower(p_sha256), 'size_bytes', p_size_bytes, 'mandatory', coalesce(p_mandatory, false),
                           'republished', v_existed));
    return jsonb_build_object('id', v_id, 'version', p_version);
end $$;

create or replace function public.admin_unpublish_release(p_admin uuid, p_ctx jsonb, p_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rel public.app_releases;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    select * into v_rel from public.app_releases where version = p_version;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    perform public.unpublish_release(p_version);
    perform public.admin_audit_write(p_admin, p_ctx, 'UNPUBLISH_RELEASE', null, 'release', p_version,
        jsonb_build_object('version', p_version, 'was_published', v_rel.is_published, 'mandatory', v_rel.mandatory));
    return jsonb_build_object('version', p_version);
end $$;

-- ---- legal documents (super_admin) ------------------------------------------------------------------------------------
create or replace function public.admin_publish_legal(p_admin uuid, p_ctx jsonb, p_version text, p_sha256 text, p_title text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prev text;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    if p_version is null or btrim(p_version) = '' or length(p_version) > 20 or p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$' then
        raise exception 'admin:invalid_input' using errcode = 'P0001';
    end if;
    select sha256 into v_prev from public.legal_documents where is_current;
    perform public.publish_legal_document(btrim(p_version), lower(p_sha256), left(p_title, 200));
    perform public.admin_audit_write(p_admin, p_ctx, 'PUBLISH_LEGAL', null, 'legal_document', lower(p_sha256),
        jsonb_build_object('version', btrim(p_version), 'title', left(p_title, 200), 'previous_current_sha256', v_prev));
    return jsonb_build_object('sha256', lower(p_sha256), 'version', btrim(p_version));
end $$;

-- Un-publishing the CURRENT text means nobody is asked to accept terms any more (terms_required() becomes false). The UI makes
-- this a typed confirmation. The document row and every acceptance stay forever.
create or replace function public.admin_unpublish_legal(p_admin uuid, p_ctx jsonb, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.legal_documents;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    select * into v_doc from public.legal_documents where sha256 = lower(p_sha256) and is_current;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    update public.legal_documents set is_current = false where sha256 = v_doc.sha256;
    perform public.admin_audit_write(p_admin, p_ctx, 'UNPUBLISH_LEGAL', null, 'legal_document', v_doc.sha256,
        jsonb_build_object('version', v_doc.version, 'title', v_doc.title));
    return jsonb_build_object('sha256', v_doc.sha256);
end $$;

-- ---- admin management (super_admin) ----------------------------------------------------------------------------------------
create or replace function public.admin_list_admins(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform public.admin_assert(p_admin, 'super_admin');
    return coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'role', a.role, 'is_active', a.is_active,
                                                         'created_at', a.created_at, 'last_sign_in_at', u.last_sign_in_at) order by a.created_at)
                       from public.admin_users a join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

create or replace function public.admin_add_admin(p_admin uuid, p_ctx jsonb, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_user   uuid;
    v_email  text := lower(btrim(p_email));
    v_before public.admin_users;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    if p_role is null or p_role not in ('super_admin', 'admin', 'support') then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null;
    if v_user is null then raise exception 'admin:user_not_found' using errcode = 'P0001'; end if;
    if v_user = p_admin then raise exception 'admin:cannot_target_self' using errcode = 'P0001'; end if;
    select * into v_before from public.admin_users where user_id = v_user;
    insert into public.admin_users (user_id, role, is_active, created_by) values (v_user, p_role, true, p_admin)
    on conflict (user_id) do update set role = excluded.role, is_active = true;
    perform public.admin_audit_write(p_admin, p_ctx, 'ADMIN_PERMISSION_CHANGE', v_user, 'admin_user', v_user::text,
        jsonb_build_object('before', case when v_before.user_id is null then null else jsonb_build_object('role', v_before.role, 'is_active', v_before.is_active) end,
                           'after', jsonb_build_object('role', p_role, 'is_active', true)), v_email);
    return jsonb_build_object('user_id', v_user, 'role', p_role);
end $$;

create or replace function public.admin_set_admin(p_admin uuid, p_ctx jsonb, p_user uuid, p_role text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before public.admin_users;
begin
    perform public.admin_assert(p_admin, 'super_admin');
    if p_user = p_admin then raise exception 'admin:cannot_target_self' using errcode = 'P0001'; end if;
    if p_role is null or p_role not in ('super_admin', 'admin', 'support') or p_active is null then raise exception 'admin:invalid_input' using errcode = 'P0001'; end if;
    select * into v_before from public.admin_users where user_id = p_user;
    if not found then raise exception 'admin:not_found' using errcode = 'P0001'; end if;
    update public.admin_users set role = p_role, is_active = p_active where user_id = p_user;   -- trigger keeps >= 1 active super_admin
    perform public.admin_audit_write(p_admin, p_ctx, 'ADMIN_PERMISSION_CHANGE', p_user, 'admin_user', p_user::text,
        jsonb_build_object('before', jsonb_build_object('role', v_before.role, 'is_active', v_before.is_active),
                           'after', jsonb_build_object('role', p_role, 'is_active', p_active)));
    return jsonb_build_object('user_id', p_user, 'role', p_role, 'is_active', p_active);
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
