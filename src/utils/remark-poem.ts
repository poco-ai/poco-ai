import { SKIP, visit } from 'unist-util-visit'

// :::poem interleaves with Markdown. The opening fence stays on one line.
// A leading blockquote is the epigraph. Lines [^id]: after the verses are notes.
// Adjacent :::poem blocks that share a series attribute render as one group.

interface HastText {
  type: 'text'
  value: string
}
interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, string | undefined>
  children: (HastText | HastElement)[]
}
type HastChild = HastText | HastElement

interface DirectiveNode {
  type: string
  name?: string
  children?: unknown[]
  data?: Record<string, unknown>
  position?: {
    start?: { offset?: number | null }
    end?: { offset?: number | null }
  }
}

interface PoemAttrs {
  title?: string
  subtitle?: string
  date?: string
  place?: string
  epigraph?: string
  series?: string
  vertical: boolean
}

interface Note {
  id: string
  text: string
}

interface Poem {
  kind: 'poem'
  attrs: PoemAttrs
  epigraph?: string
  notes: Note[]
  stanzas: string[][]
}

interface Series {
  kind: 'series'
  title?: string
  poems: Poem[]
}

interface Ids {
  poem: number
  series: number
}

const FALSE_FLAG = /^(false|0|no)$/i

function text(value: string): HastText {
  return { type: 'text', value }
}

function el(
  tagName: string,
  properties: Record<string, string | undefined>,
  children: HastChild[]
): HastElement {
  return { type: 'element', tagName, properties, children }
}

function parseAttrList(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern =
    /([A-Za-z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+)))?/g
  for (const match of source.matchAll(pattern)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

function parseOpening(line: string): PoemAttrs {
  const match = line.match(/^:::poem(?:\[([^\]]*)\])?(?:\{(.*)\})?\s*$/)
  const raw = parseAttrList(match?.[2] ?? '')
  const label = match?.[1]?.trim()
  const title = raw.title?.trim() || label || undefined
  return {
    title,
    subtitle: raw.subtitle?.trim() || undefined,
    date: raw.date?.trim() || undefined,
    place: raw.place?.trim() || undefined,
    epigraph: raw.epigraph?.trim() || undefined,
    series: raw.series?.trim() || undefined,
    vertical: Object.hasOwn(raw, 'vertical') && !FALSE_FLAG.test(raw.vertical),
  }
}

function stripOuterFence(source: string): { open: string; inner: string[] } {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const open = lines[0] ?? ''
  let end = lines.length
  while (end > 1 && lines[end - 1].trim() === '') end -= 1
  if (end > 1 && lines[end - 1].trim() === ':::') end -= 1
  return { open, inner: lines.slice(1, end) }
}

function parseNotes(source: string | undefined): Note[] {
  if (!source?.trim()) return []
  const notes: Note[] = []
  for (const chunk of source.split(/\n(?=\[\^[^\]]+\]:)/)) {
    const match = chunk.match(/^\[\^([^\]]+)\]:\s*([\s\S]*)$/)
    if (!match) continue
    const body = match[2].trim()
    if (!body) continue
    notes.push({ id: match[1], text: body })
  }
  return notes
}

function stanzasFrom(source: string): string[][] {
  const stanzas: string[][] = []
  let current: string[] = []
  for (const line of source.split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) {
        stanzas.push(current)
        current = []
      }
      continue
    }
    current.push(line.replace(/[ \t]+$/g, ''))
  }
  if (current.length > 0) stanzas.push(current)
  return stanzas
}

function splitBody(lines: string[]): {
  epigraph?: string
  notes?: string
  verses: string
} {
  let index = 0
  while (index < lines.length && lines[index].trim() === '') index += 1

  const epigraphLines: string[] = []
  if (lines[index]?.startsWith('>')) {
    while (index < lines.length) {
      const line = lines[index]
      if (line.startsWith('>')) {
        epigraphLines.push(line.replace(/^>\s?/, ''))
        index += 1
        continue
      }
      if (line.trim() === '' && lines[index + 1]?.startsWith('>')) {
        index += 1
        continue
      }
      break
    }
  }

  const verseLines: string[] = []
  const noteLines: string[] = []
  let inNotes = false
  for (const line of lines.slice(index)) {
    if (!inNotes && /^\[\^[^\]]+\]:/.test(line)) inNotes = true
    if (inNotes) noteLines.push(line)
    else verseLines.push(line)
  }

  return {
    epigraph: epigraphLines.join('\n').trim() || undefined,
    notes: noteLines.join('\n').trim() || undefined,
    verses: verseLines.join('\n'),
  }
}

function parseFencedPoem(source: string): Poem {
  const { open, inner } = stripOuterFence(source)
  const attrs = parseOpening(open)
  const regions = splitBody(inner)
  return {
    kind: 'poem',
    attrs,
    epigraph: regions.epigraph || attrs.epigraph,
    notes: parseNotes(regions.notes),
    stanzas: stanzasFrom(regions.verses),
  }
}

function parseInlines(
  source: string,
  notes: Note[],
  poemId: string
): HastChild[] {
  const children: HastChild[] = []
  const pattern = /\\([\\*])|\*([^*]+)\*|\[\^([^\]]+)\]/g
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) children.push(text(source.slice(cursor, index)))
    if (match[1]) children.push(text(match[1]))
    else if (match[2]) children.push(el('em', {}, [text(match[2])]))
    else if (match[3]) {
      const noteIndex = notes.findIndex((note) => note.id === match[3])
      if (noteIndex === -1) children.push(text(match[0]))
      else {
        const number = String(noteIndex + 1)
        children.push(
          el('sup', { className: 'poem-ref' }, [
            el('a', { href: `#${poemId}-note-${number}` }, [text(number)]),
          ])
        )
      }
    }
    cursor = index + match[0].length
  }
  if (cursor < source.length) children.push(text(source.slice(cursor)))
  return children
}

