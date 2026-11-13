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

### 打包不联网

- 主控复跑 `pnpm dist` 时，electron-builder 的打包步骤即使本机缓存里已有 Electron 的 zip，仍会去 GitHub 取校验和，网络不通就失败。现在 `electron-builder.yml` 用 `electronDist: node_modules/electron/dist` 直接拿工作区里已安装的 Electron（`node_modules/electron` 是 pnpm 建的链接，不写 `.pnpm` 下的哈希目录），打包时不再下载或校验 Electron。
- 根目录的 `pnpm dist` 先跑 `scripts/ensure-electron-dist.ts`：二进制已在就直接继续（不联网）；Electron 45 没有 postinstall，全新安装后二进制可能还没下载，这时它触发一次下载（需要网络），失败时给出明确的报错和手动命令。
- 其他二进制：NSIS、nsis-resources、7zip 由 electron-builder 下载到 `%LOCALAPPDATA%electron-builderCache`，校验和写在 electron-builder 里，**有缓存时不联网**（下面的断网验证里没有任何下载记录）；全新的机器（包括 CI）第一次打包时会下载一次。
- 验证：把 `HTTP(S)_PROXY`、`ALL_PROXY`、npm 的 proxy、`ELECTRON_GET_USE_PROXY` + `GLOBAL_AGENT_*` 都指向不通的 `127.0.0.1:9`（同样设置下 `curl https://github.com` 失败），删掉 `release/` 后跑 `pnpm dist`：退出码 0，日志里没有下载记录，`tests/dist/T-ARC-2.packaged.test.ts` 3/3 通过。这是“代理不通”的断网，不是拔网线：不认代理环境变量、直接连网的客户端不受它限制，但打包日志里没有出现任何下载，原先失败的那一步就是走这条路的。

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

## M1 竖切：从模板到带透明通道的文件

### 版本与依赖

| 项 | 版本 | 许可 | 说明 |
|---|---|---|---|
| three / @types/three | 0.187.0（r187） | MIT | 与 1.3 一致；`WebGLRenderer` 没有被弃用，照用 |
| comlink | 4.4.2 | Apache-2.0 | 只在渲染进程（Worker 入口和宿主）用，引擎包不依赖它 |
| es-module-lexer | 3.0.4 | MIT | 用它的纯 JS 版本 `es-module-lexer/js`：WebAssembly 版需要 CSP 放行 `wasm-unsafe-eval`，不放宽 |
| yauzl | 3.4.0 | MIT | 只给 `scripts/fetch-ffmpeg.ts` 解压用（根目录 devDependency） |
| vite（根目录 devDependency） | 8.3.8 | MIT | 打包 test:engine 的测试页 |
| FFmpeg | FFmpeg-Builds `autobuild-2026-11-12-15-40`，`ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-9.0.zip` | LGPLv3 | SHA-256 写死在 `scripts/fetch-ffmpeg.ts`，与发布页的 `checksums.sha256` 一致 |

### FFmpeg

- 固定的构建是 n9.0.2 的 LGPL 变体（9.9）。`-encoders` 实测：`prores_ks`、`png`、`libvpx-vp9`、`aac`、`libopus`、`pcm_s16le`、`h264_nvenc`、`h264_qsv`、`h264_amf`、**`h264_mf`**、`libopenh264` 都在（5.6 要求确认 `h264_mf`）。5.10 里 M1 范围的测试（T-EXP-1 ①②、T-EXP-2、T-EXP-3 ①）在这个构建上重新跑通；ProRes 回读出来的像素格式是 `yuva444p12le`（解码器的输出格式），色彩标记、矩阵、范围与 5.9 的结论一致。
- autobuild 发布会被定期清理。资源不在了时 `pnpm ffmpeg:fetch --from <本机 zip>` 用本机的同一个文件（仍然校验 SHA-256）；换构建要改标签和哈希并重跑 test:export。
- 已取回且 `build.json` 与写死的哈希一致时，脚本不联网直接退出。
- 安装包只带 `ffmpeg.exe`、`LICENSE.txt`、`build.json`（`extraResources`）；`ffprobe.exe` 只给测试用。
- 查找顺序：`ALLAY_FFMPEG`（只在未打包时生效）→ `resources/ffmpeg/<平台>/` → `PATH`（只在未打包时）。打包后只用随包的那个。test:export 和 e2e 只用 `resources/ffmpeg/` 里固定的构建，缺失时明确失败并提示 `pnpm ffmpeg:fetch`。
- ProRes 的输出先写到 `<目标>.mov.partial`，扩展名推断不出容器，所以命令行在输出前加了 `-f mov`（PNG 序列加 `-f image2`）；其余与 5.3 逐字一致。剪辑点按 5.8 写进 `-metadata comment=cut_frame=n`。
- PNG 序列：用户选一个目录，帧写进 `<目录>/<名字>.partial/<名字>_%05d.png`，成功后改名为 `<目录>/<名字>/`，重名加 “ (2)”。
- 导出失败给出错误码（`ffmpeg-missing`、`output-not-writable`、`disk-full`、`encoder-unavailable`、`ffmpeg-failed`、`frame-mismatch`、`template-failed`、`template-unresponsive`），界面按错误码显示文案。`writeFrame`/`finish` 不抛错而是返回 `{ ok: false, error }`，因为 IPC 的异常只能带 message。“复制诊断信息”在 M7。
- `export` 命名空间 M1 只实现 `start`、`writeFrame`、`finish`、`cancel`、`ffmpegInfo`；`writeAudio`（M6）、`probeEncoders`（M7）还没有。`powerSaveBlocker` 已接上；应用退出时取消所有进行中的任务。

