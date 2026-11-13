# M0 评审说明

**做了什么**：pnpm workspace（`apps/desktop` 和六个包），TS 严格模式、ESLint 依赖方向规则、Vitest、Playwright。electron-vite 的主进程、preload、渲染进程；`app://` 协议加 1.6 的 CSP；会话级网络拦截并写日志；加固的 `webPreferences`、拒绝新窗口/跳转/权限；fuses；IPC 统一做来源校验和 zod 校验。无边框窗口加系统按钮（颜色随主题），窗口位置大小记忆。Tailwind 4 加 shadcn（Base UI）、6.2 的全部设计变量和两套主题。三栏加播放条的空布局，分栏可拖、可折叠（`Ctrl+B`）、经主进程的 `settings.json` 记忆。i18next 中英两套文案，产品名只在 `packages/ui/src/brand/`。来源登记和许可检查脚本、CI 工作流、`pnpm dist` 出 NSIS 安装包（不签名）。

截图（真实窗口截图，含系统按钮区）：`m0-dark-zh.png`、`m0-light-zh.png`、`m0-dark-en-left-collapsed.png`、`m0-light-en-left-collapsed.png`。

**和规格不同的地方**（详见 `docs/decisions.md`）：TypeScript 用 6.0.3 而不是最新的 7.0（typescript-eslint 还不支持）；不用 `@vitejs/plugin-react`（Fast Refresh 的内联脚本违反 CSP）；`shadcn init` 需要临时的 vite 配置才能在库包里运行；T-UI-6 用键盘调分栏、T-ARC-3 用 CDP 关掉 CSP 来验证第二层拦截；T-ARC-2 的 fuses 部分在 `pnpm dist` 末尾跑，不在 `pnpm check` 里。

**没有验证的**：
- CI 工作流只写了文件，没有在 GitHub 上真正跑过。
- T-UI-8 的拖动测试会移动本机的真实鼠标，需要可交互的桌面；在 GitHub 托管的 Windows 运行器上没试过。
- 只在一台 150% 缩放、单显示器的 Windows 11 上跑过；多显示器、100% 缩放下窗口记忆没测。
- 打包后的应用只手动冒烟启动过一次（窗口出来、页面加载），没有在干净的机器上安装、卸载。
- 开发模式（`pnpm dev`）只确认了能启动并加载页面，没有自动化测试。
- 空布局里的按钮、搜索框都只是外形，没有功能。
