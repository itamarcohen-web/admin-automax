"""Runs the AutoMax base schema (schema.sql + registration.sql) and then the admin migrations on a REAL local PostgreSQL
(pip install pgserver "psycopg[binary]") with a small stand-in for the Supabase roles/auth/storage objects, and checks:
  - nobody except service_role can touch or execute anything admin
  - authorization (not admin / inactive / role too low), atomic audit rows, append-only audit log
  - the business actions (plan, extend, cancel, reactivate, devices, talent, lifetime, registrations, releases, legal)
  - disable/enable enforced inside check_license, safe delete (payments archived), pagination/search safety

    python tests/sql/test_admin_sql.py            (env AMX_BASE_SQL_DIR to point at the folder holding schema.sql)
"""
import os, pathlib, sys, tempfile, json
import pgserver, psycopg

HERE = pathlib.Path(__file__).resolve().parent
ADMIN_ROOT = HERE.parent.parent
BASE = pathlib.Path(os.environ.get('AMX_BASE_SQL_DIR') or (ADMIN_ROOT.parent / 'AutoMax Models Beta' / 'server' / 'supabase'))
if not (BASE / 'schema.sql').exists():
    print(f'SKIPPED: the base AutoMax schema was not found at {BASE}. Set AMX_BASE_SQL_DIR to the folder holding schema.sql and registration.sql.')
    sys.exit(0)
MIGS = sorted((ADMIN_ROOT / 'supabase' / 'migrations').glob('*.sql'))

d = pathlib.Path(tempfile.mkdtemp(prefix='amx_admin_pg_'))
srv = pgserver.get_server(d, cleanup_mode='stop')
conn = psycopg.connect(srv.get_uri(), autocommit=True)

passed = failed = 0
def check(name, cond, extra=''):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1
        print('FAIL:', name, extra)

def one(q, *a):
    cur = conn.execute(q, a or None)
    r = cur.fetchone()
    return r[0] if r else None

def fails(q, *a):
    """The error text when the statement raises (connection stays usable), else False."""
    try:
        conn.execute(q, a or None)
        return False
    except psycopg.Error as e:
        return str(e).split('\n')[0]

def as_role(role, uid=None):
    conn.execute('reset role')
    conn.execute(f'set role {role}')
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid) if uid else '',))

def as_owner():
    conn.execute('reset role')
    conn.execute("select set_config('request.jwt.claim.sub', '', false)")

CTX = json.dumps({'ip': '203.0.113.9', 'user_agent': 'pytest'})
def svc(q, *a):
    """run as the Edge Function does: service_role"""
    as_role('service_role')
    try:
        return one(q, *a)
    finally:
        as_owner()

def svc_fails(q, *a):
    as_role('service_role')
    try:
        return fails(q, *a)
    finally:
        as_owner()

# ---- a minimal Supabase look-alike ---------------------------------------------------------------------------------------------
conn.execute('''
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
                         email_confirmed_at timestamptz, created_at timestamptz not null default now(), last_sign_in_at timestamptz, banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
''')

conn.execute((BASE / 'schema.sql').read_text(encoding='utf-8'))
conn.execute((BASE / 'registration.sql').read_text(encoding='utf-8'))
for m in MIGS:
    conn.execute(m.read_text(encoding='utf-8'))
for m in MIGS:                       # idempotent: a second run must not fail
    conn.execute(m.read_text(encoding='utf-8'))
check('migrations run twice', True)
check('five migrations found', len(MIGS) == 5, len(MIGS))

def new_user(email, confirmed=True):
    return one('insert into auth.users (email, email_confirmed_at) values (%s, %s) returning id', email, 'now()' if confirmed else None)

DEV = lambda c: c * 40

# actors
A = new_user('owner@auto-max.co.il')    # super_admin
B = new_user('ops@auto-max.co.il')      # admin
C = new_user('help@auto-max.co.il')     # support
I = new_user('gone@auto-max.co.il')     # inactive admin
U = new_user('customer@example.com')    # normal customer
V = new_user('victim@example.com')      # another customer
conn.execute("insert into public.admin_users (user_id, role) values (%s,'super_admin'), (%s,'admin'), (%s,'support')", (A, B, C))
conn.execute("insert into public.admin_users (user_id, role, is_active) values (%s,'admin', false)", (I,))

# ---- 1. nobody but service_role can touch admin things ---------------------------------------------------------------------------
for role in ('anon', 'authenticated'):
    as_role(role, U)
    for t in ('admin_users', 'admin_audit_log', 'admin_rate_limits', 'payments_archive'):
        check(f'{role} cannot select {t}', fails(f'select * from public.{t}') is not False)
    check(f'{role} cannot insert into admin_users', fails("insert into public.admin_users (user_id) values (%s)", U) is not False)
    as_owner()
