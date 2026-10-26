# AGENTS.md

Personal fork of the Astro AntfuStyle theme. This file is for agents changing the theme: navigation, pages, layout, styles, the content model, and the Markdown pipeline.

Read `ARCHITECTURE.md` before changing the theme. It is the module map. When a change adds, removes, or moves a module, update `ARCHITECTURE.md` in the same change.

Article prose is a separate job. When the task is a post or a short, follow the skills at the end and leave this file.

## Before you change

Read `ARCHITECTURE.md`, then the implementation that already does the job, and extend it. File names, component names, and switch names are read from that code.

## Reuse

- Open or extend an existing switch, prop, component, or helper when it can express the change.
- A page composes a layout and a view. Existing behavior is passed through props.
- A new section has its own page and an entry in the navigation config. A grouping that already has a page is reached from the post and from that page.
- Store each fact once. Grouping, cross-post data, and syntax extend the helper that already owns them.
- New chrome follows the markup of the closest existing component. Each view keeps its own layout.

## Where a change lands

Stop at the outermost layer that can express the change:

1. Configuration and feature switches.
2. How a page composes a layout, a view, and props.
3. A shared view, or the post chrome.
4. The content model: schema first, then collection config. Posts stay in the content tree. Cross-post logic stays in helpers.
5. Markdown syntax goes through the existing plugins. Styles for rendered widgets live with the Markdown styles: markup in a content collection does not receive styles injected by a component.

## Style

A UI or UX change keeps the visual language already on the site. Reuse the motion, the light and dark theme colors, and the type, opacity, and spacing already in use. A new motion or color is added to those shared definitions, then used from there.

- Use the utility classes already on the component. Shared chrome, the reading column, and Markdown widgets each append to the stylesheet that already owns that layer.
- Stay with the type scale, opacity, and spacing already on the page.
- Icons use the icon classes already on the site. In MDX, write a normal `class` attribute.

## Language

- Text the theme renders as chrome is English: navigation, asides, empty states, controls, and accessible names.
- Post and short bodies may be Chinese. A title or description is content and stays as written.
- Author-facing build messages are outside the chrome language rule.

## Before you finish

- Run the repo's type check, lint, and production build.
- Upstream continuous integration does not cover this fork. Those three local checks are the gate.
- When a reader can see the change, walk the affected path in the browser, and the other pages that share the same data or component.

## Article body

Follow the skill for that kind of writing:

- Where a post lives, frontmatter, and sentences: `.agents/skills/note-prose`
- Nonstandard Markdown in a post: `.agents/skills/note-markup`
- Diagrams: `.agents/skills/note-figure`
