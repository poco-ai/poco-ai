# 文件夹

`:::folder` 单独成块，前后留空行。`src` 相对 `src/specimens/`，可以是目录，也可以是一个文件。

```md
:::folder{src="folder-demo"}
:::

:::folder{src="folder-demo" open="references/guide.md"}
显示在组件上方的说明。
:::

:::folder{src="folder-demo/hello.ts"}
:::
```

- 材料放在 `src/specimens/`。构建读这份副本，不读作者电脑上的其他目录。
- `open` 只在 `src` 是目录时生效。不写时先找根上的 `SKILL.md`，再找 `README.md`，否则按目录在前、文件在后、名字升序做深度优先，取第一个文件。
- 单个文件不显示树，只留文件名和内容。
- 路径必须留在 `src/specimens/` 里。绝对路径、`..`、链到目录外的符号链接会让构建失败。
- `.md` / `.mdx` 走文章的编译管线。frontmatter 的每个字段列在正文上方。
- 代码和 `.json` / `.yml` / `.yaml` / `.toml` 用 Expressive Code。图片和 SVG 显示成图片。其他 UTF-8 文本是等宽原文。非文本只显示文件名和大小。
- specimen 里再写 `:::folder` 不会展开。脚本不执行。
- 组件高度固定，右侧自己滚动。窄屏时树改到顶部。

用法见 `src/content/shorts/2026/10/文件夹.md`。