function renderPoem(poem: Poem, ids: Ids): HastElement {
  ids.poem += 1
  const poemId = `poem-${ids.poem}`
  const writing = poem.attrs.vertical ? 'vertical' : 'horizontal'
  const frame: HastChild[] = []

  const heading: HastChild[] = []
  if (poem.attrs.title) {
    heading.push(
      el('p', { className: 'poem-title', id: `${poemId}-title` }, [
        text(poem.attrs.title),
      ])
    )
  }
  if (poem.attrs.subtitle) {
    heading.push(
      el('p', { className: 'poem-subtitle' }, [text(poem.attrs.subtitle)])
    )
  }
  if (heading.length > 0) {
    frame.push(el('header', { className: 'poem-heading' }, heading))
  }

  if (poem.epigraph) {
    frame.push(
      el(
        'div',
        { className: 'poem-epigraph' },
        poem.epigraph
          .split('\n')
          .map((line) =>
            el(
              'span',
              { className: 'poem-line' },
              parseInlines(line, poem.notes, poemId)
            )
          )
      )
    )
  }

  frame.push(
    el(
      'div',
      { className: 'poem-body' },
      poem.stanzas.map((stanza) =>
        el(
          'p',
          { className: 'poem-stanza' },
          stanza.map((line) =>
            el(
              'span',
              { className: 'poem-line' },
              parseInlines(line, poem.notes, poemId)
            )
          )
        )
      )
    )
  )

  const meta: HastChild[] = []
  if (poem.attrs.date) meta.push(text(poem.attrs.date))
  if (poem.attrs.date && poem.attrs.place) meta.push(text(' · '))
  if (poem.attrs.place) meta.push(text(poem.attrs.place))
  if (meta.length > 0) {
    frame.push(el('p', { className: 'poem-meta' }, meta))
  }

  const children: HastChild[] = [el('div', { className: 'poem-frame' }, frame)]
  if (poem.notes.length > 0) {
    children.push(
      el(
        'ol',
        { className: 'poem-notes' },
        poem.notes.map((note, index) =>
          el(
            'li',
            { id: `${poemId}-note-${index + 1}` },
            parseInlines(note.text, [], poemId)
          )
        )
      )
    )
  }

  return el(
    'article',
    {
      className: 'poem',
      id: poemId,
      lang: 'zh-Hans',
      dataWriting: writing,
      ariaLabelledBy: poem.attrs.title ? `${poemId}-title` : undefined,
    },
    children
  )
}

function renderSeries(series: Series, ids: Ids): HastElement {
  ids.series += 1
  const seriesId = `poem-series-${ids.series}`
  const children: HastChild[] = []
  if (series.title) {
    children.push(
      el('p', { className: 'poem-series', id: `${seriesId}-title` }, [
        text(series.title),
      ])
    )
  }
  for (const poem of series.poems) children.push(renderPoem(poem, ids))
  return el(
    'section',
    {
      className: 'poem-group',
      id: seriesId,
      lang: 'zh-Hans',
      ariaLabelledBy: series.title ? `${seriesId}-title` : undefined,
    },
    children
  )
}

function sourceOf(
  file: { value?: unknown; toString(): string },
  node: DirectiveNode
): string | undefined {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return undefined
  const value = typeof file.value === 'string' ? file.value : file.toString()
  return value.slice(start, end)
}

interface VisitParent {
  children: unknown[]
}

function isPoemDirective(node: unknown): node is DirectiveNode {
  if (!node || typeof node !== 'object') return false
  const directive = node as DirectiveNode
  return directive.type === 'containerDirective' && directive.name === 'poem'
}

function applyRendered(node: DirectiveNode, rendered: HastElement) {
  const data = (node.data ??= {})
  data.hName = rendered.tagName
  data.hProperties = rendered.properties
  data.hChildren = rendered.children
}

function stripPoemFootnotes(node: { children?: unknown[] }) {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (!child || typeof child !== 'object') return [child]
    const typed = child as { type?: string; children?: unknown[] }
    if (
      typed.type === 'footnoteDefinition' ||
      typed.type === 'footnoteReference'
    ) {
      return []
    }
    stripPoemFootnotes(typed)
    return [child]
  })
}

export function remarkPoem() {
  return (
    tree: { type: string },
    file: { value?: unknown; toString(): string }
  ) => {
    const ids: Ids = { poem: 0, series: 0 }
    visit(tree, (node, index, parent) => {
      if (!isPoemDirective(node)) return undefined
      if (!parent || index == null || !('children' in parent)) return undefined
      const source = sourceOf(file, node)
      if (!source) return undefined

      const poem = parseFencedPoem(source)
      const seriesName = poem.attrs.series
      const poems = [poem]
      const siblings = (parent as VisitParent).children
      if (seriesName) {
        for (let cursor = index + 1; cursor < siblings.length; cursor += 1) {
          const sibling = siblings[cursor]
          if (!isPoemDirective(sibling)) break
          const siblingSource = sourceOf(file, sibling)
          if (!siblingSource) break
          const siblingPoem = parseFencedPoem(siblingSource)
          if (siblingPoem.attrs.series !== seriesName) break
          poems.push(siblingPoem)
        }
      }

      const rendered = seriesName
        ? renderSeries({ kind: 'series', title: seriesName, poems }, ids)
        : renderPoem(poem, ids)
      applyRendered(node, rendered)
      stripPoemFootnotes(node)
      const extraCount = poems.length - 1
      if (extraCount > 0) siblings.splice(index + 1, extraCount)
      return SKIP
    })
  }
}
