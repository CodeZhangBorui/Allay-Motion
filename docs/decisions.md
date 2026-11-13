# 决策与偏离记录

规格没说清、或与现实对不上的地方，在这里记一笔：偏离了什么、为什么。按里程碑分节。

## M0 脚手架与安全基线

### 版本

| 项 | 规格 | 实际 | 原因 |
|---|---|---|---|
| TypeScript | 最新稳定版 | **6.0.3**（最新是 7.0.2） | typescript-eslint 8.72 的 peer 依赖是 `typescript >=4.8.4 <6.1.0`。TS 7 是 Go 重写版，ESLint 生态还没跟上。等 typescript-eslint 支持后再升 |
| pnpm | — | 12.18.0 | 安装时的最新版。构建脚本白名单写在 `pnpm-workspace.yaml` 的 `allowBuilds`（esbuild 允许；electron-winstaller 拒绝，我们用 NSIS 不用 Squirrel）。Electron 45 没有 postinstall，第一次被 `require('electron')` 时才下载二进制 |
| Electron / electron-vite / Vite / electron-builder | 45 / 6 / 8 / 26 | 45.3.1 / 6.0.0 / 8.3.8 / 26.18.0 | 与 1.3 一致 |
| Vitest / Playwright | 5 / 1.65 | 5.1.0 / 1.65.0 | 一致 |
| react-resizable-panels | — | 4.21.0 | v4 的 API 是 `Group`/`Panel`/`Separator`，尺寸可以直接写像素。4.22.0 发布不满 pnpm 12 默认的最短发布时长，没有绕过这条供应链策略 |

### 工具链

- **shadcn init**：`shadcn init -b base` 只认应用项目，在 `packages/ui` 里检测不到框架。做法是临时放一个空的 `vite.config.ts` 让它通过检测，跑完 `init -b base -p nova` 和 `add button resizable separator tooltip` 后删掉。之后的调整：CLI 把组件放到了 `components/ui/ui/`，挪回 `components/ui/`；去掉它自动加的 Geist 字体（规格用 Inter）和没用到的 clsx、tailwind-merge（组件用的是 shadcn 自己的 `cn` 包，MIT）；`shadcn` CLI 改为 devDependency（只需要它的 `tailwind.css`，构建时解析）；按钮高度改成 6.2 的 28/24/32，悬停和按下用 `--primary-hover`/`--primary-active`。
- **不用 `@vitejs/plugin-react`**：它的 Fast Refresh 要在页面里注入内联脚本，1.6 第 2 条的 CSP（`script-src 'self' blob:`）不允许，开发模式也不能为它放宽。JSX 由 Vite 内置转换处理，开发时改动走整页刷新。
- **依赖方向的 lint**：没用 eslint-plugin-boundaries，直接用 `@typescript-eslint/no-restricted-imports` 的正则模式，每个包一条“除了允许的都禁止”，再用 `allowTypeImports` 表达“仅限类型”。规则表导出在 `eslint.config.js` 的 `dependencyRules`。1.4 表格没写到的两处：`ui` 也不能依赖 `mascot`（避免循环）；`mascot` 不能依赖 `engine` 的子路径（“内部”），可以依赖其公开入口。引擎和模板另外禁止 `window`、`document` 全局，引擎的 tsconfig 只带 `WebWorker` 库、不带 `DOM`。
- **主进程和 preload 打包全部依赖**（`externalizeDeps: false`），安装包的 asar 里只有 `out/` 和 `package.json`，没有 `node_modules`。sandbox 下的 preload 输出单文件 CJS。
- **运行时库都放 `dependencies`，构建工具放 `devDependencies`**，这样 `pnpm -r licenses list --prod` 列出的正好是进安装包的代码，许可检查才有意义。
- **Inter 字体**用 npm 包 `@fontsource-variable/inter`（OFL-1.1），不把 woff2 提交进仓库，所以 `ASSETS_PROVENANCE.json` 里没有它的条目；许可检查里 OFL 只对 `@fontsource` 包放行（9.8“字体允许 OFL”）。构建时 `assetsInlineLimit: 0`，字体不会被内联成 `data:`（CSP 的 `font-src 'self'` 不允许）。

### 安全基线的实现细节

