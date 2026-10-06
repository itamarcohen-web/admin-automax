// Regenerates vercel.json from scripts/security-headers.mjs:  node scripts/gen-vercel-json.mjs
// (vercel.json is committed, because Vercel reads it before the build; a test fails if it drifts from the shared definition.)
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildCsp, OTHER_HEADERS } from './security-headers.mjs'

export const WILDCARD_SUPABASE = 'https://*.supabase.co'

export function vercelConfig() {
  const toList = (o) => Object.entries(o).map(([key, value]) => ({ key, value }))
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: 'nextjs',
    buildCommand: 'npm run build',
    installCommand: 'npm ci',
    outputDirectory: 'out',
    trailingSlash: true,
    cleanUrls: false,
    // static files win over rewrites on Vercel, so /users/new/ is served as its own page and any other /users/<id>/ gets the shell page
    rewrites: [
      { source: '/users/:id/', destination: '/users/_/' },
      { source: '/users/:id', destination: '/users/_/' },
    ],
    headers: [
      { source: '/(.*)', headers: toList({ 'Content-Security-Policy': buildCsp(WILDCARD_SUPABASE), ...OTHER_HEADERS }) },
      { source: '/_next/static/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync('vercel.json', JSON.stringify(vercelConfig(), null, 2) + '\n')
  console.log('vercel.json written')
}
