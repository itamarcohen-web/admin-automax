// Shapes returned by the admin-api Edge Function (see supabase/migrations for the SQL that builds them).

export type Role = 'super_admin' | 'admin' | 'support'
export const ROLE_RANK: Record<Role, number> = { support: 1, admin: 2, super_admin: 3 }
export const can = (role: Role | undefined, min: Role): boolean => !!role && ROLE_RANK[role] >= ROLE_RANK[min]

export interface Me { user_id: string; email: string | null; role: Role; mfa_enrolled: boolean; mfa_required: boolean }
export interface Page<T> { total: number; rows: T[] }

export interface Plan { code: string; name: string; price_cents: number; currency: string; max_devices: number; is_active: boolean }

export interface DashboardData {
  total_users: number
  active_users_30d: number
  active_subscriptions: number
  lifetime_users: number
  talent_users: number
  registered_devices: number
  payments_count: number
  payments_total_cents: number
  pending_registrations: number
  disabled_users: number
  recent_registrations: { id: string; created_at: string; customer_type: string; first_name: string; last_name: string; business_name: string | null; email: string; status: string }[]
  recent_payments: { id: string; user_id: string; email: string | null; amount_cents: number; currency: string; status: string; provider: string; paid_at: string }[]
  recent_users: { id: string; email: string | null; full_name: string | null; created_at: string }[]
  recent_admin_actions: { id: string; created_at: string; action: string; admin_email: string | null; target_email: string | null }[] | null
}

export interface UserRow {
  id: string
  email: string | null
  full_name: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  is_disabled: boolean
  sub_status: string | null
  is_lifetime: boolean | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  plan_code: string | null
  plan_name: string | null
  license_valid: boolean
  device_count: number
  is_admin: boolean
}

export interface SubscriptionRow {
  id: string
  user_id: string
  email: string | null
  plan_code: string
  plan_name: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  provider: string
  is_lifetime: boolean
  created_at: string
  is_valid: boolean
}

export interface PaymentRow {
  id: string
  user_id: string | null
  email: string | null
  amount_cents: number
  currency: string
  status: string
  provider: string
  provider_payment_id: string | null
  paid_at: string | null
  created_at: string | null
  archived: boolean
}

export interface DeviceRow { id: string; user_id: string; email: string | null; device_id: string; device_name: string | null; first_seen: string; last_seen: string }

export interface TalentRow {
  id: string
  email: string
  user_id: string | null
  months: number | null
  is_lifetime: boolean
  note: string | null
  created_at: string
  applied_at: string | null
  revoked_at: string | null
  status: 'pending' | 'applied' | 'revoked'
  expires_at: string | null
  granted_by: string | null
}

export interface RegistrationRow {
  id: string
  created_at: string
  status: string
  customer_type: 'private' | 'business'
  first_name: string
  last_name: string
  business_name: string | null
  company_number: string | null
  email: string
  phone_e164: string
  country_name: string | null
  country_code: string
  city: string
  street: string
  house_number: string
  apartment: string | null
  postal_code: string | null
  language: string | null
  app_version: string | null
  admin_notes: string | null
  mail_sent: boolean
  has_account: boolean
}

export interface ReleaseRow {
  id: string
  version: string
  version_num: number
  download_url: string
  sha256: string
  size_bytes: number
  notes: string | null
  mandatory: boolean
  is_published: boolean
  published_at: string
}

export interface LegalRow { version: string; sha256: string; title: string | null; published_at: string; is_current: boolean; acceptances: number }

export interface AuditRow {
  id: string
  created_at: string
  admin_user_id: string | null
  admin_email: string | null
  action: string
  target_user_id: string | null
  target_email: string | null
  target_resource_type: string | null
  target_resource_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
}

export interface AdminRow { user_id: string; email: string; role: Role; is_active: boolean; created_at: string; last_sign_in_at: string | null; mfa_enrolled: boolean | null }

export interface UserDetail {
  account: { id: string; email: string | null; created_at: string; last_sign_in_at: string | null; email_confirmed_at: string | null; banned_until: string | null }
  profile: { full_name: string | null; email: string | null; created_at: string; updated_at: string; is_disabled: boolean; disabled_at: string | null; disabled_reason: string | null } | null
  is_admin: boolean
  subscriptions: {
    id: string; plan_code: string; plan_name: string; max_devices: number; status: string; current_period_start: string; current_period_end: string
    cancel_at_period_end: boolean; provider: string; is_lifetime: boolean; created_at: string; is_valid: boolean
  }[]
  payments: { id: string; amount_cents: number; currency: string; status: string; provider: string; provider_payment_id: string | null; paid_at: string; created_at: string }[]
  devices: { id: string; device_id: string; device_name: string | null; first_seen: string; last_seen: string }[]
  talent_grants: { id: string; email: string; months: number | null; is_lifetime: boolean; note: string | null; created_at: string; applied_at: string | null; revoked_at: string | null; status: string; granted_by: string | null }[]
  legal_acceptances: { version: string; sha256: string; context: string; app_version: string | null; accepted_at: string }[]
  audit: { id: string; created_at: string; action: string; admin_email: string | null; metadata: Record<string, unknown> }[]
  registration: { id: string; created_at: string; customer_type: string; status: string; phone_e164: string; city: string; country_code: string } | null
}
