import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parseFrontmatter } from '@astrojs/markdown-remark'

import { insideDirectory } from './specimen-paths'

// A skill page on skills.sh or SkillsMP is an index. The files live in the
// GitHub directory that page points at. Cached under .cache/skills.

const WEEK = 7 * 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const CACHE_DIR = path.join(process.cwd(), '.cache', 'skills')
const INDEX_PATH = path.join(CACHE_DIR, 'index.json')
const USER_AGENT = 'antfustyle-blog'
const MAX_FILES = 40
const MAX_FILE_BYTES = 100_000
const MAX_SKILL_BYTES = 400_000
const TREE_LIMIT = 4_000_000

const SKIP_NAMES = new Set(['node_modules', '.git', 'dist'])
const SKILL_ROOTS = [
  'skills',
  '.agents/skills',
  '.github/skills',
  '.claude/skills',
  '.cursor/skills',
  '.copilot/skills',
  '.roo/skills',
]

export interface SkillView {
  href: string
  source: string
  owner: string
  repo: string
  path: string
  stars: number | null
  avatar: string
  name: string
  description: string
  dir: string | null
  shown: number
  total: number
}

interface StoredView {
  href: string
  source: string
  owner: string
  repo: string
  path: string
  stars: number | null
  avatar: string
  name: string
  description: string
  shown: number
  total: number
  files: boolean
  fileKey: string
}

interface CacheEntry {
  fetchedAt: number
  ok: boolean
  view?: StoredView
}

interface RepoInfo {
  owner: string
  repo: string
  defaultBranch: string
  stars: number
  description: string
  avatar: string
}

interface GitBlob {
  path: string
  size: number
}

interface GithubTarget {
  owner: string
  repo: string
  mode: 'repo' | 'tree' | 'blob'
  rest: string
}

let memory: Record<string, CacheEntry> | null = null
let loading: Promise<Record<string, CacheEntry>> | null = null
let writing: Promise<void> = Promise.resolve()
const inflight = new Map<string, Promise<SkillView | null>>()
const fileInflight = new Map<string, Promise<string | null>>()
const commitCache = new Map<string, string | null>()

export function canonicalSkillUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.href
  } catch {
    return ''
  }
}

export function flushSkillCache(): Promise<void> {
  return writing
}

export async function loadSkill(rawUrl: string): Promise<SkillView | null> {
  const href = canonicalSkillUrl(rawUrl)
  if (!href) return null
  const pending = inflight.get(href)
  if (pending) return pending
  const task = loadFresh(href).finally(() => {
    inflight.delete(href)
  })
  inflight.set(href, task)
  return task
}

async function loadFresh(href: string): Promise<SkillView | null> {
  const store = await cacheStore()
  const hit = store[href]
  if (hit && fresh(hit)) {
    if (!hit.ok || !hit.view) return null
    const cached = materialize(hit.view)
    if (cached) return cached
  }

  let view: SkillView | null = null
  try {
    view = await resolveSkill(href)
  } catch (error) {
    console.warn(`::skill ${href} failed: ${errorText(error)}`)
    view = null
  }

  remember(href, {
    fetchedAt: Date.now(),
    ok: view != null,
    view: view ? storeView(view) : undefined,
  })
  return view
}

function fresh(entry: CacheEntry): boolean {
  const age = Date.now() - entry.fetchedAt
  if (!Number.isFinite(entry.fetchedAt) || age < 0) return false
  return entry.ok ? age < WEEK : age < HOUR
}

function storeView(view: SkillView): StoredView {
  return {
    href: view.href,
    source: view.source,
    owner: view.owner,
    repo: view.repo,
    path: view.path,
    stars: view.stars,
    avatar: view.avatar,
    name: view.name,
    description: view.description,
    shown: view.shown,
    total: view.total,
    files: Boolean(view.dir),
    fileKey: view.dir ? path.basename(view.dir) : '',
  }
}

function materialize(stored: StoredView): SkillView | null {
  const dir =
    stored.files && stored.fileKey
      ? path.join(CACHE_DIR, 'files', stored.fileKey)
      : null
  if (dir && !existsSync(dir)) return null
  return {
    href: stored.href,
    source: stored.source,
    owner: stored.owner,
    repo: stored.repo,
    path: stored.path,
    stars: stored.stars,
    avatar: stored.avatar,
    name: stored.name,
    description: stored.description,
    dir,
    shown: stored.shown,
    total: stored.total,
  }
}

