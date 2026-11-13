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

### 修复：T-EXP-5（界面）的不稳定（合入 main 之后）

- **现象**：主控在 main 上复跑时，“导出到一半取消”的 `export-cancel` 点击 30 秒超时，日志是 element is not stable … detached from the DOM；单独跑时通过。
- **根因**：不是界面的问题。实测导出期间取消按钮始终是同一个 DOM 节点、位置和大小不变；但这个不显示的窗口里 `requestAnimationFrame` 大约每秒只来一次（`backgroundThrottling: false` 也一样），Playwright 判断“稳定”要等连续两帧 rAF，点击前的可操作性检查因此要好几秒。旧测试用“极致”画质，指望导出慢到来得及点；这台机器上 67 帧约 3 秒就导完，导完按钮被卸载，就成了 detached。
- **修法**：测试不再依赖导出的快慢。导出流程里加了一个只给测试用的“闸门”（`exportRunner.ts` 的 `setExportGate`，正式运行时为 null，不等待任何东西）；测试钩子 `pauseExportAfter(n)` 让导出写完第 n 帧后停住（FFmpeg 仍在运行、`.partial` 已存在），测试正常点击“取消”。等闸门时也会被取消打断，所以取消总能生效。没有加长超时、没有 `force`、没有重试。

## M2a 目录与资源栈的非引擎部分

M2 拆成两半并行：M2a 不依赖引擎（本节），M2b 在 M1 合入后做资源到 Worker 的通路、网格、位图字、缩略图和界面。

### 范围变更：取消自制内置贴图（用户决定，经主控转达，2026-11-13）

- 用户决定**不自己画材质**，方块、物品、界面贴图直接用 Minecraft 原版资源；合成音效也先不做。主控定的落实方式：**应用在运行时只读用户本机已装游戏的 jar**（3.4 的原版层）。仓库和安装包里仍然没有任何 Mojang 文件（硬性规则第 1 条不变）。
- 本分支早先写好的程序化贴图/音效生成器、`resources/builtin-pack/` 的产物、H-ART 联络图，已经用新提交删除。`pnpm assets:gen` 恢复为“尚未实现”。`ASSETS_PROVENANCE.json` 和根 `package.json` 与 main 相同；为生成器引入的 fflate 和 `.gitattributes` 也一并去掉。
- 内置层保留为通用的“从一个目录读”（`openBuiltinLayer(root)`），不假设里面有什么。目录不存在时是空层，`revision` 为 `empty`。内置层的素材来源待用户决定。
- **由此产生的规格偏离，待主控和用户确认**：
  - `01` 1.1 第 4 条和 `03` 3.1 的“开箱即用、没装游戏也能完整预览和导出”不再成立。没有原版层也没有资源包时，所有贴图都会走占位图。**这时界面怎么表现，待主控和用户确认。**后来加上的运行时下载（见下一小节）让没装游戏的用户在同意并联网下载后也能用，但离线且从未下载过时仍然没有素材。
  - `03` 3.3（内置层由脚本生成、内置合成音效）不做。
  - T-AST-2（只有内置层时加载内置模板，`warnings` 为空）在没有素材时做不到，需要改判定或改前提。
  - T-AST-7（生成脚本的确定性）不再适用。H-ART 不再需要。
  - 3.3 的覆盖率检查改成“某一层能提供目录里的多少贴图”（`requiredTextures()` + `findMissing()`）。单元测试对夹具做检查；对本机真实 jar 的检查做成手动冒烟脚本 `scripts/smoke-vanilla.ts`，不进 `pnpm check`。

### 对“应用不联网”的例外：运行时从 Mojang 下载客户端 jar（用户批准）

用户在主控会话里的原话是：“工具在运行时从mojang服务器下载jar，然后提取assets”。主控把这句话作为对硬性规则第 10 条的明确授权转达过来。这是**唯一的例外**，边界全部写死在 `apps/desktop/src/main/resources/download.ts` 里：

