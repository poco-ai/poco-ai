import { defineConfig, fontProviders, logHandlers } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import robotsTxt from 'astro-robots-txt'
import unocss from 'unocss/astro'
import astroExpressiveCode from 'astro-expressive-code'
import mdx from '@astrojs/mdx'
import { unified } from '@astrojs/markdown-remark'

import { remarkPlugins, rehypePlugins } from './plugins'
import { SITE } from './src/config'
import { DEFAULT_LOCALE, LOCALES } from './src/i18n'
import { specimenAssets } from './src/utils/specimen-assets'

const sansFallbacks = [
  'ui-sans-serif',
  'system-ui',
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"',
  '"Segoe UI Symbol"',
  '"Noto Color Emoji"',
  'sans-serif',
]

const monoFallbacks = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Courier New"',
  'monospace',
]

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: SITE.website,
  base: SITE.base,
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: {
      prefixDefaultLocale: false,
    },
  },
  build: {
    inlineStylesheets: 'never',
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: {
          en: 'en',
          zh: 'zh-CN',
        },
      },
    }),
    robotsTxt(),
    unocss({ injectReset: true }),
    astroExpressiveCode(),
    mdx(),
    specimenAssets(),
  ],
  markdown: {
    syntaxHighlight: false,
    processor: unified({
      remarkPlugins: remarkPlugins,
      rehypePlugins: rehypePlugins,
    }),
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-sans',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      formats: ['woff2'],
      fallbacks: sansFallbacks,
    },
    {
      provider: fontProviders.fontsource(),
      name: 'DM Mono',
      cssVariable: '--font-mono',
      weights: [400],
      styles: ['normal'],
      subsets: ['latin'],
      formats: ['woff2'],
      fallbacks: monoFallbacks,
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Roboto Condensed',
      cssVariable: '--font-condensed',
      weights: [400],
      styles: ['normal'],
      subsets: ['latin'],
      formats: ['woff2'],
      fallbacks: sansFallbacks,
    },
    {
      // Glyphs for the homepage epigraph only.
      provider: fontProviders.local(),
      name: 'Ma Shan Zheng',
      cssVariable: '--font-display',
      fallbacks: ['"Songti SC"', '"STKaiti"', 'serif'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: ['./src/assets/fonts/ma-shan-zheng.woff2'],
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Great Vibes',
      cssVariable: '--font-script',
      fallbacks: ['cursive'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: ['./src/assets/fonts/great-vibes.woff2'],
          },
        ],
      },
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Source Serif 4',
      cssVariable: '--font-heading',
      weights: [600],
      styles: ['normal'],
      subsets: ['latin'],
      formats: ['woff2'],
      fallbacks: ['"Iowan Old Style"', 'Palatino', '"Songti SC"', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-og-sans',
      weights: [400],
      styles: ['normal'],
      subsets: ['latin'],
      formats: ['woff'],
      fallbacks: sansFallbacks,
      options: {
        experimental: {
          variableAxis: {
            opsz: ['24'],
          },
        },
      },
    },
  ],
  image: {
    // https://docs.astro.build/en/guides/images/#responsive-image-behavior
    // Used for all local (except `/public`) and authorized remote images using `![]()` syntax; not configurable per-image
    // Used for all `<Image />` and `<Picture />` components unless overridden with `layout` prop
    layout: 'constrained',
    responsiveStyles: true,
    domains: SITE.imageDomains,
  },
  security: {
    // Allow Giscus iframe to load local styles
    // 1. Allow Giscus through Astro's dev request filter without warning
    allowedDomains: [
      {
        hostname: 'giscus.app',
        protocol: 'https',
      },
    ],
  },
  vite: {
    logLevel: 'warn',
    build: { chunkSizeWarningLimit: 1200 },
    server: {
      headers: {
        // 2. Satisfy the browser's CORS check for Giscus theme CSS and fonts
        'Access-Control-Allow-Origin': 'https://giscus.app',
      },
    },
  },
  logger: logHandlers.node({ level: 'info' }),
  experimental: {
    contentIntellisense: true,
    chromeDevtoolsWorkspace: true,
  },
})
