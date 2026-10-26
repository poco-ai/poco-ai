import { readFileSync } from 'node:fs'
import path from 'node:path'

// VS Code's file icon theme, shipped in @iconify/json. Inlined at build time
// so the tree does not depend on a CSS scan of generated class names.

interface IconifyIcon {
  body: string
  width?: number
  height?: number
  left?: number
  top?: number
}

interface IconifySet {
  width?: number
  height?: number
  icons: Record<string, IconifyIcon>
}

const BY_EXT: Record<string, string> = {
  md: 'file-type-markdown',
  mdx: 'file-type-markdown',
  ts: 'file-type-typescript',
  tsx: 'file-type-reactts',
  mts: 'file-type-typescript',
  cts: 'file-type-typescript',
  js: 'file-type-js',
  jsx: 'file-type-reactjs',
  mjs: 'file-type-js',
  cjs: 'file-type-js',
  json: 'file-type-json',
  yml: 'file-type-yaml',
  yaml: 'file-type-yaml',
  toml: 'file-type-toml',
  svg: 'file-type-svg',
  png: 'file-type-image',
  jpg: 'file-type-image',
  jpeg: 'file-type-image',
  gif: 'file-type-image',
  webp: 'file-type-image',
  avif: 'file-type-image',
  ico: 'file-type-image',
  bmp: 'file-type-image',
  txt: 'file-type-text',
  css: 'file-type-css',
  scss: 'file-type-scss',
  html: 'file-type-html',
  htm: 'file-type-html',
  py: 'file-type-python',
  rs: 'file-type-rust',
  go: 'file-type-go',
  sh: 'file-type-shell',
  bash: 'file-type-shell',
  zsh: 'file-type-shell',
  vue: 'file-type-vue',
  pdf: 'file-type-pdf2',
  zip: 'file-type-zip',
}

const BY_NAME: Record<string, string> = {
  'package.json': 'file-type-npm',
  'tsconfig.json': 'file-type-tsconfig',
  dockerfile: 'file-type-docker',
  makefile: 'file-type-makefile',
}

let icons: IconifySet | undefined

function iconSet() {
  if (icons) return icons
  const file = path.join(
    process.cwd(),
    'node_modules/@iconify/json/json/vscode-icons.json'
  )
  icons = JSON.parse(readFileSync(file, 'utf8')) as IconifySet
  return icons
}

export function fileIcon(name: string, kind: 'file' | 'dir', open = false) {
  const set = iconSet()
  const key =
    kind === 'dir'
      ? open
        ? 'default-folder-opened'
        : 'default-folder'
      : (iconName(name, set) ?? 'default-file')
  const resolved = set.icons[key] ? key : 'default-file'
  const state = kind === 'dir' ? (open ? ' is-open' : ' is-closed') : ''
  return svg(set, resolved, state)
}

function iconName(filename: string, set: IconifySet) {
  const base = filename.toLowerCase()
  const named = BY_NAME[base]
  if (named && set.icons[named]) return named
  const ext = path.extname(filename).slice(1).toLowerCase()
  const fromExt = ext ? BY_EXT[ext] : undefined
  if (fromExt && set.icons[fromExt]) return fromExt
  if (!ext && set.icons['file-type-binary']) return 'file-type-binary'
  return undefined
}

function svg(set: IconifySet, name: string, state = '') {
  const icon = set.icons[name]
  if (!icon) return ''
  const width = icon.width ?? set.width ?? 32
  const height = icon.height ?? set.height ?? 32
  const left = icon.left ?? 0
  const top = icon.top ?? 0
  return `<svg class="folder-icon${state}" viewBox="${left} ${top} ${width} ${height}" aria-hidden="true">${icon.body}</svg>`
}
