import { glob, file } from 'astro/loaders'
import { defineCollection } from 'astro:content'

import { feedLoader } from '@ascorbic/feed-loader'
import { githubReleasesLoader } from 'astro-loader-github-releases'
import { githubPrsLoader } from 'astro-loader-github-prs'

import {
  pageSchema,
  postSchema,
  projectSchema,
  seriesSchema,
  streamSchema,
  photoSchema,
} from '~/schema'

const pages = defineCollection({
  loader: glob({ base: './src/pages', pattern: '**/*.mdx' }),
  schema: pageSchema,
})

const home = defineCollection({
  loader: glob({ base: './src/content/home', pattern: '**/*.{md,mdx}' }),
})

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/[^_]*.{md,mdx}' }),
  schema: postSchema,
})

const projects = defineCollection({
  loader: file('./src/content/projects/data.json'),
  schema: projectSchema,
})

const releases = defineCollection({
  loader: githubReleasesLoader({
    mode: 'repoList',
    repos: [
      'withastro/astro',
      'withastro/starlight',
      'lin-stephanie/astro-loaders',
      'lin-stephanie/astro-antfustyle-theme',
    ],
    monthsBack: 2,
    entryReturnType: 'byRelease',
    clearStore: true,
  }),
})

const prs = defineCollection({
  loader: githubPrsLoader({
    search:
      'repo:withastro/astro repo:withastro/starlight repo:lin-stephanie/astro-antfustyle-theme',
    monthsBack: 1,
    clearStore: true,
  }),
})

const photos = defineCollection({
  loader: file('src/content/photos/data.json'),
  schema: photoSchema,
})

const shorts = defineCollection({
  loader: glob({ base: './src/content/shorts', pattern: '**/[^_]*.{md,mdx}' }),
  schema: postSchema,
})

const series = defineCollection({
  loader: glob({
    base: './src/content/series',
    pattern: '*.md',
  }),
  schema: seriesSchema,
})

const streams = defineCollection({
  loader: file('./src/content/streams/data.json'),
  schema: streamSchema,
})

const feeds = defineCollection({
  loader: feedLoader({
    url: 'https://astro.build/rss.xml',
  }),
})

export const collections = {
  pages,
  home,
  blog,
  projects,
  releases,
  prs,
  photos,
  shorts,
  series,
  streams,
  feeds,
}
