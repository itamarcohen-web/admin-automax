// Static export: the admin console is plain files (HTML/JS/CSS) served by Cloudflare Pages. There is no Next.js server, so there is
// no server-side secret to leak; every privileged operation happens in the Supabase Edge Function.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
}
export default nextConfig