- **在哪里联网**：只在主进程，用 Node 的 https。渲染进程会话级的网络拦截、CSP 以及 1.6 的其余各条都不动。
- **访问哪里**：主机白名单只有 `piston-meta.mojang.com`、`piston-data.mojang.com`、`resources.download.minecraft.net`，只用 https、默认端口。URL 里不能带用户信息。任何重定向一律拒绝，不跟随。版本清单返回的 URL 也要过白名单。
- **发什么**：请求不带任何自定义头（没有 User-Agent，也没有任何标识或用户信息）。
- **何时联网**：只在调用方显式调用 `downloadLatest()` 或 `fetchObject()` 时，调用方负责先取得用户同意。`findCached()` 和 `chooseVanillaSource()` 完全离线。不做后台自动更新，不做遥测。
- **流程**：版本清单 → `latest.release` → 版本 JSON（用清单给的 sha1 校验）→ 客户端 jar 和资源索引（用版本 JSON 给的 sha1 和 size 校验）。音效等资源对象在读取时按需从 `resources.download.minecraft.net/<前两位>/<哈希>` 取，同样校验 sha1 和大小。
- **存放**：放在调用方传入的缓存目录（应为 `userData/vanilla-cache`），结构如下。jar 整体保留，按需读取其中的条目，不全量解压。
  - `versions/<id>/client.jar`
  - `versions/<id>/version.json`
  - `indexes/<id>.json`
  - `objects/<前两位>/<哈希>`
- **校验与清理**：先写 `.part` 临时文件，大小和 sha1 校验通过后才改名。超过大小上限（JSON 16 MB、jar 256 MB、单个对象 64 MB）、空闲超时 30 秒、取消（AbortSignal）、校验失败，都不留半成品。版本 JSON 最后写，作为“这一版完整”的标记；`findCached()` 仍会重新校验 jar 和资源索引。
- **测试替身**：可替换的只有 `testOrigins`（把白名单主机映射到本机的假服务器），而且必须同时传 `packaged: false`；传 `packaged: true` 时构造函数直接报错。白名单检查对替换之前的逻辑 URL 做。M2b 接线时只能在 `!app.isPackaged` 且设了测试环境变量的情况下传入。
- **原版层的来源**：本机已装游戏的 jar 和下载缓存的 jar 二选一，由 `chooseVanillaSource(local, cached, prefer)` 决定。默认取版本较新的那个，可以指定偏好 `local` 或 `downloaded`；两者都没有时返回 `needs-download`，交给调用方征求同意。资源栈里用户资源包仍在原版层之上。
- **测试**：T-AST-DL-1 到 T-AST-DL-9 全部对着测试里起的本机假 HTTP 服务器跑，用脚本生成的假清单、假 jar（纯色测试色块），`pnpm check` 不访问真实网络。真实下载只做成手动冒烟脚本 `scripts/smoke-download.ts`，下载到仓库外的临时目录，下载物不进仓库。
- **实测偏差**：真实的版本清单里有 `"3D Shareware v1.34"` 这种带空格的老版本 id。所以清单里的 id 只要求是字符串，选中的那一版再按“只含字母数字、`.`、`_`、`-`”校验（它要用作目录名）。
- **发布前需人确认（H-DOWNLOAD，请主控写进发布清单）**：运行时从 Mojang 服务器下载客户端 jar 是否符合其最终用户许可协议和使用准则。下载只发生在用户机器上，仓库和安装包里仍然没有任何 Mojang 文件，但“由第三方工具替用户下载游戏文件”这一点没有经过条款核对。

### 目录与着色

- 方块目录实际 112 个（规格写“约 110”）；物品 42 个，与清单逐项一致（单元测试核对）。贴图 ID 按原版的文件名写，本机 1.21.1 的 jar 上全部能解析（见 `docs/review/M2a/README.md`）。
- 指南针和时钟在原版里是一组帧贴图（`compass_00`…、`clock_00`…，由物品模型按状态切换，不是 `.mcmeta` 动画）。目录里取第一帧 `compass_00`、`clock_00`。
- 界面贴图清单（`packages/assets/src/gui.ts`）用 1.20.2 起的 `gui/sprites/` 路径：提示框 `advancement`、`system`（九宫格边框 4），boss 条和经验条的底与进度各一张。
- 着色常量：云杉 `#619961`、白桦 `#80A755`。来源是游戏代码里 `FoliageColor` 的固定值（公开资料），**按记忆填写，没有联网复核**。草、树叶、水用规格给的值。
- `orientable` 的正面朝北、底面与顶面相同；`cube` 的六个面分别写 `up/down/north/south/east/west`；所有形状都可以带 `sideOverlay`（叠在四个侧面上）。工作台用 `cube`（底面 `oak_planks`），唱片机用 `cube_bottom_top`（底面用侧面贴图），书架用 `cube_column`（端面 `oak_planks`）。

