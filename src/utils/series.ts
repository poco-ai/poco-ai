import { basename, extname } from 'node:path'
import { getCollection } from 'astro:content'

import { getFilteredPosts } from '~/utils/data'
import { withBasePath } from '~/utils/path'

import type { CollectionEntry } from 'astro:content'

export type SeriesCollection = 'blog' | 'shorts'

export interface SeriesPostRef {
  id: string
  collection: SeriesCollection
  title: string
  pubDate: string
  order?: number
  href: string
}

export interface SeriesGroup {
  slug: string
  title: string
  description: string
  href: string
  posts: SeriesPostRef[]
}

type PostEntry = CollectionEntry<'blog' | 'shorts'>
type SeriesEntry = CollectionEntry<'series'>

const minPostsOnSeriesPage = 2

/**
 * Positive integers are handwritten positions. Empty, null, and omitted are not.
 */
export function handwrittenOrder(order: unknown): order is number {
  return typeof order === 'number'
}

/**
 * Filename without the extension. `src/content/series/agent-world.md` is `agent-world`.
 */
export function seriesFileSlug(entry: { id: string; filePath?: string }) {
  if (!entry.filePath) return entry.id
  return basename(entry.filePath, extname(entry.filePath))
}

/**
 * Posts with `order` come first, ascending. The rest follow by `pubDate`, then id.
 * Equal `order` values also break ties by `pubDate`, then id.
 */
export function compareSeriesPosts(a: SeriesPostRef, b: SeriesPostRef) {
  const aOrder = handwrittenOrder(a.order) ? a.order : undefined
  const bOrder = handwrittenOrder(b.order) ? b.order : undefined

  if (aOrder !== undefined && bOrder === undefined) return -1
  if (aOrder === undefined && bOrder !== undefined) return 1
  if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
    return aOrder - bOrder
  }

  if (a.pubDate !== b.pubDate) return a.pubDate < b.pubDate ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  if (a.collection !== b.collection) {
    return a.collection < b.collection ? -1 : 1
  }
  return 0
}

function describePost(post: PostEntry) {
  return post.filePath ? `"${post.id}" (${post.filePath})` : `"${post.id}"`
}

/**
 * A non-empty series slug must name a series file.
 * `order` without `series` is invalid. The message includes the post id.
 */
export function assertSeriesReferences(
  posts: PostEntry[],
  seriesSlugs: Set<string>
) {
  const problems: string[] = []

  for (const post of posts) {
    const slug = post.data.series.trim()
    if (handwrittenOrder(post.data.order) && !slug) {
      problems.push(
        `Post ${describePost(post)} sets order but series is empty.`
      )
    }
    if (slug && !seriesSlugs.has(slug)) {
      problems.push(
        `Post ${describePost(post)} references series "${slug}", but src/content/series/${slug}.md does not exist.`
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(`Series check failed.\n${problems.join('\n')}`)
  }
}

function toRef(post: PostEntry): SeriesPostRef {
  return {
    id: post.id,
    collection: post.collection,
    title: post.data.title,
    pubDate: post.data.pubDate.toISOString(),
    order: handwrittenOrder(post.data.order) ? post.data.order : undefined,
    href: withBasePath(`/${post.collection}/${post.id}/`),
  }
}

/**
 * Series groups for this build. Visibility matches `getFilteredPosts`:
 * production omits drafts, development keeps them.
 * A series file with no visible posts is omitted and gets no page.
 */
export async function loadSeriesGroups() {
  const [blog, shorts, seriesEntries, visibleBlog, visibleShorts] =
    await Promise.all([
      getCollection('blog'),
      getCollection('shorts'),
      getCollection('series'),
      getFilteredPosts('blog'),
      getFilteredPosts('shorts'),
    ])

  const seriesBySlug = new Map<string, SeriesEntry>()
  for (const entry of seriesEntries) {
    seriesBySlug.set(seriesFileSlug(entry), entry)
  }

  assertSeriesReferences([...blog, ...shorts], new Set(seriesBySlug.keys()))

  const grouped = new Map<string, SeriesPostRef[]>()
  for (const post of [...visibleBlog, ...visibleShorts]) {
    const slug = post.data.series.trim()
    if (!slug) continue
    const posts = grouped.get(slug) ?? []
    posts.push(toRef(post))
    grouped.set(slug, posts)
  }

  const groups = new Map<string, SeriesGroup>()
  for (const [slug, posts] of grouped) {
    const series = seriesBySlug.get(slug)
    if (!series) {
      throw new Error(
        `Series "${slug}" is missing at src/content/series/${slug}.md.`
      )
    }
    posts.sort(compareSeriesPosts)
    groups.set(slug, {
      slug,
      title: series.data.title,
      description: series.data.description,
      href: withBasePath(`/series/${slug}/`),
      posts,
    })
  }

  return groups
}

/** Groups that render `/series/<slug>/`. Fewer than two visible posts do not. */
export function seriesPages(groups: Map<string, SeriesGroup>) {
  return [...groups.values()].filter(
    (group) => group.posts.length >= minPostsOnSeriesPage
  )
}

/**
 * Placement of one visible post. Undefined when the post has no series,
 * or the series has fewer than two visible posts.
 * `position` is the sorted place, not the raw `order` value.
 */
export function seriesPlacement(
  groups: Map<string, SeriesGroup>,
  post: { id: string; collection: SeriesCollection; data: { series: string } }
) {
  const slug = post.data.series.trim()
  if (!slug) return undefined

  const group = groups.get(slug)
  if (!group || group.posts.length < minPostsOnSeriesPage) return undefined

  const index = group.posts.findIndex(
    (item) => item.id === post.id && item.collection === post.collection
  )
  if (index < 0) return undefined

  return { group, index, position: index + 1 }
}
