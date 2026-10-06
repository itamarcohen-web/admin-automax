# AutoMax Admin – Architecture

Admin console for `https://admin.auto-max.co.il`. It is **only an admin layer** on top of the existing AutoMax Supabase project
(`server/supabase/schema.sql` + `registration.sql` in *AutoMax Models Beta*). Nothing the desktop app or the website use is replaced.

```
Browser (static Next.js, anon/publishable key only)
   │  Supabase Auth (email+password, TOTP MFA)             ← official session handling, no custom auth
   ▼
Edge Function  admin-api   (verify_jwt = true, plus our own checks)
   │  1 JWT → user id   2 admin_users (active + role)   3 MFA aal2   4 rate limit   5 input validation   6 role vs action
   ▼
public.admin_* SQL functions  (SECURITY DEFINER, EXECUTE only for service_role)
   │  re-check admin + role inside the DB, do the work, write public.admin_audit_log in the SAME transaction
   ▼
Existing business logic: apply_payment, grant_talent, revoke_talent, publish_release, unpublish_release,
                         publish_legal_document, set_registration_status   (re-used, never copied)
```

The browser never talks to a sensitive table. RLS is on for every table and no policy gives anybody "admin" through
`auth.uid() is not null`: admin status is the explicit row in `public.admin_users`.

## What exists today (scan result)

| Area | Reality in the repo | Consequence for the admin |
|---|---|---|
| Tables | `plans, profiles, subscriptions, payments, devices, trial_claims, talent_grants, app_releases, blocked_email_domains, email_identities, legal_documents, legal_acceptances, registration_requests, notification_settings, contact_messages` | all listed through `admin_list_*` RPCs |
| RLS | on for all of them; clients only `select` their own `profiles/subscriptions/payments/devices` | unchanged; new tables are RLS-on with **no** client grants |
| Functions | `check_license, remove_device, apply_payment, grant_by_email, cancel_my_subscription, expire_lapsed_subscriptions, grant_talent, revoke_talent, apply_talent_grant, apply_pending_talent, publish_release, unpublish_release, check_update, set_registration_status, publish_legal_document, accept_terms, export_user_data, …` | wrapped by `admin_*` functions that add authorization + audit |
| Storage | public bucket `releases` (upload only with service key / signed upload URL) | release upload through a signed upload URL issued by the Edge Function |
| Auth | Supabase Auth e-mail+password, triggers on `auth.users` (lower-case e-mail, disposable/duplicate guard, profile + `email_identities`) | users are created/changed only through the Auth Admin API (server side) so the triggers run |
| Frontend / env | desktop app + website hold only `SUPABASE_URL` and the `sb_publishable_…` key; **no secret found in any repo file** | same rule here |

### Differences between the request and the real schema (resolved without breaking anything)

| Request says | Schema has | Decision |
|---|---|---|
| `devices.device_hash` | `devices.device_id` (a hash made by the app) | UI says "Device hash", column is `device_id` |
| payment status *successful / pending / failed / refunded* | `paid / failed / refunded` (no pending) | filters follow the schema |
| `payments.amount`, `created_at` | `amount_cents`, `paid_at`, `created_at` | amounts shown as money (÷100) |
| registration status *pending / approved / rejected* | `new / contacted / approved / rejected / spam` | "Pending registrations" = `new`; filters follow the schema; no `updated_at` exists so only *Created* is shown |
| Legal "create document / edit draft" | `legal_documents` holds only version + SHA-256 of the text that lives inside the program; no drafts | Legal page can **publish** (version + sha256 + title), **set current**, **unpublish**; history is never deleted |
| Releases "delete" | none (and the app depends on the history) | publish / unpublish only; no hard delete |
| `grant_lifetime` | lifetime exists only as `subscriptions.is_lifetime` set by the Talent grant | *Grant Lifetime* = `grant_talent(p_lifetime => true)` (Talent plan, 2 computers) |
| Disable account | no such column | new `profiles.is_disabled` + Auth ban; **enforced inside `check_license`** (migration patches it, see below) |
| `remove_device` for admins | existing function uses `auth.uid()` (the user's own) | new `admin_remove_device(user, device_id)` with validation + audit |
| `cancel_my_subscription` for admins | user-only | new `admin_cancel_subscription` |

### Destructive-delete analysis (foreign keys)

| Table → `auth.users` | on delete | Effect of deleting an account |
|---|---|---|
| `profiles`, `subscriptions`, `devices`, `email_identities` | CASCADE | removed (expected) |
| **`payments`** | **CASCADE** | **financial history would be lost** |
| `trial_claims`, `talent_grants`, `legal_acceptances` | SET NULL | kept (e-mail snapshot stays) |

The existing FK is **not** changed. Instead `admin_prepare_user_deletion()` copies the user's payments into
`public.payments_archive` (with an e-mail snapshot) in the same call, immediately before the Auth user is deleted.
The UI recommends **Disable** over **Delete**, and Delete needs a typed `DELETE`.

### Two places that re-running `schema.sql` can undo
`check_license` is replaced by the migration `…_account_disable.sql` (adds the `account_disabled` guard). Running the original
`schema.sql` again re-creates the old body: **re-run the admin migrations afterwards** (they are idempotent). Even then a disabled
user is still locked out of new sign-ins and token refreshes by the Auth ban; only the access token that is already issued
(≤ 1 h) could keep working until the guard is restored.

## Roles

| Role | Can |
|---|---|
| `support` | read everything except the audit log and admin list; remove a device; set registration status |
| `admin` | everything operational: users, subscriptions, devices, talent, payments (read), registrations, audit log (read) |
| `super_admin` | + delete users, publish/unpublish **releases** and **legal documents**, manage admins |

Role is checked twice: in the Edge Function (action table) and again inside every SQL function.

## Hosting
Static export (no Next.js server). Vercel (GitHub import; `vercel.json` carries headers and the `/users/<id>` rewrite) or Cloudflare Pages
(`out/_headers`, `out/_redirects`). Note: Vercel's free Hobby plan is non-commercial; Cloudflare Pages' free plan allows commercial use.
The CSP is `script-src 'self'`: `scripts/postbuild.mjs` moves Next's inline scripts into `/_next/static/inline/*.js`.