### 资源栈

- **`ResourceLayer` 比规格多一个必需字段 `revision`**，表示这一层内容的版本，参与 `resourceStamp`（规格只说“文件修改时间”，接口里没地方放）。另有可选的 `legacyFormat`、`warnings`。层是普通对象（方法写成闭包），开关时用展开语法复制。资源栈是从下到上的数组，下标 0 是 builtin。
- `revision` 的取法：
  - 文件夹层和内置层：文件数:最大修改时间:总大小。
  - zip：大小:修改时间。
  - 原版层：版本 id:jar 大小:jar 修改时间:索引修改时间。
- `resourceStamp` 是对 `[id, revision, enabled]` 有序列表的 FNV-1a 64 位哈希。`packages/assets` 不能用 Node 的 crypto，这里也不需要密码学强度。
- sounds.json 的跨层合并与游戏一致：上层追加变体，`replace: true` 时替换。例外是只来自 builtin 层的定义：被任何上层定义时整个替换，避免将来的兜底音效和游戏音效混在一起随机出现。
- 音效名解析到文件时先找 `.ogg` 再找 `.wav`（3.8 两种都支持）。
- `readResource` 在胜出的层读不出来时（扫描后文件被删、zip 条目损坏）继续往下找。
- 设置里的资源栈配置先写成 `packages/assets` 的 `ResourceStackSettingsSchema` 和 `buildStack()`，由 M2b 接进 `settings.json`（本次不改 `shared/settings.ts`）。zip 包在设置里只记 `<sha256>.zip` 文件名，`packZipPath()` 只接受这个格式，防止设置文件被改成指向任意路径。

### zip、文件夹与原版层

- **只要有一个不安全的条目名（`..`、绝对路径、盘符、反斜杠），整个压缩包就被拒绝**，而不是只跳过该条目：这样的包本身就可疑，游戏也不认反斜杠路径。yauzl 用 `strictFileNames: true`（不把反斜杠改成正斜杠）和 `validateEntrySizes: true`，我们再用 `isSafeRelativePath` 查一遍。
- 解压炸弹：
  - 中央目录声明解压后超过 64 MB 的条目不收录，并记一条警告。
  - 读取时按实际解压出的字节数截断，因为声明的大小可以造假。
  - 条目数上限 200 000。加密条目和不认识的压缩方法跳过。
- **导入 zip 时先复制到 `packs/` 下的临时文件，再对这份副本做校验、算哈希**，通过后改名为 `<sha256>.zip`；被拒绝时删除临时文件。这样校验的正是最终保存的那份，不怕校验之后源文件被换掉。被拒绝后可能留下一个空的 `packs/` 目录，它在应用数据目录内。
- 文件夹扫描跳过符号链接和超过 64 MB 的文件，读取前再确认一次。
- 原版层：
  - jar 里只收录 `assets/` 下的条目。
  - 资源索引里的对象映射成 `assets/<键>` 的虚拟路径，索引里不安全的键忽略。这样 sounds.json 和 .ogg 的路径写法与资源包一致。
  - 资源索引缺失时，原版层只有贴图、没有音效。本机正是这种情况：`.minecraft` 下没有 `assets/` 目录。
  - 只读，不复制到任何地方。
- **探测顺序：用户上次手动选的目录优先，其次是官方启动器的默认目录**。规格把默认目录列在前面，但用户手动选过，说明想用那一个。
- 其他启动器不自动探测：Prism、MultiMC 的目录结构不同；PCL、HMCL 的“版本隔离”把每个版本放在 `versions/<id>/` 下自成一套，但版本 JSON 和 jar 的位置与标准结构相同，用户手动选 `.minecraft` 目录即可。带 `inheritsFrom` 而没有自己 jar 的版本（例如本机的 `fabric-loader-0.20.1-1.21.1`）因为没有 jar 被自然排除。
- 版本 JSON 只用到 `type`、`releaseTime`、`assetIndex.id` 三个字段。

