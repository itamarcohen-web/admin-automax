// Strict input validation for the admin API. No dependencies (runs in Deno and Node).
// A Reader consumes the keys it knows; anything left over is rejected ("unknown_field"), so a caller cannot smuggle extra parameters.

export class ValidationError extends Error {
  constructor(public field: string, public reason = 'invalid') {
    super(`${reason}:${field}`)
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export class Reader {
  private seen = new Set<string>()
  constructor(private o: Record<string, unknown>) {}

  private take(k: string): unknown {
    this.seen.add(k)
    const v = this.o[k]
    return v === null ? undefined : v
  }

  /** Throws when the caller sent a key that no reader asked for. */
  done(): void {
    for (const k of Object.keys(this.o)) if (!this.seen.has(k)) throw new ValidationError(k, 'unknown_field')
  }

  uuid(k: string): string {
    const v = this.take(k)
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ValidationError(k)
    return v.toLowerCase()
  }

  optUuid(k: string): string | undefined {
    return this.take(k) === undefined ? undefined : this.uuid(k)
  }

  str(k: string, o: { min?: number; max: number; pattern?: RegExp; trim?: boolean } = { max: 200 }): string {
    const v = this.take(k)
    if (typeof v !== 'string') throw new ValidationError(k)
    const s = (o.trim === false ? v : v.trim()).replace(CONTROL_RE, '')
    if (s.length < (o.min ?? 1) || s.length > o.max || (o.pattern && !o.pattern.test(s))) throw new ValidationError(k)
    return s
  }

  optStr(k: string, o: { max: number; pattern?: RegExp } = { max: 200 }): string | undefined {
    const v = this.take(k)
    if (v === undefined) return undefined
    if (typeof v !== 'string') throw new ValidationError(k)
    const s = v.trim().replace(CONTROL_RE, '')
    if (s === '') return undefined
    if (s.length > o.max || (o.pattern && !o.pattern.test(s))) throw new ValidationError(k)
    return s
  }

  /** a password: returned exactly as sent (no trimming, no stripping), length-checked only. Never logged. */
  secret(k: string, o: { min: number; max: number }): string {
    const v = this.take(k)
    if (typeof v !== 'string' || v.length < o.min || v.length > o.max) throw new ValidationError(k)
    return v
  }

  email(k: string): string {
    const v = this.take(k)
    if (typeof v !== 'string') throw new ValidationError(k)
    const s = v.trim().toLowerCase()
    if (s.length > 254 || !EMAIL_RE.test(s)) throw new ValidationError(k)
    return s
  }

  int(k: string, o: { min: number; max: number }): number {
    const v = this.take(k)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < o.min || v > o.max) throw new ValidationError(k)
    return v
  }

  optInt(k: string, o: { min: number; max: number }): number | undefined {
    return this.take(k) === undefined ? undefined : this.int(k, o)
  }

  bool(k: string): boolean {
    const v = this.take(k)
    if (typeof v !== 'boolean') throw new ValidationError(k)
    return v
  }

  optBool(k: string, dflt = false): boolean {
    const v = this.take(k)
    if (v === undefined) return dflt
    if (typeof v !== 'boolean') throw new ValidationError(k)
    return v
  }

  oneOf<T extends string>(k: string, allowed: readonly T[]): T {
    const v = this.take(k)
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new ValidationError(k)
    return v as T
  }

  optOneOf<T extends string>(k: string, allowed: readonly T[]): T | undefined {
    return this.take(k) === undefined ? undefined : this.oneOf(k, allowed)
  }

  /** The literal confirmation phrase a destructive call must carry (e.g. "DELETE"). */
  literal(k: string, expected: string): void {
    const v = this.take(k)
    if (v !== expected) throw new ValidationError(k, 'confirmation_required')
  }

  /** limit (1..100, default 25) and offset (0..1e6, default 0). */
  page(): { limit: number; offset: number } {
    return { limit: this.optInt('limit', { min: 1, max: 100 }) ?? 25, offset: this.optInt('offset', { min: 0, max: 1_000_000 }) ?? 0 }
  }

  /** free-text search box value */
  search(k = 'search'): string | undefined {
    return this.optStr(k, { max: 100 })
  }
}

export function reader(params: unknown): Reader {
  if (params === undefined || params === null) return new Reader({})
  if (typeof params !== 'object' || Array.isArray(params)) throw new ValidationError('params')
  return new Reader(params as Record<string, unknown>)
}

/** >= 10 characters, upper + lower case + digit, at most 72 (bcrypt limit). */
export function checkPassword(p: string): boolean {
  return p.length >= 10 && p.length <= 72 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)
}
