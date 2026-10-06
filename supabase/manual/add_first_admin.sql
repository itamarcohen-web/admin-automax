-- =====================================================================================================================
-- AutoMax Admin - create (or restore) an admin. Supabase dashboard -> SQL Editor. Run it ONLY yourself, as the project owner.
--
-- 1. The person must already have an AutoMax/Supabase account (Authentication -> Users -> Add user, tick "Auto Confirm User",
--    or register normally and confirm the e-mail).
-- 2. Replace the e-mail below (no UUID needed - it is looked up for you) and Run.
-- 3. Sign in at https://admin.auto-max.co.il. Then enable MFA in Settings.
--
-- There is intentionally no value pre-filled: the script refuses to run until you change it.
-- To remove an admin later:  update public.admin_users set is_active = false where user_id = (select id from auth.users where email = '...');
-- =====================================================================================================================
do $$
declare
    v_email text := 'PUT-THE-ADMIN-EMAIL-HERE';   -- <- change this
    v_role  text := 'super_admin';                -- super_admin | admin | support
    v_user  uuid;
begin
    if v_email = 'PUT-THE-ADMIN-EMAIL-HERE' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'Edit v_email first.';
    end if;
    select id into v_user from auth.users where lower(email) = lower(btrim(v_email)) and email_confirmed_at is not null;
    if v_user is null then
        raise exception 'No CONFIRMED account with e-mail %. Create it first (Authentication -> Users -> Add user, "Auto Confirm User").', v_email;
    end if;
    insert into public.admin_users (user_id, role, is_active) values (v_user, v_role, true)
    on conflict (user_id) do update set role = excluded.role, is_active = true;
    insert into public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, target_email, target_resource_type, target_resource_id, metadata)
    values (null, 'sql-editor', 'ADMIN_PERMISSION_CHANGE', v_user, lower(btrim(v_email)), 'admin_user', v_user::text,
            jsonb_build_object('after', jsonb_build_object('role', v_role, 'is_active', true), 'via', 'manual SQL'));
    raise notice 'OK: % is now % (user id %).', v_email, v_role, v_user;
end $$;
