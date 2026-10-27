export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export const OG_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  zh: 'zh_CN',
}

const chrome = {
  navBlog: { en: 'Blog', zh: '博客' },
  navProjects: { en: 'Projects', zh: '项目' },
  navPhotos: { en: 'Photos', zh: '照片' },
  navShorts: { en: 'Shorts', zh: '短记' },
  navMenu: { en: 'Main menu', zh: '主菜单' },
  language: { en: 'Language', zh: '语言' },
  skip: { en: 'Skip to content', zh: '跳到正文' },
  footerPowered: { en: 'Powered by', zh: '基于' },
  search: { en: 'Search', zh: '搜索' },
  searchCategories: { en: 'Search categories', zh: '搜索分类' },
  searchNoResults: { en: 'No results found.', zh: '没有找到结果。' },
  searchOops: {
    en: 'Oops! Something went wrong. Try again.',
    zh: '出错了，再试一次。',
  },
  searchMore: { en: 'More', zh: '更多' },
  searchAll: { en: 'All', zh: '全部' },
  searchLoading: { en: 'Loading...', zh: '加载中...' },
  searchNavigate: { en: 'Navigate', zh: '移动' },
  searchGo: { en: 'Go to Page', zh: '打开页面' },
  searchClose: { en: 'Close', zh: '关闭' },
  searchShortcuts: { en: 'Keyboard shortcuts', zh: '键盘快捷键' },
  scrollToTop: { en: 'Scroll to top', zh: '回到顶部' },
  rss: { en: 'RSS feed', zh: 'RSS 订阅' },
  theme: { en: 'Dark mode', zh: '深色模式' },
  themeToggle: { en: 'Toggle theme', zh: '切换主题' },
  updated: { en: 'Updated', zh: '更新于' },
  min: { en: 'min', zh: '分钟' },
  minRead: { en: 'min read', zh: '分钟阅读' },
  notFoundDesc: { en: 'Page not found', zh: '页面不存在' },
  notFoundBody: { en: 'Nice to meet you tho!', zh: '还是见到你了。' },
  categoryAgents: { en: 'Agents', zh: '智能体' },
  categoryApplications: { en: 'Applications', zh: '应用' },
  pageHomeDescription: {
    en: 'Poco-AI is a team of Zhejiang University students building AI apps and tools for everyday study and work.',
    zh: 'Poco-AI 是来自浙江大学的校内团队，做 AI 应用与工具，把大模型用到日常学习和工作里。',
  },
  pageBlogTitle: { en: 'Blog', zh: '博客' },
  pageBlogSubtitle: {
    en: 'How to use the Astro AntfuStyle Theme',
    zh: '如何使用 Astro AntfuStyle 主题',
  },
  pageProjectsTitle: { en: 'Projects', zh: '项目' },
  pageProjectsSubtitle: {
    en: 'Agents and tools from the team',
    zh: '团队做的智能体和工具',
  },
  pageProjectsDescription: {
    en: 'Agents and tools built by Poco-AI, including the competitions they entered.',
    zh: 'Poco-AI 做的智能体和工具，以及它们参加过的比赛。',
  },
  pagePhotosTitle: { en: 'Photos', zh: '照片' },
  pagePhotosSubtitle: { en: 'Moments from the team', zh: '团队的片刻' },
  pagePhotosDescription: {
    en: 'Photos from Poco-AI, including competitions, talks, and the rooms where the work happened.',
    zh: 'Poco-AI 的照片，包括比赛、分享，以及做事的那些房间。',
  },
  pageShortsTitle: { en: 'Shorts', zh: '短记' },
  pageShortsSubtitle: {
    en: 'Share your short notes or quick thoughts',
    zh: '记下短的笔记和一时的想法',
  },
  pageFeedsTitle: { en: 'Astro Blog', zh: 'Astro 博客' },
  pageFeedsSubtitle: {
    en: 'Example: fetching Astro blog using @ascorbic/feed-loader',
    zh: '示例：用 @ascorbic/feed-loader 拉取 Astro 博客',
  },
  pageStreamsTitle: { en: 'Astro Streams', zh: 'Astro Streams' },
  pageStreamsSubtitle: {
    en: 'Example: displaying Astro streams with local JSON data',
    zh: '示例：用本地 JSON 展示 Astro streams',
  },
  pageReleasesTitle: {
    en: 'AstroEco is Releasing...',
    zh: 'AstroEco 正在发布...',
  },
  pageReleasesPulse: { en: 'Releasing...', zh: '正在发布...' },
  pageReleasesLead: {
    en: 'Display your GitHub releases using',
    zh: '用',
  },
  pageReleasesLeadEnd: {
    en: '',
    zh: '展示 GitHub 发布',
  },
  pagePrsTitle: {
    en: 'AstroEco is Contributing...',
    zh: 'AstroEco 正在贡献...',
  },
  pagePrsPulse: { en: 'Contributing...', zh: '正在贡献...' },
  pagePrsLead: {
    en: 'Display your GitHub pull requests using',
    zh: '用',
  },
  pagePrsLeadEnd: {
    en: '',
    zh: '展示 GitHub 拉取请求',
  },
  series: { en: 'Series', zh: '系列' },
  inThisSeries: { en: 'In this series', zh: '本系列' },
  previous: { en: 'Previous', zh: '上一篇' },
  next: { en: 'Next', zh: '下一篇' },
  layoutToggle: { en: 'Layout toggle', zh: '切换布局' },
  openViewer: { en: 'Open viewer', zh: '打开查看' },
  video: { en: 'Provided in video', zh: '有视频' },
  radio: { en: 'Provided in radio', zh: '有音频' },
  lastFetched: { en: 'Last fetched:', zh: '上次拉取：' },
  viewMore: { en: 'View more...', zh: '查看更多...' },
  empty: { en: 'nothing here yet', zh: '这里还没有内容' },
  skipToc: { en: 'Skip toc', zh: '跳过目录' },
  toc: { en: 'Table of contents', zh: '目录' },
  openToc: { en: 'Open table of contents', zh: '打开目录' },
  tags: { en: 'Tags', zh: '标签' },
  openTags: { en: 'Open tags filter', zh: '打开标签' },
} as const