as_owner()
n_admin_fn = one("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin\\_%'")
check('admin functions exist', n_admin_fn >= 30, n_admin_fn)
leaky = [r[0] for r in conn.execute("""
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'admin\\_%'
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))""").fetchall()]
check('no admin_* function is executable by anon/authenticated', leaky == [], leaky)
check('service_role may execute admin functions', one("select has_function_privilege('service_role', 'public.admin_assert(uuid,text)', 'execute')") is True)
as_role('authenticated', U)
check('a normal user cannot call admin_dashboard', fails('select public.admin_dashboard(%s)', U) is not False)
check('a normal user cannot impersonate an admin id', fails('select public.admin_dashboard(%s)', A) is not False)
as_owner()

# ---- 2. authorization inside the functions --------------------------------------------------------------------------------------------
check('non admin refused', 'admin:forbidden' in str(svc_fails('select public.admin_dashboard(%s)', U)))
check('inactive admin refused', 'admin:forbidden' in str(svc_fails('select public.admin_dashboard(%s)', I)))
check('null admin refused', 'admin:forbidden' in str(svc_fails('select public.admin_dashboard(null)')))
check('support may read the dashboard', svc('select public.admin_dashboard(%s)', C)['total_users'] >= 6)
check('support gets no admin actions list', svc('select public.admin_dashboard(%s)', C)['recent_admin_actions'] is None)
check('admin gets the actions list', isinstance(svc('select public.admin_dashboard(%s)', B)['recent_admin_actions'], list))
check('support cannot read the audit log', 'admin:forbidden' in str(svc_fails('select public.admin_list_audit(%s)', C)))
check('support cannot change a plan', 'admin:forbidden' in str(svc_fails("select public.admin_change_plan(%s, %s::jsonb, %s, 'pro')", C, CTX, U)))
check('admin cannot publish a release (super_admin only)', 'admin:forbidden' in str(svc_fails(
    "select public.admin_publish_release(%s, %s::jsonb, '1.2.3', 'https://x.supabase.co/storage/v1/object/public/releases/a.exe', %s, 10)", B, CTX, 'a' * 64)))
check('admin cannot delete users (super_admin only)', 'admin:forbidden' in str(svc_fails('select public.admin_prepare_user_deletion(%s, %s::jsonb, %s)', B, CTX, U)))
check('admin cannot manage admins', 'admin:forbidden' in str(svc_fails('select public.admin_list_admins(%s)', B)))
check('whoami: admin', svc('select public.admin_whoami(%s)', A)['role'] == 'super_admin')
check('whoami: normal user is null', svc('select public.admin_whoami(%s)', U) is None)

