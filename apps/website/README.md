# 官网（@allay/website）

项目的独立静态落地页，纯静态输出，与桌面应用（`apps/desktop`）完全解耦。

> 官网源码随主仓库维护，目前未配置自动发布工作流。

## 构成与定位

| 部分 | 位置 | 说明 |
|---|---|---|
| 落地页 | `index.html`、`src/site/` | React + Tailwind CSS 4，样式和组件直接来自 `packages/ui` 与 `packages/mascot` |
| 独立引擎宿主 | `src/site/engine/` | 直接复用 `@allay/engine`、`@allay/assets`、`@allay/template-sdk`，不经 `window.allay`，不导入 `apps/desktop` |
| 精选展示模板 | `build/plugins.ts`、`src/host/templates.ts` | 只打包固定 5 个代表性模板（`SHOWCASE_TEMPLATE_IDS`），主程序后续新增模板不再自动同步进官网 |
| 封面网格服务 | `src/site/engine/covers.ts` | 单个临时导出 Worker 为 5 个精选模板渲染 320×180 封面与循环帧网格，画完即释放 |
| 原版贴图（官网专用） | `public/mc/`、`src/host/mc-pack.ts` | `pnpm website:mc` 从本机正版游戏提取；缺省时自动退回 `src/host/demo-pack.ts` 生成的纯色演示块 |

## 常用命令

```bash
pnpm website:dev      # http://localhost:5180/
pnpm website:build    # 输出到 apps/website/dist/
pnpm website:preview  # http://localhost:4180/
pnpm test:website     # 官网冒烟测试（tests/website/website.spec.ts）
```

## 约定

- 不再同步桌面版新模板或复杂编辑器功能（无桌面仿真器 iframe、无整页 Three.js 方块世界），只保留轻量实时预览、三步交互工作流与特性展示。
- Mojang 贴图只允许在 `public/mc/`（经 `ASSETS_PROVENANCE.json` 与 `pnpm check:provenance` 校验），不得放入其它目录。
- 不加统计、埋点或第三方外部请求（构建产物自带严格 CSP，T-WEB-1 / T-WEB-5 校验零外部请求）。
- 产品名与非官方声明统一来自 `@allay/ui/brand`，所有可见文案必须同时维护 `zh-CN.json` 与 `en.json`。
