/**
 * dsh-workspace-search — out-of-tree bundle for DeepSeek Harness (dsh web).
 *
 * Host half: a VS Code-style workspace keyword search backend carried on the
 * Connection's generic RPC channel registry:
 *
 *   channel /workspace-search
 *     endpoint `search`  {root, query, caseSensitive?, maxFiles?, maxMatches?}
 *
 * Walks the tree with bounded breadth (skip .git/node_modules/hidden by
 * default), matches the query against file NAMES and text-file CONTENT lines,
 * and returns per-file match groups with line numbers. All caps are honored
 * and reported so the client can render "truncated" states honestly.
 */
import z from '@deepseek-ai/schemastery'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, basename } from 'node:path'

export const name = 'workspace-search'

/** The host Connection whose RPC registry carries this plugin's channel. */
export const inject = ['connection']

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

/** Directories never entered during the walk. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', '.next', 'target'])

function internalError(message) {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function ok(value) {
  return { ok: true, value }
}

function looksBinary(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  for (const byte of head) if (byte === 0) return true
  return false
}

async function* walkFiles(dir, seen) {
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
      if (seen.has(full)) continue
      seen.add(full)
      yield* walkFiles(full, seen)
      continue
    }
    if (entry.isFile()) yield full
  }
}

async function searchEndpoint(payload, config) {
  const root = typeof payload?.root === 'string' && payload.root.length > 0 ? payload.root : undefined
  const query = typeof payload?.query === 'string' ? payload.query : ''
  if (query.trim() === '') return ok({ ok: false, error: 'empty-query' })
  if (root !== undefined && !isAbsolute(root)) return ok({ ok: false, error: 'absolute-path-required' })

  let st
  try {
    st = root === undefined ? undefined : await stat(root)
  } catch {
    return ok({ ok: false, error: 'not-found' })
  }
  if (st !== undefined && !st.isDirectory()) return ok({ ok: false, error: 'not-a-directory' })

  const caseSensitive = payload.caseSensitive === true
  const needle = caseSensitive ? query : query.toLowerCase()
  const hasNeedle = (text) => (caseSensitive ? text : text.toLowerCase()).includes(needle)

  const results = []
  let scanned = 0
  let truncatedFiles = false
  let truncatedMatches = false
  let totalMatches = 0

  for await (const file of walkFiles(root ?? process.cwd(), new Set())) {
    scanned += 1
    if (scanned > config.maxFiles) {
      truncatedFiles = true
      break
    }
    const name = basename(file)
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

export function apply(ctx, config) {
  ctx.effect(() =>
    ctx.connection.rpc.handle(
      '/workspace-search',
      async (endpoint, payload, signal) => {
        try {
          if (endpoint === 'search') return await searchEndpoint(payload, config)
          return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: { issues: [] } } }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return internalError(message)
        }
      },
      { authority: 'loopback' },
    ),
    'workspace-search: rpc channel',
  )
}