- **开发模式**：页面从 Vite 开发服务器加载；主进程用 `onHeadersReceived` 给开发服务器的响应加上同一份 CSP，只在各指令后追加开发服务器的 origin（`connect-src` 另加它的 `ws://`）。会话级拦截也只多放行这一个 origin。开发服务器地址必须是本机 http，否则启动时报错。只有未打包时才读 `ELECTRON_RENDERER_URL`。
- **app:// 协议**：主机名固定为 `renderer`（`app://renderer/index.html`）。路径先经 URL 解析规整，再解码，再确认落在 `out/renderer` 里；编码过的 `..%2f` 这类越界路径返回 404。
- **拦截范围**：`onBeforeRequest` 不带过滤器，所有请求都过。另外拒绝下载、`getDisplayMedia`、设备权限、webview、子框架跳转、重定向。
- **IPC 来源校验**：要求 `event.sender` 是主窗口的 webContents、`senderFrame` 就是它的主框架，并且主框架的 URL 是 `app://renderer`（或开发服务器）。整个参数列表用 `z.tuple` 校验，多一个参数也拒绝。处理函数内部的异常只把 `internal error` 返回给渲染进程。
- **M0 实现的 IPC**：`app.info`、`settings.get/set/onChanged`、`window.setTitleBarColors`，以及 `files.pickImage`/`files.read`。后两个是为了让 T-ARC-6 的“读取未授权路径”有东西可测：渲染进程拿到的是主进程签发的 UUID 引用，不是路径。其余命名空间在各自的里程碑加。
- **应用数据目录**固定为 `%APPDATA%\AllayMotion`（内部标识，不随品牌变）。未打包的构建可以用环境变量 `ALLAY_USER_DATA_DIR` 改到别处，供测试隔离；打包后忽略这个变量。另一个只在未打包时生效的测试开关 `ALLAY_E2E_HIDDEN` 见下文“测试在后台运行”。

### 设置与窗口

- 设置 `theme` 只有 `dark`/`light`（默认 `dark`），规格没要求“跟随系统”。`language` 是 `system`/`zh-CN`/`en`，`reducedMotion` 是 `system`/`on`/`off`。读取时逐字段兜底：坏掉的字段回到默认值；整个文件解析不了或 `formatVersion` 不认识时，原文件改名为 `settings.json.bad-<时间戳>` 留档。
- **窗口大小记的是内容区尺寸，位置记外框位置**。实测在 150% 缩放下，这种无边框加 title bar overlay 的窗口外框比内容区多 1 px，按外框存取会每次重启长大一点；构造参数 `useContentSize: true` 在这种窗口上也差 1–3 px。现在的做法是按外框位置和默认尺寸创建，再 `setContentSize`，实测准确。
- 标题栏按钮区颜色：顶栏用 `--surface-1`，所以按钮区底色是 `--surface-1`、符号色是 `--foreground`。渲染进程在主题变化时读取计算后的颜色（CSS 压缩会把 `#FFFFFF` 写成 `#fff`，所以经 `rgb()` 解析）发给主进程；主进程在页面加载前用 `shared/theme-colors.ts` 里同样的值（单元测试核对它与设计变量一致）。
- 浅色主题的阴影规格没给，用了同样形状、更淡的不透明度。

### 测试的做法

- **T-ARC-2** 分两半：开发态（未打包的构建）在 `pnpm check` 的 e2e 里查 `require`/`process` 和 `webPreferences`；打包后的 fuses 检查放在 `pnpm dist` 末尾（`tests/dist/`），因为 `pnpm check` 不出安装包。CI 两个都跑。
- **T-ARC-3**（渲染进程部分）：外部请求首先被 CSP 挡在渲染进程里，根本到不了网络层，主进程也就没有记录。为了验证真正的保证（会话级拦截），测试先确认 CSP 挡住了，再用 DevTools 协议的 `Page.setBypassCSP` 关掉 CSP 重新加载，发 `fetch`、`no-cors fetch`、`<img>` 三种请求，确认都失败且主进程日志有拦截记录。
- **T-ARC-6**：测试列出 `window.allay` 的全部方法，要求每个方法都在畸形参数表里有条目（新增方法不补测试会失败）。“不是来自主窗口”的情形，e2e 里通过主进程内部的 `ipcMain._invokeHandlers` 直接用伪造的 sender 调用处理函数；这是 Electron 的私有字段，只在测试里用，单元测试也覆盖了同一个判断函数。
- **T-UI-6** 用键盘（聚焦分隔条、按方向键）调整分栏，不用合成的鼠标拖动：窗口在后台、拿不到焦点，而且在有人正在用的桌面上，真实鼠标的移动会和 Playwright 合成的指针事件互相干扰（实测约 1/10 的概率拖动没生效）。键盘调整走的是同一个分栏组件和同一条持久化路径。
- **T-UI-8**（按“测试在后台运行”的约定改过，原先截屏取色加真实鼠标拖动的做法已经删掉）：
  - 颜色：在主进程里包一层 `setTitleBarOverlay`，记录实际交给系统按钮区的颜色，切主题后核对是 `--surface-1`/`--foreground`（浅色 #FFFFFF/#141B24，深色 #14171D/#F2F4F6），并核对顶栏实际渲染的底色与之一致。**没有验证的**：系统是否真的按这个颜色把按钮区画出来——窗口不可见就截不到它。M0 开发期间用可见窗口的截屏验证过（深浅两色都对；当时含系统按钮的截图在提交 3bac743 的 `docs/review/M0/` 里），之后不再自动验证。
  - 拖动：用 `SendMessage` 向窗口发 `WM_NCHITTEST`，确认拖动区命中 `HTCAPTION`（Windows 正是据此在按住时拖动窗口）、顶栏按钮和页面内容命中 `HTCLIENT`、最右边命中系统的 `HTCLOSE`。不移动鼠标、不需要窗口可见或在前台。**没有验证的**：真的按住拖动后窗口移动了——那需要真实的前台鼠标操作。M0 开发期间用真实鼠标拖动验证过（位移在 ±15 DIP 内）。
  - 这个测试文件在非 Windows 平台跳过（v1 只做 Windows）。
