import { visit } from 'unist-util-visit'

import {
  getWikilinkIndex,
  isWikilinkEnabled,
  pageForFile,
  parseWikilink,
  resolveWikilink,
} from './wikilink'

import type { ResolvedWikilink } from './wikilink'

interface TextNode {
  type: string
  value?: string
  children?: TextNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
}

interface MarkdownFile {
  path?: string
  history?: string[]
}

const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]+)[ \t]*$/
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'tableCell',
])

export function remarkWikilink() {
  return (tree: TextNode, file: MarkdownFile) => {
    if (!isWikilinkEnabled()) return
    const index = getWikilinkIndex()
    const current = pageForFile(index, file.path || file.history?.[0])

    visit(tree, 'text', (node, indexInParent, parent) => {
      if (!parent || typeof indexInParent !== 'number' || !node.value) return
      if (!node.value.includes('[[')) return
      if (parent.type === 'link' || parent.type === 'linkReference') return

      const parts = splitWikilinks(node.value, index, current)
      if (!parts) return
      parent.children?.splice(indexInParent, 1, ...parts)
      return indexInParent + parts.length
    })
  }
}

// A trailing `^id` on a block becomes the element id. `[[page^id]]` points at it.
export function remarkBlockId() {
  return (tree: TextNode) => {
    if (!isWikilinkEnabled()) return
    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !node.children?.length) return
      const last = node.children[node.children.length - 1]
      if (last.type !== 'text' || !last.value) return

      const match = BLOCK_ID_RE.exec(last.value)
      if (!match) return

      last.value = last.value.slice(0, match.index).replace(/\s+$/, '')
      if (!last.value) node.children.pop()

      const data = (node.data ??= {})
      const props = (data.hProperties ??= {})
      if (typeof props.id !== 'string') props.id = match[1]
    })
  }
}

function splitWikilinks(
  value: string,
  index: ReturnType<typeof getWikilinkIndex>,
  current: ReturnType<typeof pageForFile>
): TextNode[] | undefined {
  const parts: TextNode[] = []
  let last = 0
  let found = false

  for (const match of value.matchAll(/(!?)(\\)?\[\[([^\]\n]+?)\]\]/g)) {
    if (match[1] || match[2]) continue
    const parsed = parseWikilink(match[3] ?? '')
    if (!parsed) continue

    const start = match.index ?? 0
    found = true
    if (start > last)
      parts.push({ type: 'text', value: value.slice(last, start) })
    parts.push(wikilinkNode(resolveWikilink(parsed, index, current)))
    last = start + match[0].length
  }

  if (!found) return
  if (last < value.length)
    parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function wikilinkNode(resolved: ResolvedWikilink): TextNode {
  if (!resolved.exists || !resolved.href) {
    return {
      type: 'wikilink',
      children: [{ type: 'text', value: resolved.label }],
      data: {
        hName: 'span',
        hProperties: {
          className: ['wikilink', 'wikilink-missing'],
        },
      },
    }
  }

  return {
    type: 'wikilink',
    children: [{ type: 'text', value: resolved.label }],
    data: {
      hName: 'a',
      hProperties: {
        href: resolved.href,
        className: ['wikilink'],
      },
    },
  }
}
