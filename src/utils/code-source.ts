import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// ::code reads one public file from GitHub at build time. The raw host is
// tried first. If that request errors, the Contents API is used instead,
// including for a public file with no token. A 404 stays a miss unless a
// token can read a private file. A full commit SHA is cached for a year.
// A branch or tag is resolved to the commit it names that day and cached
// for a week. Failures are retried after an hour.

const WEEK = 7 * 24 * 60 * 60 * 1000
const YEAR = 365 * 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const CACHE_PATH = path.join(process.cwd(), '.cache', 'code-cards.json')
const USER_AGENT = 'antfustyle-blog'
const MAX_BYTES = 1_000_000
const MAX_SPAN = 200
const WHOLE_FILE_LINES = 120

const CODE_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'jsonc',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'py',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  lua: 'lua',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  mdx: 'markdown',
  txt: 'txt',
}

const CODE_NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  containerfile: 'dockerfile',
}

export interface CodeView {
  href: string
  owner: string
  repo: string
  path: string
  sha: string
  start: number
  end: number
  ranged: boolean
  code: string
  lang: string
}

interface Range {
  start: number
  end: number
  tooLong: boolean
}

interface Request {
  href: string
  owner: string
  repo: string
  parts: string[]
  range: Range | null
  lines: string
}

interface Stored {
  href: string
  owner: string
  repo: string
  path: string
  sha: string
  start: number
  end: number
  ranged: boolean
  code: string
  lang: string
}

interface CacheEntry {
  fetchedAt: number
  ok: boolean
  pinned: boolean
  data?: Stored
}

type Read =
  | { kind: 'text'; text: string }
  | { kind: 'big' }
  | { kind: 'binary' }
  | { kind: 'missing' }
  | { kind: 'error'; reason: string }

export type CodeResult =
  { status: 'card'; view: CodeView } | { status: 'missing'; message: string }

let memory: Record<string, CacheEntry> | null = null
let loading: Promise<Record<string, CacheEntry>> | null = null
let writing: Promise<void> = Promise.resolve()
const inflight = new Map<string, Promise<CodeResult>>()
const commitCache = new Map<string, string | null>()

export function flushCodeCache(): Promise<void> {
  return writing
}

