# 卡片

这些卡片都是叶子指令，单独占一行，宽度跟正文一样。方括号里的文字和花括号里的属性等价。

```md
::github[withastro/astro]
::github{repo="withastro/astro"}

::song[186016]
::song{id="186016"}
::song{url="https://music.163.com/song?id=186016"}

::card[https://astro.build]
::card{url="https://astro.build" title="Astro" desc="一个网站生成器。"}

::paper[1706.03762]
::paper{id="https://arxiv.org/abs/1706.03762"}

::skill[https://github.com/owner/repo/tree/main/skills/demo]
::skill{url="https://skills.sh/owner/repo/demo" expanded=false open="SKILL.md"}

::code[https://github.com/owner/repo/blob/<sha>/src/file.ts#L12-L40]
::code{url="https://github.com/owner/repo/blob/<sha>/src/file.ts" lines="12-40" mark="14-16"}
```

- `github` 要 `owner/repo`，或 `github.com` 上的仓库地址。
- `song` 要纯数字 id，或地址里的 `id=`、`/song/<id>`。点封面才播放。
- `card` 要 http(s) 链接。`title`、`desc`（或 `description`）、`image` 盖过抓到的对应字段。
- `paper` 要 `1706.03762` 这种编号，或 abs、pdf 地址。也接受 `cs.CL/0001001` 这类旧编号。
- `skill` 要一条地址：GitHub 仓库、`tree` / `blob` 子目录，或 skills.sh、SkillsMP 的技能页。`owner/repo` 也行。`expanded` 不写时展开下面的文件树，`expanded=false` 先收起。`open` 是相对该 skill 目录的文件。抓不到目录时卡片还在，点进去是原地址。
- `code` 要 GitHub 文件页或 `raw.githubusercontent.com` 上的文件地址。行号写在 `#L12-L40`、`#L12`，或 `lines`。不写行号时，文件不超过 120 行就整份放出来。一次最多 200 行。`mark` 用同样的行号标出其中几行，如 `8`、`8-10`、`8,12-14`。只标当前这段里有的行。一行都对不上，或行号写错时，页面上是 `Needs a highlight range`。分支和 tag 在构建时收成当时的提交；40 位 SHA 一直对应该次提交。对不上、超过 1 MB 或不是文本时，卡片还在，点进去是原地址。

构建时抓取。`github`、`song`、`card`、`paper` 缓存在 `.cache/embed-cards.json`。`skill` 的目录缓存在 `.cache/skills/`。`code` 的片段缓存在 `.cache/code-cards.json`。抓不到时卡片还在，点进去是原地址。缺必填字段时，页面上是一句说明，例如「需要 owner/repo」。不要编造星标、歌名、摘要或代码。

完整例子在 `src/content/shorts/cards.md`。
