import { AsyncLocalStorage } from 'node:async_hooks'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import {
  createMarkdownProcessor,
  parseFrontmatter,
} from '@astrojs/markdown-remark'
import { createRenderer } from 'astro-expressive-code'
import { visit } from 'unist-util-visit'

import ecConfig from '../../ec.config.mjs'

import type { RehypePlugins, RemarkPlugins } from 'astro'
import type { MarkdownRenderer } from '@astrojs/markdown-remark'

import { fileIcon } from './specimen-icons'
import {
  flushSpecimenAssets,
  imagePublicUrl,
  insideDirectory,
  isImageExt,
  SKIP_NAMES,
  SPECIMENS_DIR,
  trackSpecimenAsset,
} from './specimen-paths'

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  data?: { meta?: unknown }
}

interface FileEntry {
  kind: 'file'
  name: string
  rel: string
  abs: string
}

interface DirEntry {
  kind: 'dir'
  name: string
  rel: string
  children: TreeEntry[]
}

type TreeEntry = FileEntry | DirEntry

interface HighlightBag {
  styles: Set<string>
  scripts: Set<string>
}

interface Renderer {
  ec: {
    render: (input: {
      code: string
      language: string
      meta?: string
    }) => Promise<{
      renderedGroupAst: HastNode
      styles: Set<string>
    }>
  }
  baseStyles: string
  themeStyles: string
  jsModules: string[]
}

const specimenDepth = new AsyncLocalStorage<number>()
const highlightBag = new AsyncLocalStorage<HighlightBag>()

interface FolderScope {
  rootDir: string
  embedImages: boolean
}

const folderScope = new AsyncLocalStorage<FolderScope>()

let storedRemark: RemarkPlugins = []
let storedRehype: RehypePlugins = []
let markdownProcessor: Promise<MarkdownRenderer> | undefined
let codeProcessor: Promise<MarkdownRenderer> | undefined
let rendererTask: Promise<Renderer> | undefined

export function insideSpecimen() {
  return (specimenDepth.getStore() ?? 0) > 0
}

export function useFolderPipeline(
  remark: RemarkPlugins,
  rehype: RehypePlugins
) {
  storedRemark = remark
  storedRehype = rehype
}

export interface FolderAssets {
  styles: Set<string>
  scripts: Set<string>
}

export function createFolderAssets(): FolderAssets {
  return { styles: new Set(), scripts: new Set() }
}

export function folderAssetHtml(assets: FolderAssets) {
  return {
    styles: styleTags(assets),
    scripts: scriptTags(assets),
  }
}

export async function renderFolder(
  input: {
    article: string
    src: string
    open?: string
    caption: string
    root?: string
    embedImages?: boolean
  },
  assets?: FolderAssets
) {
  const bag = assets ?? createFolderAssets()
  const scope: FolderScope | undefined = input.root
    ? {
        rootDir: input.root,
        embedImages: input.embedImages !== false,
      }
    : undefined
  let html: string
  try {
    const render = () => assembleFolder(input)
    html = await specimenDepth.run(1, () =>
      highlightBag.run(bag, () =>
        scope ? folderScope.run(scope, render) : render()
      )
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(':::folder'))
      throw error
    fail(input.article, input.src, errorText(error))
  }
  await flushSpecimenAssets()
  if (assets) return html
  const tags = folderAssetHtml(bag)
  return `${tags.styles}${html}${tags.scripts}`
}

async function assembleFolder(input: {
  article: string
  src: string
  open?: string
  caption: string
}) {
  const located = locate(input.article, input.src)
  const caption = input.caption.trim()
    ? await renderMarkdown(input.caption, input.article)
    : ''
  const note = caption ? `<div class="folder-note">${caption}</div>` : ''

  if (located.kind === 'file') {
    const panel = await renderPanel(located.entry, located.entry.name, true)
    return `<div class="folder-view is-single">${note}<div class="folder-frame"><div class="folder-main">${panel}</div></div></div>`
  }

  const openRel = chooseOpen(
    input.article,
    input.src,
    located.entries,
    input.open
  )
  const files = flattenFiles(located.entries)
  const panels = await Promise.all(
    files.map((file) => renderPanel(file, file.rel, file.rel === openRel))
  )
  return `<div class="folder-view">${note}<div class="folder-frame"><nav class="folder-tree" aria-label="Files">${renderTree(located.entries, openRel)}</nav><div class="folder-main">${panels.join('')}</div></div></div>`
}

