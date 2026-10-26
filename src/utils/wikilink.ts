import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import GithubSlugger from 'github-slugger'

import { FEATURES, SITE } from '../config'

// [[wikilinks]] for the collections listed in FEATURES.wikilink.
//
// A target matches, in order: a path under the collection (`2026/10/新的起点`
// or `blog/2026/10/新的起点`), a unique filename, then a unique frontmatter
// title. `[[page#heading]]`, `[[page^block]]`, and `[[page|label]]` split the
// same way as the notes site. Heading hashes use github-slugger so they line
// up with rehypeHeadingIds. Drafts are omitted in production, same as
// getFilteredPosts.

export interface BacklinkEntry {
  title: string
  url: string
}

interface Anchor {
  kind: 'heading' | 'block'
  value: string
}

export interface ParsedWikilink {
  target: string
  label: string
  anchor?: Anchor
}

interface Page {
  file: string
  relFromCwd: string
  title: string
  url: string
  headingByText: Map<string, string>
  headingBySlug: Map<string, string>
}

interface WikilinkIndex {
  backlinks: Record<string, BacklinkEntry[]>
  byFile: Map<string, Page>
  byFilename: Map<string, Page[]>
  byTitle: Map<string, Page[]>
  byPath: Map<string, Page[]>
}

interface WikilinkRoot {
  dir: string
  collection: string
  pathnamePrefix: string
}

export interface ResolvedWikilink {
  label: string
  exists: boolean
  href?: string
}

const WIKILINK_RE = /(!?)(\\)?\[\[([^\]\n]+?)\]\]/g
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

let cache: { stamp: string; index: WikilinkIndex } | undefined

export function isWikilinkEnabled() {
  const feature = FEATURES.wikilink
  return Array.isArray(feature) && feature[0] === true
}

export function getWikilinkIndex(): WikilinkIndex {
  const stamp = indexStamp()
  if (cache?.stamp === stamp) return cache.index
  const index = buildIndex()
  cache = { stamp, index }
  return index
}

export function lookupBacklinks(pathname: string): BacklinkEntry[] {
  const key = normalizePathname(pathname)
  const entries = getWikilinkIndex().backlinks[key] ?? []
  return entries.filter((entry) => normalizePathname(entry.url) !== key)
}

export function parseWikilink(inner: string): ParsedWikilink | undefined {
  const trimmed = inner.trim()
  if (!trimmed) return

  const pipe = trimmed.indexOf('|')
  const body = (pipe === -1 ? trimmed : trimmed.slice(0, pipe)).trim()
  const alias = pipe === -1 ? undefined : trimmed.slice(pipe + 1).trim()
  const cut = firstAnchor(body)

  let target = body
  let anchor: Anchor | undefined
  if (cut) {
    target = body.slice(0, cut.index).trim()
    const value = body.slice(cut.index + 1).trim()
    if (value) anchor = { kind: cut.kind, value }
  }

  if (!target && !anchor) return

  return {
    target,
    anchor,
    label: alias || (pipe === -1 ? trimmed : body),
  }
}

export function resolveWikilink(
  parsed: ParsedWikilink,
  index: WikilinkIndex,
  current?: Page
): ResolvedWikilink {
  const page = parsed.target ? findPage(index, parsed.target) : current
  if (!page) return { label: parsed.label, exists: false }

  const hash = parsed.anchor ? anchorId(page, parsed.anchor) : ''
  const same = current?.url === page.url
  const href = hash ? `${same ? '' : page.url}#${hash}` : page.url

  return { label: parsed.label, exists: true, href }
}

export function pageForFile(
  index: WikilinkIndex,
  filePath: string | undefined
): Page | undefined {
  if (!filePath) return
  const resolved = path.resolve(filePath)
  const direct = index.byFile.get(resolved)
  if (direct) return direct

  const normalized = resolved.split(path.sep).join('/')
  for (const page of index.byFile.values()) {
    if (
      normalized === page.relFromCwd ||
      normalized.endsWith(`/${page.relFromCwd}`)
    ) {
      return page
    }
  }
}