async function cacheStore(): Promise<Record<string, CacheEntry>> {
  if (memory) return memory
  if (!loading) {
    loading = readFile(INDEX_PATH, 'utf8')
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
  const snapshot = memory
  writing = writing
    .then(async () => {
      await mkdir(path.dirname(INDEX_PATH), { recursive: true })
      await writeFile(INDEX_PATH, `${JSON.stringify(snapshot)}\n`)
    })
    .catch(() => undefined)
}

async function resolveSkill(href: string): Promise<SkillView | null> {
  const url = new URL(href)
  const kind = hostKind(url.hostname)
  if (!kind) {
    return linkOnly(href, hostLabel(url.hostname), '', '', href)
  }
  if (kind === 'skillsmp') {
    const github = await skillsmpRepository(href)
    if (!github) return null
    return resolveGithub(github, 'SkillsMP', href)
  }
  if (kind === 'skills.sh') {
    return resolveSkillsSh(url, href)
  }
  return resolveGithub(href, 'GitHub', href)
}

function linkOnly(
  href: string,
  source: string,
  owner: string,
  repo: string,
  name: string
): SkillView {
  return {
    href,
    source,
    owner,
    repo,
    path: '',
    stars: null,
    avatar: '',
    name,
    description: '',
    dir: null,
    shown: 0,
    total: 0,
  }
}

function hostKind(hostname: string): '' | 'github' | 'skills.sh' | 'skillsmp' {
  const host = hostname.replace(/^www\./, '').toLowerCase()
  if (host === 'github.com' || host === 'raw.githubusercontent.com')
    return 'github'
  if (host === 'skills.sh') return 'skills.sh'
  if (host === 'skillsmp.com' || host.endsWith('.skillsmp.com'))
    return 'skillsmp'
  return ''
}

function hostLabel(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

async function resolveSkillsSh(
  url: URL,
  href: string
): Promise<SkillView | null> {
  const parts = decodeParts(url.pathname)
  if (parts.length < 2 || parts.length > 3)
    return linkOnly(href, 'skills.sh', '', '', href)
  const owner = parts[0] || ''
  const repo = (parts[1] || '').replace(/\.git$/, '')
  const slug = parts[2] || ''
  if (!isRepoName(owner) || !isRepoName(repo)) {
    return linkOnly(href, 'skills.sh', '', '', href)
  }
  const info = await repoInfo(owner, repo)
  if (!info) return linkOnly(href, 'skills.sh', owner, repo, `${owner}/${repo}`)
  const sha = await commitSha(info.owner, info.repo, info.defaultBranch)
  if (!sha) return repoCard(href, 'skills.sh', info)
  const blobs = await repoBlobs(info.owner, info.repo, sha)
  if (!blobs) return repoCard(href, 'skills.sh', info)
  let dir = slug ? matchSlug(blobs, slug) : soleSkill(blobs, '')
  if (dir == null && slug) {
    const root = await rootSkillName(info.owner, info.repo, sha)
    if (root && root.toLowerCase() === slug.toLowerCase()) dir = ''
  }
  if (dir == null) return repoCard(href, 'skills.sh', info)
  return finish(href, 'skills.sh', info, sha, dir, blobs)
}

async function resolveGithub(
  githubUrl: string,
  source: string,
  href: string
): Promise<SkillView | null> {
  let parsed: URL
  try {
    parsed = new URL(githubUrl)
  } catch {
    return linkOnly(href, source, '', '', href)
  }
  const target = parseGithub(parsed)
  if (!target) return linkOnly(href, source, '', '', href)
  const info = await repoInfo(target.owner, target.repo)
  if (!info) {
    return linkOnly(href, source, target.owner, target.repo, target.repo)
  }
  const split = await splitRef(info, target)
  if (!split) return repoCard(href, source, info)
  const blobs = await repoBlobs(info.owner, info.repo, split.sha)
  const pointed = target.mode === 'blob' ? parentPath(split.path) : split.path
  let dir: string | null = null
  if (blobs) {
    dir =
      target.mode === 'blob'
        ? skillRootOfFile(blobs, split.path)
        : soleSkill(blobs, pointed)
  } else if (target.mode !== 'repo') {
    const listed = await listContents(info.owner, info.repo, split.sha, pointed)
    if (listed) {
      dir = soleSkill(listed, pointed)
      if (dir != null) return finish(href, source, info, split.sha, dir, listed)
    }
  }
  if (dir == null) return repoCard(href, source, info)
  return finish(href, source, info, split.sha, dir, blobs || [])
}

async function finish(
  href: string,
  source: string,
  info: RepoInfo,
  sha: string,
  dir: string,
  blobs: GitBlob[]
): Promise<SkillView> {
  const fileKey = cacheId(`${info.owner}/${info.repo}@${sha}:${dir}`)
  const files = blobsUnder(blobs, dir)
  const downloaded = await downloadFiles(
    info.owner,
    info.repo,
    sha,
    files,
    dir,
    fileKey
  )
  const skillFile = await readSkillFile(downloaded.dir)
  const meta = skillFile ? skillMeta(skillFile) : { name: '', description: '' }
  const fallback = dir.split('/').filter(Boolean).pop() || info.repo
  return {
    href,
    source,
    owner: info.owner,
    repo: info.repo,
    path: dir,
    stars: info.stars,
    avatar: info.avatar,
    name: meta.name || fallback,
    description: meta.description,
    dir: downloaded.dir,
    shown: downloaded.shown,
    total: downloaded.total,
  }
}

function repoCard(href: string, source: string, info: RepoInfo): SkillView {
  return {
    href,
    source,
    owner: info.owner,
    repo: info.repo,
    path: '',
    stars: info.stars,
    avatar: info.avatar,
    name: info.repo,
    description: info.description,
    dir: null,
    shown: 0,
    total: 0,
  }
}

function parseGithub(url: URL): GithubTarget | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const parts = decodeParts(url.pathname)
  if (host === 'raw.githubusercontent.com') {
    if (parts.length < 3) return null
    const owner = parts[0] || ''
    const repo = (parts[1] || '').replace(/\.git$/, '')
    if (!isRepoName(owner) || !isRepoName(repo)) return null
    return { owner, repo, mode: 'blob', rest: parts.slice(2).join('/') }
  }
  if (parts.length < 2) return null
  const owner = parts[0] || ''
  const repo = (parts[1] || '').replace(/\.git$/, '')
  if (!isRepoName(owner) || !isRepoName(repo)) return null
  if (parts.length === 2) return { owner, repo, mode: 'repo', rest: '' }
  const mode = parts[2]
  if (mode === 'tree' || mode === 'blob') {
    return { owner, repo, mode, rest: parts.slice(3).join('/') }
  }
  return null
}

async function splitRef(
  info: RepoInfo,
  target: GithubTarget
): Promise<{ sha: string; path: string } | null> {
  if (target.mode === 'repo' || !target.rest) {
    const sha = await commitSha(info.owner, info.repo, info.defaultBranch)
    if (!sha) return null
    return { sha, path: '' }
  }
  if (
    target.rest === info.defaultBranch ||
    target.rest.startsWith(`${info.defaultBranch}/`)
  ) {
    const sha = await commitSha(info.owner, info.repo, info.defaultBranch)
    if (!sha) return null
    const path = target.rest.slice(info.defaultBranch.length).replace(/^\//, '')
    return { sha, path }
  }
  const parts = target.rest.split('/').filter(Boolean)
  const limit = Math.min(parts.length, 6)
  for (let size = limit; size >= 1; size -= 1) {
    const ref = parts.slice(0, size).join('/')
    const sha = await commitSha(info.owner, info.repo, ref)
    if (!sha) continue
    return { sha, path: parts.slice(size).join('/') }
  }
  return null
}

function soleSkill(blobs: GitBlob[], pointed: string): string | null {
  const dirs = skillDirectories(blobs, pointed)
  if (dirs.includes(pointed)) return pointed
  if (dirs.length === 1) return dirs[0] ?? null
  return null
}

function skillDirectories(blobs: GitBlob[], within: string): string[] {
  const prefix = within ? `${within}/` : ''
  const dirs = new Set<string>()
  for (const blob of blobs) {
    if (!isSkillPath(blob.path)) continue
    if (
      within &&
      blob.path !== `${within}/SKILL.md` &&
      blob.path !== `${within}/skill.md` &&
      !blob.path.startsWith(prefix)
    ) {
      continue
    }
    const dir = parentPath(blob.path)
    if (within && dir !== within && !dir.startsWith(prefix) && dir !== '')
      continue
    if (within && dir !== within && !dir.startsWith(prefix)) continue
    dirs.add(dir)
  }
  return [...dirs]
}

function matchSlug(blobs: GitBlob[], slug: string): string | null {
  const wanted = slug.toLowerCase()
  const hits: { dir: string; rank: number }[] = []
  for (const dir of skillDirectories(blobs, '')) {
    if (!dir) continue
    const name = dir.split('/').pop() || ''
    if (name.toLowerCase() !== wanted) continue
    const parent = dir.slice(0, dir.length - name.length).replace(/\/$/, '')
    const index = SKILL_ROOTS.indexOf(parent)
    const rank = index >= 0 ? index : 50
    hits.push({ dir, rank })
  }
  if (!hits.length) return null
  hits.sort((a, b) => a.rank - b.rank || a.dir.localeCompare(b.dir))
  const best = hits[0]?.rank
  const top = hits.filter((hit) => hit.rank === best)
  if (top.length !== 1) return null
  return top[0]?.dir ?? null
}

function skillRootOfFile(blobs: GitBlob[], filePath: string): string | null {
  let dir = parentPath(filePath)
  while (true) {
    const skill = dir ? `${dir}/SKILL.md` : 'SKILL.md'
    const lower = dir ? `${dir}/skill.md` : 'skill.md'
    if (blobs.some((blob) => blob.path === skill || blob.path === lower))
      return dir
    if (!dir) return null
    dir = parentPath(dir)
  }
}

function blobsUnder(blobs: GitBlob[], dir: string): GitBlob[] {
  const prefix = dir ? `${dir}/` : ''
  return blobs.filter((blob) => {
    const rel = dir
      ? blob.path.startsWith(prefix)
        ? blob.path.slice(prefix.length)
        : ''
      : blob.path
    if (!rel) return false
    return !rel
      .split('/')
      .some(
        (part) => !part || part === '.' || part === '..' || SKIP_NAMES.has(part)
      )
  })
}

async function downloadFiles(
  owner: string,
  repo: string,
  sha: string,
  files: GitBlob[],
  dir: string,
  fileKey: string
): Promise<{ dir: string | null; shown: number; total: number }> {
  const chosen = chooseFiles(files, dir)
  const pending = fileInflight.get(fileKey)
  const ready = pending
    ? await pending
    : await startFiles(owner, repo, sha, chosen.picked, fileKey)
  const shown = ready ? countFiles(ready) : 0
  return {
    dir: shown ? ready : null,
    shown,
    total: files.length,
  }
}

function startFiles(
  owner: string,
  repo: string,
  sha: string,
  picked: { file: GitBlob; rel: string }[],
  fileKey: string
): Promise<string | null> {
  const task = writeFiles(owner, repo, sha, picked, fileKey).finally(() => {
    fileInflight.delete(fileKey)
  })
  fileInflight.set(fileKey, task)
  return task
}

function chooseFiles(files: GitBlob[], dir: string) {
  const prefix = dir ? `${dir}/` : ''
  const ranked = files
    .map((file) => {
      const rel = prefix ? file.path.slice(prefix.length) : file.path
      return { file, rel }
    })
    .filter((item) => item.rel)
    .sort((a, b) => {
      const aSkill = isSkillPath(a.rel) ? 0 : 1
      const bSkill = isSkillPath(b.rel) ? 0 : 1
      if (aSkill !== bSkill) return aSkill - bSkill
      return a.rel.localeCompare(b.rel)
    })
  const picked: { file: GitBlob; rel: string }[] = []
  for (const item of ranked) {
    if (picked.length >= MAX_FILES) break
    const cap = isSkillPath(item.rel) ? MAX_SKILL_BYTES : MAX_FILE_BYTES
    if (item.file.size > cap) continue
    picked.push(item)
  }
  return { picked }
}

async function writeFiles(
  owner: string,
  repo: string,
  sha: string,
  picked: { file: GitBlob; rel: string }[],
  fileKey: string
): Promise<string | null> {
  if (!picked.length) return null
  const finalDir = path.join(CACHE_DIR, 'files', fileKey)
  if (hasSkillFile(finalDir) && countFiles(finalDir) >= picked.length)
    return finalDir
  const temp = path.join(CACHE_DIR, 'tmp', fileKey)
  await rm(temp, { recursive: true, force: true })
  await mkdir(temp, { recursive: true })
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(4, picked.length) },
    async () => {
      while (cursor < picked.length) {
        const item = picked[cursor]
        cursor += 1
        if (!item) return
        const bytes = await fetchRaw(owner, repo, sha, item.file.path)
        if (!bytes) continue
        const abs = path.resolve(temp, item.rel)
        if (!insideDirectory(temp, abs)) continue
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, bytes)
      }
    }
  )
  await Promise.all(workers)
  if (!hasSkillFile(temp)) {
    await rm(temp, { recursive: true, force: true })
    return null
  }
  await rm(finalDir, { recursive: true, force: true })
  await mkdir(path.dirname(finalDir), { recursive: true })
  await rename(temp, finalDir)
  return finalDir
}

