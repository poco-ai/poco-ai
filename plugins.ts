import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'
import getReadingTime from 'reading-time'

import remarkDirective from 'remark-directive'
import remarkDirectiveSugar from 'remark-directive-sugar'
import remarkImgattr from 'remark-imgattr'
import remarkMath from 'remark-math'

import { remarkFolder } from './src/utils/remark-folder'
import { remarkPoem } from './src/utils/remark-poem'
import { useFolderPipeline } from './src/utils/specimen'
import { remarkCards } from './src/utils/remark-cards'
import { remarkCode } from './src/utils/remark-code'
import { remarkSkill } from './src/utils/remark-skill'
import { remarkBlockId, remarkWikilink } from './src/utils/remark-wikilink'
import { remarkMermaid } from './src/utils/remark-mermaid'
import { remarkExcalidraw } from './src/utils/remark-excalidraw'

import { rehypeHeadingIds } from '@astrojs/markdown-remark'
import rehypeCallouts from 'rehype-callouts'
import rehypeKatex from 'rehype-katex'
import rehypeExternalLinks from 'rehype-external-links'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
// @ts-expect-error(rehype-wrap-all is not typed)
import rehypeWrapAll from 'rehype-wrap-all'

import { UI } from './src/config'

import type { RemarkPlugins, RehypePlugins } from 'astro'
import type { PropertiesFromTextDirective } from 'remark-directive-sugar'
import type { CreateProperties } from 'rehype-external-links'
import type { Root } from 'hast'

// Astro runs its own rehype-raw after user rehype plugins, so an `<a>` written
// as HTML in Markdown is still a raw node here and rehype-external-links skips it.
function classNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

function isNoteCardAnchor(el: { properties?: { className?: unknown } }) {
  return classNames(el.properties?.className).some(
    (name) =>
      name === 'note-card' ||
      name.startsWith('note-card-') ||
      name === 'code-card-head'
  )
}

function rehypeRawExternalAnchors() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (
        (node.type !== 'raw' && node.type !== 'html') ||
        !('value' in node) ||
        typeof node.value !== 'string' ||
        !node.value.includes('<a')
      )
        return

      node.value = node.value.replace(
        /<a\b([^>]*?)>/gi,
        (full, attrs: string) => {
          const hrefMatch = attrs.match(
            /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
          )
          const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? ''
          if (!href) return full
          const external = /^https?:\/\//i.test(href) || href.startsWith('//')
          if (!external || /\btarget\s*=/i.test(attrs)) return full

          let next = attrs
          const relMatch = next.match(/\brel\s*=\s*(["'])([\s\S]*?)\1/i)
          if (!relMatch) {
            next += ' rel="noopener noreferrer"'
          } else {
            const tokens = new Set(relMatch[2].split(/\s+/).filter(Boolean))
            tokens.add('noopener')
            tokens.add('noreferrer')
            next = next.replace(
              relMatch[0],
              `rel=${relMatch[1]}${[...tokens].join(' ')}${relMatch[1]}`
            )
          }
          return `<a${next} target="_blank">`
        }
      )
    })
  }
}

// https://docs.astro.build/en/recipes/reading-time/
function remarkReadingTime() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return (tree, file) => {
    const { frontmatter } = file.data.astro
    if (frontmatter.minutesRead || frontmatter.minutesRead === 0) return

    const textOnPage = toString(tree)
    const readingTime = getReadingTime(textOnPage)

    frontmatter.minutesRead = Math.max(1, Math.round(readingTime.minutes))
  }
}

