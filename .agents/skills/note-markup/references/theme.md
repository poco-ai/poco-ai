# 主题自带的写法

长例子在 `src/content/blog/Tutorial/markdown-mdx-extended-features.md`。那一页的英文说明腔不要写进笔记。公式的中文例子在 `src/content/shorts/diagram.md`。

## 公式

行内用一个 `$`。独立成段用 `$$`，公式居中。多行用 `aligned`，`&` 对齐等号，`\\` 换行。

```md
注意力写成 $\mathrm{softmax}(QK^\top / \sqrt{d})\,V$。

$$
\begin{aligned}
a &= b + c \\
d &= e^2 + f
\end{aligned}
$$
```

## 提示框

类型是 `note`、`tip`、`important`、`warning`、`caution`。方括号里的类型不区分大小写。`]-` 折叠且默认关上，`]+` 折叠且默认打开。类型后面可以写自定义标题。

```md
> [!note] 先备份
> 一句说明。

> [!warning]- 细节
> 默认收起。
```

## 句中链接

`:link` 待在句子里，不单独占一块版面。

```md
:link[Astro]{#withastro/astro}
:link[Vite]{id=@vitejs}
:link{#remark-directive-sugar}
:link[文档]{id=https://astro.build}
```

`@名字` 是 GitHub 用户或组织。`owner/repo` 是仓库。没有斜杠、也不是网址的是 npm 包。自定义网址写在 `id=` 里。

## 图片

```md
:::image-figure[说明文字]
![替代文字](./photo.png)
:::
```

方括号里没有说明时，用图片的替代文字。说明和替代文字都空着时，这道指令不成立。亮色图加 `(class:img-light)`，暗色图加 `(class:img-dark)`，两行 `![]()` 之间空一行。不要缩放时加 `(class:no-zoom)`。

## 视频

单独成行。

```md
::video-youtube{#gxBkghlglTg}
::video-bilibili{id=BV1MC4y1c7Kv}
::video{id=https://www.youtube-nocookie.com/embed/gxBkghlglTg}
```

## 折叠段落

```md
:::details
::summary[细节]
- 一条
- 另一条
:::
```