export type ChromeKey = keyof typeof chrome

const NAV_KEYS: Record<string, ChromeKey> = {
  '/blog': 'navBlog',
  '/projects': 'navProjects',
  '/photos': 'navPhotos',
  '/shorts': 'navShorts',
}

const CATEGORY_KEYS: Record<string, ChromeKey> = {
  Agents: 'categoryAgents',
  Applications: 'categoryApplications',
}

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'zh'
}

export function t(locale: Locale, key: ChromeKey): string {
  return chrome[key][locale]
}

export function localeFromPathname(pathname: string): Locale {
  const segment = pathname.split('/').filter(Boolean)[0]
  if (segment && isLocale(segment) && segment !== DEFAULT_LOCALE) return segment
  return DEFAULT_LOCALE
}

export function stripLocale(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const locale = localeFromPathname(normalized)
  if (locale === DEFAULT_LOCALE) return normalized
  const rest = normalized.replace(new RegExp(`^/${locale}(?=/|$)`), '')
  return rest === '' ? '/' : rest
}

export function localePath(pathname: string, locale: Locale): string {
  const bare = stripLocale(pathname)
  if (locale === DEFAULT_LOCALE) return bare
  if (bare === '/') return `/${locale}/`
  return `/${locale}${bare}`
}

export function isLocaleHome(pathname: string): boolean {
  const home = localePath('/', localeFromPathname(pathname))
  const current = pathname.endsWith('/') ? pathname : `${pathname}/`
  const target = home.endsWith('/') ? home : `${home}/`
  return current === target
}

export function localizeHref(href: string, pathname: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href
  return localePath(href, localeFromPathname(pathname))
}

export function navLabel(locale: Locale, path: string): string | undefined {
  const key = NAV_KEYS[path]
  return key ? t(locale, key) : undefined
}

export function categoryLabel(locale: Locale, category: string): string {
  const key = CATEGORY_KEYS[category]
  return key ? t(locale, key) : category
}

export function pickLocale(
  text: { en: string; zh: string },
  locale: Locale
): string {
  return text[locale] || text.en
}

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}
