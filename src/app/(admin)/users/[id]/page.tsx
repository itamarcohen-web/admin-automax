import { UserDetailView } from './user-detail'

// Static export: one pre-built shell page. Any /users/<uuid>/ URL is served this shell (Cloudflare `_redirects` rewrite) and the
// client reads the real id from the address bar. All data still comes from the authenticated Edge Function.
export const dynamicParams = false
export function generateStaticParams() {
  return [{ id: '_' }]
}

export default function Page() {
  return <UserDetailView />
}