# ---- 3. subscriptions ----------------------------------------------------------------------------------------------------------------
check('change plan without subscription refused', 'admin:no_subscription' in str(svc_fails("select public.admin_change_plan(%s, %s::jsonb, %s, 'pro')", B, CTX, U)))
r = svc("select public.admin_extend_subscription(%s, %s::jsonb, %s, 'basic', 2, 'sale by phone')", B, CTX, U)
check('extend creates a subscription', r['subscription_id'] is not None)
check('extend wrote an audit row with ip', one("select count(*) from public.admin_audit_log where action='EXTEND_SUBSCRIPTION' and target_user_id=%s and ip_address='203.0.113.9' and admin_user_id=%s", U, B) == 1)
check('extend needs a plan when none exists', 'admin:plan_required' in str(svc_fails("select public.admin_extend_subscription(%s, %s::jsonb, %s, null, 1)", B, CTX, V)))
check('extend months validated', 'admin:invalid_input' in str(svc_fails("select public.admin_extend_subscription(%s, %s::jsonb, %s, 'basic', 99)", B, CTX, U)))
check('unknown plan refused', 'admin:unknown_plan' in str(svc_fails("select public.admin_change_plan(%s, %s::jsonb, %s, 'nope')", B, CTX, U)))
r = svc("select public.admin_change_plan(%s, %s::jsonb, %s, 'pro')", B, CTX, U)
check('change plan ok', r['plan'] == 'pro')
a = one("select metadata from public.admin_audit_log where action='CHANGE_PLAN' and target_user_id=%s", U)
check('change plan audit has before/after', a['before']['plan'] == 'basic' and a['after']['plan'] == 'pro', a)
as_role('authenticated', U)
r = one('select public.check_license(%s, %s)', DEV('a'), 'PC1')
check('licence active after admin extend (existing check_license logic)', r['active'] is True and r['plan'] == 'pro', r)
as_owner()
r = svc("select public.admin_cancel_subscription(%s, %s::jsonb, %s, false)", B, CTX, U)
check('cancel at period end', one('select cancel_at_period_end from public.subscriptions where user_id=%s', U) is True)
r = svc("select public.admin_reactivate_subscription(%s, %s::jsonb, %s)", B, CTX, U)
check('reactivate clears the flag', one('select cancel_at_period_end from public.subscriptions where user_id=%s', U) is False)
svc("select public.admin_cancel_subscription(%s, %s::jsonb, %s, true)", B, CTX, U)
check('immediate cancel', one('select status from public.subscriptions where user_id=%s', U) == 'canceled')
as_role('authenticated', U)
check('canceled licence inactive', one('select (public.check_license(%s, %s))->>%s', DEV('a'), 'PC1', 'active') == 'false')
as_owner()
check('reactivate after period end refused', 'admin:period_ended' in str(svc_fails("select public.admin_reactivate_subscription(%s, %s::jsonb, %s)", B, CTX, U)))
svc("select public.admin_extend_subscription(%s, %s::jsonb, %s, 'pro', 1)", B, CTX, U)
check('extend after cancel revives it (existing apply_payment logic)', one('select status from public.subscriptions where user_id=%s', U) == 'active')
check('nothing to cancel on a user without subscription', 'admin:nothing_to_cancel' in str(svc_fails("select public.admin_cancel_subscription(%s, %s::jsonb, %s, false)", B, CTX, V)))

# ---- 3b. grant lifetime by user id (the user-page button) -----------------------------------------------------------------------------
Z = new_user('forever@example.com')
r = svc("select public.admin_grant_lifetime(%s, %s::jsonb, %s, 'founder')", B, CTX, Z)
check('grant lifetime by user id applies', r['status'] == 'applied', r)
check('lifetime row is lifetime', one('select is_lifetime from public.subscriptions where user_id=%s', Z) is True)
check('GRANT_LIFETIME audited for that user', one("select count(*) from public.admin_audit_log where action='GRANT_LIFETIME' and target_user_id=%s", Z) == 1)
check('support cannot grant lifetime', 'admin:forbidden' in str(svc_fails("select public.admin_grant_lifetime(%s, %s::jsonb, %s)", C, CTX, Z)))
check('grant lifetime: unknown user', 'admin:not_found' in str(svc_fails("select public.admin_grant_lifetime(%s, %s::jsonb, gen_random_uuid())", B, CTX)))

# ---- 4. lifetime / talent --------------------------------------------------------------------------------------------------------------
r = svc("select public.admin_grant_talent(%s, %s::jsonb, 'artist@example.com', 3, false, 'friend')", B, CTX)
check('talent for an unknown e-mail is pending', r['status'] == 'pending', r)
check('talent audit row has the grant id', one("select count(*) from public.admin_audit_log a join public.talent_grants g on g.id::text=a.target_resource_id where a.action='GRANT_TALENT'") == 1)
check('invalid talent e-mail refused', 'admin:invalid_email' in str(svc_fails("select public.admin_grant_talent(%s, %s::jsonb, 'nope', 3)", B, CTX)))
check('months + lifetime refused', 'admin:invalid_input' in str(svc_fails("select public.admin_grant_talent(%s, %s::jsonb, 'a@example.com', 3, true)", B, CTX)))
r = svc("select public.admin_grant_talent(%s, %s::jsonb, 'victim@example.com', null, true, 'partner')", B, CTX)
check('lifetime applies to a registered account', r['status'] == 'applied', r)
check('GRANT_LIFETIME audited', one("select count(*) from public.admin_audit_log where action='GRANT_LIFETIME' and target_user_id=%s", V) == 1)
as_role('authenticated', V)
r = one('select public.check_license(%s, %s)', DEV('b'), 'PC1')
check('lifetime user is licensed with no expiry', r['active'] and r['lifetime'] and r['expires_at'] is None, r)
as_owner()
check('extending a lifetime account refused', 'admin:lifetime_account' in str(svc_fails("select public.admin_extend_subscription(%s, %s::jsonb, %s, 'basic', 1)", B, CTX, V)))
check('non-immediate cancel of lifetime refused', 'admin:lifetime_account' in str(svc_fails("select public.admin_cancel_subscription(%s, %s::jsonb, %s, false)", B, CTX, V)))
svc("select public.admin_revoke_talent(%s, %s::jsonb, 'victim@example.com')", B, CTX)
as_role('authenticated', V)
check('revoked talent loses the licence', one('select (public.check_license(%s, %s))->>%s', DEV('b'), 'PC1', 'active') == 'false')
as_owner()
check('REVOKE_TALENT audited', one("select count(*) from public.admin_audit_log where action='REVOKE_TALENT'") == 1)
check('revoke of nothing refused', 'admin:not_found' in str(svc_fails("select public.admin_revoke_talent(%s, %s::jsonb, 'nobody@example.com')", B, CTX)))
t = svc("select public.admin_list_talent(%s, null, null, 50, 0)", B)
check('talent list has granted_by', any(x.get('granted_by') == 'ops@auto-max.co.il' for x in t['rows']), t)