function hasSkillFile(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'SKILL.md')) ||
    existsSync(path.join(dir, 'skill.md'))
  )
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0
  let count = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    for (const name of readdirSync(current)) {
      const abs = path.join(current, name)
      if (statSync(abs).isDirectory()) stack.push(abs)
      else count += 1
    }
  }
  return count
}

async function readSkillFile(dir: string | null): Promise<string | null> {
  if (!dir) return null
  for (const name of ['SKILL.md', 'skill.md']) {
    const abs = path.join(dir, name)
    if (!existsSync(abs)) continue
    return readFile(abs, 'utf8')
  }
  return null
}

function skillMeta(source: string): { name: string; description: string } {
  const parsed = parseFrontmatter(source)
  const name =
    typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name.trim()
      : ''
  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : ''
  return { name, description }
}

async function rootSkillName(
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  const bytes = await fetchRaw(owner, repo, sha, 'SKILL.md')
  if (!bytes) return ''
  return skillMeta(bytes.toString('utf8')).name
}

async function repoInfo(owner: string, repo: string): Promise<RepoInfo | null> {
  const data = await githubJson<{
    full_name?: string
    default_branch?: string
    stargazers_count?: number
    description?: string | null
    owner?: { login?: string; avatar_url?: string }
  }>(
    `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`
  )
  if (!data?.default_branch || !data.full_name) return null
  const slash = data.full_name.indexOf('/')
  if (slash <= 0) return null
  return {
    owner: data.full_name.slice(0, slash),
    repo: data.full_name.slice(slash + 1),
    defaultBranch: data.default_branch,
    stars: data.stargazers_count ?? 0,
    description: (data.description || '').trim(),
    avatar: httpsUrl(data.owner?.avatar_url || ''),
  }
}

