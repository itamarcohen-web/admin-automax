// Fails (exit 1) when a secret could reach the browser or Git. Run: npm run scan:secrets  (also part of `npm run check`).
//   * secret/service_role keys or JWTs with role service_role anywhere in source, config or the built site (out/)
//   * Resend keys, private keys, NEXT_PUBLIC_* variables named like secrets
//   * missing .gitignore protection, real values in .env.example
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__pycache__', 'coverage'])
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|sql|toml|txt|yml|yaml|env|example|py|ps1|sh)$/i
const findings = []

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (st.size < 5_000_000 && (TEXT_EXT.test(name) || name.startsWith('.env'))) yield p
  }
}

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
const add = (file, what, line) => findings.push(`${relative(ROOT, file)}${line ? ':' + line : ''}  ${what}`)

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  if (rel === 'scripts/scan-secrets.mjs' || rel.startsWith('tests/')) continue   // this scanner and the tests contain the patterns on purpose
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((ln, i) => {
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(ln)) add(file, 'Supabase secret key (sb_secret_...)', i + 1)
    if (/\bre_[A-Za-z0-9]{20,}\b/.test(ln)) add(file, 'Resend API key', i + 1)
    for (const m of ln.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
      try { if (JSON.parse(b64(m[1])).role === 'service_role') add(file, 'JWT with role service_role', i + 1) } catch { /* not a JWT */ }
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(ln)) add(file, 'private key', i + 1)
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE|SECRET|PRIVATE|PASSWORD|TOKEN)/.test(ln) && !rel.endsWith('.md') && rel !== '.env.example') add(file, 'NEXT_PUBLIC_ variable named like a secret', i + 1)
    if (/(SERVICE_ROLE_KEY|ADMIN_SERVICE_KEY|SB_SECRET)\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/.test(ln)) add(file, 'service key with a value', i + 1)
  })
}

// .env.example must not carry real values
const ex = join(ROOT, '.env.example')
if (existsSync(ex)) {
  readFileSync(ex, 'utf8').split(/\r?\n/).forEach((ln, i) => {
    const m = /^([A-Z0-9_]+)=(.+)$/.exec(ln)
    if (m && !/^(NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES)$/.test(m[1])) add(ex, `${m[1]} has a value in .env.example`, i + 1)
  })
}
// .gitignore must protect secrets
const gi = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : ''
for (const need of ['.env', '.env.*', '*.secret', '*.key']) if (!gi.split(/\r?\n/).includes(need)) findings.push(`.gitignore  missing "${need}"`)

if (findings.length) {
  console.error('SECRET SCAN FAILED:\n' + findings.map((f) => '  - ' + f).join('\n'))
  console.error('\nRemove the value, move it to an environment variable / Edge Function secret and ROTATE the key in Supabase if it was ever committed or published.')
  process.exit(1)
}
console.log('secret scan: OK (no secret keys in source, config or the built site; .gitignore protects .env files)')