export async function loadCode(
  raw: string,
  linesAttr: string
): Promise<CodeResult> {
  const request = parseRequest(raw, linesAttr)
  if (request === 'lines')
    return { status: 'missing', message: 'Needs a line range' }
  if (!request)
    return { status: 'missing', message: 'Needs a GitHub file link' }

  const key = request.lines ? `${request.href}\n${request.lines}` : request.href
  const store = await cacheStore()
  const hit = store[key]
  if (hit && fresh(hit)) {
    if (!hit.ok || !hit.data) return linkResult(request)
    const view = storedView(hit.data)
    if (view) return { status: 'card', view }
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const task = resolve(request)
    .then((result) => {
      remember(key, {
        fetchedAt: Date.now(),
        ok: result.ok,
        pinned: result.ok && result.pinned,
        data: result.ok ? storeOf(result.view) : undefined,
      })
      return { status: 'card' as const, view: result.view }
    })
    .catch((error: unknown) => {
      console.warn(`::code ${request.href} failed: ${errorText(error)}`)
      remember(key, { fetchedAt: Date.now(), ok: false, pinned: false })
      return linkResult(request)
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}

function linkResult(request: Request): CodeResult {
  return {
    status: 'card',
    view: {
      href: request.href,
      owner: request.owner,
      repo: request.repo,
      path: '',
      sha: '',
      start: 0,
      end: 0,
      ranged: false,
      code: '',
      lang: '',
    },
  }
}

async function resolve(
  request: Request
): Promise<{ view: CodeView; pinned: boolean; ok: boolean }> {
  if (request.range?.tooLong) {
    warn(request.href, `range is longer than ${MAX_SPAN} lines`)
    return { view: linkView(request, request.href), pinned: false, ok: true }
  }

  const located = await locate(request)
  if (located && 'error' in located) throw new Error(located.error)
  if (!located) {
    warn(request.href, 'file was not found')
    return { view: linkView(request, request.href), pinned: false, ok: false }
  }

  const pinned = located.pinned
  const permalink = blobUrl(
    request.owner,
    request.repo,
    located.sha,
    located.path,
    0,
    0,
    false
  )
  const base = {
    href: permalink,
    owner: request.owner,
    repo: request.repo,
    path: located.path,
    sha: located.sha,
    start: 0,
    end: 0,
    ranged: false,
    code: '',
    lang: '',
  }

  if (located.read.kind === 'big') {
    warn(request.href, 'file is over 1 MB')
    return { view: base, pinned, ok: true }
  }
  if (located.read.kind === 'binary') {
    warn(request.href, 'file is not text')
    return { view: base, pinned, ok: true }
  }
  if (located.read.kind !== 'text') {
    warn(request.href, 'file was not found')
    return { view: linkView(request, request.href), pinned: false, ok: false }
  }

  const lines = splitLines(located.read.text)
  const range = request.range
  if (!range) {
    if (lines.length === 0 || lines.length > WHOLE_FILE_LINES) {
      warn(
        request.href,
        lines.length === 0
          ? 'file is empty'
          : `file has more than ${WHOLE_FILE_LINES} lines`
      )
      return { view: base, pinned, ok: true }
    }
    return {
      view: snippet(base, lines, 1, lines.length, false),
      pinned,
      ok: true,
    }
  }

  if (range.start > lines.length) {
    warn(request.href, 'line range is past the end of the file')
    return { view: base, pinned, ok: true }
  }
  const end = Math.min(range.end, lines.length)
  return {
    view: snippet(base, lines, range.start, end, true),
    pinned,
    ok: true,
  }
}

function snippet(
  base: CodeView,
  lines: string[],
  start: number,
  end: number,
  ranged: boolean
): CodeView {
  return {
    ...base,
    href: blobUrl(
      base.owner,
      base.repo,
      base.sha,
      base.path,
      start,
      end,
      ranged
    ),
    start,
    end,
    ranged,
    code: lines.slice(start - 1, end).join('\n'),
    lang: languageOf(base.path),
  }
}

function linkView(request: Request, href: string): CodeView {
  return {
    href,
    owner: request.owner,
    repo: request.repo,
    path: '',
    sha: '',
    start: 0,
    end: 0,
    ranged: false,
    code: '',
    lang: '',
  }
}

async function locate(request: Request): Promise<Located> {
  const parts = request.parts
  if (/^[0-9a-f]{40}$/i.test(parts[0] || '')) {
    const sha = (parts[0] || '').toLowerCase()
    const filePath = parts.slice(1).join('/')
    if (!filePath) return null
    const read = await fetchFile(
      request.owner,
      request.repo,
      sha,
      filePath,
      lastLine(request.range)
    )
    if (read.kind === 'error') return { error: read.reason }
    if (read.kind === 'missing') return null
    return { sha, path: filePath, pinned: true, read }
  }

  const limit = Math.min(parts.length - 1, 6)
  for (let size = 1; size <= limit; size += 1) {
    const ref = parts.slice(0, size).join('/')
    const filePath = parts.slice(size).join('/')
    if (!filePath) continue
    const sha = await commitSha(request.owner, request.repo, ref)
    if (sha === 'error') return { error: 'could not resolve the commit' }
    if (!sha) continue
    const read = await fetchFile(
      request.owner,
      request.repo,
      sha,
      filePath,
      lastLine(request.range)
    )
    if (read.kind === 'error') return { error: read.reason }
    if (read.kind === 'missing') continue
    return { sha, path: filePath, pinned: false, read }
  }
  return null
}

type Located =
  | { sha: string; path: string; pinned: boolean; read: Read }
  | { error: string }
  | null

function lastLine(range: Range | null): number {
  if (!range || range.tooLong) return WHOLE_FILE_LINES + 1
  return range.end
}

async function fetchFile(
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
  last: number
): Promise<Read> {
  const encodedPath = filePath.split('/').map(encodeSegment).join('/')
  const rawUrl = `https://raw.githubusercontent.com/${encodeSegment(owner)}/${encodeSegment(repo)}/${sha}/${encodedPath}`
  let raw = await fetchText(rawUrl, rawHeaders(), last)
  if (raw.kind === 'error' && !timedOut(raw.reason))
    raw = await fetchText(rawUrl, rawHeaders(), last)
  if (raw.kind !== 'error' && raw.kind !== 'missing') return raw
  if (raw.kind === 'missing' && !token()) return raw
  const apiUrl = `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`
  const api = await fetchText(
    apiUrl,
    githubHeaders('application/vnd.github.raw+json'),
    last
  )
  if (api.kind === 'error' && raw.kind === 'error')
    return { kind: 'error', reason: `raw ${raw.reason}; api ${api.reason}` }
  return api
}

function timedOut(reason: string): boolean {
  return /timeout|aborted/i.test(reason)
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  last: number
): Promise<Read> {
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      return { kind: 'missing' }
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      return { kind: 'error', reason: `HTTP ${response.status}` }
    }
    return await collect(response.body, last)
  } catch (error) {
    return { kind: 'error', reason: errorText(error) }
  }
}

async function collect(
  body: ReadableStream<Uint8Array>,
  last: number
): Promise<Read> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let received = 0
  let text = ''
  let kind: 'text' | 'big' | 'binary' = 'text'
  try {
    while (kind === 'text') {
      const { done, value } = await reader.read()
      if (done || !value) break
      if (value.includes(0)) {
        kind = 'binary'
        break
      }
      received += value.byteLength
      if (received > MAX_BYTES) {
        kind = 'big'
        break
      }
      text += decoder.decode(value, { stream: true })
      if (completeLineCount(text) >= last) break
    }
    if (kind === 'text') {
      try {
        text += decoder.decode()
      } catch {
        if (completeLineCount(text) < last) kind = 'binary'
      }
    }
  } catch {
    kind = 'binary'
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  if (kind === 'text') return { kind: 'text', text }
  return { kind }
}

async function commitSha(
  owner: string,
  repo: string,
  ref: string
): Promise<string | null | 'error'> {
  const key = `${owner}/${repo}@${ref}`
  if (commitCache.has(key)) return commitCache.get(key) ?? null
  let response: Response
  try {
    response = await fetch(
      `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/commits/${encodeURIComponent(ref)}`,
      {
        headers: githubHeaders('application/vnd.github+json'),
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      }
    )
  } catch {
    return 'error'
  }
  if (response.status === 404 || response.status === 422) {
    await response.body?.cancel().catch(() => undefined)
    commitCache.set(key, null)
    return null
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return 'error'
  }
  try {
    const data = (await response.json()) as { sha?: string }
    const sha = data.sha?.toLowerCase() || ''
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      commitCache.set(key, null)
      return null
    }
    commitCache.set(key, sha)
    return sha
  } catch {
    return 'error'
  }
}

