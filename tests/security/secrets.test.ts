import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()

function files(dir: string, skip: string[] = ['node_modules', '.next', '.git', 'out', 'coverage']): string[] {
  const res: string[] = []
  for (const n of readdirSync(dir)) {
    if (skip.includes(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) res.push(...files(p, skip))
    else res.push(p)
  }
  return res
}

describe('secrets never reach the browser', () => {
  it('the secret scanner passes on this repository (and on the built site when present)', () => {
    const out = execFileSync('node', ['scripts/scan-secrets.mjs'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toContain('secret scan: OK')
  })

  it('the secret scanner really fails when a service key is planted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'))
    writeFileSync(join(dir, '.gitignore'), '.env\n.env.*\n*.secret\n*.key\n')
    const fake = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.c2lnbmF0dXJlMTIz`
    writeFileSync(join(dir, 'leak.ts'), `export const k = '${fake}'\n`)
    writeFileSync(join(dir, 'b.ts'), 'const NEXT_PUBLIC_SERVICE_ROLE_KEY = 1\n')
    const r = spawnSync('node', [join(ROOT, 'scripts', 'scan-secrets.mjs')], { cwd: dir, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('JWT with role service_role')
    expect(r.stderr).toContain('NEXT_PUBLIC_ variable named like a secret')
  })

  it('client code never reads a server-side variable and never builds raw HTML', () => {
    const bad: string[] = []
    for (const f of files(join(ROOT, 'src'))) {
      if (!/\.(ts|tsx)$/.test(f)) continue
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith('NEXT_PUBLIC_')) bad.push(`${f}: ${m[1]}`)
      if (/dangerouslySetInnerHTML|innerHTML\s*=|document\.write|eval\(/.test(text)) bad.push(`${f}: unsafe DOM API`)
      if (/localStorage\.setItem\([^)]*(token|jwt|password|secret)/i.test(text)) bad.push(`${f}: stores a credential`)
    }
    expect(bad).toEqual([])
  })

  it('only the Edge Function entry point reads the service key, and only from the environment', () => {
    const dir = join(ROOT, 'supabase/functions/admin-api')
    const idx = readFileSync(join(dir, 'index.ts'), 'utf8')
    expect(idx).toMatch(/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/)
    expect(idx).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/)
    for (const f of ['core.ts', 'actions.ts', 'errors.ts', 'validate.ts', 'types.ts']) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/SERVICE_ROLE|createClient|Deno\./)
    }
  })

  it('the built site (if built) has no secret key and ships the strict headers', () => {
    const out = join(ROOT, 'out')
    if (!existsSync(out)) return
    const headers = readFileSync(join(out, '_headers'), 'utf8')
    expect(headers).toMatch(/Content-Security-Policy: default-src 'none'; script-src 'self'; /)
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    for (const f of files(out, []).filter((x) => x.endsWith('.html'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/src\s*=/.test(m[1]) && m[2].trim() !== '') throw new Error(`inline script left in ${f}`)
      }
    }
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-eval'/)
    for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy', 'Permissions-Policy', "frame-ancestors 'none'", 'X-Frame-Options: DENY']) expect(headers).toContain(h)
    for (const f of files(join(out, '_next'), [])) {
      if (!f.endsWith('.js')) continue
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/)
    }
  })

  it('.gitignore protects environment files and keys', () => {
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)
    for (const e of ['.env', '.env.*', '*.secret', '*.key']) expect(gi).toContain(e)
  })
})
