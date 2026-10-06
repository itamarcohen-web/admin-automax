// Serves out/ the way Cloudflare Pages does (applies out/_redirects rewrites and out/_headers), for local testing:
//   npm run build && npm start        ->  http://localhost:3000
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const OUT = join(process.cwd(), 'out')
const PORT = Number(process.env.PORT ?? 3000)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2' }

const rx = (pattern) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[a-zA-Z_]+/g, '[^/]+') + '$')

function parseRedirects() {
  const f = join(OUT, '_redirects')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [from, to, status] = l.split(/\s+/)
    return { re: rx(from), to, status: Number(status ?? 301) }
  })
}
function parseHeaders() {
  const f = join(OUT, '_headers')
  if (!existsSync(f)) return []
  const rules = []
  let cur = null
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) { cur = { re: rx(line.trim()), headers: [] }; rules.push(cur) }
    else if (cur) { const i = line.indexOf(':'); cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]) }
  }
  return rules
}

function resolveFile(path) {
  const clean = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  const p = join(OUT, clean)
  if (!p.startsWith(OUT)) return null
  if (existsSync(p) && statSync(p).isFile()) return p
  const idx = join(p, 'index.html')
  if (existsSync(idx)) return idx
  return null
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const redirects = parseRedirects()      // re-read on every request: a rebuild is picked up without restarting
  const headerRules = parseHeaders()
  const path = url.pathname
  let file = null
  const rule = redirects.find((r) => r.re.test(path))
  if (rule && rule.status === 200) file = resolveFile(rule.to)
  if (!file) file = resolveFile(path)
  let status = 200
  if (!file) { file = join(OUT, '404.html'); status = 404 }
  const h = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }
  for (const r of headerRules) if (r.re.test(path)) for (const [k, v] of r.headers) h[k] = h[k] ? `${h[k]}, ${v}` : v
  res.writeHead(status, h)
  res.end(readFileSync(file))
}).listen(PORT, () => console.log(`serving out/ on http://localhost:${PORT}`))