# ---- 5. devices ------------------------------------------------------------------------------------------------------------------------
svc("select public.admin_extend_subscription(%s, %s::jsonb, %s, 'pro', 1)", B, CTX, V)
as_role('authenticated', V)
one('select public.check_license(%s, %s)', DEV('c'), 'Victim-PC')
as_owner()
check('device exists', one('select count(*) from public.devices where device_id=%s and user_id=%s', DEV('c'), V) == 1)
check('remove device: wrong owner refused', 'admin:not_found' in str(svc_fails("select public.admin_remove_device(%s, %s::jsonb, %s, %s)", C, CTX, U, DEV('c'))))
check('remove device: bad id refused', 'admin:invalid_input' in str(svc_fails("select public.admin_remove_device(%s, %s::jsonb, %s, 'x')", C, CTX, V)))
svc("select public.admin_remove_device(%s, %s::jsonb, %s, %s)", C, CTX, V, DEV('c'))
check('support removed the device', one('select count(*) from public.devices where device_id=%s and user_id=%s', DEV('c'), V) == 0)
check('REMOVE_DEVICE audited', one("select count(*) from public.admin_audit_log where action='REMOVE_DEVICE' and admin_user_id=%s", C) == 1)

# ---- 6. registrations ------------------------------------------------------------------------------------------------------------------
as_role('anon')
r = one("select public.submit_registration(%s::jsonb)", json.dumps({'customer_type': 'private', 'email': 'lead@example.com', 'first_name': 'Dana', 'last_name': 'Levi',
        'phone_country_code': '972', 'phone_national': '501234567', 'country_code': 'IL', 'city': 'Haifa', 'street': 'Herzl', 'house_number': '1'}))
as_owner()
check('registration submitted', r['ok'] is True, r)
reg = one("select id from public.registration_requests where email='lead@example.com'")
check('new registration counted as pending', svc('select public.admin_dashboard(%s)', B)['pending_registrations'] == 1)
check('bad status refused', 'admin:invalid_input' in str(svc_fails("select public.admin_set_registration_status(%s, %s::jsonb, %s, 'pending')", C, CTX, reg)))
svc("select public.admin_set_registration_status(%s, %s::jsonb, %s, 'approved', 'called')", C, CTX, reg)
check('registration approved', one('select status from public.registration_requests where id=%s', reg) == 'approved')
check('registration audit has before/after', one("select metadata->'after'->>'status' from public.admin_audit_log where action='CHANGE_REGISTRATION_STATUS'") == 'approved')

# ---- 7. releases + legal -----------------------------------------------------------------------------------------------------------------
URL = 'https://abcdefghij.supabase.co/storage/v1/object/public/releases/AutoMax-Setup-9.9.9.exe'
check('bad version refused', 'admin:invalid_version' in str(svc_fails("select public.admin_publish_release(%s, %s::jsonb, 'v1', %s, %s, 10)", A, CTX, URL, 'a' * 64)))
check('foreign download url refused', 'admin:invalid_download_url' in str(svc_fails("select public.admin_publish_release(%s, %s::jsonb, '9.9.9', 'https://evil.example/x.exe', %s, 10)", A, CTX, 'a' * 64)))
svc("select public.admin_publish_release(%s, %s::jsonb, '9.9.9', %s, %s, 12345, 'notes', true)", A, CTX, URL, 'A' * 64)
check('release published (existing publish_release)', one("select is_published and mandatory and sha256=%s from public.app_releases where version='9.9.9'", 'a' * 64) is True)
as_role('anon')
check('check_update sees it', one("select (public.check_update('0.1.0'))->>'latest_version'") == '9.9.9')
as_owner()
svc("select public.admin_unpublish_release(%s, %s::jsonb, '9.9.9')", A, CTX)
as_role('anon')
check('unpublished release is gone for clients', one("select (public.check_update('0.1.0'))->>'update_available'") == 'false')
as_owner()
check('unpublish unknown refused', 'admin:not_found' in str(svc_fails("select public.admin_unpublish_release(%s, %s::jsonb, '0.0.1')", A, CTX)))