function chooseOpen(
  article: string,
  src: string,
  entries: TreeEntry[],
  open: string | undefined
) {
  const files = new Set(flattenFiles(entries).map((file) => file.rel))
  if (open) {
    const rel = normalizeRelative(open)
    if (!rel || !files.has(rel)) {
      fail(article, src, `open 指向的文件不存在: ${JSON.stringify(open)}`)
    }
    return rel
  }
  if (files.has('SKILL.md')) return 'SKILL.md'
  if (files.has('README.md')) return 'README.md'
  const first = firstFile(entries)
  if (!first) fail(article, src, '目录里没有可以打开的文件')
  return first
}

function firstFile(entries: TreeEntry[]): string | undefined {
  for (const entry of entries) {
    if (entry.kind === 'dir') {
      const nested = firstFile(entry.children)
      if (nested) return nested
    } else {
      return entry.rel
    }
  }
}

async function renderPanel(file: FileEntry, label: string, active: boolean) {
  const rendered = await renderFile(file)
  const hidden = active ? '' : ' hidden'
  const raw =
    rendered.text == null
      ? ''
      : `<pre class="folder-raw-view" hidden>${escapeHtml(rendered.text)}</pre>`
  return `<section class="folder-panel" data-folder-panel="${escapeAttr(file.rel)}"${hidden}><div class="folder-filebar"><span class="folder-filename">${escapeHtml(label)}</span>${fileActions(rendered.text != null)}</div><div class="folder-body"><div class="folder-rendered">${rendered.html}</div>${raw}</div></section>`
}

function fileActions(textual: boolean) {
  if (!textual) return ''
  return `<div class="folder-actions">${actionButton('wrap', 'Wrap lines', wrapIcon())}${actionButton('source', 'View source', sourceIcon())}${actionButton('copy', 'Copy file', copyIcon())}</div>`
}

function actionButton(name: string, tip: string, icon: string) {
  return `<button type="button" class="folder-action tip tip-bottom-end" data-folder-action="${name}" data-tip="${escapeAttr(tip)}" aria-label="${escapeAttr(tip)}">${icon}</button>`
}

function copyIcon() {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5h2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`
}

function sourceIcon() {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4.5 2.8 8 6 11.5M10 4.5 13.2 8 10 11.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

function wrapIcon() {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h7.2a2.2 2.2 0 0 1 0 4.4H7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8.4 10.6 6.8 12.4l1.6 1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

function renderTree(entries: TreeEntry[], openRel: string): string {
  const items = entries
    .map((entry) => {
      if (entry.kind === 'dir') {
        const expanded = dirContains(entry, openRel)
        return `<li class="folder-dir"><button type="button" class="folder-twist" aria-expanded="${expanded ? 'true' : 'false'}">${chevron()}<span class="folder-twist-icons">${fileIcon(entry.name, 'dir', true)}${fileIcon(entry.name, 'dir', false)}</span><span>${escapeHtml(entry.name)}</span></button>${renderTree(entry.children, openRel)}</li>`
      }
      const current = entry.rel === openRel ? ' aria-current="true"' : ''
      return `<li><button type="button" data-folder-file="${escapeAttr(entry.rel)}"${current}>${fileIcon(entry.name, 'file')}<span>${escapeHtml(entry.name)}</span></button></li>`
    })
    .join('')
  return `<ul>${items}</ul>`
}

function dirContains(entry: DirEntry, openRel: string): boolean {
  return entry.children.some((child) =>
    child.kind === 'file' ? child.rel === openRel : dirContains(child, openRel)
  )
}

function chevron() {
  return `<svg class="folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4.5 10.5 8 6 11.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

interface RenderedFile {
  html: string
  text?: string
}

async function renderFile(file: FileEntry): Promise<RenderedFile> {
  if (isImageExt(file.abs)) {
    if (folderScope.getStore()?.embedImages === false) {
      return { html: renderBinary(file, statSync(file.abs).size) }
    }
    return { html: renderImage(file) }
  }
  if (isMarkdown(file.name)) return renderMarkdownFile(file)
  const lang = codeLanguage(file.name)
  const bytes = readFileSync(file.abs)
  if (lang) {
    const text = decodeUtf8(bytes)
    if (text == null) return { html: renderBinary(file, bytes.length) }
    return { html: await renderCode(file, text, lang), text }
  }
  const text = decodeUtf8(bytes)
  if (text == null) return { html: renderBinary(file, bytes.length) }
  return {
    html: `<pre class="folder-plain">${escapeHtml(text)}</pre>`,
    text,
  }
}

function renderImage(file: FileEntry) {
  const root = specimensRoot()
  const rel = toPosix(path.relative(root, file.abs))
  trackSpecimenAsset(rel, file.abs)
  const src = imagePublicUrl(rel)
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(file.name)}" />`
}

