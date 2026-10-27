# Poco-AI

Poco-AI 是浙江大学的校内学生团队，做 AI 应用与工具。

站点：[https://poco-ai.github.io/poco-ai/](https://poco-ai.github.io/poco-ai/)

英文在根路径，中文在 `/zh/`。

## 开发

Node.js 22，pnpm 11。

```sh
pnpm install
pnpm dev
```

开发地址：[http://localhost:4321/poco-ai/](http://localhost:4321/poco-ai/)

```sh
pnpm lint
pnpm build
```

## 内容

- 首页：`src/content/home/`
- 项目：`src/content/projects/data.json`
- 照片：`src/content/photos/data.json`
- 配置：`src/config.ts`

## 发布

推送到 `main` 后，`.github/workflows/pages.yml` 构建并发布到 GitHub Pages。Pages 的 Source 为 GitHub Actions。

## 许可

基于 [Astro AntfuStyle Theme](https://github.com/lin-stephanie/astro-antfustyle-theme)，[MIT](./LICENSE) © [Stephanie Lin](https://github.com/lin-stephanie)。