check('legal: bad sha refused', 'admin:invalid_input' in str(svc_fails("select public.admin_publish_legal(%s, %s::jsonb, '1.0', 'zz')", A, CTX)))
svc("select public.admin_publish_legal(%s, %s::jsonb, '1.0', %s, 'Terms')", A, CTX, 'c' * 64)
check('legal published', one('select is_current from public.legal_documents where sha256=%s', 'c' * 64) is True)
as_role('authenticated', U)
check('terms now required (existing logic)', one('select (public.check_license(%s, %s))->>%s', DEV('a'), 'PC1', 'reason') == 'terms_required')
as_owner()
svc("select public.admin_unpublish_legal(%s, %s::jsonb, %s)", A, CTX, 'c' * 64)
check('legal row is kept after unpublish', one('select count(*) from public.legal_documents where sha256=%s', 'c' * 64) == 1)
check('legal: no longer current', one('select is_current from public.legal_documents where sha256=%s', 'c' * 64) is False)
check('legal list works', len(svc('select public.admin_list_legal(%s)', B)) == 1)

# ---- 8. disable / enable (enforced on the server inside check_license) ------------------------------------------------------------------------
check('cannot disable yourself', 'admin:cannot_target_self' in str(svc_fails("select public.admin_set_user_disabled(%s, %s::jsonb, %s, true, 'x')", B, CTX, B)))
check('cannot disable an admin', 'admin:target_is_admin' in str(svc_fails("select public.admin_set_user_disabled(%s, %s::jsonb, %s, true, 'x')", B, CTX, C)))
check('support cannot disable', 'admin:forbidden' in str(svc_fails("select public.admin_set_user_disabled(%s, %s::jsonb, %s, true, 'x')", C, CTX, U)))
as_role('authenticated', U)
check('before: licensed', one('select (public.check_license(%s, %s))->>%s', DEV('a'), 'PC1', 'active') == 'true')
as_owner()
svc("select public.admin_set_user_disabled(%s, %s::jsonb, %s, true, 'chargeback')", B, CTX, U)
as_role('authenticated', U)
r = one('select public.check_license(%s, %s)', DEV('a'), 'PC1')
check('disabled account gets account_disabled', r['active'] is False and r['reason'] == 'account_disabled', r)
as_owner()
check('data kept while disabled', one('select count(*) from public.subscriptions where user_id=%s', U) == 1)
check('DISABLE_USER audited with reason', one("select metadata->>'reason' from public.admin_audit_log where action='DISABLE_USER' and target_user_id=%s", U) == 'chargeback')
conn.execute("update public.profiles set is_disabled=false where id=%s", (U,))
conn.execute("update auth.users set banned_until = now() + interval '1 day' where id=%s", (U,))
as_role('authenticated', U)
check('Auth ban alone also blocks check_license', one('select (public.check_license(%s, %s))->>%s', DEV('a'), 'PC1', 'reason') == 'account_disabled')
as_owner()
conn.execute("update auth.users set banned_until = null where id=%s", (U,))
svc("select public.admin_set_user_disabled(%s, %s::jsonb, %s, false)", B, CTX, U)
as_role('authenticated', U)
check('enabled again: licensed', one('select (public.check_license(%s, %s))->>%s', DEV('a'), 'PC1', 'active') == 'true')
as_owner()
as_role('authenticated', U)
check('a customer cannot un-disable himself via profiles', fails('update public.profiles set is_disabled=false where id=%s', U) is not False)
as_owner()

# ---- 9. profile + e-mail change ---------------------------------------------------------------------------------------------------------
svc("select public.admin_update_profile(%s, %s::jsonb, %s, %s)", B, CTX, U, 'דנה כהן')
check('profile updated (hebrew ok)', one('select full_name from public.profiles where id=%s', U) == 'דנה כהן')
check('email guard: duplicate seen', svc("select public.admin_check_email(%s, 'victim@example.com', %s)", B, U) == 'duplicate')
check('email guard: disposable seen', svc("select public.admin_check_email(%s, 'x@mailinator.com', %s)", B, U) == 'disposable')
check('email guard: own address is fine', svc("select public.admin_check_email(%s, 'customer@example.com', %s)", B, U) is None)
conn.execute("update auth.users set email='renamed@example.com' where id=%s", (U,))
svc("select public.admin_after_email_change(%s, %s::jsonb, %s, 'customer@example.com', 'renamed@example.com')", B, CTX, U)
check('profile email follows', one('select email from public.profiles where id=%s', U) == 'renamed@example.com')
check('email identity follows', one('select count(*) from public.email_identities where user_id=%s and normalized_email=%s', U, 'renamed@example.com') == 1)

