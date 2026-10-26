import { visit } from 'unist-util-visit'

import {
  createFolderAssets,
  folderAssetHtml,
  insideSpecimen,
  renderFolder,
} from './specimen'

// :::folder reads a file or directory under src/specimens and replaces the
// directive with static HTML. A folder directive inside that specimen is left
// as source, so one specimen cannot embed another.

interface DirectiveNode {
  type: string
  name?: string
  attributes?: Record<string, string | undefined>
  children?: unknown[]
  position?: {
    start?: { offset?: number | null }
    end?: { offset?: number | null }
  }
}

interface ParentNode {
  type?: string
  name?: string
  children: unknown[]
}

interface MarkdownFile {
  path?: string
  history?: string[]
  value?: unknown
  toString(): string
}

export function remarkFolder() {
  return async (tree: { type: string }, file: MarkdownFile) => {
    if (insideSpecimen()) {
      literalizeFolders(tree, file)
      return
    }
    const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] =
      []
    visit(tree, (node, index, parent) => {
      if (!isFolder(node) || !parent || index == null) return
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
        const html = await renderFolder(
          {
            article,
            src: attr(job.node, 'src') ?? '',
            open: attr(job.node, 'open'),
            caption: captionOf(file, job.node),
          },
          assets
        )
        job.parent.children[job.index] = { type: 'html', value: html }
      })
    )
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

function literalizeFolders(tree: { type: string }, file: MarkdownFile) {
  const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] = []
  visit(tree, (node, index, parent) => {
    if (!isFolder(node) || !parent || index == null) return
    if (!('children' in parent)) return
    const owner = parent as ParentNode
    if (owner.type === 'containerDirective' && owner.name === 'folder') return
    jobs.push({ parent: owner, index, node: node as DirectiveNode })
  })
  for (const job of jobs) {
    const source = sourceOf(file, job.node) || ':::folder\n:::'
    job.parent.children[job.index] = {
      type: 'code',
      lang: 'markdown',
      value: source,
    }
  }
}

function isFolder(node: unknown): node is DirectiveNode {
  if (!node || typeof node !== 'object') return false
  const directive = node as DirectiveNode
  return directive.type === 'containerDirective' && directive.name === 'folder'
}

function attr(node: DirectiveNode, name: string) {
  const value = node.attributes?.[name]
  if (value == null) return
  const text = String(value).trim()
  return text || undefined
}

function captionOf(file: MarkdownFile, node: DirectiveNode) {
  const source = sourceOf(file, node)
  if (!source) return ''
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let end = lines.length
  while (end > 1 && lines[end - 1]?.trim() === '') end -= 1
  if (end > 1 && lines[end - 1]?.trim() === ':::') end -= 1
  return lines.slice(1, end).join('\n').trim()
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