async function renderMarkdownFile(file: FileEntry): Promise<RenderedFile> {
  const source = readFileSync(file.abs, 'utf8')
  const parsed = parseFrontmatter(source)
  const html = await renderMarkdown(parsed.content, file.abs)
  const head = frontmatterHtml(parsed.frontmatter)
  return { html: `${head}${html}`, text: source }
}

function frontmatterHtml(data: Record<string, unknown>) {
  const rows = Object.entries(data)
    .map(([key, value]) => {
      const text = formatFrontmatter(value)
      if (!text) return ''
      return `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(text)}</dd></div>`
    })
    .filter(Boolean)
  if (!rows.length) return ''
  return `<dl class="folder-frontmatter">${rows.join('')}</dl>`
}

function formatFrontmatter(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => formatFrontmatter(item))
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = formatFrontmatter(item)
        if (!text) return ''
        if (!text.includes('\n')) return `${key}: ${text}`
        return `${key}:\n${text.replace(/^/gm, '  ')}`
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

async function renderCode(file: FileEntry, source: string, lang: string) {
  const processor = await getCodeProcessor()
  const rendered = await processor.render(
    fenced(lang, source, 'showLineNumbers frame="none"'),
    {
      fileURL: pathToFileURL(file.abs),
    }
  )
  return `<div class="folder-source">${rendered.code}</div>`
}

async function renderMarkdown(source: string, filePath: string) {
  const processor = await getMarkdownProcessor()
  const rendered = await processor.render(source, {
    fileURL: pathToFileURL(path.resolve(filePath)),
  })
  return rendered.code
}

function renderBinary(file: FileEntry, bytes: number) {
  return `<p class="folder-binary"><span class="folder-binary-name">${escapeHtml(file.name)}</span><span class="folder-binary-size">${formatSize(bytes)}</span></p>`
}

function locate(article: string, src: string) {
  const base = folderScope.getStore()?.rootDir ?? SPECIMENS_DIR
  const custom = Boolean(folderScope.getStore())
  const rel = normalizeRelative(src)
  if (!rel) {
    if (!custom) fail(article, src, '路径必须留在 src/specimens 内')
    if (!existsSync(base)) fail(article, src, '目录不存在')
    const root = realpathSync(base)
    return {
      kind: 'dir' as const,
      entries: walk(root, '', root, new Set(), article, src || base),
    }
  }
  if (!existsSync(base)) {
    fail(article, src, custom ? '目录不存在' : '还没有 src/specimens 目录')
  }
  const root = realpathSync(base)
  const lexical = path.resolve(base, rel)
  if (!insideDirectory(path.resolve(base), lexical)) {
    fail(
      article,
      src,
      custom ? '路径跳出了这份目录' : '路径跳出了 src/specimens'
    )
  }
  if (!existsSync(lexical)) fail(article, src, '路径不存在')
  const real = realpathSync(lexical)
  if (!insideDirectory(root, real)) {
    const where = custom ? '这份目录' : 'src/specimens'
    fail(article, src, `符号链接指向 ${where} 以外`)
  }
  const info = statSync(real)
  if (info.isFile()) {
    const entry: FileEntry = {
      kind: 'file',
      name: path.basename(rel),
      rel: path.basename(rel),
      abs: real,
    }
    return { kind: 'file' as const, entry }
  }
  if (!info.isDirectory()) fail(article, src, 'src 不是文件或目录')
  const entries = walk(real, '', root, new Set(), article, src)
  return { kind: 'dir' as const, entries }
}

