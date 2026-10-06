-- =====================================================================================================================
-- AutoMax Admin 5/5 - indexes for the admin queries. Every statement is "if not exists"; the existing base-schema indexes are
-- NOT duplicated:
--   already there: subscriptions(user_id, current_period_end desc), payments(user_id, paid_at desc), devices unique(user_id, device_id),
--                  registration_requests(created_at desc) and (email), talent_grants(email) partial (pending), profiles(id) PK,
--                  legal_acceptances(user_id, sha256) unique partial, legal_acceptances(lower(email)).
-- Run after 20261006000400_admin_reads.sql. Idempotent.
-- =====================================================================================================================

create index if not exists subscriptions_status_idx        on public.subscriptions (status);
create index if not exists subscriptions_plan_idx          on public.subscriptions (plan_id);
create index if not exists subscriptions_period_end_idx    on public.subscriptions (current_period_end);
create index if not exists subscriptions_created_idx       on public.subscriptions (created_at desc);

create index if not exists payments_status_idx             on public.payments (status);
create index if not exists payments_paid_at_idx            on public.payments (paid_at desc);

create index if not exists devices_device_id_idx           on public.devices (device_id);
create index if not exists devices_last_seen_idx           on public.devices (last_seen desc);

create index if not exists talent_grants_user_idx          on public.talent_grants (user_id);
create index if not exists talent_grants_email_all_idx     on public.talent_grants (email);
create index if not exists talent_grants_created_idx       on public.talent_grants (created_at desc);

create index if not exists registration_requests_status_idx on public.registration_requests (status, created_at desc);

create index if not exists profiles_email_lower_idx        on public.profiles (lower(email) text_pattern_ops);
create index if not exists profiles_created_idx            on public.profiles (created_at desc);
create index if not exists app_releases_version_num_idx    on public.app_releases (version_num desc);
create index if not exists admin_users_active_idx          on public.admin_users (is_active, role);

-- Substring search ("contains") on e-mail / name: trigram indexes, only when the pg_trgm extension can be enabled.
do $$
begin
    begin
        create extension if not exists pg_trgm with schema extensions;
    exception when others then
        begin
            create extension if not exists pg_trgm;
        exception when others then
            raise notice 'pg_trgm is not available (%): substring search still works, just without a trigram index.', sqlerrm;
        end;
    end;
    if exists (select 1 from pg_extension where extname = 'pg_trgm') then
        execute format('create index if not exists profiles_email_trgm_idx on public.profiles using gin (email %s.gin_trgm_ops)',
                       (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'));
        execute format('create index if not exists profiles_full_name_trgm_idx on public.profiles using gin (full_name %s.gin_trgm_ops)',
                       (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'));
    end if;
end $$;
