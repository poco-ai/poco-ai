import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const titleLimit = 60
const kinds = ['blog', 'shorts']

function usage() {
  console.log(`Usage: pnpm new <blog|shorts> <title>

  pnpm new blog demo
  pnpm new shorts demo`)
}

const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
  usage()
  process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 1)
}

const kind = args[0]
if (!kinds.includes(kind)) {
  console.error(`Unknown type "${kind}". Use blog or shorts.`)
  usage()
  process.exit(1)
}

const title = args.slice(1).join(' ').trim()
if (!title) {
  console.error('Missing title.')
  usage()
  process.exit(1)
}
if (title.length > titleLimit) {
  console.error(
    `Title is ${title.length} characters. The limit is ${titleLimit}.`
  )
  process.exit(1)
}

const now = new Date()
const year = String(now.getFullYear())
const month = String(now.getMonth() + 1).padStart(2, '0')
const day = String(now.getDate()).padStart(2, '0')
const pubDate = `${year}-${month}-${day}`

const slug =
  title
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[\\/:*?"<>|#%]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled'

const dir = join(root, 'src/content', kind, year, month)
mkdirSync(dir, { recursive: true })

let filename = `${slug}.md`
let n = 2
while (existsSync(join(dir, filename))) {
  filename = `${slug}-${n}.md`
  n += 1
}

const file = join(dir, filename)
const quoted = `"${title.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const body = `---
title: ${quoted}
description: ""
tags: []
pubDate: ${pubDate}
draft: true
---
`

writeFileSync(file, body)

const stem = filename.replace(/\.md$/, '')
const id = `${year}/${month}/${stem}`
console.log(relative(root, file))
console.log(`/${kind}/${id}/`)