# ---- 10. lists: pagination, search safety, sort allowlist ------------------------------------------------------------------------------------
r = svc("select public.admin_list_users(%s, null, null, null, 'created_at', 'desc', 2, 0)", B)
check('users: limit honoured, total counted', len(r['rows']) == 2 and r['total'] >= 6, r['total'])
r = svc("select public.admin_list_users(%s, null, null, null, 'created_at', 'desc', 100000, 0)", B)
check('users: limit clamped to 100', len(r['rows']) <= 100)
r = svc("select public.admin_list_users(%s, '%%', null, null)", B)
check('search "%" is literal, matches nobody', r['total'] == 0, r['total'])
r = svc("select public.admin_list_users(%s, 'RENAMED@', null, null)", B)
check('search is case-insensitive substring', r['total'] == 1 and r['rows'][0]['email'] == 'renamed@example.com')
r = svc("select public.admin_list_users(%s, %s, null, null)", B, str(V))
check('search by user id', r['total'] == 1)
r = svc("select public.admin_list_users(%s, null, null, null, %s, 'desc; drop table public.plans', 5, 0)", B, 'email; drop table public.plans;--')
check('sort/dir injection is inert', r['total'] >= 6 and one("select count(*) from public.plans") >= 3)
r = svc("select public.admin_list_users(%s, null, 'pro', 'valid')", B)
check('plan + status filters', r['total'] >= 1 and all(x['plan_code'] == 'pro' and x['license_valid'] for x in r['rows']))
r = svc("select public.admin_list_users(%s, null, null, 'none')", B)
check('status none = users without subscription', all(x['sub_status'] is None for x in r['rows']))
check('bad subscription status refused', 'admin:invalid_input' in str(svc_fails("select public.admin_list_subscriptions(%s, 'bogus')", B)))
check('subscriptions list', svc("select public.admin_list_subscriptions(%s, 'active', null, 10, 0)", B)['total'] >= 1)
check('payments list + paid total', svc("select public.admin_list_payments(%s, 'paid', null, null, false, 10, 0)", B)['total'] >= 0)
check('devices list', 'rows' in svc("select public.admin_list_devices(%s, null, 10, 0)", B))
check('registrations list', svc("select public.admin_list_registrations(%s, 'approved', null, 10, 0)", B)['total'] == 1)
check('releases list', len(svc('select public.admin_list_releases(%s)', B)) == 1)
u = svc("select public.admin_get_user(%s, %s)", B, V)
check('get user has all sections', all(k in u for k in ('account', 'profile', 'subscriptions', 'payments', 'devices', 'talent_grants', 'legal_acceptances', 'audit')))
check('get user never exposes password hashes', 'encrypted_password' not in json.dumps(u))
check('get user: support sees no audit', svc("select public.admin_get_user(%s, %s)", C, V)['audit'] == [])
check('get user: unknown id', 'admin:not_found' in str(svc_fails("select public.admin_get_user(%s, gen_random_uuid())", B)))
check('plans list', len(svc('select public.admin_list_plans(%s)', C))>=3)

# ---- 11. audit log is append-only and scrubbed ------------------------------------------------------------------------------------------------
check('audit log: update refused', fails("update public.admin_audit_log set action='X_Y_Z'") is not False)
check('audit log: delete refused', fails("delete from public.admin_audit_log") is not False)
check('audit log: truncate refused', fails("truncate public.admin_audit_log") is not False)
as_role('service_role')
check('audit log: delete refused even for service_role', fails("delete from public.admin_audit_log") is not False)
as_owner()
svc("select public.admin_audit_record(%s, %s::jsonb, 'CREATE_USER', %s, 'user', %s, %s::jsonb)", B, CTX, V, str(V),
    json.dumps({'email': 'x@y.z', 'password': 'hunter2hunter2', 'nested': {'api_key': 'k', 'ok': 1}, 'token': 't'}))
