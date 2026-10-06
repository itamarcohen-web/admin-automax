// Runs before `npm run build`: refuses to build a site with a missing/unsafe public configuration.
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
const fail = (msg) => { console.error(`\nbuild stopped: ${msg}\n`); process.exit(1) }

if (!url || !key) fail('set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example) in the environment or in .env.local')
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) fail(`NEXT_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${url}")`)

let role = null
try { role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')).role ?? null } catch { /* not a JWT: fine */ }
if (key.startsWith('sb_secret_') || role === 'service_role') {
  fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is a SECRET key (service_role / sb_secret). It would be published to every visitor. Use the publishable key and rotate the secret key in Supabase.')
}
if (!key.startsWith('sb_publishable_') && role !== 'anon') fail('NEXT_PUBLIC_SUPABASE_ANON_KEY must be the publishable key (sb_publishable_...) or the legacy anon key')
console.log('build env: OK (public URL + publishable key only)')
