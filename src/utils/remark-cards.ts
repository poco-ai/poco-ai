import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { decode } from 'html-entities'
import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'

// ::github, ::song, ::card, and ::paper. Metadata is fetched at build time
// and cached in .cache/embed-cards.json. A failed fetch still renders a link.

const WEEK = 7 * 24 * 60 * 60 * 1000
const MONTH = 30 * 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const CACHE_PATH = path.join(process.cwd(), '.cache', 'embed-cards.json')
const USER_AGENT = 'antfustyle-blog'

const CARD_NAMES = new Set(['github', 'song', 'card', 'paper'])

const LANGUAGE_COLORS: Record<string, string> = {
  'Astro': '#ff5a03',
  'C': '#555555',
  'C#': '#178600',
  'C++': '#f34b7d',
  'CSS': '#663399',
  'CUDA': '#3a4e3a',
  'Dart': '#00b4ab',
  'Dockerfile': '#384d54',
  'Elixir': '#6e4a7e',
  'Go': '#00add8',
  'HTML': '#e34c26',
  'Haskell': '#5e5086',
  'Java': '#b07219',
  'JavaScript': '#f1e05a',
  'Jupyter Notebook': '#da5b0b',
  'Kotlin': '#a97bff',
  'Lua': '#000080',
  'MDX': '#fcb32c',
  'Markdown': '#083fa1',
  'Nix': '#7e7eff',
  'PHP': '#4f5d95',
  'Python': '#3572a5',
  'R': '#198ce7',
  'Ruby': '#701516',
  'Rust': '#dea584',
  'SCSS': '#c6538c',
  'Scala': '#c22d40',
  'Shell': '#89e051',
  'Solidity': '#aa6746',
  'Svelte': '#ff3e00',
  'Swift': '#f05138',
  'TypeScript': '#3178c6',
  'Vue': '#41b883',
  'Zig': '#ec915c',
}

interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, string | undefined>
  children: HastChild[]
}

type HastChild = HastText | HastElement

interface DirectiveNode {
  type: string
  name?: string
  attributes?: Record<string, string | null | undefined>
  data?: Record<string, unknown>
  children?: unknown[]
}

interface CacheEntry {
  fetchedAt: number
  ok: boolean
  data?: unknown
}

interface GithubCard {
  url: string
  owner: string
  repo: string
  description: string
  stars: number
  language: string
  avatar: string
}

interface LinkCard {
  url: string
  host: string
  title: string
  description: string
  image: string
}

interface PaperCard {
  url: string
  id: string
  title: string
  authors: string
  year: string
  category: string
  summary: string
}

interface SongCard {
  name: string
  artist: string
  cover: string
  duration: number
}

interface LinkOverrides {
  title: string
  description: string
  image: string
}

let memory: Record<string, CacheEntry> | null = null
let loading: Promise<Record<string, CacheEntry>> | null = null
let writing: Promise<void> = Promise.resolve()
const inflight = new Map<string, Promise<unknown>>()

function text(value: string): HastText {
  return { type: 'text', value }
}

function el(
  tagName: string,
  properties: Record<string, string | undefined>,
  children: HastChild[]
): HastElement {
  const clean: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) clean[key] = value
  }
  return { type: 'element', tagName, properties: clean, children }
}