async function commitSha(
  owner: string,
  repo: string,
  ref: string
): Promise<string | null> {
  const key = `${owner}/${repo}@${ref}`
  if (commitCache.has(key)) return commitCache.get(key) ?? null
  const data = await githubJson<{ sha?: string }>(
    `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/commits/${encodeURIComponent(ref)}`
  )
  const sha = data?.sha || null
  commitCache.set(key, sha)
  return sha
}

async function repoBlobs(
  owner: string,
  repo: string,
  sha: string
): Promise<GitBlob[] | null> {
  const text = await githubText(
    `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/git/trees/${sha}?recursive=1`,
    TREE_LIMIT
  )
  if (!text) return null
  const data = JSON.parse(text) as {
    truncated?: boolean
    tree?: { path?: string; type?: string; size?: number }[]
  }
  if (data.truncated) return null
  return (data.tree || [])
    .filter((item) => item.type === 'blob' && item.path)
    .map((item) => ({ path: item.path || '', size: item.size || 0 }))
}

async function listContents(
  owner: string,
  repo: string,
  sha: string,
  dir: string
): Promise<GitBlob[] | null> {
  const out: GitBlob[] = []
  const ok = await walkContents(owner, repo, sha, dir, out, 0)
  return ok ? out : null
}

async function walkContents(
  owner: string,
  repo: string,
  sha: string,
  dir: string,
  out: GitBlob[],
  depth: number
): Promise<boolean> {
  if (depth > 6 || out.length > 200) return false
  const suffix = dir ? `/${dir.split('/').map(encodeSegment).join('/')}` : ''
  const data = await githubJson<
    | { type?: string; path?: string; size?: number; name?: string }[]
    | { type?: string; path?: string; size?: number }
  >(
    `https://api.github.com/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/contents${suffix}?ref=${encodeURIComponent(sha)}`
  )
  if (!data) return false
  const rows = Array.isArray(data) ? data : [data]
  for (const row of rows) {
    if (!row.path || (!row.name && !row.path)) continue
    const name = row.path.split('/').pop() || ''
    if (SKIP_NAMES.has(name)) continue
    if (row.type === 'file') {
      out.push({ path: row.path, size: row.size || 0 })
    } else if (row.type === 'dir') {
      const nested = await walkContents(
        owner,
        repo,
        sha,
        row.path,
        out,
        depth + 1
      )
      if (!nested) return false
    }
  }
  return true
}

