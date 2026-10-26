import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  insideDirectory,
  isImageExt,
  SPECIMEN_MANIFEST,
  SPECIMENS_DIR,
  specimenRelFromUrl,
} from './specimen-paths'

import type { AstroIntegration } from 'astro'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
}

// Dev serves /_specimens from src/specimens. The production build copies
// only the images a :::folder block actually referenced.
export function specimenAssets(): AstroIntegration {
  return {
    name: 'specimen-assets',
    hooks: {
      'astro:config:setup': ({ updateConfig, command }) => {
        if (command !== 'dev') return
        updateConfig({
          vite: {
            plugins: [specimenDevPlugin()],
          },
        })
      },
      'astro:build:done': ({ dir }) => {
        copyBuiltAssets(typeof dir === 'string' ? dir : fileURLToPath(dir))
      },
    },
  }
}

function specimenDevPlugin() {
  return {
    name: 'specimen-assets-dev',
    apply: 'serve' as const,
    configureServer(server: {
      middlewares: {
        use: (
          fn: (
            req: { url?: string },
            res: {
              statusCode: number
              setHeader: (name: string, value: string) => void
              end: (body?: Buffer) => void
            },
            next: () => void
          ) => void
        ) => void
      }
    }) {
      server.middlewares.use((req, res, next) => {
        const rel = specimenRelFromUrl(req.url ?? '')
        if (!rel) return next()
        const file = resolveDevImage(rel)
        if (!file) {
          res.statusCode = 404
          res.end()
          return
        }
        const ext = path.extname(file).slice(1).toLowerCase()
        res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(file))
      })
    },
  }
}

function resolveDevImage(rel: string) {
  if (!existsSync(SPECIMENS_DIR)) return
  const lexical = path.resolve(SPECIMENS_DIR, rel)
  if (!insideDirectory(path.resolve(SPECIMENS_DIR), lexical)) return
  if (!existsSync(lexical) || !isImageExt(lexical)) return
  let real: string
  try {
    real = realpathSync(lexical)
  } catch {
    return
  }
  const root = realpathSync(SPECIMENS_DIR)
  if (!insideDirectory(root, real)) return
  return real
}

function copyBuiltAssets(outDir: string) {
  const rels = new Set<string>([
    ...relsFromManifest(),
    ...relsFromText(readIfExists(SPECIMEN_STORE)),
    ...relsFromHtmlDir(outDir),
  ])
  for (const rel of rels) {
    if (!rel || rel.split('/').includes('..')) continue
    const lexical = path.resolve(SPECIMENS_DIR, rel)
    if (!existsSync(lexical) || !isImageExt(lexical)) continue
    let real: string
    try {
      real = realpathSync(lexical)
    } catch {
      continue
    }
    if (!insideDirectory(realpathSync(SPECIMENS_DIR), real)) continue
    if (!statSync(real).isFile()) continue
    const dest = path.join(outDir, '_specimens', rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(real, dest)
  }
}

const SPECIMEN_STORE = path.join(process.cwd(), '.astro/data-store.json')

function relsFromManifest() {
  if (!existsSync(SPECIMEN_MANIFEST)) return []
  const parsed = JSON.parse(readFileSync(SPECIMEN_MANIFEST, 'utf8')) as Record<
    string,
    string
  >
  return Object.keys(parsed)
}

function relsFromHtmlDir(dir: string) {
  const rels: string[] = []
  if (!existsSync(dir)) return rels
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) rels.push(...relsFromHtmlDir(abs))
    else if (entry.name.endsWith('.html'))
      rels.push(...relsFromText(readFileSync(abs, 'utf8')))
  }
  return rels
}

function relsFromText(text: string) {
  const rels: string[] = []
  for (const match of text.matchAll(/\/_specimens\/([^"'\\\s]+)/g)) {
    let rel = match[1] ?? ''
    try {
      rel = rel
        .split('/')
        .map((part) => decodeURIComponent(part))
        .join('/')
    } catch {
      continue
    }
    if (rel) rels.push(rel)
  }
  return rels
}

function readIfExists(file: string) {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}
