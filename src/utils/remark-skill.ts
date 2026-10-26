import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'

import {
  createFolderAssets,
  folderAssetHtml,
  insideSpecimen,
  renderFolder,
} from './specimen'
import {
  canonicalSkillUrl,
  flushSkillCache,
  loadSkill,
  type SkillView,
} from './skill-source'

// ::skill resolves a skill URL to a GitHub directory and renders an intro card
// plus the folder view. expanded defaults to open. A failed fetch still leaves
// the link. A skill directive inside a specimen stays as source.

interface DirectiveNode {
  type: string
  name?: string
  attributes?: Record<string, string | null | undefined>
  children?: unknown[]
  position?: {
    start?: { offset?: number | null }
    end?: { offset?: number | null }
  }
}

interface ParentNode {
  type?: string
  children: unknown[]
}

interface MarkdownFile {
  path?: string
  history?: string[]
  value?: unknown
  toString(): string
}

export function remarkSkill() {
  return async (tree: { type: string }, file: MarkdownFile) => {
    if (insideSpecimen()) {
      literalize(tree, file)
      return
    }
    const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] =
      []
    visit(tree, (node, index, parent) => {
      if (!isSkill(node) || !parent || index == null) return
      if (!('children' in parent)) return
      jobs.push({
        parent: parent as ParentNode,
        index,
        node: node as DirectiveNode,
      })
    })
    const assets = createFolderAssets()
    const article = articleLabel(file)
    await Promise.all(
      jobs.map(async (job) => {
        const html = await renderSkill(article, job.node, assets)
        job.parent.children[job.index] = { type: 'html', value: html }
      })
    )
    await flushSkillCache()
    const first = jobs[0]
    const last = jobs[jobs.length - 1]
    if (!first || !last) return
    const tags = folderAssetHtml(assets)
    const firstNode = first.parent.children[first.index] as { value: string }
    const lastNode = last.parent.children[last.index] as { value: string }
    firstNode.value = `${tags.styles}${firstNode.value}`
    lastNode.value = `${lastNode.value}${tags.scripts}`
  }
}

async function renderSkill(
  article: string,
  node: DirectiveNode,
  assets: ReturnType<typeof createFolderAssets>
) {
  const raw = attr(node, 'url') || labelOf(node)
  const href = canonicalSkillUrl(raw)
  if (!href) return missing('Needs a skill link')
  const expanded = expandedFlag(attr(node, 'expanded'))
  const open = attr(node, 'open')
  const view = await loadSkill(href)
  if (!view) return card(linkOnly(href), null, expanded)
  if (!view.dir) return card(view, null, expanded)

  let folder = await folderHtml(article, view.dir, open, assets)
  if (!folder && open) folder = await folderHtml(article, view.dir, '', assets)
  return card(view, folder, expanded)
}

async function folderHtml(
  article: string,
  root: string,
  open: string,
  assets: ReturnType<typeof createFolderAssets>
) {
  try {
    return await renderFolder(
      {
        article,
        src: '',
        open: open || undefined,
        caption: '',
        root,
        embedImages: false,
      },
      assets
    )
  } catch (error) {
    console.warn(`::skill folder failed: ${errorText(error)}`)
    return null
  }
}