### 引擎

- **协议 schema 放在 template-sdk**（`packages/template-sdk/src/protocol.ts`）：引擎只能依赖 three、template-sdk、assets（1.4），而线程边界要用 zod 校验。Worker 校验宿主发来的请求，宿主校验 Worker 交回的 `LoadResult`、`FrameStats`。
- **Worker 入口在渲染进程**（`apps/desktop/src/renderer/engine-host/engine.worker.ts`）：它用 Comlink 暴露引擎，Comlink 不进引擎包。三种 Worker 是同一份入口。
- `EngineApi` 多了一个 `readPreview(t)`：画一帧预览（N = 1）并在同一个任务里 `readPixels` 读回画布，供 T-ENG-4 和诊断用。`renderThumbnail` 还没做（M2 的缩略图）。
- **删全局**：WebIDL 的 `fetch`、`indexedDB`、`caches` 等定义在原型链上，只 `delete self.fetch` 无效，所以沿原型链逐层删除，最后确认都是 `undefined`，否则 Worker 启动失败。另外顺手删了 `WebTransport`。
- **动态 import 的防线**：宿主在交给引擎前用 es-module-lexer 检查源码，出现任何静态或动态 `import` 就拒绝（4.8 第 3 步提前到每次装载）。经 `Function`/`eval` 拼出来的 `import()` 被 CSP（没有 `unsafe-eval`）挡住，T-ARC-4 两种都测了。
- 不做 resolve 着色器里的 ±0.5 LSB 抖动（规格写的是“可以加”）：抖动会让预览（预乘）和导出（直通）的取整不一样，T-ENG-4 的 ≤ 1 就难保证。辉光出现色带时再议。
- 模板的 `setup` 结束后，引擎遍历场景释放剩下的几何体和材质（Three 的资源释放后用到会自动重新上传，所以总是安全的）；贴图属于引擎的缓存，`resourceStamp` 变化时清空。
- 贴图载荷：`{ kind: 'rgba', width, height, data }`，直通 alpha、sRGB、第一行是顶部；引擎在 CPU 上翻一次行再做成 `DataTexture`。缺失时用品红黑棋盘占位并记一条警告。
- 开发构建的确定性拦截（2.4）由宿主传 `strictDeterminism: import.meta.env.DEV` 打开；test:engine 一律打开。

### 帧管线的测试判定

- **T-ENG-4 的判定**：预览画布是 8 位**预乘** alpha，换算回直通时颜色的量化误差是 ±0.5 × 255 / a，alpha 小的边缘像素（MSAA 的抗锯齿边）理论上就不可能做到 ≤ 1。测试的判定是：alpha 每个像素 ≤ 1；alpha = 255 与 alpha ≥ 128 的像素直通颜色 ≤ 1；**全部像素在预乘域里**（导出的直通值乘回 alpha 后与画布比较）≤ 1。实测这三项都是 0 或 1。
- T-ENG-5 在预乘域里做 2×2 平均再比较（直通颜色在透明处没有意义）。
- T-ENG-3 用 1920×1080（1 设计单位 = 1 像素），宽 300 的白色矩形，取中间一行。
- T-ENG-1 用 1280×720、标准画质（N = 8）：一个新 Worker 顺序渲染全部 67 帧，另一个新 Worker 按确定性的乱序渲染，SHA-256 逐帧相同；另有同一 Worker 里穿插渲染后的自检。

### 临时模板与“首末帧全透明”

- 临时模板在 `packages/templates/m1-block-wipe/`：普通 JS（不含 import 的单文件 ESM），用 JSDoc + `checkJs` 做类型检查；参数写死成 T1 的默认值（centerOut、reverse、backOut、flipY、3d/fov 30、cols 12）。渲染进程用 Vite 的 `?raw` 拿到源码文本，和用户模板一样经 `engine.load` 装载。M3 用 esbuild 和正式的模板包替换它。
- **发现的规格问题（M3 的 T1 要处理）**：按 4.10 的公式，进入阶段从 `t = 0` 就开始。开了运动模糊（标准画质）时，首帧的子帧有一半落在 `(0, 0.5/fps]`，这时中心的方块已经长出来，首帧最大 alpha 实测是 127，违反 4.6 第 7 条和 T-EXP-7。末帧同理。引擎照 2.6 如实渲染，不在引擎里特殊处理。临时模板的做法：进入阶段从 `1/fps` 开始、退出阶段提前 `1/fps` 结束（首尾各留一帧全透明，快门角最大 360° 时子帧也不超过 ±0.5/fps）。T1 的正式实现需要同样的余量，或者规格改公式。

