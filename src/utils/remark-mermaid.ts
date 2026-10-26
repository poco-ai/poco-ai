import { visit } from 'unist-util-visit'

interface CodeNode {
  type: string
  lang?: string | null
  value?: string
}

interface ParentNode {
  children: CodeNode[]
}

// ```mermaid fences become a div the client renders. Other fences stay code.
export function remarkMermaid() {
  return (tree: ParentNode) => {
    visit(tree, 'code', (node: CodeNode, index, parent) => {
      if (node.lang !== 'mermaid' || !parent || index == null) return
      parent.children[index] = {
        type: 'html',
        value: `<div class="mermaid">${escapeHtml(node.value ?? '')}</div>`,
      }
    })
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
