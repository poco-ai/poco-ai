# Poco-AI

Poco-AI 是浙江大学的校内学生团队，做 AI 应用与工具。

站点：[https://poco-ai.pages.dev/](https://poco-ai.pages.dev/)

英文在根路径，中文在 `/zh/`。

## 开发

Node.js 22，pnpm 11。

```sh
pnpm install
pnpm dev
```

开发地址：[http://localhost:4321/](http://localhost:4321/)

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

部署在 Cloudflare Pages，从 `main` 自动构建。项目设置：

- Build command：`pnpm build`
- Build output directory：`dist`
- 环境变量：`NODE_VERSION=22`、`PNPM_VERSION=11`

站点地址配置在 `src/config.ts` 的 `website`，换成自定义域名时同步修改。

## 许可

基于 [Astro AntfuStyle Theme](https://github.com/lin-stephanie/astro-antfustyle-theme)，[MIT](./LICENSE) © [Stephanie Lin](https://github.com/lin-stephanie)。