- 端到端测试跑的是 `pnpm build` 的产物（`app://` 生产路径），不是开发服务器。

### 测试在后台运行（约定，后续里程碑沿用）

来自主控会话转达的用户要求：所有测试都在后台运行，不能影响用户的前台操作。

- **会启动应用的测试**（Playwright 驱动 Electron 等）不弹出可见窗口、不抢焦点、不进任务栏。做法：测试设置环境变量 `ALLAY_E2E_HIDDEN=1`，主进程据此创建窗口时 `skipTaskbar: true`，且不调用 `show()`/`maximize()`；页面照常加载、渲染，Playwright 通过 CDP 操作它（键盘、`evaluate`、`capturePage` 都不需要窗口可见）。
- **这个开关只在未打包的构建里生效**（`!app.isPackaged`），打包后的应用忽略它；它只决定窗口显不显示，1.6 的任何安全设置在两种情况下完全相同（`webPreferences`、CSP、网络拦截、IPC 校验都不变，T-ARC-2 的 `webPreferences` 检查就是在隐藏窗口上跑的）。
- **不发系统级的鼠标键盘输入**，不移动真实光标。需要系统参与的判断改用不影响前台的方式（例如 T-UI-8 的 `WM_NCHITTEST`）；确实只能在可见、前台窗口上验证的项，写明没验证什么，交给人工确认。
- **需要浏览器的测试**（以后的 `test:engine` 等）用 headless。
- **评审截图**用 `webContents.capturePage()` 截页面，不显示窗口。代价是截图里没有系统窗口按钮（它们由系统画在页面之外）。
- **辅助进程**（测试里调用的 PowerShell）用 `-WindowStyle Hidden` 和 `windowsHide`，不闪控制台窗口。
- 实现会话自己跑 `pnpm check`、`pnpm dist` 这类耗时命令时放后台执行，不打开用户可见的终端或应用窗口。
- 不能再用的做法：`desktopCapturer` 截窗口（要求窗口可见）、`SetCursorPos`/`mouse_event`、`setAlwaysOnTop`、`focus()`。

### 其他

- 1.10 里此时没有内容的命令（`assets:gen`、`templates:build`、`mascot:bake`、`ffmpeg:fetch`、`test:engine`、`test:export`）是 `scripts/not-implemented.ts`：打印“尚未实现于 M0”并以 0 退出。`pnpm check` 里也调用了后两个，它们不做任何检查。
- **来源登记检查**的生成器约定：`origin: generated` 的记录，检查脚本以环境变量 `ALLAY_GEN_OUT=<临时目录>` 运行 `generator`，产物按仓库相对路径写进去，再逐字节比对。比对对所有生成的文件做，而不只是“与原版贴图同名”的，判断更严、也不需要在仓库里放原版文件名表。登记的 `origin` 有三种：`generated`、`third-party`（必须有 `source` 和 `author`）、`original`（项目自己做、无法重新生成的，比如评审截图）。不覆盖任何文件的登记也报错。
- 空布局里放了静态的占位外形（骨架卡片、禁用的按钮、时间码），让 M0 的截图能看出最终布局；功能在后续里程碑接上。`Ctrl+B` 折叠左栏已经实现（T-UI-6 要用）。
- 品牌：按 H-BRAND 的方案 A 实现。产品名只在 `packages/ui/src/brand/`（`brand.*` 文案键），单元测试扫描界面源码确认别处没有写死。例外是 `apps/desktop/electron-builder.yml` 的 `productName`（安装包和 exe 的名字），这是构建配置不是界面文字，换品牌时要一起改。
