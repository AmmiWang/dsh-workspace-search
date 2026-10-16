/**
 * dsh-workspace-search — out-of-tree bundle for DeepSeek Harness (dsh web).
 *
 * Host half: a VS Code-style workspace keyword search backend served as a
 * plain HTTP prefix route on the webServer route registry (same pattern as
 * dsh-side-panel and dsh-better-sidebar):
 *
 *   POST /workspace-search/{endpoint}
 *     `search`  {root, query, caseSensitive?, regex?, include?, exclude?}
 *
 * NOTE: do NOT use `connection.rpc.handle()` here. Its implementation
 * rebinds the registration owner to the connection service's OWN fiber
 * (cordis Service tracker shadow: `owner = this.ctx` inside the `rpc`
 * getter resolves through `symbols.shadow` to the declaring fiber of
 * dsh-client-connection, whose inject is ["credentials"] only), so
 * `owner.webServer.register(...)` throws
 * `cannot get property "webServer" without inject` no matter what the
 * plugin's own module declares. Third-party bundles must serve their
 * browser routes directly off `ctx.webServer`.
 *
 * Walks the tree with bounded breadth (skips .git/dist/hidden dirs and the
 * client-provided exclude globs by default — node_modules is NOT hard-skipped,
 * it is excluded via the client's default exclude pattern so users can remove
 * it to search vendored trees), matches the query against file NAMES and
 * text-file CONTENT lines,
 * and returns per-file match groups with line numbers. All caps are honored
 * and reported so the client can render "truncated" states honestly.
 */
import z from '@deepseek-ai/schemastery'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, basename, relative } from 'node:path'

export const name = 'workspace-search'

/**
 * Host services this fiber needs. `webServer` is resolved on OUR fiber
 * (injected services land in the fiber store on activation), so
 * `ctx.webServer.register(...)` works — unlike the connection-service
 * shadow path. See the module header note.
 */
export const inject = ['webServer']

export const Config = z.object({
  /** Hard cap on files scanned per search. Defaults to 5000. */
  maxFiles: z.number().step(1).min(1).default(5000),
  /** Hard cap on total content matches per search. Defaults to 300. */
  maxMatches: z.number().step(1).min(1).default(300),
  /** Hard cap on one matched line's reported length. Defaults to 300. */
  maxLineLength: z.number().step(1).min(20).default(300),
  /** Files above this size are skipped for content scan. Defaults to 1 MiB. */
  maxFileBytes: z.number().step(1).min(1024).default(1048576),
})

/** Directories never entered during the walk. node_modules is deliberately
 * NOT listed: it is excluded by the client's default exclude glob, which the
 * user can clear to search vendored trees. */
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'dist', 'build', '.next', 'target'])

const ROUTE_PREFIX = '/workspace-search'

/** Loopback hostnames accepted by the request fence. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '[::ffff:127.0.0.1]'])

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function internalError(message) {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function ok(value) {
  return { ok: true, value }
}

/**
 * Loopback trust fence, same posture as the built-in /api gateway: the
 * request's Host must be a loopback authority, and a present Origin (or
 * cross-site Sec-Fetch-Site marker) must point at the same host. No CORS
 * headers are ever emitted, so cross-origin reads stay blocked by the
 * browser regardless.
 */
function fenced(req) {
  const hostHeader = req.headers?.host
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '')
  const hostTrusted = LOOPBACK_HOSTNAMES.has(hostname)
  const originHeader = req.headers?.origin
  if (typeof originHeader === 'string' && originHeader.length > 0) {
    let originHost
    try {
      originHost = new URL(originHeader).hostname.toLowerCase()
    } catch {
      return false
    }
    return originHost === hostname
  }
  if (!hostTrusted) return false
  return req.headers?.['sec-fetch-site'] !== 'cross-site'
}

function looksBinary(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  for (const byte of head) if (byte === 0) return true
  return false
}

async function* walkFiles(dir, root, matcher, seen) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      const rel = relPath(root, full)
      if (matcher.excludeDir(rel)) continue
      if (seen.has(full)) continue
      seen.add(full)
      yield* walkFiles(full, root, matcher, seen)
      continue
    }
    if (entry.isFile()) yield full
  }
}

/**
 * VS Code-flavored glob → RegExp. Supports double-star (any depth), `*`
 * (within a segment), `?` (one char), and `{a,b}` alternation. A pattern
 * without a slash matches the basename anywhere; a pattern with a slash
 * matches the root-relative path (a leading double-star-slash is allowed,
 * a leading slash is stripped).
 */
function globToRegExp(pattern) {
  let pat = pattern.replace(/\\/g, '/')
  const leading = pat.startsWith('**/') ? '**/' : ''
  if (leading !== '') pat = pat.slice(3)
  if (pat.startsWith('/')) pat = pat.slice(1)
  const hasSlash = pat.includes('/')
  let re = ''
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]
    if (c === '*') {
      if (pat[i + 1] === '*') {
        re += '.*'
        i += 1
        if (pat[i + 1] === '/') i += 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const close = pat.indexOf('}', i)
      if (close === -1) {
        re += '\\{'
      } else {
        const alts = pat.slice(i + 1, close).split(',').map(escapeRegex)
        re += `(?:${alts.join('|')})`
        i = close
      }
    } else {
      re += escapeRegex(c)
    }
  }
  if (hasSlash) {
    return new RegExp(`^(?:${re})${leading === '**/' ? '' : ''}`)
  }
  return new RegExp(`^[^/]*${re}$`)
}