function specimensRoot() {
  return realpathSync(SPECIMENS_DIR)
}

function walk(
  dir: string,
  rel: string,
  root: string,
  stack: Set<string>,
  article: string,
  src: string
): TreeEntry[] {
  if (stack.has(dir)) fail(article, src, '目录里有循环的符号链接')
  stack.add(dir)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    fail(article, src, errorText(error))
  }
  const dirs: DirEntry[] = []
  const files: FileEntry[] = []
  try {
    for (const name of names) {
      if (SKIP_NAMES.has(name)) continue
      const abs = path.join(dir, name)
      let real: string
      try {
        real = realpathSync(abs)
      } catch (error) {
        fail(article, src, errorText(error))
      }
      if (!insideDirectory(root, real)) {
        const where = folderScope.getStore() ? '这份目录' : 'src/specimens'
        fail(article, src, `符号链接指向 ${where} 以外: ${name}`)
      }
      const childRel = rel ? `${rel}/${name}` : name
      const info = statSync(real)
      if (info.isDirectory()) {
        dirs.push({
          kind: 'dir',
          name,
          rel: childRel,
          children: walk(real, childRel, root, stack, article, src),
        })
      } else if (info.isFile()) {
        files.push({ kind: 'file', name, rel: childRel, abs: real })
      }
    }
  } finally {
    stack.delete(dir)
  }
  dirs.sort((a, b) => compareName(a.name, b.name))
  files.sort((a, b) => compareName(a.name, b.name))
  return [...dirs, ...files]
}

function flattenFiles(entries: TreeEntry[]): FileEntry[] {
  const files: FileEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'dir') files.push(...flattenFiles(entry.children))
    else files.push(entry)
  }
  return files
}

function getMarkdownProcessor() {
  markdownProcessor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    gfm: true,
    smartypants: true,
    remarkPlugins: [...storedRemark, remarkSpecimenImages],
    rehypePlugins: [...storedRehype, rehypeSpecimenHighlight],
  })
  return markdownProcessor
}

function getCodeProcessor() {
  codeProcessor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    gfm: false,
    smartypants: false,
    remarkPlugins: [],
    rehypePlugins: [rehypeSpecimenHighlight],
  })
  return codeProcessor
}

function getRenderer() {
  if (!rendererTask) {
    const source = ecConfig as { plugins?: unknown[] }
    const config = {
      ...source,
      plugins: [...(source.plugins ?? [])],
    }
    rendererTask = createRenderer(
      config as Parameters<typeof createRenderer>[0]
    ).then((renderer) => renderer as Renderer)
    rendererTask.catch(() => {
      rendererTask = undefined
    })
  }
  return rendererTask
}

// Relative images inside a specimen become build assets. Absolute and
// remote URLs stay as written.
function remarkSpecimenImages() {
  return (tree: { type: string }, file: { path?: string }) => {
    const from = filesystemPath(file.path)
    if (!from) return
    visit(tree, (node) => {
      const current = node as { type?: string; url?: string }
      if (current.type !== 'image' && current.type !== 'definition') return
      if (typeof current.url !== 'string') return
      const next = publishImage(current.url, from)
      if (next) current.url = next
    })
  }
}

function filesystemPath(value: string | undefined) {
  if (!value) return
  if (value.startsWith('file:')) {
    try {
      return fileURLToPath(value)
    } catch {
      return
    }
  }
  return value
}

function publishImage(url: string, fromFile: string) {
  if (
    !url ||
    url.startsWith('/') ||
    url.startsWith('#') ||
    url.startsWith('data:')
  )
    return
  if (URL.canParse(url)) return
  let decoded = url
  try {
    decoded = decodeURI(url)
  } catch {
    return
  }
  const abs = path.resolve(path.dirname(fromFile), decoded)
  if (!existsSync(abs)) return
  let real: string
  try {
    real = realpathSync(abs)
  } catch {
    return
  }
  if (!existsSync(SPECIMENS_DIR)) return
  if (!insideDirectory(specimensRoot(), real) || !isImageExt(real)) return
  if (!statSync(real).isFile()) return
  const rel = toPosix(path.relative(specimensRoot(), real))
  trackSpecimenAsset(rel, real)
  return imagePublicUrl(rel)
}

