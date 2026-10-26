import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { visit } from 'unist-util-visit'

interface CodeNode {
  type: string
  lang?: string | null
  value?: string
}

interface ParentNode {
  children: CodeNode[]
}

interface MarkdownFile {
  path?: string
  history?: string[]
}

interface SceneFile {
  elements?: { isDeleted?: boolean }[]
  files?: Record<string, unknown>
  appState?: {
    viewBackgroundColor?: unknown
    theme?: unknown
  }
}

// ```excalidraw fences point at a .excalidraw file. The scene is inlined and
// drawn in the browser, where the viewer can pan and zoom.
export function remarkExcalidraw() {
  return (tree: ParentNode, file: MarkdownFile) => {
    visit(tree, 'code', (node: CodeNode, index, parent) => {
      if (node.lang !== 'excalidraw' || !parent || index == null) return
      parent.children[index] = {
        type: 'html',
        value: renderFence(node.value ?? '', file),
      }
    })
  }
}

function renderFence(source: string, file: MarkdownFile) {
  const spec = source.trim()
  const markdownPath = file.path || file.history?.[0]
  if (!spec || !markdownPath) {
    throw new Error('An excalidraw block needs a path to a .excalidraw file.')
  }

  const scenePath = path.resolve(path.dirname(markdownPath), spec)
  const root = process.cwd()
  if (scenePath !== root && !scenePath.startsWith(root + path.sep)) {
    throw new Error(`Excalidraw file must stay inside the project: ${spec}`)
  }
  if (!existsSync(scenePath)) {
    throw new Error(`Excalidraw file not found: ${spec}`)
  }

  const scene = JSON.parse(readFileSync(scenePath, 'utf8')) as SceneFile
  const background = cssColor(scene.appState?.viewBackgroundColor)
  const theme = scene.appState?.theme === 'dark' ? 'dark' : 'light'
  const payload = JSON.stringify({
    elements: (scene.elements ?? []).filter((element) => !element.isDeleted),
    files: scene.files ?? {},
    appState: {
      viewBackgroundColor: background,
      theme,
    },
  }).replace(/</g, '\\u003c')

  return `<figure class="excalidraw-view"><p class="excalidraw-view-status">Loading</p><script type="application/json">${payload}</script></figure>`
}

function cssColor(value: unknown) {
  if (typeof value !== 'string') return 'transparent'
  const color = value.trim()
  if (color === 'transparent') return 'transparent'
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(color)) return color
  return 'transparent'
}
