-- =====================================================================================================================
-- AutoMax Admin - ROLLBACK of the admin layer. Supabase dashboard -> SQL Editor. READ BEFORE RUNNING.
--
-- Removes: every public.admin_* function, admin_users, admin_rate_limits, and the added indexes.
-- KEEPS (on purpose): public.admin_audit_log and public.payments_archive (evidence / financial history), and the profiles.is_disabled
--                     columns (so nobody is silently re-enabled). Drop them yourself only if you really mean it.
-- check_license is NOT restored automatically (the old body is in AutoMax-Server-Setup.sql / schema.sql): to remove the
-- "account_disabled" guard re-run schema.sql.
-- =====================================================================================================================
do $$
declare f record;
begin
    for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'admin\_%' loop
        execute format('drop function if exists %s cascade', f.sig);
    end loop;
end $$;
drop function if exists public.admin_users_guard() cascade;
drop table if exists public.admin_rate_limits;
drop table if exists public.admin_users;

drop index if exists public.subscriptions_status_idx, public.subscriptions_plan_idx, public.subscriptions_period_end_idx, public.subscriptions_created_idx,
    public.payments_status_idx, public.payments_paid_at_idx, public.devices_device_id_idx, public.devices_last_seen_idx,
    public.talent_grants_user_idx, public.talent_grants_email_all_idx, public.talent_grants_created_idx,
    public.registration_requests_status_idx, public.profiles_email_lower_idx, public.profiles_created_idx, public.app_releases_version_num_idx,
    public.profiles_email_trgm_idx, public.profiles_full_name_trgm_idx;

-- To also remove the evidence tables (irreversible):
--   drop table public.admin_audit_log;
--   drop table public.payments_archive;
