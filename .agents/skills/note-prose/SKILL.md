---
name: note-prose
description: 起草和修改这个站的笔记正文，包括 blog 与 shorts 的年/月落点、frontmatter 和句子节奏。用户要写文章、改讲解稿、补一篇 short、润色已有 Markdown，或问该放在 blog 还是 shorts 时使用。插入卡片、诗、双链、公式、提示框时同时遵循 note-markup。配流程图、架构图或 Excalidraw 时同时遵循 note-figure。
---

# 笔记正文

写 `src/content/blog` 和 `src/content/shorts`。先定落点和 frontmatter，再写能独立读完的句子。卡片、诗、双链、公式按 [note-markup](../note-markup/SKILL.md)。图按 [note-figure](../note-figure/SKILL.md)。

## 放在哪

两条都按年、月分目录，月份两位：

- `src/content/blog/YYYY/MM/<文件名>.md`
- `src/content/shorts/YYYY/MM/<文件名>.md`

随笔、讲解、记录放 blog。用法笔记、短句、还在试的演示放 shorts。

用脚手架，标题最长 60 字：

```
pnpm new blog 标题
pnpm new shorts 标题
```

文件名沿用标题。中文标题保持中文，不必改成英文 slug。

`src/content/shorts/` 根目录里已有的稿子留在原地。新稿进 `年/月`。搬旧稿会改公开地址，先问过再搬。

## Frontmatter

脚手架会写出标题、描述、标签、日期和草稿。补上一句 `description`，再按篇幅决定 `toc`。

```yaml
---
title: "标题"
description: "一句话，给列表和分享。"
tags: []
pubDate: YYYY-MM-DD
draft: true
toc: false
---
```

- `title` 必填，最多 60 字。
- `description` 写这一篇具体在说什么。留空会用全站描述。
- `pubDate` 用 `YYYY-MM-DD`。
- 新稿保持 `draft: true`。用户说可以发布，再改成 `false` 或删掉该行。
- 用法演示、短文，以及没有可供跳转的小标题时，写 `toc: false`。正式文有多级标题、读者需要跳着看时，删掉 `toc`，目录默认打开。
- `tags` 用短词。没有就留空数组。
- `series` 是可选 slug，一篇最多一个。不写就不是系列。blog 和 shorts 可以写同一个 slug。
- `order` 可选，正整数。不写就没有手写序号。
- 系列的标题和描述写在 `src/content/series/<slug>.md`。文件名去掉扩展名就是 slug。
- `subtitle`、`cover`、`ogImage`、`share`、`giscus` 用得到再加。不要为了填满 schema 把默认值全写上。

## 句子

文风看这两处，不看主题自带的英文 Tutorial：

- `src/content/blog/2026/10/新的起点.md`
- `src/content/shorts/` 里的用法文，例如 `poem.md`、`cards.md`、`wikilink.md`

先写清这篇在讲什么。一段只推进一件事。句子短，对象具体。

组件接在句子后面，不代替句子。一句话加普通链接能说清的，用普通 Markdown。双链指向站内已经写过的篇目；这个概念第一次出现时，当页写完。

图、卡片、诗各自占块。前面有一句说明它在回答什么，后面只补表面上看不出来的限制。

用法笔记沿用现有 short 的结构：先给能复制的写法，紧接着放渲染结果。正式文里不再讲一遍语法。