export const remarkPlugins: RemarkPlugins = [
  // https://github.com/remarkjs/remark-directive
  remarkDirective,
  remarkFolder,
  // https://github.com/lin-stephanie/remark-directive-sugar
  [
    remarkDirectiveSugar,
    {
      badge: {
        presets: {
          n: { text: 'NEW' },
          a: { text: 'ARTICLE' },
          v: { text: 'VIDEO' },
        },
      },
      link: {
        faviconSourceUrl:
          'https://www.google.com/s2/favicons?domain={domain}&sz=128',
        imgProps: (node: Parameters<PropertiesFromTextDirective>[0]) => {
          const props: ReturnType<PropertiesFromTextDirective> = {
            'aria-hidden': 'true',
          }
          if (node.attributes?.class?.includes('github'))
            props.src = 'https://github.githubassets.com/favicons/favicon.svg'
          return props
        },
      },
      image: {
        stripParagraph: false,
      },
    },
  ],
  remarkPoem,
  remarkCards,
  remarkSkill,
  remarkCode,
  remarkWikilink,
  remarkBlockId,
  // https://github.com/OliverSpeir/remark-imgattr
  remarkImgattr,
  remarkMermaid,
  remarkExcalidraw,
  // https://github.com/remarkjs/remark-math/tree/main/packages/remark-math
  remarkMath,
  remarkReadingTime,
]

export const rehypePlugins: RehypePlugins = [
  // https://docs.astro.build/en/guides/markdown-content/#heading-ids-and-plugins
  rehypeHeadingIds,
  // https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex
  rehypeKatex,
  // https://github.com/lin-stephanie/rehype-callouts
  [
    rehypeCallouts,
    {
      theme: 'vitepress',
    },
  ],
  rehypeRawExternalAnchors,
  // https://github.com/rehypejs/rehype-external-links
  [
    rehypeExternalLinks,
    {
      rel: UI.externalLink.newTab ? 'noopener noreferrer' : [],
      content: (el: Parameters<CreateProperties>[0]) => {
        if (!UI.externalLink.newTab || !UI.externalLink.showNewTabIcon)
          return null
        if (isNoteCardAnchor(el)) return null

        let hasImage = false
        visit(el, 'element', (childNode) => {
          if (childNode.tagName === 'img') {
            hasImage = true
            return false
          }
        })
        if (hasImage) return null

        return {
          type: 'text',
          value: '',
        }
      },
      contentProperties: (el: Parameters<CreateProperties>[0]) => {
        if (!UI.externalLink.newTab || !UI.externalLink.showNewTabIcon)
          return null
        if (isNoteCardAnchor(el)) return null

        let hasImage = false
        visit(el, 'element', (childNode) => {
          if (childNode.tagName === 'img') {
            hasImage = true
            return false
          }
        })
        if (hasImage) return null

        return {
          'u-i-carbon-arrow-up-right': true,
          'className': ['new-tab-icon'],
          'aria-hidden': 'true',
        }
      },
      properties: (el: Parameters<CreateProperties>[0]) => {
        const props: ReturnType<CreateProperties> = {}
        const href = el.properties.href

        if (!href || typeof href !== 'string') return props

        if (UI.externalLink.newTab) {
          props.target = '_blank'
          // The card's accessible name is its title. A blanket aria-label
          // would replace that name with "Open in new tab".
          if (!isNoteCardAnchor(el)) props.ariaLabel = 'Open in new tab'
          if (
            !isNoteCardAnchor(el) &&
            UI.externalLink.cursorType.length > 0 &&
            UI.externalLink.cursorType !== 'pointer'
          ) {
            props.className = Array.isArray(el.properties.className)
              ? [...el.properties.className, 'external-link-cursor']
              : ['external-link-cursor']
          }
        }

        return props
      },
    },
  ],
  // https://github.com/rehypejs/rehype-autolink-headings
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',
      properties: (el: Parameters<CreateProperties>[0]) => {
        let content = ''
        visit(el, 'text', (textNode) => {
          content += textNode.value
        })
        return {
          'class': 'header-anchor',
          'tab-index': 0,
          'aria-hidden': 'false',
          'aria-label': content ? `Link to ${content}` : undefined,
          // avoid `#` being indexed and show in search results
          'data-pagefind-ignore': '',
        }
      },
      content: {
        type: 'text',
        value: '#',
      },
    },
  ],
  // https://github.com/florentb/rehype-wrap-all
  [
    rehypeWrapAll,
    {
      selector: 'table',
      wrapper: 'div',
    },
  ],
]

useFolderPipeline(remarkPlugins, rehypePlugins)