function escapeRegex(chunk) {
  return chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function relPath(root, full) {
  const rel = relative(root, full).replace(/\\/g, '/')
  return rel
}

function compileGlobs(list, dirMode) {
  const patterns = String(list ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const regexes = []
  for (const p of patterns) {
    try {
      const re = globToRegExp(p)
      regexes.push({ pattern: p, re, dirMode })
    } catch {
      // Invalid glob: ignored (VS Code behavior for syntactically odd patterns).
    }
  }
  return regexes
}

async function searchEndpoint(payload, config) {
  const root = typeof payload?.root === 'string' && payload.root.length > 0 ? payload.root : undefined
  const query = typeof payload?.query === 'string' ? payload.query : ''
  if (query.trim() === '') return ok({ ok: false, error: 'empty-query' })
  if (root !== undefined && !isAbsolute(root)) return ok({ ok: false, error: 'absolute-path-required' })

  const regexMode = payload.regex === true
  const caseSensitive = payload.caseSensitive === true
  let queryRe = null
  if (regexMode) {
    try {
      queryRe = new RegExp(query, caseSensitive ? '' : 'i')
    } catch {
      return ok({ ok: false, error: 'invalid-regex' })
    }
  }

  const include = compileGlobs(payload.include, false)
  const exclude = compileGlobs(payload.exclude, false)
  const excludeDirs = compileGlobs(payload.exclude, true)

  const dirBlocked = (rel) => {
    // A pattern without a slash compiles to an anchored basename match, so
    // also test the directory's own name — this is what makes a bare
    // `node_modules` exclude dirs nested at any depth (VS Code semantics).
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    const dirRel = rel.endsWith('/') ? rel : `${rel}/`
    for (const { re } of excludeDirs) {
      if (re.test(rel) || re.test(dirRel) || re.test(base)) return true
    }
    return false
  }
  const fileBlocked = (rel, base) => {
    for (const { re } of exclude) if (re.test(rel) || re.test(base)) return true
    if (include.length > 0) {
      let hit = false
      for (const { re } of include) if (re.test(rel) || re.test(base)) { hit = true; break }
      if (!hit) return true
    }
    return false
  }
  const matcher = { excludeDir: dirBlocked }

  let st
  try {
    st = root === undefined ? undefined : await stat(root)
  } catch {
    return ok({ ok: false, error: 'not-found' })
  }
  if (st !== undefined && !st.isDirectory()) return ok({ ok: false, error: 'not-a-directory' })

  const needle = caseSensitive ? query : query.toLowerCase()
  const hasNeedle = (text) => {
    if (queryRe !== null) {
      queryRe.lastIndex = 0
      return queryRe.test(text)
    }
    return (caseSensitive ? text : text.toLowerCase()).includes(needle)
  }

  const results = []
  let scanned = 0
  let truncatedFiles = false
  let truncatedMatches = false
  let totalMatches = 0
  const rootDir = root ?? process.cwd()

  for await (const file of walkFiles(rootDir, rootDir, matcher, new Set())) {
    const rel = relPath(rootDir, file)
    const name = basename(file)
    if (fileBlocked(rel, name)) continue
    scanned += 1
    if (scanned > config.maxFiles) {
      truncatedFiles = true
      break
    }
    const nameMatch = hasNeedle(name)
    let matches = null
    let fileStat
    try {
      fileStat = await stat(file)
    } catch {
      fileStat = undefined
    }
    if (fileStat !== undefined && fileStat.size <= config.maxFileBytes) {
      let buf
      try {
        buf = await readFile(file)
      } catch {
        buf = undefined
      }
      if (buf !== undefined && !looksBinary(buf)) {
        const lines = buf.toString('utf8').split('\n')
        const found = []
        for (let i = 0; i < lines.length; i++) {
          if (!hasNeedle(lines[i])) continue
          if (totalMatches >= config.maxMatches) {
            truncatedMatches = true
            break
          }
          totalMatches += 1
          found.push({
            line: i + 1,
            text: lines[i].length > config.maxLineLength
              ? `${lines[i].slice(0, config.maxLineLength)}…`
              : lines[i],
          })
        }
        if (found.length > 0) matches = found
      }
    }
    if (nameMatch || matches !== null) {
      results.push({ path: file, name, nameMatch, matches: matches ?? [] })
    }
  }

  results.sort((a, b) => {
    const am = a.matches.length > 0 ? 1 : 0
    const bm = b.matches.length > 0 ? 1 : 0
    if (am !== bm) return bm - am
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })

  return ok({
    ok: true,
    query,
    root: root ?? process.cwd(),
    scanned,
    truncatedFiles,
    truncatedMatches,
    results,
  })
}

async function readJsonBody(req, limit = 1 << 20) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  return JSON.parse(raw)
}

export function apply(ctx, config) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          if (!fenced(req)) {
            json(res, 403, internalError('forbidden'))
            return
          }
          if (req.method !== 'POST') {
            res.setHeader('allow', 'POST')
            json(res, 405, internalError('method not allowed; POST ' + ROUTE_PREFIX + '/search'))
            return
          }
          const endpoint = req.url?.slice(ROUTE_PREFIX.length).replace(/^\/+|\/+$/g, '') ?? ''
          if (endpoint !== 'search') {
            json(res, 404, internalError(`unknown endpoint: ${endpoint}`))
            return
          }
          const payload = await readJsonBody(req)
          const result = await searchEndpoint(payload, config)
          json(res, 200, result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          json(res, error instanceof SyntaxError ? 400 : 500, internalError(message))
        }
      },
    }),
    'workspace-search: http route',
  )
}