function parseRequest(
  raw: string,
  linesAttr: string
): Request | 'lines' | null {
  const href = canonical(raw)
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const target = githubFile(url)
  if (!target) return null
  const lines = linesAttr.trim()
  let range: Range | null
  if (lines) {
    range = parseLines(lines)
    if (!range) return 'lines'
  } else {
    range = parseLines(url.hash.replace(/^#/, ''))
  }
  return {
    href,
    owner: target.owner,
    repo: target.repo,
    parts: target.parts,
    range,
    lines,
  }
}

function githubFile(
  url: URL
): { owner: string; repo: string; parts: string[] } | null {
  const host = url.hostname.replace(/^www\./, '')
  const parts = decodeParts(url.pathname)
  if (parts.length < 2) return null
  const owner = parts[0] || ''
  const repo = (parts[1] || '').replace(/\.git$/, '')
  if (!isRepoName(owner) || !isRepoName(repo)) return null
  let rest: string[]
  if (host === 'raw.githubusercontent.com') {
    rest = parts.slice(2)
  } else if (host === 'github.com' && parts[2] === 'blob') {
    rest = parts.slice(3)
  } else {
    return null
  }
  const cleaned = cleanParts(rest)
  if (!cleaned || cleaned.length < 2) return null
  return { owner, repo, parts: cleaned }
}

function parseLines(value: string): Range | null {
  const match = value.trim().match(/^L?(\d+)(?:\s*-\s*L?(\d+))?$/i)
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : start
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 1 || end < start) return null
  return { start, end, tooLong: end - start + 1 > MAX_SPAN }
}

function canonical(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.protocol = 'https:'
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase()
    url.username = ''
    url.password = ''
    url.search = ''
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    const range = parseLines(url.hash.replace(/^#/, ''))
    if (!range) url.hash = ''
    else if (range.start === range.end) url.hash = `#L${range.start}`
    else url.hash = `#L${range.start}-L${range.end}`
    return url.href
  } catch {
    return ''
  }
}

function blobUrl(
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
  start: number,
  end: number,
  ranged: boolean
): string {
  const suffix = filePath.split('/').map(encodeSegment).join('/')
  const base = `https://github.com/${encodeSegment(owner)}/${encodeSegment(repo)}/blob/${sha}/${suffix}`
  if (!ranged) return base
  if (start === end) return `${base}#L${start}`
  return `${base}#L${start}-L${end}`
}

function languageOf(filePath: string): string {
  const base = filePath.split('/').pop()?.toLowerCase() || ''
  if (CODE_NAMES[base]) return CODE_NAMES[base]
  const ext = base.includes('.') ? base.split('.').pop() || '' : ''
  return CODE_LANG[ext] || ''
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function completeLineCount(text: string): number {
  const lines = splitLines(text)
  if (!text.endsWith('\n') && !text.endsWith('\r'))
    return Math.max(0, lines.length - 1)
  return lines.length
}

function cleanParts(parts: string[]): string[] | null {
  if (!parts.length) return null
  if (
    parts.some((part) => part === '.' || part === '..' || part.includes('\0'))
  )
    return null
  return parts
}

function decodeParts(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
}

function isRepoName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function token(): string {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

function rawHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  const auth = token()
  if (auth) headers.Authorization = `Bearer ${auth}`
  return headers
}

function githubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': accept,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const auth = token()
  if (auth) headers.Authorization = `Bearer ${auth}`
  return headers
}

function warn(href: string, reason: string) {
  console.warn(`::code ${href} left as a link: ${reason}`)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function storeOf(view: CodeView): Stored {
  return {
    href: view.href,
    owner: view.owner,
    repo: view.repo,
    path: view.path,
    sha: view.sha,
    start: view.start,
    end: view.end,
    ranged: view.ranged,
    code: view.code,
    lang: view.lang,
  }
}

function storedView(data: Stored): CodeView | null {
  if (!data || typeof data.href !== 'string' || !data.href) return null
  return {
    href: data.href,
    owner: data.owner || '',
    repo: data.repo || '',
    path: data.path || '',
    sha: data.sha || '',
    start: data.start || 0,
    end: data.end || 0,
    ranged: Boolean(data.ranged),
    code: data.code || '',
    lang: data.lang || '',
  }
}

function fresh(entry: CacheEntry): boolean {
  const age = Date.now() - entry.fetchedAt
  if (!Number.isFinite(entry.fetchedAt) || age < 0) return false
  if (!entry.ok) return age < (entry.pinned ? YEAR : HOUR)
  return age < (entry.pinned ? YEAR : WEEK)
}

async function cacheStore(): Promise<Record<string, CacheEntry>> {
  if (memory) return memory
  if (!loading) {
    loading = readFile(CACHE_PATH, 'utf8')
      .then((raw) => {
        const parsed = JSON.parse(raw) as Record<string, CacheEntry>
        memory = parsed && typeof parsed === 'object' ? parsed : {}
        return memory
      })
      .catch(() => {
        memory = {}
        return memory
      })
  }
  return loading
}

function remember(key: string, entry: CacheEntry) {
  if (!memory) memory = {}
  memory[key] = entry
  const payload = `${JSON.stringify(memory, null, 2)}\n`
  writing = writing
    .then(async () => {
      await mkdir(path.dirname(CACHE_PATH), { recursive: true })
      await writeFile(CACHE_PATH, payload)
    })
    .catch(() => undefined)
}
