---
name: note-markup
description: 在 blog 或 shorts 正文里插入或修改非常规 Markdown，包括卡片（::github、::song、::card、::paper、::skill、::code）、诗（:::poem）、文件夹（:::folder）、双链（[[wikilink]]）、公式、提示框、:link、带说明的图片和视频。用户写到这些语法，或问该用卡片还是链接、诗怎么排、双链怎么写时使用。流程图、架构图和 Excalidraw 交给 note-figure。
---

# 笔记语法

先选写法，再只读对应的那一份参考。正文节奏见 [note-prose](../note-prose/SKILL.md)。

| 要放的东西 | 写法 | 参考 |
| --- | --- | --- |
| 单独占一行的仓库、歌曲、网页、论文、skill、代码 | `::github` `::song` `::card` `::paper` `::skill` `::code` | [cards.md](references/cards.md) |
| 句中的仓库、包、人 | `:link` | [theme.md](references/theme.md) |
| 诗 | `:::poem` | [poem.md](references/poem.md) |
| `src/specimens/` 里的目录或文件 | `:::folder` | [folder.md](references/folder.md) |
| 站内另一篇、某一节、某一段 | `[[目标]]` | [wikilink.md](references/wikilink.md) |
| 公式 | `$` `$$` | [theme.md](references/theme.md) |
| 提示或可折叠说明 | `> [!note]` | [theme.md](references/theme.md) |
| 带说明的图片、视频 | `:::image-figure` `::video` | [theme.md](references/theme.md) |
| 步骤、分支、时序、架构、对照 | 交给 note-figure | [note-figure](../note-figure/SKILL.md) |

块级组件单独成行，前后留空行。句中点名用 `:link` 或普通链接。语法以仓库里的实现和 `src/content/shorts/` 的用法文为准。