### 渲染进程

- 预览画布由 `previewEngine` 创建并放进 React 给的容器：一个 `<canvas>` 只能 `transferControlToOffscreen()` 一次，看门狗终止 Worker 后要换一块新画布再建 Worker；交给 React 管会和 StrictMode 的双重挂载冲突。
- 看门狗触发后：Worker 终止，立即重建一个**空闲的** Worker（不再装载刚才的模板，否则会再次卡死），预览区显示“模板无响应”和“重试”。
- 播放的时钟是界面的 `requestAnimationFrame`（真实时间），只决定传给引擎的 `t`；模板的 `update` 只看 `t`。拖动吸附到帧。播放条用引擎的 `frameCount`（`@allay/engine/frames` 子路径，不把 three 拉进主线程的包）。
- M1 的最小导出对话框：格式（ProRes 4444、PNG 序列）、画质（草稿/标准/高/极致，快门角固定 180°）、进度、取消、结果。完整界面在 M7。
- 资源桩 `stubResolveResource` 只认 `minecraft:block/*` 的贴图，按 ID 生成 16×16 的占位方块图（纯函数，不读文件，不需要登记来源）。

### 测试的做法

- **test:engine 在 Electron 自带的 Chromium 里跑**，而不是 Playwright 下载的 Chromium：不用额外下载浏览器（`pnpm check` 在依赖装好后不联网），测的就是要发布的那个渲染内核。Electron 在 Windows 上没有真正的 headless 模式，这里用不显示的窗口（`show: false`、`skipTaskbar`），不弹窗、不抢焦点。测试页用 Vite 打包到 `tests/engine/out/`，由 `harness://` 协议提供，响应带与应用相同的 CSP（从 `security-policy.ts` 读），会话级拦截同样只放行本地协议。Playwright 的 `NODE_OPTIONS` 不传给 Electron（它的加载器会让 ESM 主进程脚本装载失败）。
- **测试钩子**：e2e 需要在应用里装载测试模板（T-ARC-4、T-ARC-5）。主进程在未打包且设置了 `ALLAY_E2E_HOOKS=1` 时，`app.info()` 返回 `testHooks: true`，渲染进程据此装上 `window.__allayTest`（换模板、读状态、设时间、读预览像素统计）。打包后的应用忽略这个变量；钩子只调用界面本身的路径，1.6 的任何设置不变。另有两个同样只在未打包时生效的开关：`ALLAY_E2E_EXPORT_TARGET`（导出不弹保存对话框，直接写到这个目录）和 `ALLAY_FFMPEG`（5.6 的开发用 FFmpeg）。
- **T-ARC-3（Worker 部分）**：和 M0 一样分两层验证。第一层：Worker 里联网的全局已经不在，动态 `import('https://…')` 被 CSP 挡在渲染进程里（主进程日志里没有它）。第二层（真正的保证）：Worker 脚本的 CSP 来自它自己的 `app://` 响应头，`Page.setBypassCSP` 和 `webRequest.onHeadersReceived` 都管不到（实测），所以这个测试**单独启动一个应用**，在主进程里把 `app://` 换成提供同样文件、但不带 CSP 头的处理函数，重新加载后在新的引擎 Worker 里（Playwright 的 `worker.evaluate`）发动态 import 和 `FontFace` 请求：都失败，且主进程日志有 `blocked request`。会话级拦截没有任何改动；换处理函数只发生在这个测试自己的进程里，不影响其他测试。
- **T-ARC-5**：在应用里装载 `update` 死循环的测试模板，用真实的 5 秒预览单帧时限；主线程卡顿用页面里的 longtask 观察器，加上测试每 20 ms 经 CDP 往页面主线程发一次 evaluate 量往返时间。最初用的页面内 10 ms `setInterval` 心跳不可靠：窗口不显示时 Chromium 会把隐藏页面的计时器压到约每秒一次（实测一次 1007 ms 的间隔，同期没有任何长任务），量出来的是节流不是卡顿。引擎层另有一个用 2 秒时限的测试（test:engine）。
- **T-EXP-5/6** 在 test:export 里直接驱动主进程的 `ExportJob`（Node，不需要 Electron）：中途取消（ProRes 和 PNG 各一次，查 `.partial`、目标、FFmpeg 进程）、不可写路径、伪造的坏二进制、不存在的二进制、帧与设置不符。界面部分在 e2e 里：取消后没有残留文件和进程；不可写路径给出对应文案；坏二进制在打开导出对话框时就被 `ffmpegInfo` 探测出来，对话框显示“FFmpeg 缺失”的文案并禁用“导出”（坏二进制在 `start` 时失败的路径由 test:export 覆盖）。**T-EXP-7** 在 e2e 里经真实界面、真实 IPC 导出。
- 其他会话把 git worktree 放在仓库里的 `.claude/worktrees/`（本地 `.git/info/exclude` 已排除），ESLint 会扫进去，所以 `eslint.config.js` 忽略 `.claude/**`。
