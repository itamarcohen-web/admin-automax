const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

export function fmtRelative(v: string | null | undefined, now = Date.now()): string {
  if (!v) return 'never'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.round((now - t) / 1000)
  const abs = Math.abs(s)
  const unit = abs < 60 ? [abs, 's'] : abs < 3600 ? [Math.round(abs / 60), 'm'] : abs < 86400 ? [Math.round(abs / 3600), 'h'] : [Math.round(abs / 86400), 'd']
  return s >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`
}

/** amounts are stored in the smallest unit (agorot / cents) */
export function fmtMoney(cents: number | null | undefined, currency = 'ILS'): string {
  if (cents === null || cents === undefined) return '—'
  try {
    return new Intl.NumberFormat('en-IL', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function shortId(id: string | null | undefined, n = 8): string {
  return id ? id.slice(0, n) : '—'
}

export function fullName(first?: string | null, last?: string | null, business?: string | null): string {
  const person = [first, last].filter(Boolean).join(' ')
  return business ? `${business}${person ? ` (${person})` : ''}` : person || '—'
}

export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