function buildIndex(): WikilinkIndex {
  const index: WikilinkIndex = {
    backlinks: {},
    byFile: new Map(),
    byFilename: new Map(),
    byTitle: new Map(),
    byPath: new Map(),
  }
  const pages: { page: Page; body: string }[] = []
  const skipDrafts = process.env.NODE_ENV === 'production'

  for (const root of wikilinkRoots()) {
    walk(root.dir, (file) => {
      const raw = readFileSync(file, 'utf8')
      const { data, body } = splitFrontmatter(raw)
      if (skipDrafts && isDraft(data.draft)) return

      const rel = path.relative(root.dir, file).replace(/\.mdx?$/, '')
      const relPosix = rel.split(path.sep).join('/')
      const filename = path.basename(relPosix).toLowerCase()
      const title = data.title || path.basename(relPosix)
      const page: Page = {
        file: path.resolve(file),
        relFromCwd: path
          .relative(process.cwd(), file)
          .split(path.sep)
          .join('/'),
        title,
        url: pageUrl(root.pathnamePrefix, relPosix),
        ...headingMaps(stripCode(body)),
      }

      pages.push({ page, body })
      index.byFile.set(page.file, page)
      pushMap(index.byFilename, filename, page)
      pushMap(index.byPath, relPosix.toLowerCase(), page)
      pushMap(
        index.byPath,
        `${root.collection}/${relPosix}`.toLowerCase(),
        page
      )
      const prefixKey = root.pathnamePrefix
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase()
      if (prefixKey && prefixKey !== root.collection.toLowerCase()) {
        pushMap(index.byPath, `${prefixKey}/${relPosix}`.toLowerCase(), page)
      }
      const titleKey = title.trim().toLowerCase()
      if (titleKey) pushMap(index.byTitle, titleKey, page)
    })
  }

  for (const { page, body } of pages) {
    for (const inner of outgoingTargets(body)) {
      const parsed = parseWikilink(inner)
      if (!parsed) continue
      const resolved = resolveWikilink(parsed, index, page)
      if (!resolved.exists || !resolved.href) continue

      const targetUrl = resolved.href.split('#')[0] || page.url
      if (normalizePathname(targetUrl) === normalizePathname(page.url)) continue

      const list = (index.backlinks[normalizePathname(targetUrl)] ??= [])
      if (list.some((entry) => entry.url === page.url)) continue
      list.push({ title: page.title, url: page.url })
    }
  }

  for (const list of Object.values(index.backlinks)) {
    list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }

  return index
}

function outgoingTargets(body: string): string[] {
  const targets: string[] = []
  WIKILINK_RE.lastIndex = 0
  for (const match of stripCode(body).matchAll(WIKILINK_RE)) {
    if (match[1] || match[2]) continue
    if (match[3]) targets.push(match[3])
  }
  return targets
}

function headingMaps(
  visible: string
): Pick<Page, 'headingByText' | 'headingBySlug'> {
  const headingByText = new Map<string, string>()
  const headingBySlug = new Map<string, string>()
  const slugger = new GithubSlugger()

  for (const line of visible.split('\n')) {
    const heading = HEADING_RE.exec(line)
    if (!heading) continue
    const text = stripInlineMd(heading[2])
    if (!text) continue
    const id = slugger.slug(text)
    const key = headingKey(text)
    if (!headingByText.has(key)) headingByText.set(key, id)
    headingBySlug.set(id.toLowerCase(), id)
  }

  return { headingByText, headingBySlug }
}

function findPage(index: WikilinkIndex, target: string): Page | undefined {
  const key = target
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\.mdx?$/, '')
  if (!key) return

  return (
    sole(index.byPath.get(key)) ??
    sole(index.byFilename.get(key)) ??
    sole(index.byTitle.get(key))
  )
}