function rehypeSpecimenHighlight() {
  return async (tree: HastNode) => {
    const hits: { parent: HastNode; node: HastNode }[] = []
    collectPres(tree, hits)
    if (!hits.length) return
    const renderer = await getRenderer()
    const bag = highlightBag.getStore()
    if (bag) {
      if (renderer.baseStyles) bag.styles.add(renderer.baseStyles)
      if (renderer.themeStyles) bag.styles.add(renderer.themeStyles)
      for (const source of renderer.jsModules) bag.scripts.add(source)
    }
    for (const hit of hits) {
      const info = codeBlock(hit.node)
      if (!info) continue
      const code = info.text.replace(/\t/g, '  ')
      try {
        const rendered = await renderer.ec.render({
          code,
          language: info.lang,
          meta: info.meta,
        })
        if (bag) {
          for (const style of rendered.styles) bag.styles.add(style)
        }
        const index = hit.parent.children?.indexOf(hit.node) ?? -1
        if (index === -1 || !hit.parent.children) continue
        hit.parent.children[index] = rendered.renderedGroupAst
      } catch {
        // Unknown languages stay as a plain pre. Known languages used in
        // posts are part of the same Shiki bundle Expressive Code already loads.
      }
    }
  }
}

function collectPres(
  node: HastNode,
  hits: { parent: HastNode; node: HastNode }[],
  parent?: HastNode
) {
  if (parent && node.tagName === 'pre') hits.push({ parent, node })
  for (const child of node.children ?? []) collectPres(child, hits, node)
}

function codeBlock(node: HastNode) {
  const code = node.children?.find(
    (child) => child.type === 'element' && child.tagName === 'code'
  )
  if (!code) return
  const text = (code.children ?? [])
    .filter((child) => child.type === 'text')
    .map((child) => child.value ?? '')
    .join('')
  const classes = code.properties?.className
  const list = Array.isArray(classes)
    ? classes.map(String)
    : typeof classes === 'string'
      ? classes.split(/\s+/)
      : []
  const lang = list.find((name) => name.startsWith('language-'))?.slice(9) ?? ''
  const meta =
    typeof code.data?.meta === 'string'
      ? code.data.meta
      : typeof code.properties?.metastring === 'string'
        ? code.properties.metastring
        : ''
  return { text, lang, meta }
}

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
}

const CODE_NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  containerfile: 'dockerfile',
}

function codeLanguage(filename: string) {
  const base = filename.toLowerCase()
  if (CODE_NAMES[base]) return CODE_NAMES[base]
  const ext = path.extname(filename).slice(1).toLowerCase()
  return CODE_LANG[ext]
}

function isMarkdown(filename: string) {
  const ext = path.extname(filename).toLowerCase()
  return ext === '.md' || ext === '.mdx'
}

function decodeUtf8(bytes: Buffer) {
  if (bytes.includes(0)) return
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return
  }
}

function fenced(lang: string, source: string, meta = '') {
  let ticks = '```'
  while (source.includes(ticks)) ticks += '`'
  const info = meta ? `${lang} ${meta}` : lang
  return `${ticks}${info}\n${source}\n${ticks}\n`
}

function normalizeRelative(value: string) {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
  if (
    !parts.length ||
    parts.some((part) => part === '..' || part.includes('\0'))
  )
    return
  return parts.join('/')
}

function compareName(a: string, b: string) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function toPosix(value: string) {
  return value.split(path.sep).join('/')
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${trimUnit(kb)} KB`
  return `${trimUnit(kb / 1024)} MB`
}

function trimUnit(value: number) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1)
}

function styleTags(bag: HighlightBag) {
  return [...bag.styles]
    .map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
    .join('')
}

function scriptTags(bag: HighlightBag) {
  return [...bag.scripts]
    .map(
      (source) =>
        `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`
    )
    .join('')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

function fail(article: string, src: string, detail: string): never {
  throw new Error(
    `:::folder in ${article} failed: ${detail} (src: ${JSON.stringify(src)})`
  )
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
