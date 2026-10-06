// `npm run demo` - try the whole console locally with FAKE data (no Supabase project, nothing real is touched):
//   builds the site against a local mock backend, then serves it on http://localhost:3000
//   sign in with owner@auto-max.co.il / Mock-Passw0rd   (also: ops@ = admin, help@ = support, mfa@ = TOTP code 123456, customer@example.com = refused)
import { spawn, spawnSync } from 'node:child_process'

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_localmockkey0000000000000000',
  NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES: '30',
}
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })

if (run('npx', ['next', 'build']).status !== 0) process.exit(1)
if (run('node', ['scripts/postbuild.mjs']).status !== 0) process.exit(1)
spawn('node', ['tests/e2e/mock-supabase.mjs'], { stdio: 'inherit', env })
spawn('node', ['scripts/serve-out.mjs'], { stdio: 'inherit', env: { ...env, PORT: '3000' } })
