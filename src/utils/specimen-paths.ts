import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { SITE } from '../config'

// Copies shown by :::folder. The remark plugin reads them at build time.
// Nothing under src/content collects this directory.

export const SPECIMENS_DIR = path.resolve(process.cwd(), 'src/specimens')

export const SPECIMEN_MANIFEST = path.join(
  process.cwd(),
  '.cache/specimen-assets.json'
)

export const SKIP_NAMES = new Set(['node_modules', '.git', 'dist'])

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'ico',
  'bmp',
])

const assets = new Map<string, string>()
let writing = Promise.resolve()

export function isImageExt(filePath: string) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return IMAGE_EXTS.has(ext)
}

export function insideDirectory(root: string, target: string) {
  const rel = path.relative(root, target)
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  )
}

export function imagePublicUrl(relPosix: string) {
  const base = SITE.base === '/' ? '' : SITE.base.replace(/\/$/, '')
  const encoded = relPosix.split('/').map(encodeURIComponent).join('/')
  return `${base}/_specimens/${encoded}`
}

export function specimenRelFromUrl(url: string) {
  const pathname = url.split('?')[0] ?? ''
  const marker = '/_specimens/'
  if (!pathname.startsWith(marker)) return
  let rel = ''
  try {
    rel = pathname
      .slice(marker.length)
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/')
  } catch {
    return
  }
  if (!rel || rel.split('/').some((part) => part === '..' || part === ''))
    return
  return rel
}

// Remember an image so the production build can copy it into dist.
export function trackSpecimenAsset(relPosix: string, absolutePath: string) {
  assets.set(relPosix, absolutePath)
  const snapshot = Object.fromEntries(assets)
  writing = writing.then(() => {
    mkdirSync(path.dirname(SPECIMEN_MANIFEST), { recursive: true })
    writeFileSync(SPECIMEN_MANIFEST, JSON.stringify(snapshot))
  })
}

export function flushSpecimenAssets() {
  return writing
}