### 测试夹具

- 夹具由 `tests/unit/helpers/resource-fixtures.ts` 在测试时写进临时目录：三个资源包、充当内置层的目录、恶意 zip、解压炸弹、含假 jar 和假资源索引的 `.minecraft`。
- 夹具里的 PNG 是**纯色色块，只是测试数据**，用颜色区分“这张来自哪一层”，不是产品素材。不提交任何二进制，`.jar` 也不允许提交，所以 `tests/fixtures/` 下没有新增文件。
- 恶意 zip 用手写的 zip 生成器造，因为正常的压缩工具不肯写出 `../` 条目。
- T-AST-6 的夹具场景（较新的版本没有 jar，选中较旧且有 jar 的正式版）与本机实际情况一致：`26.3` 没有 jar，`1.21.1` 有。

### 没做的

- 因范围变更不做：内置贴图和音效的生成、H-ART 联络图、T-AST-7、针对内置层的覆盖率检查。
- 运行时下载留给 M2b 的部分：IPC 接线、征求同意的对话框、进度界面；把 `app.getPath('userData')/vanilla-cache` 和 `app.isPackaged` 传给 `createVanillaDownloader`。
- 留给 M2b：T-AST-2、T-AST-3；资源到 Worker 的通路和缓存；网格；位图字的栅格化和文字对象（本次只做了字体提供器 JSON 的解析和字形宽度规则）；缩略图；IPC 的 `resources` 命名空间；首次发现游戏时的对话框；资源栈弹层；拖入资源包。
- 没有引入任何字体。

## M2b 资源层接进引擎和界面

### 范围与前提（沿用 M2a 的范围变更）

- 不自制任何贴图、图标、字形、音效。M1 的占位方块桩 `stub-resources.ts` 已删除；贴图缺失时只用引擎里的品红黑棋盘并记警告（T-AST-3）。
- **T-AST-2 的前提改为**：资源栈里只有一个由测试脚本生成的假原版层（纯色色块的假 jar，覆盖方块、物品、界面目录的全部贴图）。e2e 里这样装载临时模板，`warnings` 为空。另加一条：没有任何素材层时显示引导状态，不报错、不白屏。T-AST-7、H-ART 不再适用，没有做。
- 覆盖率检查：`tests/unit/coverage-fake-vanilla.test.ts` 对假原版层全覆盖；对本机真实 jar 的检查仍是手动的 `scripts/smoke-vanilla.ts`。

### 兜底字体：方舟像素字体

- 规格的“内置像素字体”用 9.7 推荐的方舟像素字体（Ark Pixel Font）2026.11.10，12px 比例宽度 zh_hans 的 **BDF**，从官方发布包原样取出，**不做任何修改**（不转格式、不裁剪），放在 `resources/fonts/ark-pixel/`，附发布包里的 `OFL.txt`，登记在 `ASSETS_PROVENANCE.json`，随安装包（`extraResources`）分发。
- 许可核对（2026-11-13，经 GitHub API 读仓库）：字体部分是 `LICENSE-OFL`（SIL OFL 1.1，`Copyright (c) 2021, TakWolf`，**没有 Reserved Font Name**）；构建程序是 `LICENSE-MIT`，不随我们分发。README 写明“字体”和“构建程序”分别授权，没有发现其他条款。缝合像素字体合并了多个来源的字形，许可链更长，没有选。
- 选 BDF 而不是 OTF/TTF：BDF 是纯文本位图，解析简单、像素准确，不需要在 Worker 里做字体光栅化（Worker 里没有 FontFace 的网络路径，CSP 也不用动）。`.gitattributes` 让它按原样保存，不做换行符转换。
- 解析在主进程（`@allay/assets` 的 `parseBdf`，约 90 ms，只做一次），成表格经 IPC 交给渲染进程，再交给引擎。
- 关于页的“第三方许可”在 M4；OFL 全文已经随包附带。

### 资源通路