function anchorId(page: Page, anchor: Anchor): string {
  if (anchor.kind === 'block') return anchor.value
  const written = anchor.value.trim()
  return (
    page.headingByText.get(headingKey(written)) ??
    page.headingBySlug.get(written.toLowerCase()) ??
    new GithubSlugger().slug(stripInlineMd(written))
  )
}

function firstAnchor(
  body: string
): { index: number; kind: Anchor['kind'] } | undefined {
  const hash = body.indexOf('#')
  const caret = body.indexOf('^')
  if (hash === -1 && caret === -1) return
  if (hash === -1) return { index: caret, kind: 'block' }
  if (caret === -1) return { index: hash, kind: 'heading' }
  return hash < caret
    ? { index: hash, kind: 'heading' }
    : { index: caret, kind: 'block' }
}

function pageUrl(pathnamePrefix: string, rel: string) {
  const base = SITE.base.replace(/\/+$/, '')
  const sitePrefix =
    !base || base === '/' ? '' : base.startsWith('/') ? base : `/${base}`
  const prefix = `/${pathnamePrefix}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return `${sitePrefix}${prefix}/${rel}/`.replace(/\/{2,}/g, '/')
}

function wikilinkRoots(): WikilinkRoot[] {
  const feature = FEATURES.wikilink
  if (!Array.isArray(feature) || feature[0] !== true) return []

  return feature[1].collections.map((item) => {
    if (!/^[A-Za-z0-9_-]+$/.test(item.collection)) {
      throw new Error(
        `FEATURES.wikilink collection "${item.collection}" must be a folder name under src/content.`
      )
    }

    return {
      dir: path.join(process.cwd(), 'src/content', item.collection),
      collection: item.collection,
      pathnamePrefix: item.pathnamePrefix,
    }
  })
}

function sole(pages: Page[] | undefined) {
  return pages?.length === 1 ? pages[0] : undefined
}

function normalizePathname(pathname: string) {
  let pathOnly = pathname.split(/[?#]/)[0] || '/'
  try {
    pathOnly = decodeURI(pathOnly)
  } catch {
    // Keep a malformed escape as written.
  }
  if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`
  return pathOnly.endsWith('/') ? pathOnly : `${pathOnly}/`
}

function headingKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripInlineMd(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

function stripCode(source: string) {
  const lines = source.split('\n')
  const kept: string[] = []
  let fence: string | undefined

  for (const line of lines) {
    if (fence) {
      if (line.startsWith(fence)) fence = undefined
      continue
    }
    const open = /^(`{3,}|~{3,})/.exec(line)
    if (open) {
      fence = open[1]
      continue
    }
    kept.push(line)
  }

  return kept.join('\n').replace(/`[^`\n]*`/g, '')
}

function splitFrontmatter(raw: string): {
  data: Record<string, string>
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { data: {}, body: text }

  const end = text.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: text }

  const yaml = text.slice(text.indexOf('\n') + 1, end)
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, string> = {}

  for (const line of yaml.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    data[match[1]] = unquote(match[2].trim())
  }

  return { data, body }
}

function unquote(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function isDraft(value: string | undefined) {
  return value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes'
}

function pushMap(map: Map<string, Page[]>, key: string, page: Page) {
  const list = map.get(key)
  if (!list) {
    map.set(key, [page])
    return
  }
  if (!list.some((item) => item.file === page.file)) list.push(page)
}

function walk(dir: string, visit: (file: string) => void) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, visit)
    else if (/\.mdx?$/.test(entry.name)) visit(full)
  }
}

function indexStamp() {
  const roots = wikilinkRoots()
  const parts = [
    process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
    roots.map((root) => `${root.collection}:${root.pathnamePrefix}`).join(','),
  ]
  for (const root of roots) {
    walk(root.dir, (file) => {
      parts.push(`${file}:${statSync(file).mtimeMs}`)
    })
  }
  return parts.join(';')
}
