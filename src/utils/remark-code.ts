import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'

import { flushCodeCache, loadCode, type CodeView } from './code-source'
import { insideSpecimen } from './specimen'

// ::code{url="https://github.com/owner/repo/blob/<ref>/path#L12-L40" mark="14-16"}
// A failed fetch still leaves a link. mark highlights file lines inside the
// slice. Inside a specimen the directive stays as source, same as ::skill.

interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, string | undefined>
  children: HastChild[]
  data?: { meta?: string }
}

type HastChild = HastText | HastElement

interface DirectiveNode {
  type: string
  name?: string
  attributes?: Record<string, string | null | undefined>
  data?: Record<string, unknown>
  children?: unknown[]
  value?: string
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
  value?: unknown
  toString(): string
}

export function remarkCode() {
  return async (tree: { type: string }, file: MarkdownFile) => {
    if (insideSpecimen()) {
      literalize(tree, file)
      return
    }
    const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] =
      []
    visit(tree, (node, index, parent) => {
      if (!isCode(node) || !parent || index == null) return
      if (!('children' in parent)) return
      jobs.push({
        parent: parent as ParentNode,
        index,
        node: node as DirectiveNode,
      })
    })
    await Promise.all(
      jobs.map(async (job) => {
        apply(job.node, await render(job.node))
      })
    )
    await flushCodeCache()
  }
}

async function render(node: DirectiveNode): Promise<HastElement> {
  const raw = attr(node, 'url') || labelOf(node)
  const lines = attr(node, 'lines')
  const mark = attr(node, 'mark')
  if (!raw) return missing('Needs a GitHub file link')
  const result = await loadCode(raw, lines)
  if (result.status === 'missing') return missing(result.message)
  if (!result.view.code) return linkCard(result.view)
  const highlighted = highlight(mark, result.view)
  if (highlighted === 'invalid') return missing('Needs a highlight range')
  return snippet(result.view, highlighted)
}

function snippet(view: CodeView, mark: string): HastElement {
  const start = view.start || 1
  const meta = mark
    ? `showLineNumbers startLineNumber=${start} mark={${mark}}`
    : `showLineNumbers startLineNumber=${start}`
  // Expressive Code reads metastring / data.meta. It also drops blank lines
  // at the two ends, which would move the gutter, so those lines keep a
  // zero-width space.
  const code = el(
    'code',
    {
      className: view.lang ? `language-${view.lang}` : undefined,
      metastring: meta,
    },
    [text(protectEdges(view.code))]
  )
  code.data = { meta }
  return el('div', { 'className': 'code-card', 'data-note-card': 'code' }, [
    head(view),
    el('pre', {}, [code]),
  ])
}

// mark uses the file's line numbers, the same numbers as the gutter.
// Expressive Code counts from the first line of the slice, so the meta
// range is shifted. Lines outside the slice are dropped. None left, or a
// value that is not a line list, is invalid.
function highlight(mark: string, view: CodeView): string | 'invalid' {
  if (!mark) return ''
  const ranges = parseHighlight(mark)
  if (!ranges) return 'invalid'
  const hit = new Set<number>()
  for (const range of ranges) {
    const from = Math.max(range.start, view.start)
    const to = Math.min(range.end, view.end)
    for (let line = from; line <= to; line += 1) hit.add(line)
  }
  if (!hit.size) return 'invalid'
  const lines = [...hit].sort((a, b) => a - b)
  const parts: string[] = []
  let run = lines[0] ?? view.start
  let prev = run
  for (const line of lines.slice(1)) {
    if (line === prev + 1) {
      prev = line
      continue
    }
    parts.push(relative(run, prev, view.start))
    run = line
    prev = line
  }
  parts.push(relative(run, prev, view.start))
  return parts.join(',')
}

function parseHighlight(mark: string): { start: number; end: number }[] | null {
  const text = mark.trim().replace(/^\{|\}$/g, '')
  if (!text) return null
  const ranges: { start: number; end: number }[] = []
  for (const part of text.split(',')) {
    const match = part.trim().match(/^L?(\d+)(?:\s*-\s*L?(\d+))?$/i)
    if (!match) return null
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start < 1 || end < start) return null
    ranges.push({ start, end })
  }
  return ranges.length ? ranges : null
}