async function fetchRaw(
  owner: string,
  repo: string,
  sha: string,
  filePath: string
): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bytes = await fetchRawOnce(owner, repo, sha, filePath)
    if (bytes) return bytes
  }
  return null
}

async function fetchRawOnce(
  owner: string,
  repo: string,
  sha: string,
  filePath: string
): Promise<Buffer | null> {
  const url = `https://raw.githubusercontent.com/${encodeSegment(owner)}/${encodeSegment(repo)}/${sha}/${filePath
    .split('/')
    .map(encodeSegment)
    .join('/')}`
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 429 || response.status >= 500) return null
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let received = 0
    while (received <= MAX_SKILL_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      received += value.byteLength
      if (received > MAX_SKILL_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(Buffer.from(value))
    }
    await reader.cancel().catch(() => undefined)
    const bytes = Buffer.concat(chunks)
    return bytes.byteLength ? bytes : null
  } catch {
    return null
  }
}

async function skillsmpRepository(pageUrl: string): Promise<string | null> {
  let html: string | null = null
  for (let attempt = 0; attempt < 3 && !html; attempt += 1) {
    html = await textBody(
      pageUrl,
      { 'Accept': 'text/html', 'User-Agent': USER_AGENT },
      2_000_000
    )
  }
  if (!html) return null
  const blocks = html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const block of blocks) {
    try {
      const found = findCodeRepository(JSON.parse(block[1] || ''))
      if (found) return found
    } catch {
      continue
    }
  }
  const urls = [
    ...html.matchAll(
      /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:tree|blob)\/[A-Za-z0-9_.~/%-]+/g
    ),
  ].map((match) => match[0] || '')
  urls.sort((a, b) => b.length - a.length)
  return urls[0] || null
}

function findCodeRepository(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findCodeRepository(item)
      if (found) return found
    }
    return null
  }
  const row = data as Record<string, unknown>
  if (
    typeof row.codeRepository === 'string' &&
    row.codeRepository.includes('github.com')
  ) {
    return row.codeRepository
  }
  for (const value of Object.values(row)) {
    const found = findCodeRepository(value)
    if (found) return found
  }
  return null
}

async function githubJson<T>(url: string): Promise<T | null> {
  const text = await githubText(url, 1_000_000)
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function githubText(url: string, limit: number): Promise<string | null> {
  return textBody(url, githubHeaders(), limit)
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function textBody(
  url: string,
  headers: Record<string, string>,
  limit: number
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    let body = ''
    while (received < limit) {
      const { done, value } = await reader.read()
      if (done || !value) break
      received += value.byteLength
      if (received > limit) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    await reader.cancel().catch(() => undefined)
    return body
  } catch {
    return null
  }
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

function isSkillPath(filePath: string): boolean {
  const base = filePath.split('/').pop()?.toLowerCase()
  return base === 'skill.md'
}

function parentPath(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  return slash < 0 ? '' : filePath.slice(0, slash)
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function httpsUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

function cacheId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