function plain(value: string): string {
  return decode(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(value: string, max: number): string {
  const cleaned = plain(value)
  if (cleaned.length <= max) return cleaned
  const sliced = cleaned.slice(0, max)
  const cut = sliced.replace(/\s+\S*$/, '').trim()
  return `${cut || sliced.trim()}…`
}

function attr(node: DirectiveNode, ...keys: string[]): string {
  for (const key of keys) {
    const value = node.attributes?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function labelOf(node: DirectiveNode): string {
  return toString(node as Parameters<typeof toString>[0]).trim()
}

function httpUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

function imageSrc(value: string, base?: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    return httpUrl(base ? new URL(trimmed, base).href : trimmed)
  } catch {
    return ''
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function parseRepo(raw: string): string {
  const value = raw
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  const fromUrl = value.match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i
  )
  const pair = fromUrl ? `${fromUrl[1]}/${fromUrl[2]}` : value
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pair)) return ''
  return pair
}

function parseSongId(raw: string): string {
  const value = raw.trim()
  const fromQuery = value.match(/[?&#]id=(\d+)/)
  if (fromQuery) return fromQuery[1]
  const fromPath = value.match(/\/song\/(\d+)/)
  if (fromPath) return fromPath[1]
  if (/^\d+$/.test(value)) return value
  return ''
}

function parsePaperId(raw: string): string {
  let value = raw.trim()
  const fromUrl = value.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#\s]+)/i)
  if (fromUrl) value = fromUrl[1]
  value = value.replace(/^arxiv:/i, '').replace(/\.pdf$/i, '')
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(value)) return value
  if (/^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i.test(value)) return value
  return ''
}

function compactCount(count: number): string {
  if (count < 1000) return String(count)
  const units = [
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ] as const
  for (const [size, unit] of units) {
    if (count < size) continue
    const value = count / size
    const digits = value >= 10 || Number.isInteger(value) ? 0 : 1
    return `${value.toFixed(digits).replace(/\.0$/, '')}${unit}`
  }
  return String(count)
}

function starsEl(count: number): HastElement {
  return el('span', { className: 'note-card-stars' }, [
    el('svg', { 'viewBox': '0 0 16 16', 'aria-hidden': 'true' }, [
      el(
        'path',
        {
          fill: 'currentColor',
          d: 'M8 1.4 9.9 5.6l4.6.4-3.5 3 .1 4.6L8 11.4 4.9 13.6l1.1-4.6-3.5-3 4.6-.4Z',
        },
        []
      ),
    ]),
    text(compactCount(count)),
  ])
}

function formatAuthors(names: string[]): string {
  const clean = names.map((name) => plain(name)).filter(Boolean)
  if (clean.length <= 3) return clean.join(', ')
  return `${clean.slice(0, 3).join(', ')} et al.`
}

function applyRendered(node: DirectiveNode, rendered: HastElement) {
  const data = (node.data ??= {})
  data.hName = rendered.tagName
  data.hProperties = rendered.properties
  data.hChildren = rendered.children
}

function missing(kind: string, message: string): HastElement {
  return el(
    'div',
    { 'className': 'note-card note-card-fallback', 'data-note-card': kind },
    [
      el('span', { className: 'note-card-body' }, [
        el('span', { className: 'note-card-title' }, [text(message)]),
      ]),
    ]
  )
}

function kicker(value: string): HastElement {
  return el('span', { className: 'note-card-kicker' }, [text(value)])
}

function titleEl(children: HastChild[], wrap = false): HastElement {
  return el(
    'span',
    { className: wrap ? 'note-card-title is-wrap' : 'note-card-title' },
    children
  )
}

function titleLine(children: HastChild[], className = ''): HastElement {
  return el(
    'span',
    { className: className ? `note-card-line ${className}` : 'note-card-line' },
    children
  )
}

function tagEl(label: string): HastElement {
  return el('span', { className: 'note-card-tag' }, [text(label)])
}

function descriptionEl(value: string): HastElement | null {
  const clipped = clip(value, 240)
  if (!clipped) return null
  return el('span', { className: 'note-card-desc' }, [text(clipped)])
}

function cardLink(
  kind: string,
  href: string,
  media: HastChild | null,
  body: HastChild[]
): HastElement {
  const children: HastChild[] = []
  if (media) children.push(media)
  children.push(el('span', { className: 'note-card-body' }, body))
  return el(
    'a',
    { 'className': 'note-card', href, 'data-note-card': kind },
    children
  )
}

function mediaImage(src: string, icon: boolean): HastElement {
  return el(
    'img',
    {
      className: icon ? 'note-card-media note-card-icon' : 'note-card-media',
      src,
      alt: '',
      width: '72',
      height: '72',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: icon ? undefined : 'no-referrer',
    },
    []
  )
}

function renderGithub(repoName: string, card: GithubCard | null): HastElement {
  const href = card?.url || `https://github.com/${repoName}`
  if (!card) {
    return cardLink('github', href, null, [
      titleLine([titleEl([text(repoName)]), tagEl('repo')]),
    ])
  }

  const line: HastChild[] = [
    titleEl([
      el('span', { className: 'note-card-owner' }, [text(`${card.owner}/`)]),
      text(card.repo),
    ]),
  ]
  if (Number.isFinite(card.stars)) line.push(starsEl(card.stars))
  line.push(tagEl('repo'))

  const body: HastChild[] = [titleLine(line)]
  const description = descriptionEl(card.description)
  if (description) body.push(description)

  const meta: HastChild[] = []
  if (card.language) {
    const color = LANGUAGE_COLORS[card.language]
    meta.push(
      el('span', { className: 'note-card-lang' }, [
        el(
          'span',
          {
            className: 'note-card-dot',
            style: color ? `background-color:${color}` : undefined,
          },
          []
        ),
        text(card.language),
      ])
    )
  }
  if (meta.length) {
    body.push(el('span', { className: 'note-card-meta' }, meta))
  }

  const media = card.avatar ? mediaImage(card.avatar, false) : null
  return cardLink('github', href, media, body)
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const remain = total % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

function coverUrl(raw: string): string {
  const secure = raw.trim().replace(/^http:\/\//i, 'https://')
  const url = httpUrl(secure)
  if (!url) return ''
  const parsed = new URL(url)
  if (!parsed.searchParams.has('param'))
    parsed.searchParams.set('param', '180y180')
  return parsed.href
}

function glyph(kind: 'play' | 'pause'): HastElement {
  const play = kind === 'play'
  return el(
    'svg',
    {
      'className': play
        ? 'note-card-glyph is-play'
        : 'note-card-glyph is-pause',
      'viewBox': '0 0 24 24',
      'width': '16',
      'height': '16',
      'aria-hidden': 'true',
    },
    [
      el(
        'path',
        {
          fill: 'currentColor',
          d: play ? 'M8 5.5v13l11-6.5-11-6.5z' : 'M6 5h4v14H6zm8 0h4v14h-4z',
        },
        []
      ),
    ]
  )
}

// The official outchain iframe calls /api/song/enhance/player/url and, for these
// songs, gets an empty url, so its play control does nothing. MetingJS resolves
// audio on demand from a type=url endpoint. The CDN address expires in minutes,
// so it is not stored on the card. Resolved when the listener presses play.
const SONG_SCRIPT = `(() => {
  if (window.__noteCardSong) return
  window.__noteCardSong = true
  const srcFor = (id) =>
    'https://api.injahow.cn/meting/?server=netease&type=url&id=' + encodeURIComponent(id)
  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return m + ':' + String(sec).padStart(2, '0')
  }
  const cardOf = (node) =>
    node && node.closest ? node.closest('[data-note-card="song"]') : null
  const audioOf = (card) => card.querySelector('audio')
  const paint = (card) => {
    const audio = audioOf(card)
    if (!audio) return
    const time = card.querySelector('[data-song-time]')
    const dur = card.querySelector('[data-song-duration]')
    const seek = card.querySelector('[data-song-seek]')
    if (time) time.textContent = fmt(audio.currentTime || 0)
    if (dur && Number.isFinite(audio.duration)) dur.textContent = fmt(audio.duration)
    if (
      seek &&
      seek.dataset.drag !== '1' &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0
    ) {
      const ratio = audio.currentTime / audio.duration
      seek.value = String(Math.round(ratio * 1000))
      seek.style.setProperty('--song-progress', ratio * 100 + '%')
    }
  }
  const setPlaying = (card, on) => {
    if (card.classList.contains('is-failed')) return
    card.classList.toggle('is-playing', on)
    const btn = card.querySelector('[data-song-play]')
    if (btn) btn.setAttribute('aria-label', on ? 'Pause' : 'Play')
  }
  const fail = (card) => {
    card.classList.add('is-failed')
    card.classList.remove('is-playing')
    const btn = card.querySelector('[data-song-play]')
    if (btn) {
      btn.disabled = true
      btn.setAttribute('aria-label', "Can't play")
    }
    const status = card.querySelector('[data-song-status]')
    if (status) status.hidden = false
  }
  document.addEventListener('click', (event) => {
    const btn = event.target.closest && event.target.closest('[data-song-play]')
    if (!btn) return
    const card = cardOf(btn)
    const audio = card && audioOf(card)
    if (!card || !audio || card.classList.contains('is-failed')) return
    if (!audio.paused) {
      audio.pause()
      setPlaying(card, false)
      return
    }
    if (!audio.getAttribute('src')) {
      const id = card.getAttribute('data-song-id')
      if (!id) return fail(card)
      audio.src = srcFor(id) + '&r=' + Date.now()
    }
    document.querySelectorAll('[data-note-card="song"]').forEach((other) => {
      if (other === card) return
      const otherAudio = audioOf(other)
      if (otherAudio && !otherAudio.paused) otherAudio.pause()
      setPlaying(other, false)
    })
    const pending = audio.play()
    if (pending && pending.then) pending.then(() => setPlaying(card, true)).catch(() => fail(card))
    else setPlaying(card, true)
    const started = performance.now()
    const watch = () => {
      if (card.classList.contains('is-failed') || audio.paused) return
      if (audio.readyState >= 1 || audio.currentTime > 0) return
      if (performance.now() - started > 8000) return fail(card)
      setTimeout(watch, 400)
    }
    watch()
  })
  document.addEventListener('input', (event) => {
    const seek = event.target.closest && event.target.closest('[data-song-seek]')
    if (!seek) return
    const card = cardOf(seek)
    const audio = card && audioOf(card)
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    audio.currentTime = (Number(seek.value) / 1000) * audio.duration
    seek.style.setProperty('--song-progress', Number(seek.value) / 10 + '%')
    paint(card)
  })
  const onMedia = (event) => {
    const audio = event.target
    if (!audio || audio.tagName !== 'AUDIO') return
    const card = cardOf(audio)
    if (!card) return
    if (event.type === 'timeupdate' || event.type === 'loadedmetadata') paint(card)
    if (event.type === 'play') setPlaying(card, true)
    if (event.type === 'pause' || event.type === 'ended') setPlaying(card, false)
    if (event.type === 'error') fail(card)
  }
  ;['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended', 'error'].forEach((type) => {
    document.addEventListener(type, onMedia, true)
  })
})()`

function renderSong(id: string, card: SongCard | null): HastElement {
  const href = `https://music.163.com/song?id=${id}`
  const cover = card?.cover
    ? el(
        'img',
        {
          className: 'note-card-media no-zoom',
          src: card.cover,
          alt: '',
          width: '72',
          height: '72',
          loading: 'lazy',
          decoding: 'async',
          referrerpolicy: 'no-referrer',
        },
        []
      )
    : el('span', { 'className': 'note-card-mark', 'aria-hidden': 'true' }, [
        text('♪'),
      ])
  const info: HastChild[] = [
    el('span', { className: 'note-card-song-line' }, [
      el('span', { className: 'note-card-title' }, [text(card?.name || id)]),
      el(
        'a',
        {
          'className': 'note-card-open',
          'href': href,
          'aria-label': 'Open on NetEase',
        },
        [
          el(
            'img',
            {
              className: 'note-card-netease no-zoom',
              src: '/logos/netease-cloud-music.svg',
              alt: '',
              width: '18',
              height: '18',
            },
            []
          ),
        ]
      ),
    ]),
  ]
  if (card?.artist) {
    info.push(
      el('span', { className: 'note-card-authors' }, [text(card.artist)])
    )
  }
  info.push(
    el('span', { className: 'note-card-track' }, [
      el('span', { 'className': 'note-card-time', 'data-song-time': '' }, [
        text('0:00'),
      ]),
      el(
        'input',
        {
          'className': 'note-card-seek',
          'type': 'range',
          'min': '0',
          'max': '1000',
          'value': '0',
          'data-song-seek': '',
          'aria-label': 'Progress',
        },
        []
      ),
      el('span', { 'className': 'note-card-time', 'data-song-duration': '' }, [
        text(formatClock(card?.duration || 0)),
      ]),
    ])
  )
  info.push(
    el(
      'span',
      {
        'className': 'note-card-status',
        'data-song-status': '',
        'hidden': '',
      },
      [text("Can't play here")]
    )
  )

  return el(
    'div',
    {
      'className': 'note-card note-card-song',
      'data-note-card': 'song',
      'data-song-id': id,
    },
    [
      el(
        'button',
        {
          'type': 'button',
          'className': 'note-card-play',
          'data-song-play': '',
          'aria-label': 'Play',
        },
        [
          cover,
          el(
            'span',
            { 'className': 'note-card-play-icon', 'aria-hidden': 'true' },
            [glyph('play'), glyph('pause')]
          ),
        ]
      ),
      el('span', { className: 'note-card-body' }, info),
      el('audio', { preload: 'none', referrerpolicy: 'no-referrer' }, []),
      el('script', {}, [text(SONG_SCRIPT)]),
    ]
  )
}

function renderLink(
  url: string,
  card: LinkCard | null,
  overrides: LinkOverrides
): HastElement {
  const host = card?.host || hostOf(url)
  const title = overrides.title || card?.title || url
  const description = overrides.description || card?.description || ''
  const image = overrides.image || card?.image || ''
  const icon =
    !image && host
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
      : ''
  const mediaSrc = image || icon
  const body: HastChild[] = []
  if (host && title !== host) body.push(kicker(host))
  body.push(titleEl([text(title)]))
  const summary = descriptionEl(description)
  if (summary) body.push(summary)
  return cardLink(
    'card',
    url,
    mediaSrc ? mediaImage(mediaSrc, !image) : null,
    body
  )
}

function renderPaper(id: string, card: PaperCard | null): HastElement {
  const href = card?.url || `https://arxiv.org/abs/${id}`
  const mark = arxivMark()
  if (!card) {
    return cardLink('paper', href, mark, [
      titleLine([titleEl([text(id)]), tagEl('paper')]),
    ])
  }

  const body: HastChild[] = [
    titleLine([titleEl([text(card.title)], true), tagEl('paper')], 'is-top'),
  ]
  const facts = paperFacts(card)
  if (facts) body.push(facts)
  const summary = paperSummary(card.summary)
  if (summary) body.push(summary)
  return cardLink('paper', href, mark, body)
}

function arxivMark(): HastElement {
  const image = mediaImage('/logos/arxiv.svg', false)
  image.properties.alt = 'arXiv'
  image.properties.className = `${image.properties.className} note-card-logo`
  return image
}

function paperFacts(card: PaperCard): HastElement | null {
  const meta = [card.year, card.category, card.id].filter(Boolean).join(' · ')
  const children: HastChild[] = []
  if (card.authors) {
    children.push(
      el('span', { className: 'note-card-authors' }, [
        miniIcon('person'),
        el('span', {}, [text(card.authors)]),
      ])
    )
  }
  if (meta) {
    children.push(el('span', { className: 'note-card-meta' }, [text(meta)]))
  }
  if (!children.length) return null
  return el('span', { className: 'note-card-paper-row' }, children)
}

function paperSummary(value: string): HastElement | null {
  const clipped = clip(value, 240)
  if (!clipped) return null
  return el('span', { className: 'note-card-desc note-card-paper-summary' }, [
    miniIcon('text'),
    el('span', {}, [text(clipped)]),
  ])
}

function miniIcon(kind: 'person' | 'text'): HastElement {
  const person =
    'M8 8.15a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM3.35 13.55c.6-2.2 2.45-3.35 4.65-3.35s4.05 1.15 4.65 3.35'
  const text = 'M3.25 3.75h9.5M3.25 6.75h9.5M3.25 9.75h6.5M3.25 12.75h4.25'
  return el(
    'svg',
    {
      'className': 'note-card-mini',
      'viewBox': '0 0 16 16',
      'aria-hidden': 'true',
    },
    [
      el(
        'path',
        {
          'd': kind === 'person' ? person : text,
          'fill': 'none',
          'stroke': 'currentColor',
          'stroke-width': '1.3',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        []
      ),
    ]
  )
}

async function cacheStore(): Promise<Record<string, CacheEntry>> {
  if (memory) return memory
  if (!loading) {
    loading = readFile(CACHE_PATH, 'utf8')
      .then((raw) => {
        const parsed = JSON.parse(raw) as Record<string, CacheEntry>
        memory = parsed && typeof parsed === 'object' ? parsed : {}
        return memory
      })
      .catch(() => {
        memory = {}
        return memory
      })
  }
  return loading
}

function remember(key: string, entry: CacheEntry) {
  if (!memory) memory = {}
  memory[key] = entry
  const snapshot = memory
  writing = writing
    .then(async () => {
      await mkdir(path.dirname(CACHE_PATH), { recursive: true })
      await writeFile(CACHE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
    })
    .catch(() => undefined)
}

function fresh(entry: CacheEntry, ttl: number): boolean {
  const age = Date.now() - entry.fetchedAt
  if (!Number.isFinite(entry.fetchedAt) || age < 0) return false
  return entry.ok ? age < ttl : age < HOUR
}

async function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T | null>,
  parse: (data: unknown) => T | null
): Promise<T | null> {
  const store = await cacheStore()
  const hit = store[key]
  if (hit && fresh(hit, ttl)) {
    if (!hit.ok) return null
    const parsed = parse(hit.data)
    if (parsed) return parsed
  }

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T | null>

  const request = (async () => {
    let data: T | null = null
    try {
      data = await load()
    } catch {
      data = null
    }
    remember(key, {
      fetchedAt: Date.now(),
      ok: data != null,
      data: data ?? undefined,
    })
    return data
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, request)
  return request
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, limit)

  const decoder = new TextDecoder()
  let received = 0
  let body = ''
  while (received < limit) {
    const { done, value } = await reader.read()
    if (done || !value) break
    received += value.byteLength
    body += decoder.decode(value, { stream: true })
  }
  body += decoder.decode()
  await reader.cancel().catch(() => undefined)
  return body.slice(0, limit)
}

async function request(
  url: string,
  headers: Record<string, string>,
  timeout: number,
  limit: number
): Promise<{ ok: boolean; finalUrl: string; body: string } | null> {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
  const body = await readLimited(response, limit)
  if (!response.ok) return null
  return { ok: true, finalUrl: response.url || url, body }
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null
  return data as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseGithub(data: unknown): GithubCard | null {
  const row = asRecord(data)
  if (!row) return null
  const owner = asString(row.owner)
  const repo = asString(row.repo)
  const url = httpUrl(asString(row.url))
  if (!owner || !repo || !url) return null
  return {
    url,
    owner,
    repo,
    description: asString(row.description),
    stars: typeof row.stars === 'number' ? row.stars : 0,
    language: asString(row.language),
    avatar: httpUrl(asString(row.avatar)),
  }
}

function parseLink(data: unknown): LinkCard | null {
  const row = asRecord(data)
  if (!row) return null
  const url = httpUrl(asString(row.url))
  const title = asString(row.title)
  if (!url || !title) return null
  return {
    url,
    host: asString(row.host) || hostOf(url),
    title,
    description: asString(row.description),
    image: imageSrc(asString(row.image), url),
  }
}

function parsePaper(data: unknown): PaperCard | null {
  const row = asRecord(data)
  if (!row) return null
  const id = asString(row.id)
  const title = asString(row.title)
  const url = httpUrl(asString(row.url))
  if (!id || !title || !url) return null
  return {
    url,
    id,
    title,
    authors: asString(row.authors),
    year: asString(row.year),
    category: asString(row.category),
    summary: asString(row.summary),
  }
}

async function loadGithub(repoName: string): Promise<GithubCard | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await request(
    `https://api.github.com/repos/${repoName}`,
    headers,
    8000,
    200_000
  )
  if (!response) return null

  const payload = JSON.parse(response.body) as {
    full_name?: string
    description?: string | null
    stargazers_count?: number
    language?: string | null
    html_url?: string
    owner?: { avatar_url?: string }
  }
  const fullName = payload.full_name || ''
  const slash = fullName.indexOf('/')
  if (slash <= 0) return null
  const url = httpUrl(payload.html_url || '')
  if (!url) return null

  return {
    url,
    owner: fullName.slice(0, slash),
    repo: fullName.slice(slash + 1),
    description: payload.description || '',
    stars: payload.stargazers_count ?? 0,
    language: payload.language || '',
    avatar: httpUrl(payload.owner?.avatar_url || ''),
  }
}

function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  const wanted = key.toLowerCase()
  for (const tag of tags) {
    const attrs: Record<string, string> = {}
    const pattern =
      /([^\s="'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    for (const match of tag.matchAll(pattern)) {
      const name = match[1]?.toLowerCase()
      if (!name || name === 'meta' || name.startsWith('<')) continue
      attrs[name] = match[2] ?? match[3] ?? match[4] ?? ''
    }
    const name = (attrs.property || attrs.name || '').toLowerCase()
    if (name === wanted && attrs.content) return plain(attrs.content)
  }
  return ''
}

async function loadLink(url: string): Promise<LinkCard | null> {
  const response = await request(
    url,
    {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
    5000,
    400_000
  )
  if (!response) return null

  const html = response.body
  const title =
    metaContent(html, 'og:title') ||
    metaContent(html, 'twitter:title') ||
    plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  if (!title) return null

  const description =
    metaContent(html, 'og:description') ||
    metaContent(html, 'twitter:description') ||
    metaContent(html, 'description')
  const image = imageSrc(
    metaContent(html, 'og:image') || metaContent(html, 'twitter:image'),
    response.finalUrl
  )

  return {
    url,
    host: hostOf(response.finalUrl || url),
    title,
    description,
    image,
  }
}

function parseArxivEntry(xml: string, id: string): PaperCard | null {
  const entry = xml.match(/<entry\b[^>]*>([\s\S]*?)<\/entry>/i)?.[1]
  if (!entry) return null
  const title = plain(
    entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  )
  if (!title || title.toLowerCase() === 'error') return null

  const authors = [
    ...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/gi),
  ].map((match) => match[1] || '')
  const published =
    entry.match(/<published[^>]*>([^<]+)<\/published>/i)?.[1] || ''
  const category =
    entry.match(/primary_category\b[^>]*\bterm="([^"]+)"/i)?.[1] ||
    entry.match(/<category\b[^>]*\bterm="([^"]+)"/i)?.[1] ||
    ''
  const summary = plain(
    entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || ''
  )

  return {
    url: `https://arxiv.org/abs/${id}`,
    id,
    title,
    authors: formatAuthors(authors),
    year: published.slice(0, 4),
    category,
    summary,
  }
}

function parseSong(data: unknown): SongCard | null {
  const row = asRecord(data)
  if (!row) return null
  const name = asString(row.name)
  if (!name) return null
  const duration = typeof row.duration === 'number' ? row.duration : 0
  return {
    name,
    artist: asString(row.artist),
    cover: httpUrl(asString(row.cover)),
    duration,
  }
}

async function loadSong(id: string): Promise<SongCard | null> {
  const response = await request(
    `https://music.163.com/api/song/detail/?id=${id}&ids=${encodeURIComponent(`[${id}]`)}`,
    {
      'Accept': 'application/json',
      'Referer': 'https://music.163.com/',
      'User-Agent': USER_AGENT,
    },
    8000,
    200_000
  )
  if (!response) return null

  const payload = JSON.parse(response.body) as {
    songs?: {
      name?: string
      duration?: number
      artists?: { name?: string }[]
      album?: { picUrl?: string }
    }[]
  }
  const song = payload.songs?.[0]
  if (!song?.name) return null
  const artist = (song.artists || [])
    .map((item) => plain(item.name || ''))
    .filter(Boolean)
    .join(' / ')
  return {
    name: plain(song.name),
    artist,
    cover: coverUrl(song.album?.picUrl || ''),
    duration: song.duration ? song.duration / 1000 : 0,
  }
}

async function loadPaper(id: string): Promise<PaperCard | null> {
  const response = await request(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
    {
      'Accept': 'application/atom+xml',
      'User-Agent': USER_AGENT,
    },
    8000,
    300_000
  )
  if (!response) return null
  return parseArxivEntry(response.body, id)
}

async function renderDirective(node: DirectiveNode): Promise<HastElement> {
  const name = node.name || ''
  const label = labelOf(node)

  if (name === 'github') {
    const repoName = parseRepo(attr(node, 'repo') || label)
    if (!repoName) return missing('github', 'Needs owner/repo')
    const card = await cached(
      `github:${repoName.toLowerCase()}`,
      WEEK,
      () => loadGithub(repoName),
      parseGithub
    )
    return renderGithub(repoName, card)
  }

  if (name === 'song') {
    const id = parseSongId(attr(node, 'id') || attr(node, 'url') || label)
    if (!id) return missing('song', 'Needs a song id')
    const card = await cached(`song:${id}`, WEEK, () => loadSong(id), parseSong)
    return renderSong(id, card)
  }

  if (name === 'card') {
    const url = httpUrl(attr(node, 'url') || label)
    if (!url) return missing('card', 'Needs a link')
    const overrides: LinkOverrides = {
      title: plain(attr(node, 'title')),
      description: plain(attr(node, 'desc') || attr(node, 'description')),
      image: imageSrc(attr(node, 'image'), url),
    }
    const card = await cached(
      `card:${url}`,
      WEEK,
      () => loadLink(url),
      parseLink
    )
    return renderLink(url, card, overrides)
  }

  if (name === 'paper') {
    const id = parsePaperId(attr(node, 'id') || label)
    if (!id) return missing('paper', 'Needs an arXiv id')
    const card = await cached(
      `paper:${id.toLowerCase()}`,
      MONTH,
      () => loadPaper(id),
      parsePaper
    )
    return renderPaper(id, card)
  }

  return missing(name, "This card can't be shown")
}

function isCardDirective(node: unknown): node is DirectiveNode {
  if (!node || typeof node !== 'object') return false
  const directive = node as DirectiveNode
  return (
    directive.type === 'leafDirective' && CARD_NAMES.has(directive.name || '')
  )
}

export function remarkCards() {
  return async (tree: { type: string }) => {
    const nodes: DirectiveNode[] = []
    visit(tree, (node) => {
      if (!isCardDirective(node)) return
      nodes.push(node)
    })
    await Promise.all(
      nodes.map(async (node) => {
        applyRendered(node, await renderDirective(node))
      })
    )
    await writing
  }
}