function relative(start: number, end: number, origin: number): string {
  const from = start - origin + 1
  const to = end - origin + 1
  return from === to ? `${from}` : `${from}-${to}`
}

function protectEdges(code: string): string {
  const lines = code.split('\n')
  if (!lines.length) return code
  if (lines[0]?.trimEnd() === '') lines[0] = '\u200b'
  const last = lines.length - 1
  if (last > 0 && lines[last]?.trimEnd() === '') lines[last] = '\u200b'
  return lines.join('\n')
}

function apply(node: DirectiveNode, rendered: HastElement) {
  const data = (node.data ??= {})
  data.hName = rendered.tagName
  data.hProperties = rendered.properties
  data.hChildren = rendered.children
  node.children = []
  delete node.value
}

function head(view: CodeView): HastElement {
  const line: HastChild[] = [
    el('span', { className: 'note-card-title' }, titleChildren(view)),
  ]
  if (view.sha) {
    line.push(
      el('span', { className: 'note-card-tag' }, [text(view.sha.slice(0, 7))])
    )
  }
  if (view.ranged && view.start > 0) {
    const label =
      view.start === view.end ? `L${view.start}` : `L${view.start}–${view.end}`
    line.push(el('span', { className: 'note-card-tag' }, [text(label)]))
  }
  return el(
    'a',
    {
      className: 'code-card-head',
      href: view.href,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    [el('span', { className: 'note-card-line' }, line)]
  )
}

function linkCard(view: CodeView): HastElement {
  return el(
    'a',
    {
      'className': 'note-card',
      'data-note-card': 'code',
      'href': view.href,
      'target': '_blank',
      'rel': 'noopener noreferrer',
    },
    [
      el('span', { className: 'note-card-body' }, [
        el('span', { className: 'note-card-line' }, [
          el('span', { className: 'note-card-title' }, titleChildren(view)),
          el('span', { className: 'note-card-tag' }, [text('code')]),
        ]),
      ]),
    ]
  )
}

function titleChildren(view: CodeView): HastChild[] {
  if (view.path && view.owner && view.repo) {
    return [
      el('span', { className: 'note-card-owner' }, [
        text(softPath(`${view.owner}/${view.repo}/`)),
      ]),
      text(softPath(view.path)),
    ]
  }
  if (view.owner && view.repo) return [text(`${view.owner}/${view.repo}`)]
  return [text(view.href)]
}

function softPath(value: string): string {
  return value.replaceAll('/', '/\u200b')
}

function missing(message: string): HastElement {
  return el(
    'div',
    { 'className': 'note-card note-card-fallback', 'data-note-card': 'code' },
    [
      el('span', { className: 'note-card-body' }, [
        el('span', { className: 'note-card-title' }, [text(message)]),
      ]),
    ]
  )
}

function literalize(tree: { type: string }, file: MarkdownFile) {
  const jobs: { parent: ParentNode; index: number; node: DirectiveNode }[] = []
  visit(tree, (node, index, parent) => {
    if (!isCode(node) || !parent || index == null) return
    if (!('children' in parent)) return
    jobs.push({
      parent: parent as ParentNode,
      index,
      node: node as DirectiveNode,
    })
  })
  for (const job of jobs) {
    const source = sourceOf(file, job.node) || '::code'
    job.parent.children[job.index] = {
      type: 'code',
      lang: 'markdown',
      value: source,
    }
  }
}

function isCode(node: unknown): node is DirectiveNode {
  if (!node || typeof node !== 'object') return false
  const directive = node as DirectiveNode
  return directive.type === 'leafDirective' && directive.name === 'code'
}

function attr(node: DirectiveNode, name: string) {
  const value = node.attributes?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function labelOf(node: DirectiveNode) {
  return toString(node as Parameters<typeof toString>[0]).trim()
}

function sourceOf(file: MarkdownFile, node: DirectiveNode) {
  const value = typeof file.value === 'string' ? file.value : file.toString()
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start == null || end == null) return
  return value.slice(start, end)
}

function text(value: string): HastText {
  return { type: 'text', value }
}

function el(
  tagName: string,
  properties: Record<string, string | undefined>,
  children: HastChild[]
): HastElement {
  const clean: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) clean[key] = value
  }
  return { type: 'element', tagName, properties: clean, children }
}