- 主进程 `ResourceService`（`apps/desktop/src/main/resources/service.ts`）：按 `settings.json` 的 `resources`（M2a 的 `ResourceStackSettingsSchema`）组装资源栈，栈一变就算新的 `resourceStamp` 并经 `resources:changed` 推给渲染进程。改栈的操作串行执行。
- 渲染进程 `engine-host/resource-client.ts` 是引擎的 `resolveResource`：经 IPC 取原始文件，**在渲染进程里自己解码 PNG**（`@allay/assets` 的 `decodePng`，用浏览器的 `DecompressionStream` 解压）。不用 canvas 解码，是因为 2D canvas 内部预乘，半透明像素会丢精度。解码结果按 stamp 缓存；每次交给 Worker 的是副本（载荷是零拷贝转移的）。
- 预览：stamp 变了就重新 `load`（引擎按新的 stamp 清空贴图缓存）。导出：用开始导出时的 stamp。
- 贴图载荷带 `mcmeta`：**与 PNG 来自同一层**的 `.png.mcmeta` 原文（游戏的规则：元数据跟着胜出的那张图走），引擎自己解析动画和 `gui.scaling`。
- 规格 1.8 之外多出的 IPC 方法：`resources.readTexture`（PNG + 同层 mcmeta）、`fontProviders`（字体定义合并、展开 reference）、`fallbackFont`、`chooseGameDir`（规格的 `setVanilla` 拆成开关/同意和选目录两件事）、`downloadVanilla`、`cancelDownload`。`setVanilla` 只接受 `{ consent?, enabled? }`。全部有 zod 校验，T-ARC-6 的畸形参数表已补齐。
- 拖放：preload 的 `addDroppedPack(file)` 只接受 `File`，用 `webUtils.getPathForFile` 取路径再交给主进程；页面自己构造的 `File` 没有路径，主进程收到空串被 schema 拒绝（e2e 覆盖）。主进程再要求是绝对路径，且只接受 zip 文件或目录。

### 原版层的来源、同意与下载

- 启动时：内置层和资源包先打开（不需要探测），原版层在后台**离线**探测（本机游戏 + 下载缓存的 `findCached`），`chooseVanillaSource` 默认取较新的那个。
- 同意：`consent` 为 null 且发现本机游戏时弹一次 3.4 的对话框。**第二个按钮原文“先用内置素材”改为“暂不使用”**（没有内置素材了）；答案写进设置，之后不再问。用户点“下载”并成功、或手动选了游戏目录，都视为同意。
- 引导状态：探测完、资源栈里没有任何启用的原版层或资源包时，预览区上方显示一张卡片（不是错误卡片，模板照常装载、缺的贴图是占位）：“下载原版资源（约 45 MB，来自 Mojang 官方服务器）”、“查找游戏目录…”、“添加资源包…”，发现过本机游戏但没同意时另有“使用本机的 Minecraft {版本}”。说明文字写明会连哪两个主机、下载什么、存在哪里、不发个人信息、不自动更新。**“约 45 MB”是按 2026-09 的 26.3（jar 41.5 MB）写的估计**，下载前不联网所以拿不到准确大小。资源栈弹层里没有原版层时显示同一组入口。
- 下载只在 `downloadVanilla()` 里调用，只由按钮触发；进度经 `resources:changed`（节流 100 ms，节流掉的最后一次在间隔结束时补发）。取消用 AbortController，不留 `.part`。失败分 network / verify / disk / unknown 四类文案。
- **下载缓存的原版层不传 `fetchObject`**：除了用户点“下载”，应用不再按需联网取音效对象。音效在 M6，到时再定（可以在下载时一并取 10 个事件需要的对象）。
- 测试替身：主进程只有在未打包、且 `ALLAY_E2E_MOJANG_ORIGIN` 是 `http://127.0.0.1:端口` 时才把三个 Mojang 主机映射到这个本机地址（`readTestSwitches` 校验格式，`createVanillaDownloader` 在打包后本来就拒绝）。e2e 的默认值是没人监听的 `127.0.0.1:9`，误点下载也不会出网。另一个开关 `ALLAY_E2E_GAME_APPDATA` 让探测看测试目录而不是 `%APPDATA%`，e2e 默认指向一个空目录，**测试永远不会碰到这台机器上真装的游戏**。
- 同意过、但游戏和下载缓存都找不到了：静默退回，资源面板显示一行提示（`vanilla.problem = 'missing'`）；jar 打不开为 `jar-unreadable`。

