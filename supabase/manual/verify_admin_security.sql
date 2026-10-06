-- =====================================================================================================================
-- AutoMax Admin - read-only security verification. Supabase dashboard -> SQL Editor -> Run. Changes nothing.
-- Every query must return the "expected" result written above it. If one does not, STOP and fix it before using the console.
-- =====================================================================================================================

-- 1. EXPECTED: 0 rows. No admin_* function may be executable by anon / authenticated (i.e. by any browser key).
select p.oid::regprocedure as function_callable_by_browser_keys
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'admin\_%'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

-- 2. EXPECTED: rls_enabled = true for every row, and anon_or_auth_privileges = 0.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = c.relname and g.grantee in ('anon', 'authenticated')) as anon_or_auth_privileges
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('admin_users', 'admin_audit_log', 'admin_rate_limits', 'payments_archive');

-- 3. EXPECTED: no policy at all on the admin tables (nothing grants anybody access through RLS).
select schemaname, tablename, policyname from pg_policies
 where schemaname = 'public' and tablename in ('admin_users', 'admin_audit_log', 'admin_rate_limits', 'payments_archive');

-- 4. EXPECTED: the sensitive existing tables still have RLS on (rls_enabled = true everywhere).
select c.relname, c.relrowsecurity as rls_enabled
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in ('plans', 'profiles', 'subscriptions', 'payments', 'devices', 'trial_claims', 'talent_grants', 'app_releases',
                     'blocked_email_domains', 'email_identities', 'legal_documents', 'legal_acceptances', 'registration_requests',
                     'notification_settings', 'contact_messages')
 order by 1;

-- 5. EXPECTED: the audit log refuses UPDATE, DELETE and TRUNCATE (2 triggers listed: ..._no_update covers update+delete, ..._no_truncate).
select tgname, tgenabled from pg_trigger where tgrelid = 'public.admin_audit_log'::regclass and not tgisinternal order by 1;

-- 6. EXPECTED: at least one active super_admin (and nobody you do not recognise).
select u.email, a.role, a.is_active, a.created_at from public.admin_users a join auth.users u on u.id = a.user_id order by a.created_at;

-- 7. EXPECTED: check_license contains the account_disabled guard (true). If false, run 20261006000200_account_controls.sql again
--    (re-running the old schema.sql replaces the function and removes the guard).
select position('account_disabled' in pg_get_functiondef('public.check_license(text, text)'::regprocedure)) > 0 as check_license_has_disabled_guard;

-- 8. EXPECTED: 0. No browser role can write profiles.is_disabled (only full_name is writable by customers).
select count(*) as customer_writable_sensitive_columns
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
   and privilege_type = 'UPDATE' and column_name <> 'full_name';

-- 9. EXPECTED: 0. No Auth user is deleted without its payments being kept: payments_archive holds the history. (Informational)
select count(*) as archived_payments from public.payments_archive;