m = one("select metadata from public.admin_audit_log where action='CREATE_USER' order by created_at desc limit 1")
check('passwords/tokens/keys are scrubbed from audit metadata', m['password'] == '[removed]' and m['token'] == '[removed]' and m['nested']['api_key'] == '[removed]' and m['nested']['ok'] == 1, m)
check('audit_record needs an admin', 'admin:forbidden' in str(svc_fails("select public.admin_audit_record(%s, %s::jsonb, 'LOGIN')", U, CTX)))
check('bad audit action name refused', fails("insert into public.admin_audit_log (action) values ('drop table')") is not False)
svc("select public.admin_audit_denied(%s, %s::jsonb, 'DELETE_USER', 'not_admin')", U, CTX)
check('denied attempt recorded', one("select count(*) from public.admin_audit_log where action='ACCESS_DENIED' and (metadata->>'user_id')=%s", str(U)) == 1)
for _ in range(30):
    svc("select public.admin_audit_denied(%s, %s::jsonb, 'DELETE_USER', 'not_admin')", U, CTX)
check('denied log is rate limited', one("select count(*) from public.admin_audit_log where action='ACCESS_DENIED' and (metadata->>'user_id')=%s", str(U)) <= 20)
check('audit list filters by action', svc("select public.admin_list_audit(%s, 'CHANGE_PLAN')", B)['total'] == 1)
check('audit list search by e-mail', svc("select public.admin_list_audit(%s, null, 'ops@')", B)['total'] >= 5)

# ---- 12. rate limiter ------------------------------------------------------------------------------------------------------------------------
res = [svc("select public.admin_rate_hit('t:1', 3, 60)") for _ in range(5)]
check('rate limit: 3 allowed then blocked', res == [True, True, True, False, False], res)
check('rate limit: buckets are independent', svc("select public.admin_rate_hit('t:2', 3, 60)") is True)

# ---- 13. admin management --------------------------------------------------------------------------------------------------------------------
check('add admin: unknown e-mail', 'admin:user_not_found' in str(svc_fails("select public.admin_add_admin(%s, %s::jsonb, 'nobody@example.com', 'admin')", A, CTX)))
check('add admin: bad role', 'admin:invalid_input' in str(svc_fails("select public.admin_add_admin(%s, %s::jsonb, 'victim@example.com', 'root')", A, CTX)))
svc("select public.admin_add_admin(%s, %s::jsonb, 'victim@example.com', 'support')", A, CTX)
check('admin added', one('select role from public.admin_users where user_id=%s', V) == 'support')
check('ADMIN_PERMISSION_CHANGE audited', one("select count(*) from public.admin_audit_log where action='ADMIN_PERMISSION_CHANGE' and target_user_id=%s", V) == 1)
check('cannot change own role', 'admin:cannot_target_self' in str(svc_fails("select public.admin_set_admin(%s, %s::jsonb, %s, 'admin', true)", A, CTX, A)))
svc("select public.admin_set_admin(%s, %s::jsonb, %s, 'support', false)", A, CTX, V)
check('deactivated admin refused', 'admin:forbidden' in str(svc_fails('select public.admin_dashboard(%s)', V)))
check('last super_admin cannot be demoted', 'admin:last_super_admin' in str(fails("update public.admin_users set role='admin' where user_id=%s", A)))
check('last super_admin cannot be deleted', 'admin:last_super_admin' in str(fails("delete from public.admin_users where user_id=%s", A)))
check('...nor deleted through the auth user cascade', 'admin:last_super_admin' in str(fails("delete from auth.users where id=%s", A)))
check('admins list', len(svc('select public.admin_list_admins(%s)', A)) >= 4)