### 资源包与资源栈弹层

- 新加的包放在最上面。zip 包 id 是 `zip:<sha256 前 16 位>`，同一内容重复添加不会出现两行；删除时没有别的条目引用就删掉 `packs/` 里的副本。文件夹包 id 是 `folder:<uuid>`，设置里记路径，窗口重新获得焦点时重扫，内容变了才重建。
- 打不开的包（文件没了、zip 被拒绝）不进资源栈，在弹层里单独列出原因和删除按钮。
- 原版层固定在内置层之上、所有资源包之下，不参与排序（规格：资源包在原版层之上）。
- **内置层是空的，不在弹层里列出**（`LayerInfo.empty`）。
- 弹层是自己写的（Escape、点外面关闭），排序用每行的“上移/下移”按钮，键盘可用。dnd-kit 拖拽排序、shadcn Popover、Sonner 通知在 M4 换上；现在拖入结果用窗口底部一条 6 秒的提示。

### 引擎

- `ctx.resources.block/item`、`ctx.text.create`、`ctx.sprite.create` 实现，`runtime.ts` 的类型补齐。
- **面明暗和着色的色彩空间**：游戏在 sRGB 里把系数乘在贴图上；引擎把系数先换成线性值烘进顶点色，在线性空间里乘。对纯幂函数两者相同，sRGB 曲线下暗色会差几个单位（测试里草的着色差到 4/255，容差放到 6）。M1 的临时模板原来把 0.8 等系数当线性值用，现在改用目录方块后南面会比 M1 亮一些。
- 实例化的方块一律走透明队列（逐实例不透明度需要混合）；不透明度为 1 时结果与不透明相同。不透明度 ≤ 0 的片元直接丢弃（不写深度）。cutout 的阈值只看贴图 alpha（不透明度在 alphaTest 之后才乘）。半透明方块按物体排序，实例之间不排序（“尽力排序”）。
- 侧面叠加层（草方块侧面）是另外 4 个面，抠图并用 polygonOffset 往前偏。
- 物品：正反面各一个四边形，用 alphaTest 0.5 抠出形状；侧壁按不透明像素生成并合并同色相邻段。不在目录里但在方块目录里的 ID 按方块渲染。侧壁明暗用方块那套系数（上 1.0、下 0.5、左右 0.6），规格没写。
- **文字是“一段文字一张贴图、一个四边形”**，不是规格写的“每个字形一个四边形”：每个字形的像素原样拷进这张贴图，放大缩小都用最近邻，视觉上等价，实现和确定性都更简单。阴影是同一张贴图偏移 1 个字体像素、颜色 × 0.25（sRGB）。行高是这一行字形的上升 + 下降 + 1 像素间隔。原点：水平按 align，垂直在整段文字的中线（规格没写）。
- 原版字形和兜底字形按各自的原生像素尺寸画：原版约 8 像素高，方舟 12 像素高，混排时中文看起来大一些。游戏里中日韩字形来自 unihex（16 像素画成一半），v1 不解析 unihex，所以有这个差别。
- 哪个字体都没有的字形跳过并报一条警告（列出前 8 个码位）。
- `text.create` 是同步的，所以引擎在每次 `setup` 之前取好字体（资源栈字体按 stamp 缓存，兜底字体整个 Worker 只取一次）。
- 精灵九宫格：边框按“逻辑像素 × pixelSize”，逻辑像素以 `.mcmeta` 的 `gui.scaling` 尺寸为准（高清包的贴图像素是它的倍数）。尺寸比两边边框还小时按比例压缩边框。
- `renderThumbnail` 按规格返回 `ImageBitmap`。方块的投影刚好放进 ±0.82 的正交框。

### 缩略图

