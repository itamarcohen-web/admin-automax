import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error plain .mjs modules without types
import { vercelConfig, WILDCARD_SUPABASE } from '../../scripts/gen-vercel-json.mjs'
// @ts-expect-error plain .mjs modules without types
import { buildCsp, OTHER_HEADERS } from '../../scripts/security-headers.mjs'

const ROOT = process.cwd()
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))

describe('Vercel / GitHub deployment config', () => {
  it('vercel.json is exactly what scripts/gen-vercel-json.mjs produces (run `npm run vercel-json` after changing headers)', () => {
    expect(vercel).toEqual(vercelConfig())
  })
  it('sends the strict CSP and every security header on all routes', () => {
    const all = vercel.headers.find((h: { source: string }) => h.source === '/(.*)').headers as { key: string; value: string }[]
    const map = Object.fromEntries(all.map((h) => [h.key, h.value]))
    expect(map['Content-Security-Policy']).toBe(buildCsp(WILDCARD_SUPABASE))
    expect(map['Content-Security-Policy']).toContain("script-src 'self';")
    expect(map['Content-Security-Policy']).not.toMatch(/script-src[^;]*unsafe-/)
    for (const [k, v] of Object.entries(OTHER_HEADERS)) expect(map[k]).toBe(v)
  })
  it('rewrites /users/<id> to the static shell, and never swallows /users/new or the list', () => {
    expect(vercel.rewrites).toEqual([{ source: '/users/:id/', destination: '/users/_/' }, { source: '/users/:id', destination: '/users/_/' }])
    expect(vercel.trailingSlash).toBe(true)
    expect(vercel.outputDirectory).toBe('out')
  })
  it('the build refuses to run without the public Supabase variables', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.prebuild).toContain('check-env')
    expect(pkg.scripts.build).toContain('postbuild')
  })
  it('no server-only variable is referenced by the Next.js config', () => {
    expect(readFileSync(join(ROOT, 'next.config.mjs'), 'utf8')).not.toMatch(/process\.env/)
  })
})