# ---- 14. safe delete: payments archived before the cascade ---------------------------------------------------------------------------------
W = new_user('deleteme@example.com')
conn.execute("select public.apply_payment(%s, 'basic', 4900, 'ILS', 'stripe', 'pay_w1', 1)", (W,))
conn.execute("select public.apply_payment(%s, 'basic', 4900, 'ILS', 'stripe', 'pay_w2', 1)", (W,))
as_role('authenticated', W)
one("select public.accept_terms('1.0', %s, null, null, 'login', null)", 'c' * 64)   # legal doc is no longer current -> 'stale', no row; fine
as_owner()
conn.execute("insert into public.legal_acceptances (user_id, email, version, sha256) values (%s, 'deleteme@example.com', '1.0', %s)", (W, 'd' * 64))
check('cannot delete yourself', 'admin:cannot_target_self' in str(svc_fails('select public.admin_prepare_user_deletion(%s, %s::jsonb, %s)', A, CTX, A)))
check('cannot delete an active admin', 'admin:target_is_admin' in str(svc_fails('select public.admin_prepare_user_deletion(%s, %s::jsonb, %s)', A, CTX, B)))
r = svc('select public.admin_prepare_user_deletion(%s, %s::jsonb, %s)', A, CTX, W)
check('two payments archived', r['payments_archived'] == 2, r)
check('DELETE_USER started audited', one("select count(*) from public.admin_audit_log where action='DELETE_USER' and target_user_id=%s", W) == 1)
svc('select public.admin_prepare_user_deletion(%s, %s::jsonb, %s)', A, CTX, W)
check('prepare is idempotent (no duplicate archive rows)', one('select count(*) from public.payments_archive where user_id=%s', W) == 2)
conn.execute('delete from auth.users where id=%s', (W,))           # what auth.admin.deleteUser does
check('live payments cascaded away', one('select count(*) from public.payments where user_id=%s', W) == 0)
check('payment history SURVIVES in the archive', one('select count(*) from public.payments_archive where user_email=%s', 'deleteme@example.com') == 2)
check('legal acceptance proof survives', one("select count(*) from public.legal_acceptances where email='deleteme@example.com'") == 1)
check('archived payments are listed for admins', svc("select public.admin_list_payments(%s, null, null, null, true, 10, 0)", B)['total'] == 2)
check('audit survives the deletion', one("select count(*) from public.admin_audit_log where target_user_id=%s", W) >= 1)

# ---- 15. base-schema regression (what the desktop app relies on) ------------------------------------------------------------------------------
X = new_user('regress@example.com')
conn.execute("select public.apply_payment(%s, 'basic', 4900, 'ILS', 'stripe', 'pay_x1', 1)", (X,))
as_role('authenticated', X)
r = one('select public.check_license(%s, %s)', DEV('e'), 'PC')
check('regression: paid licence active', r['active'] is True and r['plan'] == 'basic' and r['max_devices'] == 1, r)
r = one('select public.check_license(%s, %s)', DEV('f'), 'PC2')
check('regression: device limit', r['active'] is False and r['reason'] == 'device_limit', r)
check('regression: user still reads own subscription only', one('select count(*) from public.subscriptions') == 1)
check('regression: user reads only his own payments', one('select count(*) from public.payments') == 1)
check('regression: user reads only his own devices', one('select count(*) from public.devices') == 1)
check('regression: user reads only his own profile', one('select count(*) from public.profiles') == 1)
for t in ('talent_grants', 'registration_requests', 'legal_acceptances', 'trial_claims', 'notification_settings', 'email_identities', 'admin_talents', 'admin_registrations'):
    check(f'regression: customer cannot read {t}', fails(f'select * from public.{t}') is not False)
check('regression: customer cannot read other customers by id', one('select count(*) from public.subscriptions where user_id <> auth.uid()') == 0)
check('regression: customer cannot write subscriptions', fails("update public.subscriptions set status='active'") is not False)
check('regression: customer cannot write payments', fails("insert into public.payments (user_id, amount_cents) values (auth.uid(), 1)") is not False)
check('regression: customer cannot make himself an admin', fails("insert into public.admin_users (user_id, role) values (auth.uid(), 'super_admin')") is not False)
as_owner()

# ---- 16. the production verification script (supabase/manual/verify_admin_security.sql) gives the expected answers ----------------------------
vtext = (ADMIN_ROOT / 'supabase' / 'manual' / 'verify_admin_security.sql').read_text(encoding='utf-8')
vtext = chr(10).join(l for l in vtext.splitlines() if not l.strip().startswith('--'))
stmts = [x.strip() for x in vtext.split(';') if x.strip()]
check('verification script has 9 queries', len(stmts) == 9, len(stmts))
res = [conn.execute(q).fetchall() for q in stmts]
check('verify 1: no browser-callable admin function', res[0] == [], res[0])
check('verify 2: admin tables RLS on, no anon/authenticated privileges', len(res[1]) == 4 and all(r[1] is True and r[2] == 0 for r in res[1]), res[1])
check('verify 3: no policy on admin tables', res[2] == [], res[2])
check('verify 4: sensitive tables have RLS', len(res[3]) >= 13 and all(r[1] is True for r in res[3]), [r for r in res[3] if r[1] is not True])
check('verify 5: audit log has its 2 triggers', len(res[4]) == 2, res[4])
check('verify 6: super_admin listed', any(r[1] == 'super_admin' and r[2] for r in res[5]))
check('verify 7: check_license has the disabled guard', res[6][0][0] is True)
check('verify 8: customers cannot write profile columns other than full_name', res[7][0][0] == 0, res[7])

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