- `features/thumbnails/thumbnails.ts`：内存 → `cache.getThumb` → 杂务 Worker 画，按顺序排队；PNG 写进 `userData/cache/thumbs/<stamp>/<kind>_<size>_<id>.png`（ID 里的 `:` 和 `/` 换成 `~`）。写入新 stamp 时删掉其他 stamp 的目录。stamp 变了就丢掉内存里的，把要过的缩略图在后台重建。杂务 Worker 空闲 30 秒销毁。
- M2 还没有界面用它（方块选择器在 M4），e2e 经测试钩子覆盖生成、磁盘缓存命中和失效。

### 测试

- test:engine 的假资源栈（`tests/engine/harness/fake-resources.ts`）：按 ID 散列的纯色 16×16、一张 4 帧纯色动画条、一张纯色边框的面板图、一张左半透明的物品图、一套由不同宽度实心矩形拼成的测试字体。都只是测试数据。兜底字体用仓库里真实的 BDF。
- e2e 的假游戏、假资源包、假 Mojang 服务器全部在测试时生成（纯色色块），不提交二进制。拖放用真实的文件输入框拿到带路径的 `File`，再派发 `drop` 事件，走的是界面真实的拖放处理和 preload。

### T-ARC-5 的 1 秒空洞（主控复跑时发现，已查清）

- **现象**：完整 e2e 里 T-ARC-5 偶尔（无开关时约 2/14 次完整运行）量到约 1 秒的 CDP 往返，同期长任务观察器什么也没记到。单独跑这一条从来不出现。
- **查证**：在测试里同时量了四样东西，放在同一条时间线上：CDP 往返；页面里的探针 Worker（每 10 ms 发消息、主线程立刻回）；页面里的 MessageChannel 自循环；主进程和 Playwright 进程各自的事件循环延迟。两次复现的结果一致：
  - 探针 Worker 的消息在约 990 ms 里没有被主线程处理，MessageChannel 自循环同样断了 1001 ms，和 CDP 的空洞是同一段时间；
  - 主进程、Playwright 进程都没有延迟，所以不是量法本身的问题，渲染进程的主线程确实这么久没处理消息；
  - 这段时间里既没有长任务，也没有 long-animation-frame 记录，主线程没有在跑我们的 JS，也没有在渲染；
  - 空洞长度都是一个帧周期（993、1001 ms）。用 rAF 记的帧时刻显示，不显示的测试窗口每秒只出 1 帧（`visibilityState` 仍是 visible），空洞的起止正好落在这个 1 Hz 帧时钟的相位上；
  - 页面里一直挂着 rAF 循环时（每帧都请求帧）8 次完整运行都不出现：主帧按帧时钟走，就不会卡在等下一帧上。
- **根因**：从不显示的窗口没有显示器垂直同步，Chromium 退回每秒 1 帧的合成帧时钟。界面一有 DOM 变化（这里是装载完成、状态切到“就绪”的那次重绘），主线程会等合成器处理下一帧才继续处理消息。可见窗口里这个等待最多一帧（约 16 ms），在隐藏窗口里被拉长到将近 1 秒。所以这是测试环境的帧时钟造成的，不是产品里有阻塞主线程的代码。偶发是因为只有装载恰好在某个帧相位上完成时才赶上。
- **处理**：
  - 主进程在 `ALLAY_E2E_HIDDEN`（只在未打包时生效）打开时加 Chromium 开关 `disable-frame-rate-limit`，让隐藏窗口的帧时钟和可见窗口一样快：加开关后 rAF 间隔约 17 ms。只影响帧的节拍，1.6 的安全设置一条不动。
  - T-ARC-5 的判定改为页面里的三种量法：长任务（> 100 ms 失败）、探针 Worker 往返、MessageChannel 自循环间隔（都 < 100 ms）。后两种不靠计时器，也不经过浏览器进程和 Playwright 的事件循环，量到的是主线程多久没处理消息（不管卡在 JS 还是渲染流水线）。CDP 往返只记在注解里，不再断言。
  - 结果：加开关后 T-ARC-5 连跑 20 次全过，完整 e2e 又跑了 5 次全过，然后完整 `pnpm check` 通过。
  - 也解释了 M1 记录的“隐藏窗口里 rAF 约每秒一次”。T-EXP-5 的测试闸门做法保留，它本来就不依赖时序。
