# ARCHITECTURE.md

Module map of this theme. A page is a shell that composes a layout and a view. Configuration and props turn behavior on. Shared chrome, helpers, and the Markdown pipeline sit behind those views.

Article prose is not described here. It lives in the skills named at the end of `AGENTS.md`.

## Modules

```text
astro.config.ts                 // site, integrations, fonts, images; markdown processor comes from plugins.ts
plugins.ts                      // remark order, then rehype order; folder specimens reuse both lists
unocss.config.ts                // utility presets; icon safelist is derived from UI config
ec.config.mjs                   // Expressive Code for fenced code
src/config.ts                   // SITE identity, UI chrome, FEATURES switches
src/types.ts                    // shapes for src/config.ts
src/schema.ts                   // Zod schemas for pages, posts, and the JSON collections
src/content.config.ts           // collections: loader plus schema, no rendering

src/pages/                      // route shells and a few endpoints
  index.mdx                     // home: RenderPage over the home collection
  blog/index.mdx                // series rail, then ListView for blog
  blog/[...slug].astro          // one post, via RenderPost
  shorts/index.mdx              // CardView for shorts
  shorts/[...slug].astro        // one short, via RenderPost
  projects.mdx                  // GroupView for projects
  photos/index.mdx              // PhotoView
  photos/photos.[hash].json.ts  // photo manifest the viewer fetches
  feeds.mdx                     // TabbedLayout + ListView for feeds
  streams.mdx                   // TabbedLayout + ListView for streams
  releases.mdx                  // GithubView for releases
  prs.mdx                       // GithubView for pull requests
  series/[slug].astro           // one series; reached from a post and from this page
  og-images/[...slug].png.ts    // generated social images
  rss.xml.js                    // blog feed
  giscus/[theme].css.ts         // comment-widget theme
  app.webmanifest.js            // web app manifest
  404.mdx                       // not-found page

src/layouts/
  BaseLayout.astro              // document, nav, footer, global CSS, client boot
  StandardLayout.astro          // title and the centered column
  TabbedLayout.astro            // tabs declared in UI config; used by feeds and streams

src/components/views/           // one listing shape each, plus the two renderers
  ListView / ListItem           // rows: blog, feeds, streams
  CardView / CardItem           // cards: shorts
  GroupView / GroupItem         // grouped tiles: projects
  GithubView / GithubItem       // release and pull-request rows
  PhotoView                     // gallery
  RenderPost                    // one blog post or short, with its chrome
  RenderPage                    // one content entry rendered into a page (home)

src/components/nav/             // bar, item, mobile switch; the link list lives in UI config
src/components/toc/             // year or heading jumps
src/components/tags/            // tag filter
src/components/base/            // rails, post meta, series rail and directory, backlinks, document head
src/components/widgets/         // search, share, comments, theme, images, rss
src/components/backgrounds/     // page background chosen by the shell

src/styles/
  main.css                      // shared chrome
  prose.css                     // the reading column
  markdown.css                  // Markdown and embed widgets
  giscus/                       // comment theme sources

src/utils/
  data.ts                       // load, filter, and sort posts; tag relations
  series.ts                     // series membership shared by blog and shorts
  wikilink.ts                   // resolve links and backlinks
  remark-*.ts                   // one author syntax each
  skill-source.ts               // resolve a ::skill URL and cache its files
  code-source.ts                // resolve a ::code URL and cache the snippet
  specimen.ts                   // render a :::folder block
  specimen-assets.ts            // integration that publishes specimen images
  specimen-paths.ts             // specimen paths and the public URL
  specimen-icons.ts             // file-type icons inside a folder block
  og-image/                     // which pages get an image, and how the PNG is drawn
  datetime.ts path.ts toc.ts    // small shared helpers
  image.ts misc.ts server.ts

src/client/                     // browser code, loaded from BaseLayout when the markup is present
  excalidraw-view.ts            // mount .excalidraw-view
  folder-view.ts                // mount .folder-view
                                // mermaid runs inline in BaseLayout, not from this folder

src/content/                    // entries: blog, shorts, home, series, and the JSON collections
src/specimens/                  // files a :::folder block is allowed to show

scripts/new-post.mjs            // scaffolds a blog or shorts file; not part of the rendered site
```

