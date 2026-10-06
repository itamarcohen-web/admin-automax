import { Badge, type Tone } from '@/components/ui/card'
import type { Role } from '@/lib/types'

const SUB: Record<string, Tone> = { active: 'success', trialing: 'info', past_due: 'warning', canceled: 'neutral', expired: 'danger' }
const PAY: Record<string, Tone> = { paid: 'success', failed: 'danger', refunded: 'warning' }
const REG: Record<string, Tone> = { new: 'info', contacted: 'warning', approved: 'success', rejected: 'danger', spam: 'neutral' }
const TALENT: Record<string, Tone> = { applied: 'success', pending: 'warning', revoked: 'neutral' }

const label = (s: string) => s.replace(/_/g, ' ')

export const SubscriptionBadge = ({ status }: { status: string | null | undefined }) => (status ? <Badge tone={SUB[status] ?? 'neutral'}>{label(status)}</Badge> : <Badge>none</Badge>)
export const PaymentBadge = ({ status }: { status: string }) => <Badge tone={PAY[status] ?? 'neutral'}>{label(status)}</Badge>
export const RegistrationBadge = ({ status }: { status: string }) => <Badge tone={REG[status] ?? 'neutral'}>{label(status)}</Badge>
export const TalentBadge = ({ status }: { status: string }) => <Badge tone={TALENT[status] ?? 'neutral'}>{label(status)}</Badge>
export const RoleBadge = ({ role }: { role: Role }) => <Badge tone={role === 'super_admin' ? 'warning' : role === 'admin' ? 'info' : 'neutral'}>{label(role)}</Badge>

export function ActionBadge({ action }: { action: string }) {
  const tone: Tone = /DELETE|DISABLE|REVOKE|CANCEL|UNPUBLISH|REMOVE|DENIED/.test(action) ? 'danger' : /CREATE|GRANT|PUBLISH|ENABLE|REACTIVATE|ADD/.test(action) ? 'success' : /LOGIN|LOGOUT/.test(action) ? 'neutral' : 'info'
  return <Badge tone={tone} className="font-mono">{action}</Badge>
}