function card(view: SkillView, folder: string | null, expanded: boolean) {
  const name = view.name || view.href
  const owner =
    view.owner && view.name
      ? `<span class="note-card-owner">${escapeHtml(view.owner)}/</span>`
      : ''
  const stars =
    view.stars == null
      ? ''
      : `<span class="note-card-stars">${starIcon()}${escapeHtml(compactCount(view.stars))}</span>`
  const media = view.avatar
    ? `<img class="note-card-media" src="${escapeAttr(view.avatar)}" alt="" width="72" height="72" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="note-card-mark" aria-hidden="true">Skill</span>`
  const description = view.description
    ? `<span class="note-card-desc">${escapeHtml(clip(view.description, 240))}</span>`
    : ''
  const link = `<a class="note-card" href="${escapeAttr(view.href)}">${media}<span class="note-card-body"><span class="note-card-line"><span class="note-card-title">${owner}${escapeHtml(name)}</span>${stars}<span class="note-card-tag">Skill</span></span>${description}</span></a>`
  const omitted =
    folder && view.total > view.shown
      ? `<p class="skill-omitted">Showing ${view.shown} of ${view.total} files.</p>`
      : ''
  const files = folder
    ? `<details class="skill-files"${expanded ? ' open' : ''}><summary>Files</summary>${omitted}${folder}</details>`
    : ''
  return `<div class="skill-card" data-note-card="skill">${link}${files}</div>`
}

function linkOnly(href: string): SkillView {
  return {
    href,
    source: hostOf(href),
    owner: '',
    repo: '',
    path: '',
    stars: null,
    avatar: '',
    name: href,
    description: '',
    dir: null,
    shown: 0,
    total: 0,
  }
}

function missing(message: string) {
  return `<div class="note-card note-card-fallback" data-note-card="skill"><span class="note-card-body"><span class="note-card-title">${escapeHtml(message)}</span></span></div>`
}

function expandedFlag(value: string): boolean {
  const text = value.trim().toLowerCase()
  if (!text) return true
  if (text === 'false' || text === '0' || text === 'no' || text === 'off')
    return false
  return true
}

function starIcon() {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.4 9.9 5.6l4.6.4-3.5 3 .1 4.6L8 11.4 4.9 13.6l1.1-4.6-3.5-3 4.6-.4Z"/></svg>`
}

function compactCount(count: number): string {
  if (count < 1000) return String(count)
  const units = [
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ] as const
  for (const [size, unit] of units) {
    if (count < size) continue
    const value = count / size
    const digits = value >= 10 || Number.isInteger(value) ? 0 : 1
    return `${value.toFixed(digits).replace(/\.0$/, '')}${unit}`
  }
  return String(count)
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const sliced = cleaned.slice(0, max)
  const cut = sliced.replace(/\s+\S*$/, '').trim()
  return `${cut || sliced.trim()}…`
}

function literalize(tree: { type: string }, file: MarkdownFile) {
  const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] = []
  visit(tree, (node, index, parent) => {
    if (!isSkill(node) || !parent || index == null) return
    if (!('children' in parent)) return
    jobs.push({
      parent: parent as ParentNode,
      index,
      node: node as DirectiveNode,
    })
  })
  for (const job of jobs) {
    const source = sourceOf(file, job.node) || '::skill'
    job.parent.children[job.index] = {
      type: 'code',
      lang: 'markdown',
      value: source,
    }
  }
}

function isSkill(node: unknown): node is DirectiveNode {
  if (!node || typeof node !== 'object') return false
  const directive = node as DirectiveNode
  return directive.type === 'leafDirective' && directive.name === 'skill'
}

function attr(node: DirectiveNode, name: string) {
  const value = node.attributes?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function labelOf(node: DirectiveNode) {
  return toString(node as Parameters<typeof toString>[0]).trim()
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return 'Skill'
  }
}

function sourceOf(file: MarkdownFile, node: DirectiveNode) {
  const value = typeof file.value === 'string' ? file.value : file.toString()
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start == null || end == null) return
  return value.slice(start, end)
}

function articleLabel(file: MarkdownFile) {
  const raw = file.path || file.history?.[0]
  if (!raw) return '(unknown file)'
  const abs = raw.startsWith('file:') ? fileUrlPath(raw) : raw
  const rel = pathRelative(abs)
  return rel || abs
}

function fileUrlPath(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return value
  }
}

function pathRelative(abs: string) {
  const cwd = process.cwd().replace(/\/+$/, '')
  if (abs === cwd) return ''
  if (abs.startsWith(`${cwd}/`)) return abs.slice(cwd.length + 1)
  return abs
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