## How a page is built

An `.mdx` file under `src/pages/` is a shell. It picks `BaseLayout`, then either `StandardLayout` or `TabbedLayout`, then one view. It passes props for behavior the view already has. A post route is thinner: `getStaticPaths` loads the collection and `RenderPost` owns the chrome.

`BaseLayout` is the document. It loads the three stylesheets, draws the nav and footer, and on `astro:page-load` starts mermaid, Excalidraw, and folder views when those nodes exist. `StandardLayout` is the title and the column. `TabbedLayout` reads its tabs from UI config.

`RenderPost` is the post page for both blog and shorts: meta, series placement, cover, share, comments, backlinks, and the aside. `RenderPage` renders a single entry from a collection into an existing shell. The home page uses it for the home collection.

The aside is `DesktopAside` on a wide viewport and `MobileControl` on a narrow one. Year or heading jumps come from `Toc`. Tag filtering comes from the tag components. A view opts in with its own props. The global switch still lives in `FEATURES`.

The blog shell also places `SeriesIndex` in that column. It lists series that already have a page. It does not turn on the tag filter.

## Content model

`src/schema.ts` describes a record. `src/content.config.ts` binds a loader and a schema to a collection name. Entries stay under `src/content/`, except the `pages` collection, which reads frontmatter from `src/pages/**/*.mdx` for social-image generation.

`blog` and `shorts` share `postSchema`. `series` is a separate collection: one file per series, title and description only. A post points at that file with `series` and an optional `order`. `src/utils/series.ts` builds the groups, decides which series get a page, and tells `RenderPost` where the current post sits. The series page is `src/pages/series/[slug].astro`. It is not a nav entry.

`projects`, `photos`, and `streams` are JSON files. `feeds`, `releases`, and `prs` are loaded from outside the repo. Cross-post queries go through `src/utils/data.ts`.

## Markdown pipeline

Author syntax is transformed in `plugins.ts`, before the page shell runs. Order is the contract: a later plugin sees the tree the earlier ones left.

```text
remark
  remark-directive            // enable ::: and ::
  remark-folder               // :::folder → HTML from src/specimens
  remark-directive-sugar      // :link, badges, images
  remark-poem                 // :::poem
  remark-cards                // ::github ::song ::card ::paper
  remark-skill                // ::skill → intro card plus the skill directory
  remark-code                 // ::code → one file slice at a commit
  remark-wikilink             // [[wikilink]]
  remark-block-id             // stable ids for wikilink targets
  remark-imgattr              // image attributes
  remark-mermaid              // ```mermaid → <div class="mermaid">
  remark-excalidraw           // ```excalidraw → <figure class="excalidraw-view">
  remark-math                 // $ and $$
  remark-reading-time         // minutesRead on frontmatter, when the author did not set it

rehype
  heading ids
  katex
  callouts
  raw external anchors        // HTML <a> written in Markdown, which the next plugin skips
  external links              // new tab, from UI config
  autolink headings
  wrap tables
```

`useFolderPipeline()` runs the same lists again for code inside a specimen, so a folder block highlights with the theme's own plugins.

`::skill` reads a GitHub directory, or a skills.sh / SkillsMP page that points at one, into `.cache/skills/`. The card uses the same folder renderer. `expanded` defaults to open.

`::code` reads one GitHub file, at a branch, tag, or commit, into `.cache/code-cards.json` and renders that line range. `mark` highlights lines inside that range, using the file's line numbers. A full commit SHA stays cached. A failed fetch still leaves a link.

Widget markup emitted here is not an Astro component. Its CSS lives in `src/styles/markdown.css`, which `BaseLayout` imports for every page. Interactive widgets start from `BaseLayout`, not from the remark plugin.

## Styles

UnoCSS utilities stay on the component. `unocss.config.ts` only adds presets and the icons the config already names.

The three stylesheets split by layer. `main.css` is chrome shared by every page. `prose.css` is the reading column. `markdown.css` is Markdown and the widgets the pipeline emits. A new visual for one of those layers is appended to the stylesheet that already owns it.
