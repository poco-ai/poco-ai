---
name: folder-demo
description: 一份放在 src/specimens 里的示例，用来在文章里逐个打开。
---

# 这份材料

正文从这里开始。文件开头的 frontmatter 列在上面。

勾股定理写成 $a^2 + b^2 = c^2$。

```ts
export const answer = 42
```

> [!note]
> 提示框走文章同一套管线。

材料里再写一条文件夹指令，它停在原文里，不会再展开：

:::folder{src="folder-demo/hello.ts"}
:::
