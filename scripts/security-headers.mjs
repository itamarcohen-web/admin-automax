// The single definition of the security headers. Used by scripts/postbuild.mjs (out/_headers for Cloudflare Pages) and mirrored
// in vercel.json (Vercel cannot read build-time values; a test keeps the two identical except for the Supabase host).

/** connectSrc: "https://<project-ref>.supabase.co" (exact, for _headers) or "https://*.supabase.co" (vercel.json) */
export function buildCsp(connectSrc) {
  return [
    "default-src 'none'",
    "script-src 'self'",                       // no inline scripts: postbuild moves Next's two inline scripts into /_next/static/inline/*.js
    "style-src 'self' 'unsafe-inline'",        // toasts/dialogs inject <style> at runtime; scripts are what matters
    "img-src 'self' data:",                    // data: = the SVG QR code of the MFA enrolment
    "font-src 'self'",
    `connect-src 'self' ${connectSrc}`,
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export const OTHER_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
}
