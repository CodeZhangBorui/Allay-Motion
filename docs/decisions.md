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

## M5a 悦灵的模型、四个动作和烘焙

M5 拆成两半：M5a 只做依赖 M1 的三项（模型、动作、烘焙）；React 组件、出场编排、启动画面、把图标接进 electron-builder 留给 M4/M5 后半。

### 来源规则变更：悦灵用原版贴图（用户决定，经主控转达，2026-11-13）

- 用户原话：“**拿原版贴图，我担责**”。这取代 `07` 7.3 的“自行建模、自行绘制，不得使用游戏 jar 里的任何像素”。同时沿用 M2a 的“禁止自己画材质”：没有 `allay.skin.ts` 那种字符网格加调色板的自绘贴图，7.3 的调色板表不再使用。
- **贴图不进仓库**：`pnpm mascot:bake` 烘焙时才从原版 jar 里读 `assets/minecraft/textures/entity/allay/allay.png`，只在内存里解码。来源顺序：本机已装游戏（复用 `vanilla.ts` 的探测，`--game-dir` 可指定）→ 应用的下载缓存（`%APPDATA%\AllayMotion\vanilla-cache`，离线）→ 只有显式加 `--download` 时用 `download.ts` 从 Mojang 官方服务器取（白名单、校验与应用相同）；都没有就报错并提示这两个参数。jar 和贴图都不复制到任何地方。
- **烘焙产物是原版贴图的派生图像**（图集、头像、应用图标、联络图、评审 APNG）：写进被 git 忽略的 `packages/mascot/generated/` 和 `docs/review/M5a/out/`，**不提交**。按用户决定，这些派生图像**会进安装包**（M4/M5 后半接入时）。这是对硬性规则第 1 条“不把 Mojang 的任何文件放进安装包”的一处明确例外，边界是：仓库里没有、测试夹具里没有，只在本机烘焙后由打包带走。
- **这加重了发布前的 H-BRAND**：除了“用游戏角色做产品图标和品牌”本身，现在安装包里还带着由原版贴图派生的图像（包括应用图标）。**请主控把这一条列入发布清单**，与 M2a 的 H-DOWNLOAD 一起在任何对外发布之前由人核对 Mojang 的使用准则和最终用户许可协议。
- 因此 **T-ALY-7 的判定改为**：`packages/mascot` 里没有任何提交进仓库的图片文件；产物目录被 git 忽略；全部产物都能由 `pnpm mascot:bake` 重新生成。`packages/mascot` 的导出（`src/atlas.ts`）只有常量和类型，不导入任何产物，所以产物缺失时类型检查和测试照常通过。构建在产物缺失时怎么报错或占位，留给 M4 接入组件时处理（这次没有改构建）。
- 闭眼版头像：原版贴图没有闭眼的样子。做法是从原图派生、不画新像素：在头的正面里找出眼睛（接近白色的像素），每列只留最下面那个，上面的换成同一行里最近的非眼睛像素，效果是眯眼。是否可接受，交给 H-ALY。

### 模型

- 几何写在 `packages/mascot/model/allay.model.ts`，按原版悦灵模型的布局（凭记忆）写，并对照本机 1.21.1 的贴图核对过展开区域：头 5×5×5（贴图 0,0，正面 5–10 × 5–10，两只 1×2 的白眼睛）；身体 3×4×2（0,10）外加缩小 0.2、高 5 的半透明下摆（0,16，alpha 160）；手臂 1×4×2（23,0 与 23,6）；翅膀是宽为 0 的一片 0×5×8（16,14，只有一面有像素，左翅镜像）。7.3 表里“手臂 1×3×1、翅膀 0.5×5×4”的尺寸是自绘版本的起点，以对上原版贴图为准。烘焙后看过联络图：眼睛在脸上、翅膀用的是翅膀那块、下摆在身体下面。
- 盒子展开和各面的贴图坐标照游戏的做法（上下面一行，西、北、东、南四个侧面一行；镜像时左右对调、贴图水平翻转）。所有面双面渲染（游戏的半透明实体也不剔除背面）；不透明部分用 alphaTest 0.5，半透明下摆单独一层、不写深度、后画。
- 原版的翅膀像素是不透明的，所以翅膀不是 7.3 说的“半透明”；照原版贴图画。
- root 的枢轴从脚下（23.5）挪到身体顶部（19.5），子部件位置相应换算，几何不变；这样“前倾”“摇摆”绕身体转。

### 动作与取景

- 动作在 `allay.motions.ts`：每个动作里所有频率都是“1 / 时长”的整数倍（hover 翅膀 4 Hz × 1.5 s = 6 次，fly 7.5 Hz × 0.8 s = 6 次，dance 一圈加两个来回），所以 `pose(t) = pose(t + 时长)`，末帧的下一帧就是首帧。渲染时 N = 1（不加运动模糊：子帧时间会被钳在 `[0, duration]`，首帧会因此不对称，破坏首尾无缝）。
- 骨架数学（`allay.rig.ts`）自己做 4×4 矩阵，不依赖 three 的运行时：内部模板在 Worker 里用它摆姿态，烘焙脚本在 Node 里用同一份代码算 `handAnchor`，两边结果一致。
- 明暗不用 three 的灯光（物理单位下强度换算容易出偏差）：每帧按面的世界法线算一个亮度（环境 0.58 + 左上前方一盏平行光），写进顶点颜色乘到贴图上。头像不加明暗，正面就是贴图本来的颜色。
- 取景：正交相机，悦灵朝右并朝镜头转 28°（绕竖轴 62°），俯角 8°；所有动作共用一个取景，身体在画面正中。半边长 11.5 模型像素，来自全部动作全部帧的包围盒（dance 转圈时翅膀会扫到两侧）；T-ALY-1 另查了每帧都不贴边。
- 头像用正面正交投影，整数倍放大且左上角对齐整像素（`headFraming`），小尺寸也不糊。应用图标里头像约占 70%，同样整数倍。

### 烘焙

- 内部模板 `allay.internal.mascot`（`packages/mascot/model/allay.internal.mascot.ts`）只有类型导入；烘焙时用 Vite 的库模式把它连同模型、动作、骨架打成一个不含 import 的 ESM 字符串，交给应用同一份 `EngineHost.load`（同样过 es-module-lexer 的源码检查、同样的 Worker 和看门狗）。引擎没有改。
- 渲染在不显示的 Electron 窗口里（做法照 test:engine：`show: false`、`skipTaskbar`，带与应用相同的 CSP，外部请求一律取消），由 Playwright 的 `_electron` 驱动，帧以直通 alpha 的 RGBA 交回 Node。每次烘焙把渲染页打包到一个临时目录，可以并行。
- PNG、APNG、ICO 的编码和 PNG 解码自己写（`scripts/mascot-bake/png.ts`，只用 Node 的 zlib），没有新依赖。编码确定：每行按固定的启发式选滤波，不写时间戳。ICO 里放 16–256 七个尺寸的 PNG；`icon.icns` 没做（v1 只做 Windows）。
- 产物：`allay-288.png`、`allay-96.png`（13×13 网格，159 帧）、`allay.atlas.json`（比 7.3 的样例多了 `frames` 和 `sizes` 两个字段）、`allay-head-{16,20,24,32,48}.png` 及 `-closed` 版、`icon-{16…1024}.png`、`icon.ico`。7.3 写的 `scripts/make-icons.ts` 合并进了烘焙脚本（图标要用引擎渲染的头像）；联络图从 `docs/review/mascot-contact-sheet.png` 改到被忽略的 `docs/review/M5a/out/`，因为它是派生图像、不能提交。
- 本机实测：一次完整烘焙约 25 秒；同一张贴图两次烘焙全部产物逐字节相同（T-ALY 测试里自动比较）。

### 测试

- `tests/unit/T-ALY.mascot-bake.test.ts`（在 `pnpm test` 里）：用测试时生成的假贴图（按各盒子的展开区域填纯色色块，只是测试数据，不落进仓库）并行跑两次完整的 `pnpm mascot:bake`，检查 T-ALY-1（帧数、尺寸与 `atlas.json` 一致；锚点每帧一项；每帧有内容且不贴边；每个动作“末帧到首帧”的差 ≤ 相邻帧差中位数的 1.5 倍，两套尺寸都查）、确定性、ICO 结构、T-ALY-7（改过的判定）。不访问网络、不读本机游戏。
- 没有新增 `pnpm check` 的步骤（根 `package.json` 只改了 `mascot:bake`）。

### 没做的、没验证的

- 没做：React 组件、出场编排、启动画面、图标接进 electron-builder、构建时缺产物的报错或占位（M4/M5 后半）；`icon.icns`。
- `packages/mascot/model/` 不在 `eslint.config.js` 的 mascot 依赖方向规则覆盖范围内（规则只管 `src/`），这次没有改 eslint 配置；model 里的文件只导入同目录文件和 template-sdk 的类型。
- 模型布局凭记忆写成，只用本机 1.21.1 的贴图对照过；没有和游戏里的实际渲染逐像素比较。
- H-ALY 待人确认：悦灵的样子、动作是否自然、首尾是否无缝、闭眼版是否可接受（材料见 `docs/review/M5a/README.md`）。7.10 要求的 A、B、C 三段编排录屏属于 M5 后半，这次交的是四段动作本身的 APNG。

## M3 模板系统

### 版本与依赖

| 项 | 版本 | 许可 | 说明 |
|---|---|---|---|
| esbuild | 0.28.2 | MIT | 根目录 devDependency，只给 `pnpm templates:build` 和 test:engine 的打包用，不进安装包。装的是工作区里已有的版本（Vite 的依赖），离线安装 |

没有引入 semver、zip 写入库：版本范围（`template-sdk/src/semver.ts`，只支持精确、`^`、`~`、比较符、`x`/`*` 和空格连接）和确定性的 zip 写入（`apps/desktop/src/main/templates/zip-writer.ts`，Node 的 zlib，时间戳固定）都自己写。template-sdk 只能依赖 zod（1.4）。

### manifest 与参数（4.3、4.4）

- schema 在 `packages/template-sdk/src/manifest.ts`，类型从 schema 推出；顶层和参数定义都是 looseObject（未知字段保留但忽略）。schema 之外的检查（都给出具体字段路径）：参数 key 不重复；默认值本身合法（在 `[min, max]` 内、在选项里、颜色没开 alpha 不能带 alpha、text 不超过 `maxLength` 等）；`group` 指向存在的分组；`visibleWhen.key` 指向存在的其他参数；`timeline.segments` 指向 `duration` 参数。**脚本模板必须有 `params`，派生模板不能有 `params`、`timeline`，只有派生模板能有 `overrides`**（规格只说“脚本模板必需”“派生模板用”）。
- 迁移框架（`migrate.ts`）：`{ current, steps: { n: n → n+1 } }`，更高的格式版本拒绝（`format-too-new`，提示升级应用），更低的按链升级后再过 schema。manifest 和预设的迁移表现在都是空的（只有格式版本 1）；T-TPL-1 用一张假的三版迁移表测框架。
- 参数清洗（`params.ts` 的 `sanitizeParams`，引擎和界面共用）规格没写细的地方：
  - `integer`、`seed`：带小数的数字先四舍五入再钳制；`seed` 钳制到 `[0, 2³¹−1]`。
  - `angle` 没有上下限：折回 `[0, 360)`。
  - `color`：统一成大写；没开 `alpha` 时去掉 alpha 通道（而不是回到默认值）。
  - `text`：超过 `maxLength` 按码位截断。多语言默认值按 `locale` 取（缺省英文），之后就是普通字符串。
  - `blockList`：形状不对的条目丢掉，缺权重的取 1，权重钳制到 `[0, 1000]`，超过 `max` 截掉；清洗后为空或权重全为 0 时回到默认值。
  - `easing`：贝塞尔的 x1、x2 钳制到 `[0, 1]`，y 不限。
  - 资源 ID（`block`、`item`、`sound`、`texture`）：`命名空间:路径`，路径里不能有空段、`.`、`..`，命名空间不能是 `asset` 或 `file`（T-TPL-2 抓出来过 `asset:../x.png` 被当成资源 ID 放过去）。`texture` 另外接受空串、`asset:<安全的相对路径>`，以及 `allowFile` 时的 `file:<主进程签发的 UUID 引用>`（不接受路径）。
- **引擎在 `load`/`setParams` 时用同一个函数清洗参数**（manifest 有参数定义时）：`ctx.params` 总是完整的一组。`LoadRequest` 多了可选的 `locale`。`ctx.random` 的种子取第一个 `seed` 类型参数（规格：“模板有 seed 参数时”），不再按键名 `seed`。
- 测试模板（test:engine、e2e 的钩子、悦灵的内部模板）现在也都在 manifest 里声明了自己用到的参数。

### 模板包、安装与卸载（4.2、4.8）

- **安装分两段，IPC 比 1.8 多出 `commitInstall`、`cancelInstall`**：主进程做第 1–3 步并把包解压到 `userData/templates/.staging/<uuid>/`，返回暂存 ID 和装载需要的 manifest、代码；渲染进程在杂务 Worker 里试运行（第 4 步）后调用 `commitInstall(暂存 ID, { warnings })`，主进程把暂存目录改名为 `templates/<id>/<version>/`（第 6 步）。渲染进程交来的只有暂存 ID 和枚举值的警告，路径全由主进程决定（1.6 第 6 条）。暂存 10 分钟不提交作废；启动时清空暂存区。同 id 同版本再装一次是替换。
- 第 1 步：包 ≤ 50 MB；zip 读取复用 `resources/zip.ts`（任何不安全的条目名整包拒绝）。另加：单个条目解压后 ≤ 50 MB、全部条目 ≤ 200 MB、≤ 2000 个条目；**zip.ts 跳过的任何条目（过大、加密、重复）都让整个包被拒绝**，不装一个缺了东西的模板。扩展名白名单照 4.8。
- 错误码：`not-a-zip`、`package-too-large`、`unsafe-path`、`bad-extension`、`unpacked-too-large`、`manifest-missing`、`manifest-invalid`、`format-too-new`、`app-too-old`（`minAppVersion`）、`reserved-id`、`base-missing`、`base-not-script`、`code-missing`、`derived-has-code`、`code-too-large`、`code-has-import`、`code-syntax`、`trial-failed`、`staging-expired`。界面按错误码显示两种语言的文案，后面附英文细节（出错的字段或条目）。
- 安装元数据（试运行的警告、安装时间）放在 `templates/<id>/<version>.meta.json`，不放进版本目录，免得和包里的文件重名。
- **试运行（第 4 步）**：320×180、manifest 的 `defaultOutput.fps`（没有时 60）、标准画质（N = 8、180°）、默认参数；渲染剪辑点那一帧（没有剪辑点时取中间一帧）、首帧、末帧，再把第一帧重新渲染一次比较字节（2.4 的确定性自检）。装载或渲染失败（含看门狗）拒绝安装（`trial-failed`）；不确定、首末帧不透明、剪辑点不是完全不透明、装载有警告，只记为警告（`nondeterministic` 等），仍允许安装。M3 的最小模板列表在条目上标“预览与导出可能不一致”；完整的卡片标注在 M4。
- **第 5 步（封面和悬停预览）留到 M4**：它们属于模板库卡片（6.4），M3 没有卡片。
- **内置模板**：`resources/templates/<id>-<version>.allaytpl`，启动时读进内存（经同一个 `readPackage`，跳过第 1、3 步，manifest 照样校验，不检查 `allay.` 前缀）。**启动时不对内置模板试运行**：冷启动有预算（T-ARC-7），而内置模板的同一组检查由 T-TPL-3、T-TPL-4 在 CI 里做。内置模板不能删除，用户模板不能用 `allay.` 前缀，所以两个来源的 id 不会冲突。
- 卸载：只删用户模板（版本目录和元数据，最后一个版本时连 id 目录）。依赖它的派生模板保留，列表里标 `baseMissing`、不能选；预设本来就按 id 记模板，不受影响。正在用的模板被删时换回 T1。
- 导出（`exportPackage`）：把包内容重新打成 `.allaytpl`，经主进程的保存对话框写出。

### 派生模板与预设（4.7）

- 基模板取“已安装的、满足 `extends.version` 的最高版本”；它本身是派生模板时 `base-not-script`。装载时（`resolveDerived`）覆盖的默认值经参数清洗：越界钳制、类型不对回到基模板的默认值、不认识的键丢弃；`hidden` 里不认识的键忽略。交给引擎的是“生效 manifest”：派生模板的 id 和名称 + 基模板的参数定义（套上覆盖）和时间段，没有 `extends`。代码来自基模板。
- `asset:` 引用先找派生模板自己的 `assets/`，再找基模板的。渲染进程给每个引擎宿主一个按模板取图的 `resolveResource`（`createResolver`），交给引擎的 `resourceStamp` 带上模板（`<资源栈 stamp>|<id>@<version>`），换模板时引擎清空贴图缓存，同名的 `asset:logo.png` 不会串。试运行时按暂存 ID 读暂存包里的图。`file:` 引用经 `files.read(ref)` 读（引用只来自主进程的对话框）。
- **另存为派生模板多一个 IPC `templates.saveDerived`**（规格把它放在属性面板底部的弹窗里，界面在 M4）：id 是 `user.<6 位随机十六进制>.<名称转成的 slug>`，版本 `1.0.0`，`extends` 写成 `^<基模板版本>`。M3 不支持在另存时带上图片（`file:` 参数转成 `asset:`），这要等 M4 的弹窗。
- 预设：`userData/presets/<32 位十六进制>.allaypreset`。渲染进程按参数定义去掉与默认值相同的项（text 与任一语言的默认值相同都算没改），主进程再按 schema 校验一次后写入。套用时：预设记的版本还在就用它，否则用同一个 id 的最高版本，参数经清洗（多的丢弃、缺的补默认值）。导入、导出经主进程的对话框。预设的界面在 M4，M3 经测试钩子覆盖。

### templates:build（4.9）

- `scripts/build-templates.ts`：esbuild 把 `src/index.ts` 打成单文件 ESM；**本目录以外的导入（包括 `three` 和 template-sdk 的运行时）一律留作外部**，随后被 es-module-lexer 的检查（与安装时同一个函数，`apps/desktop/src/shared/template-code.ts`）拒绝，所以内置模板在构建时就不可能夹带依赖。lint 另有一条依赖方向规则（M0 已有）。产物逐字节确定。
- 根 `pnpm build` 和 `pnpm dist` 先跑 `pnpm templates:build`；electron-builder 把 `resources/templates/*.allaytpl` 作为 `extraResources` 带进安装包。
- test:engine 的测试页用同一个打包函数现场打包内置模板（Vite 插件 `virtual:builtin-templates`），测的就是装进 `.allaytpl` 的那份代码。Vite 的配置加载器默认不能跟着配置文件导入仓库里没有扩展名的 TS 源码，test:engine 改用 `vite build --configLoader runner`。
- M1 的 `packages/templates/m1-block-wipe/` 和渲染进程里 `?raw` 的装载路径已删除；应用启动时经 `templates.list` / `templates.read` 选旗舰模板。

### T1 方块擦除

- 全部 16 个参数照 4.10；分组：方块、动画、时间、音效（折叠）。manifest 里不写 `author`（硬性规则第 9 条：产品名只在品牌目录）。
- **时间余量（M1 发现的规格问题）**：按 4.10 的公式进入阶段从 `t = 0` 开始，开了运动模糊时首帧就有内容。T1 的做法和 M1 的临时模板一样，但把剪辑点也算进去，记 `pad = 1/fps`：
  - 进入阶段的局部进度用 `[pad, min(inDuration, cutTime − pad)]`，退出阶段用 `[max(inDuration + hold, cutTime + pad), duration − pad]`，公式的其余部分不变。
  - 理由：子帧最多偏离帧时刻 ±0.5/fps（快门角 360°）；剪辑点那一帧（`round(cutTime × fps)`）离 `cutTime` 最多 0.5/fps。所以 `[0, 1/fps]` 和 `[duration − 1/fps, duration]` 里画面全空，`[cutTime − 1/fps, cutTime + 1/fps]` 里全满，**任意画质、0–360° 快门角**下首末帧最大 alpha 为 0、剪辑点最小 alpha 为 255（T-TPL-4 随机了画质和快门角）。`hold` 大于 2/fps 时（默认 0.1 s），只有首尾各被压缩了一帧，与规格公式的差别看不出来。
  - 局部进度到 1 时直接取 1（不经浮点误差落在 0.9999…），缓动在 0 和 1 处取精确的 0 和 1。
  - 帧率极低（一帧比半个阶段还长）时余量做不到，退回各阶段的一半，保证时间窗不为空；这时首末帧可能不透明，试运行会给出警告。
  - 没有在引擎里做任何特殊处理。
- 图案（规格只给了名字）：`leftToRight` 等取格子中心的归一化坐标；`centerOut` 是到舞台中心的距离除以半对角线（圆形，三种画幅都自然），`edgesIn` 是它的反面；`diagonal` 是 `x + y`（左上到右下）；`random` 用 `ctx.random`；`noise` 是 `ctx.noise2D(x / 420, y / 420)`（设计单位）。先把原始值归一化，再加 `jitter × 随机数`，再归一化。`outPattern` 的 `same` 是“先出现的先消失”，`reverse` 是 `1 − u`。
- 每个格子按权重随机分配一种方块（`ctx.random('blocks')`），每种方块一组实例。`flat` 用默认的正交相机、不加面明暗（`shading: false`）；`3d` 用 fov 30 的透视相机和面明暗。`spin` 的轴：`flipX` 是 x 轴、`flipY` 是 y 轴、`twist` 是 z 轴。
- 剪辑点完全不透明的前提是方块不透明。用户选了玻璃这类半透明或镂空的方块时剪辑点本来就盖不满；T-TPL-4 的随机参数只从目录里不透明的方块里挑。
- 音效：按顺序值排序后均匀取最多 12 个方块，在它们开始动的时刻放 `placeSound`/`breakSound`，增益 `volume`。音频的调度和混音在 M6。

### 引擎里两处确定性问题（T-TPL-3/4 发现）

T1 的 T-ENG-1（顺序渲染和乱序渲染逐字节相同）一开始不稳定。查清了两个与模板无关的根因，都在引擎里修掉：

1. **多重采样 resolve 不是逐位可复现的**。现象：1080p、标准画质下第 43 帧每次渲染在两个结果之间随机跳（同一个 Worker 里也一样）；差的是 8 个像素的绿色通道 127/128，这 8 个像素在一条竖直的边上，两种颜色的子样本各占一半，线性值恰好落在取整边界上。只在开了 MSAA 时出现：把 sceneRT 的 MSAA 关掉、或者子帧时间全相同（快门角 0），都不再出现；8 位的预览画布也看不出来。结论是 NVIDIA/D3D11 上多重采样缓冲的硬件 resolve 在最低位上不稳定（试过 RGBA32F 的 MSAA 缓冲和 `invariant gl_Position`，都只是换了出问题的帧）。**修法：sceneRT 改用 2×2 超采样（RGBA16F，不带 MSAA），在累积着色器里按固定顺序把 2×2 个像素平均**，结果只取决于输入。规格 2.6 写的是“MSAA 4×”，这是偏离：显存与 MSAA 4× 相同；片元着色多 4 倍，我们的材质都很简单；纹理边缘和抠图边缘也一并抗锯齿。输出的两倍超过显卡的最大尺寸时退回 1×（不抗锯齿）。`N = 1` 也经过累积通道（权重 1）。T-ENG-2 至 T-ENG-5 照原判定通过。
2. **InstancedMesh 的包围球在第一次渲染时按当时的实例矩阵算出并缓存**，Three 的透明队列按它的中心排序。几组实例（几种方块）之间的绘制顺序——以及深度相等的面谁胜出——就取决于这个 Worker 先渲染了哪一帧：同一组随机参数下，先渲染第 0 帧和先渲染第 10 帧的 Worker 从第 28 帧起结果不同（各自稳定）。**修法：实例的包围球固定在原点**（`frustumCulled` 本来就关着）。
- 修完后：T1 全部帧在三种画幅、N = 1/8/16 下各渲染 5 次全部一致；T-TPL-3 连跑 3 次、T-TPL-4（50 组）全部通过。M1 的 T-ENG-1 在 720p 下一直通过，是碰巧没有落在取整边界上的像素。

### 测试的做法

- T-TPL-1、T-TPL-2：`tests/unit/`，manifest 合法夹具 11 个、非法 26 个，每个非法夹具断言错误路径；15 种参数类型各测默认值、合法值、越界、错类型、缺失。
- T-TPL-6、T-TPL-7、T-TPL-8：主进程的 `TemplateService`、`PresetStore` 在 `tests/unit/` 里对着测试时生成的包测（内置模板用 `buildTemplates` 打到临时目录）；e2e（`tests/e2e/m3.spec.ts`）再走一遍界面路径：经真实的文件输入框拿到带路径的 `File` 安装、试运行、派生模板的自带图片画在预览里、预设往返、删除基模板。
- T-TPL-3：test:engine，三种画幅的全分辨率（1920×1080 等）、60 fps、标准画质、默认参数；T-ENG-1 是全部帧顺序渲染一遍、在另一个新 Worker 里乱序渲染一遍。
- T-TPL-4：50 组随机合法参数（固定种子的伪随机数），画幅轮换，每组随机帧率（24/30/60）、画质（N = 1/2/4/8/16）、快门角（0–360，每 5 组有一组 360°）；为了在合理时间内对每组做完整的 T-ENG-1，分辨率是全分辨率的 1/8（如 240×135）。本机约 40 秒。
- T-TPL-5：基准图在 `tests/fixtures/baselines/<模板 id>/`，三种画幅（640×360、360×640、480×480）各五帧，标准画质。**用 test:engine 的纯色假资源栈渲染，不含任何原版贴图**。`pnpm templates:baselines` 重新生成。比较全部通道的平均绝对误差；渲染器名字里有 SwiftShader 等软件渲染器时放宽到 4/255。
- **来源登记多了一种 `origin: rendered`**：基准图由脚本在显卡上渲染，能重新生成，但不同显卡的输出不逐字节相同，不能用 `generated` 的逐字节比对。`rendered` 的记录必须写一个存在于 `package.json` 的生成命令，且只能覆盖测试夹具目录下的文件。
- 测试钩子新增：选模板、改参数、装模板包（`File`）、删模板、存取预设、调短试运行的看门狗、`previewUpToDate`（预览装载了工程的最新一版且就绪：改参数之后旧的“就绪”状态还会留一会儿，e2e 不能只看状态）。
- M1、M2 里引用临时模板的测试（T-ENG-*、T-EXP-7、预览、资源栈）都改用 T1，判定不变；T1 的默认参数下时长 1.1 秒、剪辑点 0.55 秒，与临时模板相同。

### 没做的、留给 M4

- 模板库卡片、封面和悬停预览（4.8 第 5 步）；由参数定义生成的属性面板（M3 只经测试钩子改参数）；“另存为模板”的弹窗（含把用户选的图片带进派生模板）；预设的界面。M3 的左栏只是一个最小的模板列表加“导入模板…”。
- 主进程对话框的几条路径（`install`、`exportPackage`、`presets.importFile`/`exportFile`）没有 e2e：测试窗口不显示，弹对话框会卡住；它们背后的服务方法有单元测试，拖放安装有 e2e。

## M4 界面

### 版本与依赖

| 项 | 版本 | 许可 | 用在哪里 |
|---|---|---|---|
| cmdk | 1.1.1 | MIT | 命令面板（shadcn 的 Command） |
| sonner | 2.0.8 | MIT | 通知 |
| react-colorful | 5.8.1 | MIT | 取色区域 |
| @tanstack/react-virtual | 3.14.26 | MIT | 方块/物品选择器的虚拟滚动 |
| @dnd-kit/core、sortable、utilities | 6.3.1 / 10.0.0 / 3.2.2 | MIT | 资源栈拖拽排序 |
| motion | 14.13.0 | MIT | 规格列出的界面动效库；M4 的动效都用 CSS 过渡和一个 rAF 循环做完了，依赖已装、暂时没有调用（M5 的悦灵编排再用） |
| zundo | 2.3.0 | MIT | 撤销重做 |
| axe-core | 4.14.0 | MPL-2.0 | **只是根目录的 devDependency**，T-UI-5 在测试里注入页面；不进安装包，许可检查只看生产依赖 |

没有引入 GSAP、Theatre.js。shadcn 的组件（Dialog、DropdownMenu、ContextMenu、Popover、Tabs、Select、Switch、Slider、ScrollArea、Badge、Input、Textarea、ToggleGroup、Collapsible、Command、Sonner）照 shadcn 的写法在 Base UI 上手写进 `packages/ui/src/components/ui/`，没有再跑 shadcn CLI（它要联网取注册表）。

### 范围变更带来的偏离

- **预览视口的“示例素材”背景禁用**：两张原创示意图原属 M6，范围变更后不自己画。分段控件里这一项禁用，悬停说明原因；工程文件里记成 `sample` 的按棋盘格显示。**留给主控和用户决定**（换成用户自己的图片、或者去掉这个模式）。
- **悦灵五个组件是占位实现**：`Allay`、`AllayHead`、`AllayLoader`、`AllayProgress`、`AllayEmpty` 的接口按 7.4 定稿，外形是 CSS 几何形状（方块的头、两只眼、椭圆翅膀），不读烘焙产物、不画新图。加载时序（`packages/mascot/src/timing.ts`）、飞舞路径（`flight.ts`，7.6 A 的公式）、光、拖尾、退场时内容依次淡入、减少动效的静止表现都已经是正式逻辑。已经放进去的位置：模板库（首次加载、封面重建）、预览视口（装载）、“我的”空状态、错误卡片（sad）、导出进度、拖放、首次发现游戏的对话框、顶栏头像、关于页。方块选择器的缩略图（7.5 第 4 项）只有骨架，没有飞舞。“同一时刻只有一只全身悦灵”（T-ALY-3）没有做全局协调，属于 M5。
- **像素字没有用**：6.2 的像素字（字标、空状态标题、导出完成标题）需要一份网页可用的像素字体；方舟像素字体在仓库里只有 BDF（主进程解析给引擎用），没有转成网页字体。这几处现在用界面字体。M5 或 M8 决定是否把方舟像素字体的 OTF 也引入。
- **字标**：顶栏左侧是悦灵头像占位和 `brand.wordmark`（两种语言都是 “Allay Motion”）。

### 规格没写清、选了更简单的做法

- **T-ALY-2“就绪后 300 ms 内退场完毕”与“至少停留 500 ms”**：300 ms 的加载在 180 ms 出现，要停到 680 ms，再加 260 ms 的退场，离“就绪”有 640 ms，两条字面上冲突。按 7.6 A“内容就绪且已显示满 500 ms 后，悦灵用 260 ms 飞出”理解为：退场在“可以离开”（就绪与显示满 500 ms 中较晚的那个）之后 300 ms 内完成。3 s 的加载就是就绪后 260 ms。
- **AllayLoader 在 holding 阶段继续显示加载时的子内容**（骨架），退场开始时才换成真正的内容；不到 180 ms 就结束的，这段时间子内容占着布局但不可见。预览视口的加载层整层 `pointer-events: none`。
- **只改参数时预览走 `setParams`**：模板、输出、资源栈都没变、上次装载成功时，不重新装载代码，也不进入“装载中”状态（拖滑块时不会闪加载编排）。同一时刻最多一个在途的装载或改参数；新的工程版本在它完成后再来一次，每个动画帧最多发一次（1.7）。
- **撤销**：zundo 只记模板和参数。连续操作（ScrubNumberField 的拖动区、滑块、取色区域、贝塞尔控制点、方向盘、时间轴分界线）在指针按下时暂停记录并记下按下前的状态，在 window 上等到松开时补一条。text 参数失焦或回车时才提交（不是每个按键一条）。撤销后换了模板时预览整个重新装载。新建、打开工程和启动时的默认工程清空历史，也不算“未保存的改动”。
- **复制值、粘贴值**：用应用内的剪贴板，只在参数之间用（同类型才能粘贴，粘贴时经参数清洗）。系统剪贴板的异步 API 要权限，1.6 第 4 条拒绝一切权限请求，不放宽。“复制诊断信息”用一次性的选区复制（`execCommand('copy')`），不需要权限。
- **enum 的分段控件**：4 项以内，但选项文字放不下（总宽超过约 24 个半角字符，中日韩字符按 2 计）时也用下拉，不把选项截成 “Fli…”。
- **时间码**：`秒.帧`（6.4），例如 60 fps 下 `00:00.36` 是第 0 秒第 36 帧；帧号在时间码下面一行（窄窗口下给时间轴留出宽度）。
- **模板封面和悬停预览**：杂务 Worker 用默认参数、320×180、30 fps、草稿画质（N = 1，封面只是缩略图，不加运动模糊）渲染，最多 4 秒。封面是剪辑点那一帧（没有剪辑点取中间一帧）；悬停预览是全部帧排成 8 列的网格图，悬停时按 30 fps 画到一块小画布上。按 resourceStamp 存进 `cache/thumbs/`（键 `cover_<id>_<版本>` 和 `…~sheet`），资源栈变化后全部作废重建。缓存的 PNG 上限从 1 MB 放宽到 8 MB（网格图大）；超过 8 MB 的网格图只留在内存里。磁盘缓存不记帧数，按格子数播放，末行多出的空格是全透明帧。
- **模板库的骨架**：只在模板列表还没取到、或者资源栈变化后一张封面都还没有时显示（骨架 + 悦灵）；之后单张封面没好时那张卡片是骨架块。
- **设置对话框“导出”页的“默认输出设置”改的是当前工程的输出设置**（与播放条的输出规格弹层是同一个表单），没有另设应用级的默认值；新建工程用 1920×1080、60 fps。“重新检测编码器”按钮禁用，编码器探测在 M7。
- **关于页的“第三方许可”**只列了几行概述；完整的许可页面在 M8。
- **最近的工程**：`userData/recents.json`，最多 10 个；渲染进程拿到的是这次运行里的不透明 id、文件名和所在文件夹（只用于显示），打开时由主进程按 id 找路径。打不开的从列表里去掉。
- **未保存的改动**：新建、打开时先弹确认（“放弃改动”）；退出应用时没有拦截（M8 再定）。
- **工程里的 `export` 字段**：记最小导出对话框里选的格式和画质；快门角固定 180°（M7）。
- **工程引用的模板版本不在了**：用同一个 id 的最高版本打开（与预设一致）；id 都没有时打不开并说明缺哪个模板（1.9）。
- **音效**：SoundField 的下拉列出 3.8 的 11 个事件；试听按钮禁用（M6 接上）。静音开关只记状态。

### IPC

- 新增 `project` 命名空间：`open`、`openRecent(id)`、`save(handle | null, data)`、`saveAs(data)`、`recents`。**没有 `create`**：新建工程只是渲染进程里的状态，不碰文件。工程用主进程签发的句柄表示；`save` 收到没签发过的句柄就拒绝。`data` 是 strict 的 zod schema，多一个字段（比如 `files` 或路径）都拒绝。texture 参数里的 `file:<引用>` 由主进程在保存时换成 `files` 里的本机路径，打开时再签发新的引用（1.6 第 6 条）；找不到的图片对应的参数回到默认值并提示。
- `templates.saveDerived` 现在接受 texture 参数里的 `file:` 引用：主进程按引用读出图片（只认 PNG、JPEG、WebP 的文件头，单张 ≤ 16 MB），复制进派生模板的 `assets/<参数 key>.<扩展名>`，默认值改成 `asset:` 引用。读不出来时返回 `image-unreadable`。
- `settings.set` 多了 `editor`（预览背景、纯色、参考线、缩放、高质量预览、静音、分组折叠、最近使用），每个字段都有 schema 和上限（最近使用每类 12 条，分组折叠最多记 200 个模板）。读取时坏掉的字段回到默认值。
- T-ARC-6 的畸形参数表补了 `project.*` 五个方法和 `settings.set`、`templates.saveDerived` 的新情形。
- 测试开关 `ALLAY_E2E_PROJECT_PATH`（只在未打包时生效）：工程的打开、保存对话框不弹出，直接用这个路径。对话框本身的路径由服务层单元测试（`tests/unit/project-service.test.ts`）覆盖。

### 测试的做法

- **T-UI-1**：遍历 `templates.list` 里的全部内置模板（M4 时 main 上只有 T1；T2–T6 合入后自动覆盖），点卡片选中，读回预览画布确认非空；在属性面板的数字框里按上方向键改参数，比较改前改后剪辑点那一帧的像素哈希。
- **T-UI-2**：经测试钩子连续改 5 个参数（与控件走同一个 store 方法），Ctrl+Z 五次回到初始；然后用合成的指针事件拖一次“重叠”滑块，撤销历史只多一条，撤销一次回到初始。
- **T-UI-3**：只用 Tab、Enter、方向键、Ctrl+E：Tab 到模板卡片、Tab 到“列数”的数字框按上方向键、Ctrl+E 打开导出对话框、Tab 到“关闭”回车。每一步检查焦点元素（或它所在的控件）有 2 px 的焦点环。
- **T-UI-4**：两种语言各起一次，窗口内容区设为最小的 1120×700，依次打开主界面、设置的五页、命令面板、资源栈弹层、方块选择器、导出对话框、“我的”空状态。判定：i18next 的缺失键记录为空；界面文字里没有形如 `gallery.xxx` 的文案键；按钮、标签、标题等元素的内容不比盒子宽（有意截断的、带 `truncate` 和 title 的除外）。
- **T-UI-5**：截图基线在 `tests/fixtures/ui-baselines/`，由 `pnpm test:e2e:baselines` 在本机渲染（假原版层，纯色色块），登记为 `origin: rendered`。引擎画出来的东西（预览画布、封面、方块缩略图）随显卡不同，和会眨眼的悦灵头像一起蒙住；CSS 动画关掉；容差 1% 的像素。axe-core 经 DevTools 协议求值注入（CSP 不允许内联脚本，不为测试放宽），跑 WCAG 2.0/2.1 A、AA 规则：对比度问题必须为零，严重和关键级别的问题必须为零。
- **T-UI-7**：在“重叠”滑块上按住，3 秒里每 16 ms 移动一次，用 longtask 观察器记录长任务（它只记超过 50 ms 的），要求为零；整个拖动只产生一条撤销记录。
- **T-ALY-2**：纯逻辑用假时钟测（`tests/unit/T-ALY-2.loader-timing.test.ts`）；e2e 在真实界面里经测试钩子让预览视口“假装加载” 100 ms、300 ms、3 s，用 MutationObserver 在页面里记下 `data-allay-loader-phase` 和悦灵元素的出现、消失时刻。
- **T-ALY-5**：飞舞时取悦灵元素的中心点，`elementFromPoint` 不在加载层里，合成的点击落到下面的元素上。
- 工程的保存、新建、打开在 e2e 里经测试开关走通；未保存时新建会弹确认。
- M1 的 T-EXP-7 等改为点画质分段控件（原来是原生 `<select>`）；M2 的资源栈排序改为 dnd-kit 的键盘拖拽（聚焦手柄、空格、下方向键、空格）。

### 自己复跑时遇到的偶发失败（已查清）

- **M2 的资源栈排序（改成 dnd-kit 键盘拖拽后）**：完整 `pnpm check` 里一次失败、单独跑通过。根因：dnd-kit 在空格拿起之后才异步量各行的位置，量好之前到的方向键被忽略，空格放下时原地不动。测试改为等手柄的 `aria-pressed` 变为 true、再按方向键直到这一行真的有向下的位移才放下，不靠时序；改后单独连跑 5 次、完整 `pnpm check` 通过。真实用户按键之间的间隔远大于量位置的时间，不受影响。
- **T-ALY-2/T-ALY-5 首次运行失败**：启动时模板库正在生成封面（主线程上的 PNG 编码会推迟 React 的提交，模板库的加载编排里也有一只悦灵）。测试改为先等封面生成完、只看预览视口的加载层。T-ALY-3（全身悦灵最多一只）的全局协调属于 M5。

### 色板

- `palettes.ts` 的 16 种染料色和 16 种聊天格式色按记忆填写（Minecraft Java 版公开的 DyeColor 颜色和格式码前景色）。**联网核对没有成功**（minecraft.wiki 两次连接都断开），需要人对照可靠来源复核一次。

### 没做的、没验证的

- 7.5 的出场位置只接了一部分（见上）；四段编排的完整版、启动画面、T-ALY-1/3/4/6 属于 M5。
- “示例素材”背景（见上）。
- 导出对话框仍是 M1 的最小形态，只换了视觉；720×520 的完整三页在 M7。
- 退出应用时的“未保存”拦截；双击 `.allay` 打开（文件关联，M8）。
- 系统窗口按钮区的颜色和拖动区沿用 M0 的 T-UI-8 判定，没有在可见窗口里重新人工看过。

### 合入 T2–T6（M6a）之后的集成（分支 integrate/m6a）

- **T-UI-1 的取样点**：原来只在剪辑点那一帧（叠加层取中间一帧）比较改参数前后的哈希。转场在剪辑点“完全盖住画面”，平涂填充的模板（item-stinger）改节奏、图案、方向一类参数时这一帧不变，测试误判为“画面没变”。现在在整段的 20%、35%、50%、65%、80% 处加上剪辑点各取一帧，合并哈希比较；“改参数后画面必须变化”的判定不变，仍是从属性面板的数字框按上方向键改参数。画布非空取这几帧里最大的 alpha。测试给每个模板记一条注解，写明是改了哪个参数让画面变的。合并后六个内置模板逐个通过：方块擦除（列数）、方块坠落（“石头”的权重）、物品飞掠（物品大小）、像素溶解（格子大小）、进度提示（界面缩放；叠加层，没有剪辑点）、加载界面（亮度）。
- **T-UI-5 的基线**：模板库从 1 张卡片变成 6 张。核对差异图：两种主题里不同的像素都在左栏卡片区域（x 10–267、y 130–428，左栏宽 280），其余区域一致，于是用 `pnpm test:e2e:baselines` 重新生成。
- **T-UI-4 扩大到全部内置模板**：最小窗口下逐个检查卡片有封面、悬停时播放预览，选中后把属性面板的分组全部展开再查文字溢出。六个模板都通过，没有发现界面缺陷，也没有发现模板 manifest 的问题。之后的方块选择器检查要用 T1 的“方块”参数，所以循环结束后换回 T1。

## 人工确认记录

- **H-ALY（2026-11-13，用户确认）**：看过 `docs/review/M5a/out/` 的联络图和四段动作后，用户答复“还不错，要”——悦灵的样子和动作可以接受，闭眼（眯眼）版头像保留。M5 后半可以把悦灵接到全部位置。
- **H-M1**：待确认（导出的 MOV 在真实剪辑软件里的边缘、颜色、首尾）。
- **M2 的人工确认**（开关原版层时预览会变）：待确认。

## 发布前待人确认的事项（汇总，M8 写入 `docs/release-checklist.md`）

除 `docs/09-compliance.md` 9.11 带 ★ 的各项外，实现过程中新增：

- ★ **H-DOWNLOAD**：运行时从 Mojang 官方服务器下载客户端 jar 是否符合其条款（M2a）。
- ★ **H-BRAND 加重**：安装包带有由原版悦灵贴图派生的图集、头像和应用图标（用户决定并担责，M5a）。
- 打包产物里有 Electron 自带的 `resources/default_app.asar`（`electronDist` 指向已安装的 Electron 后带进来的），M8 打包时去掉。

## 界面重设计（“方块工作台”）

用户看了 M4 的界面后认为“和别的 AI 默认第一次跑出来的一模一样”（深蓝灰底、蓝色主按钮、圆角、细线图标、柔和阴影）。主控定了“方块工作台”的方向，这一节记录落实时的决定和偏离。只改视觉层和规格（`docs/06-ui-design.md` 6.1、6.2 与受影响的组件描述），不改功能、store、IPC、引擎、模板，没有增删文案键。

### 做法

- **缺角描边用外侧的四个零模糊投影画，不用 `clip-path`。** `clip-path` 会把外偏移 2 px 的焦点环一起切掉（T-UI-3）。四个只沿一个方向偏移 2 px 的 `box-shadow` 在盒子外面围出 2 px 的框，四角正好空出 2×2。斜面是盒子里的两条 inset，浮层的 `4px 4px 0` 硬投影沿缺角轮廓画（5 个偏移）。三部分各放在一个不继承的 `@property` 变量里，每个工具类都按同一顺序合成 `box-shadow`，所以 `blk`、`blk-raised`、`blk-float`、`blk-edge-ring` 可以任意组合。代价：描边不占布局，相邻控件之间要留 ≥ 2 px，滚动容器边上要有内边距（已逐屏检查）。
- **圆角**：Tailwind 的 `--radius-*` 全部为 0，`globals.css` 另有一条 `border-radius: 0 !important` 的全局规则兜住第三方组件（Sonner、react-colorful）的内置圆角；`backdrop-filter` 同样全局置空。`tests/unit/design-tokens.test.ts` 核对：圆角变量全为 0、`globals.css` 里所有 `box-shadow` 的模糊半径为 0、没有线性/径向渐变和 `blur()`。棋盘格仍用 `conic-gradient` 画硬边方格，这是图案不是渐变填充。
- **像素字的设备像素对齐**：方舟像素字体 12px 的字形是 12 像素见方的点阵。这台机器的显示缩放是 150%，固定 12 CSS px 会落在 18 个设备像素上、整体糊掉。`packages/ui/src/lib/pixel-scale.ts` 按 `devicePixelRatio` 把名义字号换算成让每个字形像素占 `round(dpr)` 个设备像素的 CSS 字号（150% 下 12→16、24→24；100%、200% 下不变），写进 `--px-12`、`--px-24`，缩放变化时更新。代价：150% 下像素字比名义字号大三分之一。评审图里的像素字都在这种情况下截取，放大看是锐利的 2 倍点阵。
- **字体文件**：选发布包里的 OTF 版 WOFF2（字形轮廓就是像素方块），zh_hans 一个文件 567 KB，放 `packages/ui/assets/fonts/`，由 Vite 当作资源打进渲染进程（`assetsInlineLimit: 0`，不内联成 data:），走 `font-src 'self'`。许可文件与仓库里的 `resources/fonts/ark-pixel/OFL.txt` 逐字节相同，后者已经随安装包分发。
- **像素字的使用范围**照任务说明，另外加上对话框标题（24）和弹层标题。参数标签、菜单项、说明文字、提示、对话框正文、搜索框输入用 Inter：这些是长短不一的句子，像素字在 150% 下会变宽，放不下。
- **图标**：全局 CSS 把 Lucide 的 `stroke-width` 改成 2.5、方头方角、`shape-rendering: crispEdges`；原来 14 px 和 12 px 的图标统一到 16 px。
- **动效**：`--dur-1` 60 ms、`--dur-2`/`--dur-3` 120 ms，界面上的过渡用 `steps(3, end)`；弹层和对话框不再缩放，只做分级透明度；骨架呼吸、悦灵占位的上下浮动和扇翅也改成分级。悦灵飞行仍用原来的曲线（它是角色动画，不是界面状态）。
- **系统窗口按钮区**比顶栏矮 2 px（`TITLEBAR_OVERLAY_HEIGHT = 38`），让顶栏下缘的 2 px 线通到窗口右边；颜色跟着新的 `--surface-1`、`--foreground`、`--background`。
- **导出对话框的格式单选**：原生单选框是圆的，改成 `appearance: none` 的方形凹槽（选中时内部平涂青色），仍是原生 `<input type="radio">`，键盘和读屏行为不变。

### 偏离任务说明里的起点色值（为了对比度）

- **描边分两种**：任务给的描边 `#4A4852` 对面板只有 1.7:1，达不到界面元素 3:1。控件和浮层的 2 px 描边用 `--input-border`（深 `#737080`、浅 `#857D71`，都 ≥ 3:1），`#4A4852`（浅色 `#A39B8E`）只给容器之间的分隔线和预览画面外框。
- **危险色**深色主题用 `#EC6146`（起点 `#D9472F` 在面板上只有 3.6:1，它要做正文）；浅色 `#B8321F`。成功、警告、紫水晶在浅色主题上也各取了更深的一档（见 6.2）。
- **次要文字**深色 `#AFA9A1`（起点 `#A8A29A`），让它在悬停的凸起面上也不低于 3:1。
- **浅色主题的青色文字** `--primary-text` 用 `#08627A`：起点 `#0E7F99` 在凹槽 `#DAD3C6` 上只有 3.1:1，而选中的分段和标签是“凹槽里的青字”。焦点环仍用 `#0E7F99`（≥ 3:1）。主操作按钮两种主题都是 `#43D3EA` 实心配 `#141216` 墨字。
- **浅色凸起面** `#FBF6EC`（起点 `#FFFBF3`）：亮缘是纯白，面太接近白色时亮缘看不出来。
- **预览视口四周**仍是无彩色的中性灰（深 `#0E0E0E`、浅 `#CFCFCF`），没有跟着暖紫：判断转场颜色需要中性的环境。

### 顺手修掉的视觉缺陷

- 分类标签页的“选中”样式一直没有生效：Base UI 1.9 的 Tabs 给选中项的属性是 `data-active`，组件里写的是 `data-selected`。改成 `data-active` 之后选中的分类才显示为按下去的凹槽（M4 的截图里四个分类看起来一样）。
- 中间栏很窄（最小窗口 1120×700）时，24 的时间码会把播放条右侧的高质量预览和静音按钮挤出去。用容器查询：中间栏 < 640 px 时时间码和帧号退成 12 的像素字、上下两行。
- 无素材引导卡片下移到 `top-16`，不再和变大了的视口工具条重叠。

### 跟着改的测试

- **T-UI-8**：窗口按钮区和顶栏的期望颜色换成新的设计变量。
- **T-UI-6**：分隔条从 1 px 变成 2 px 后，150% 缩放下拖到上限的左栏量出来是 360.01 px。改成按整像素比较（重启后恢复的那两条本来就允许 1 px 误差）。
- **T-UI-1**（合进 main 后已被 m6a 的多时刻取样取代，下面是当时的情况）：中间栏窄了约 3 px 之后，预览画布从 1185×667 变成 1182×665；在这个尺寸下“方块擦除”在剪辑点正好盖满整个画面，换任何参数那一帧都逐像素相同，测试只比剪辑点那一帧所以失败（M4 能过是靠画布边缘的取整）。改成同时比剪辑点和它之前一半处的那一帧，任一帧变了就算“画面变化”。判定的含义没变，只是不再依赖画布尺寸。
- **T-UI-5**：两种主题的截图基线重新生成；axe-core 零对比度问题。

### 悦灵占位

- 占位图形（CSS 几何形状）全部改成方角平涂；翅膀用 `--allay-light`。`Allay` 的 `glow` 参数保留在接口里（7.4），占位实现忽略它：界面禁止发光。加载编排里的柔光圈去掉了，只留空的定位层，飞行逻辑没动。`--allay-glow` 改名 `--allay-light`。

### 没验证的

- 只在 150% 缩放的这台机器上看过；100%、125%、200% 下的像素字锐度只由 `pixel-scale` 的单元测试保证换算，没有截图核对。125% 下 12 的像素字是 9.6 CSS px（12 个设备像素，物理尺寸和 100% 屏上一样），可能偏小。
- 系统窗口按钮区（titleBarOverlay）在评审图里看不到（截图只截页面），没在可见窗口里人工看过。
- 高对比度模式（Windows 的强制颜色）没有处理：`box-shadow` 画的描边在强制颜色下会消失。

### 第四版（定稿，2026-11-13）

上面“方块工作台”的各条决定已经作废：用户先要求调研专业剪辑、特效软件和开源同类工具，再由主控汇总出本产品的风格，确认了第四版（`docs/design-direction.md`、定稿稿 `docs/design/ui-direction-v4.png` / `.html`）。保留下来的只有与风格无关的部分：Tabs 选中属性改成 `data-active`、T-UI-1 同时比两帧、T-UI-6 按整像素比较、评审脚本 `scripts/review-ui-redesign.ts`、设计变量集中在 `globals.css`。方舟像素的网页字体（woff2、来源登记、`pixel-scale.ts`）已经移除；仓库原有的方舟像素 BDF（模板文字的兜底字形）不受影响。

**引入的依赖（用户于 2026-11-13 同意）**：`@fontsource/ibm-plex-sans`、`@fontsource/ibm-plex-mono`、`@fontsource/noto-sans-sc`（OFL 1.1，许可检查对 `@fontsource/*` 本来就放行 OFL，脚本不用改）；`@phosphor-icons/react`（MIT）。移除 `@fontsource-variable/inter` 和 `lucide-react`。Noto Sans SC 三个字重的分片字体（woff2 加 woff 兜底）会让渲染进程的资源多出约 25 MB，都在 asar 里，不联网。

**偏离定稿稿的数值**（都为了对比度）：

- 第三级文字：稿子的 `#6d6d72` 在面板上只有 3.4:1，不够做文字。它保留为 `--fg-faint`（只给图标、装饰），文字用 `--fg-subtle: #8b8b91`（面板上 5.1:1）。
- 危险、成功、警告：稿子没给，深色取 `#f26b6b` / `#4cc38a` / `#e8c547`，浅色取 `#c2362f` / `#1d7a4e` / `#806200`，都 ≥ 4.5:1。
- 浅色主题整套是推导的（稿子只有深色）：底 `#dcdcdf`、面板 `#f2f2f3`、次级面 `#f8f8f9`、凹槽 `#e7e7e9`、控件 `#e3e3e6`、控件高亮 `#d6d6da`；强调色 `#0b6aa6`（实心按钮上用白字，5.8:1），作文字时用更深的 `#095c90`；琥珀 `#9a5800`；音效 `#278556`。数值和对比度见 6.2 和 `contrast-check.mjs`。

**实现上的决定**：

- **数值框即滑块**：`ScrubNumberField` 自己算拖动位移（有范围时整个框宽对应整个范围），不用 Base UI 的 ScrubArea 和指针锁——隐藏窗口和测试里拿不到指针锁。原来独立的滑块并进了数值框；T-UI-2、T-UI-7 拖的仍是 `param-overlap` 下的第一个元素，判定不变。
- **图案选择器**：manifest 的 enum 新增可选的 `ui: 'pattern'` 和每个选项的 `pattern`（16 个 0–1 的数，4×4 小格的出现顺序），schema 校验长度和取值，声明了却缺图案时不合法；T-TPL-1 补了一个合法、三个非法夹具；规格 4.4 补了说明。纯数据驱动，属性面板据此画小格，没声明的照旧走分段或下拉。合进 main（m6a）之后给内置模板加了这个字段（只加数据）：block-wipe 的“进入顺序”、block-fall 的“落下顺序”、pixel-dissolve 的“图案”。block-wipe 的“退出顺序”没加：它有“与进入相同”“与进入相反”两个相对于进入顺序的选项，画不成一张固定的图，照旧是下拉。
- **分栏**：外层 [主列 | 右栏]，主列里 [左栏 | 预览] 加固定高度的时间轴。分隔条宽 0（命中区是伪元素撑开的 6 px），面板之间的缝由面板自己的内边距留出：react-resizable-panels 按像素换算面板宽度时不算分隔条和分组的内边距，分隔条一宽，保存的宽度就和实际宽度对不上（T-UI-6 重启后差 29 px）。布局回调里读到的尺寸可能是中间值，所以等一帧再记录。面板默认宽度仍是 280 / 320（设置的默认值在 `shared/settings.ts`，不动主进程），定稿稿是 292 / 336，用户可以拖。
- **音效轨**：引擎装载结果里本来就有 `audioCues`，存进 `previewStore`，不动引擎和 IPC。
- **预览帧率**：渲染进程在每帧画完时记时间，只在播放时统计最近约 1 秒的滑动平均，暂停时状态栏不显示这一项。
- **时间码**改成 `分:秒:帧`（定稿稿的写法）；当前帧号放在播放头的小牌上，`F当前/总` 的文字去掉了。m1 的“播放、暂停、拖动（键盘）”测试改为核对小牌上的帧号和总时长，判定的内容相同。
- **窗口按钮区**：顶栏坐在底色上，按钮区跟着用 `--background`，高 44（T-UI-8 的期望值跟着改）。
- **模板卡片的时长**：取 manifest 时间段（`timeline.segments`）对应的 duration 参数默认值之和；没有时间段的模板只在它是当前模板时显示装载结果里的时长，其他情况不显示（不编造）。
- **“导出”唯一实心**：窗口里的其他按钮（无素材引导里的“下载原版资源”“使用本机的游戏”）改成控件色；对话框里的确认按钮（导出对话框的“导出…”、保存预设、另存为模板、找到游戏目录的“使用原版素材”）仍用强调色，因为它们是模态里的主操作。
- **悦灵占位**：恢复 M4 的圆角几何形状，只跟上配色；`glow` 参数照旧不画（界面禁止外发光）。

**没做的**：时间轴的磁吸和缩放（定稿稿画了，是新功能）；音效分组标题右侧的摘要（“放置 · 破坏 · 80%”）；预览规格读数里的“Alpha”（输出设置里没有这个字段，不编造）。

### 界面注册表与命令的形状（docs/code-editing-and-mcp-plan.md H1、H2）

将来的“应用内代码编辑”和可能的 MCP 接入必须是可整块拆除的可选模块，砍掉时不牵连主界面。所以主界面的可扩展点都由一张注册表驱动，**核心功能自己也经同一组接口注册**，**可选模块只能经它接入**（不得直接改主界面的组件、菜单、命令表）。这次没有为它们做任何占位界面、菜单项、标签页或文案。

注册表在渲染进程的应用层：`apps/desktop/src/renderer/app/registry.ts`（接口）、`app/core.tsx`（核心功能的注册，启动时 `registerCore()` 调一次）。每个 `register*` 返回注销函数；同一个 id 不能注册两次。

- **面板与标签页** `registerPanel({ id, titleKey, region, order, component, actions?, testId? })`：`region` 是 `left` / `right`（左右面板的标签页，`TabbedPanel` 渲染）或 `dock`（主区里可停靠的额外面板，排在右栏之前；核心功能目前没有）。`actions` 是这个标签页激活时放在面板标题行右侧的操作。
- **菜单项** `registerMenuItem({ id, menu, group, order, command?, titleKey?, input?, component?, testId? })`：`menu` 是顶栏的 `file` / `edit` / `view` / `help`；组之间画分隔线。指向命令的菜单项，标题、快捷键、可用条件都取自命令（`titleKey` 可覆盖说法，`input` 是执行时带的参数）；子菜单、单选组这种不是一个命令的，直接给 `component`。
- **命令** `registerCommand({ id, titleKey, shortcut?, input?, output?, effect, undoLabelKey?, hideInPalette?, enabled?(), run(input) })`：`input` / `output` 是 zod schema（没有参数的命令不写）；`effect` 是 `read` / `write` / `destructive`；`undoLabelKey` 是 write 命令在撤销记录上的说法。带具体参数类型的命令用 `defineCommand()` 包一下放进表里。
- **执行只经 `dispatch(id, input?)`**：找命令、看可用条件、带参数的先过 zod 校验、有 output 的再校验返回值，错误是 `CommandError`（`unknown-command` / `disabled` / `invalid-input` / `invalid-output`）。界面上的触发用 `trigger()`（不关心返回值，出错只记日志）。
- 命令面板、全局快捷键（按命令的 `shortcut` 字符串匹配，另有 `Ctrl+Y` 这一个重做的别名；逐帧的左右键不是命令）、顶栏菜单、设置里的快捷键表都从这张表读。原来 `features/commands/commands.ts` 的命令表迁移成了 `CORE_COMMANDS`（形状如上，没有新增命令）；“设置”命令带一个可选参数 `{ page }`，帮助菜单的“快捷键”“关于”就是带参数调用它。Ctrl+B 原来由分栏组件自己监听，现在统一走 `toggleLeft` 命令的快捷键。
- 预设列表原来由属性面板持有刷新函数，标签页拆开之后改成 uiStore 里的 `presetsVersion` 计数；“保存为预设”“另存为模板”两个对话框挪到应用根部（任一标签页都能打开）。
- `tests/unit/ui-registry.test.ts` 核对注册、注销、重复 id、dispatch 的参数与返回值校验、面板排序。

## M6a 内置模板 T2 至 T6

M6 拆成两半：M6a 只做五个模板（本节）；音频 cue 的调度、预览播放、音效选择器试听、离线混音留给 M6 后半。

### 共同做法

- 五个模板各一个目录（`packages/templates/<名字>/`），结构照 T1：manifest、`src/index.ts`、package.json、tsconfig。只用 `ctx` 和 template-sdk 的类型；`three` 的类型也经 `SetupContext['THREE']` 取，不直接导入 `three`（lint 的依赖方向规则）。T3、T5 共用的小工具（`util.ts`）各自目录里放一份相同的副本，因为内置模板只能导入本目录内的文件。
- manifest 不写 `author`（硬性规则第 9 条），名称、说明、参数标签、分组、选项都有中英两种。参数、默认值、范围照 4.10；4.10 没给的 `step`、`ui`、`visibleWhen`、`hint` 按 T1 的习惯补。
- **时间余量**：全部沿用 T1 的做法（M3“T1 的时间余量”），记 `pad = 1/fps`：进入阶段的进度用 `[pad, min(inDuration, cutTime − pad)]`，退出阶段用 `[max(inDuration + hold, cutTime + pad), duration − pad]`；帧率极低时退回各阶段的一半。阶段进度到 0、1 时直接取 0、1，缓动只在开区间里算（缓动在端点不一定精确等于 0、1，贝塞尔就不是）。于是任意画质、0–360° 快门角下，`[0, 1/fps]`、`[duration − 1/fps, duration]` 内的所有子帧都看到“阶段进度 = 0 / 退出进度 = 1”，`[cutTime − 1/fps, cutTime + 1/fps]` 内都看到“进入进度 = 1、退出进度 = 0”。各模板据此在这两种状态下保证全空、全满，见下面各节。
- **音频 cue**：只在 `setup` 里声明，音效 ID 用原版事件名（3.8）。T2：落地时刻 `placeSound`、散落开始时刻 `breakSound`，各按时刻排序后均匀取最多 12 个（同 T1）；T3：`t = 0` 放 `sound`（4.10）；T6：`t = 0` 放 `sound`；T4、T5 没有音效参数，不声明 cue。增益都是 `volume`。播放和混音不在本次范围。
- **着色器**（T3、T5）：`ShaderMaterial`，`transparent: true` 走 Three 默认的 NormalBlending，缓冲里得到预乘 alpha（2.6）。**不设 `glslVersion: GLSL3`**：那样 Three 不再定义 `gl_FragColor`，片元着色器编译失败，而引擎只在控制台打印、不报 warning，画面就是空的（开发时踩过）。不设时 Three 在 WebGL2 上照样按 GLSL ES 3.00 编译，`texelFetch`、`textureGrad` 都能用。着色器只读 uniform，不用时间和随机；需要随机的量（T5 的阈值）在 `setup` 里用 `ctx.random`/`ctx.noise2D` 算好。
- 方块贴图平铺时用连续坐标的导数 `textureGrad(tex, fract(uv), dFdx(uv), dFdy(uv))`，避免 `fract` 接缝处的导数跳变让 mipmap 跳级出一条线。没有改共享贴图的 `wrapS`（贴图属于引擎的缓存）。

### 接口缺口：取方块某个面的贴图（请主控决定）

T3、T5 的 `fill = block` 要在着色器里平铺“方块的贴图”，但模板接口没有“方块 ID → 面贴图”的途径：对应关系在应用的方块目录里，模板拿不到；按 `minecraft:block/<名字>` 猜贴图 ID 对草方块、熔炉、南瓜等多面方块是错的（会缺图、出警告）。

- **现在的做法（只用公开接口）**：`ctx.resources.block(id, { shading: false }).single()`，在它的几何里找所有顶点 `z = +0.5` 的材质组（朝相机的南面），取该组材质的 `map`；跳过抠图的侧面叠加层。只读 Three 的公开属性，但依赖“`single()` 是一个按面分材质组的 Mesh”这一实现细节；找不到时退回 `block/<名字>`。用完释放 `single()` 的几何和材质（贴图属于引擎缓存，不释放）。草方块侧面的着色和叠加层因此不出现在平铺里。
- **建议的最小新接口**：`BlockHandle.faceTexture(face: 'up' | 'down' | 'north' | 'south' | 'east' | 'west'): THREE.Texture`（返回引擎缓存里的贴图，模板不释放）。加上后 T3、T5 的 `util.ts` 换成一行调用。按任务约束本次没有改 template-sdk 和引擎。
- T4 的背景平铺不需要它：直接用实例化方块（正交相机、`shading: false`，只看得见朝向相机的面），面用哪张贴图由引擎决定。

### 另一个引擎建议（未做）

着色器编译失败时引擎不产生 warning（见上），T-TPL-3 的“无警告”抓不到，只有“首末帧/剪辑点”这类画面断言能间接发现。建议引擎在 `renderer.debug.onShaderError` 里记一条模板 warning。属于引擎的改进，不是本次发现的缺陷，没有改。

### T2 方块坠落

- 网格同 T1；透视相机（fov 30）加面明暗，下落、散落时看得见侧面。
- 下落顺序：列的先后（`columnOrder`；`random` 用 `ctx.random('columns')` 洗牌）占 55%，同一列里从下往上占 45%，归一化后作为每块在进入阶段里的开始位置；每块的动画占阶段的 35%。同一列里每块都比下面那块晚开始、下落曲线相同，所以永远在下面那块之上，不会互相穿过。
- 下落 `y = y终 + D × (1 − q²)`，`D = 舞台高 + 3 格`（从最下一行算也在画外）。**回弹的 τ 规格没说单位**：这里取“局部进度里回弹那一段（后 38%）归一化到 [0, 1]”，`bounce × s × e^(−6τ) × |sin(3πτ)|`。这样每块在自己的动画结束时恰好静止（局部进度为 1 时直接取原位，不经 `sin(3π)` 的浮点残差），剪辑点时整面墙严丝合缝。
- 动画中的方块朝相机抬起 `0.05 格`，避免回弹时与上面一块的正面共面闪烁。
- 退出：`fall` 上面的行先走（行序 65% + 随机 35%），抛物线 `x += vx·p`、`y += kick·4p(1−p) − (舞台高 + 4 格)·p²`，带随机角速度；`explode` 几乎同时（随机 25% + 离中心距离 15%），沿“中心 → 格子”方向走到半对角线以外（再补上重力下坠的量），带随机轴的自转；`shrink` 与进入相反的顺序，缩放 `backOut(1 − p)`，同 T1 的缩回。
- **首末帧与剪辑点**：局部进度 ≤ 0（进入前）和 ≥ 1（退出后）的方块缩放为 0，所以首末帧全空；剪辑点时所有方块局部进度为 1、在网格原位、不抬起，覆盖与 T1 的 3d 样式相同，全满（前提同 T1：方块不透明）。

### T3 物品飞掠

- 色带、阶梯、条纹由一个铺满舞台的着色器四边形画出：每个片元换到“沿运动方向”的局部坐标 `(lx, ly)`，算 `e = lx − ly × 0.4`，`后沿 < e < 前沿` 时是色带。
- **规格没说前后沿的走向**：取一条与运动方向垂直方向成约 22° 的斜线（斜率 0.4）。`straight` 是这条光滑的斜线；`stairs` 把 `(lx, ly)` 量化到 `pixelSize` 的格子中心（格子随运动方向转动），斜线就成了像素阶梯。
- **条纹的位置**：4.10 说“后沿之前”，取为色带尾端之后（露出的一侧）：A 在 `[后沿 − 2 格, 后沿 − 1 格)`，B 在 `[后沿 − 4 格, 后沿 − 3 格)`，宽度都是 `pixelSize`，半透明按自身 alpha 画。条纹只在退出阶段跟着后沿出现。
- `fill = block` 时贴图按 `tileSize` 相对舞台固定平铺（色带像遮罩一样扫过），面贴图的取法见上面的“接口缺口”。
- 物品用 `ctx.resources.item(item).single()`，`image` 非空时用 `ctx.sprite.create`，宽高比取贴图的 `image.width / height`；放在色带前面，中心在前沿前方 `itemLead × 高 + 半径`，以 `spin` 圈每秒绕画面法线旋转（正值顺时针）。
- **行程**：`e` 是线性函数，舞台上的极值在四个角上，记 `E = 角上 |e| 的最大值 + 1 格`（阶梯量化最多偏 0.7 格）。前沿从 `min(−E, −S − r − ahead)` 走到 `max(E, S + r − ahead)`（`S` 是舞台沿运动方向的半宽，`r` 是物品半对角线），后沿从 `−E` 走到 `E + 4 格`。所以进入前色带和物品都在画外、首帧全空；前沿到终点时整块舞台都在色带里、物品已出画，剪辑点全满（`fill = block` 的前提同 T1：方块不透明）；后沿到终点时条纹也出画，末帧全空。最初用“半对角线 × 1.4 + 2 格”这种宽松的上界，默认参数下一大半帧都是全空或全满，T-TPL-3 的“确实在动”不过，才改成按角点精确算。

### T4 加载界面

- 背景是实例化方块（`shading: false`、默认正交相机），`tileSize` 的格子向上取整铺满并居中，`setTint` 染成 `dim`。**`dim` 按 sRGB 系数乘**（和游戏一样），换成线性值交给 `setTint`。
- 标题、副标题用 `ctx.text.create`（位图字、带阴影、居中，`maxWidth` 为舞台宽的 90%，超长时换行），字号 `textScale`。进度条：外框（文字颜色，1 个字体像素）、黑底、`barColor` 填充，高 3 个字体像素，宽 `min(舞台宽 × 70%, 100 × textScale)`。三者竖直方向整体居中，行距 6 个字体像素。规格没给这些尺寸。
- 进度条在**未加余量的**停留阶段 `[inDuration, inDuration + hold]` 里线性从 0 走到 100%（只是画面内容，不影响透明度）。
- 进出方式：`fade` 所有层一起改不透明度（逐层淡入，文字处在淡入中途会比背景略实，接受）；`slideUp` 整屏从下方滑入、向上方滑出，位移 `舞台高 + tileSize + 文字块高`，保证超出画面的长文字也完全出画；`dissolve` 背景逐格出现（每格一个阈值：随机 50% + 噪声 50%，归一化，种子 `seed`），文字和进度条跟着淡入淡出。
- `cutTime = inDuration + hold × cutAt`，可以落在停留阶段的任意位置（包括两端），时间窗公式本来就按 `cutTime ± pad` 截，所以照样成立。**首末帧与剪辑点**：进入前 `fade`/`dissolve` 的不透明度和可见格子都是 0、`slideUp` 整屏在画外；剪辑点时位移为 0、不透明度为 1、全部格子可见，平铺的方块盖满舞台。

### T5 像素溶解

- 舞台按 `cellSize` 分格（行列数向上取整、居中）。每格的阈值在 `setup` 里算好：`noise` 是 `ctx.noise2D(x/360, y/360)`，`random` 是 `ctx.random`，`sweep` 是沿 `angle` 的投影除以半对角线加 `spread × 噪声`，`radial` 是到中心的距离除以半对角线加 `spread × 噪声`（`spread` 用的噪声尺度 240）；然后归一化到 [0, 1]。噪声尺度按设计单位取，换格子大小时图案的大轮廓不变。`spread` 对 `noise`、`random` 不起作用（规格只给 sweep、radial 写了 spread）。
- 阈值存进一张 `R32F` 贴图（最近邻、不做 mipmap），着色器用 `texelFetch` 按格子取，逐位精确，不在 GPU 上算噪声。
- **accent 的处理**：照字面“`h < a` 时可见、与进度相差不到 `accentWidth` 的显示 accent”，进入结束（`a = 1`）时阈值最大的那些格子还是 accent 色，停留阶段就会留着一圈 accent，退出一开始又会突然冒出 accent。所以把进度映射成 `A = a(1 + w + ε)`、`B = b(1 + w + ε) − w`（`w = accentWidth`，`ε = 10⁻³`）：`a = 0` 时没有格子可见；`a = 1` 时全部可见且没有 accent，停留阶段是纯填充；`b = 0` 时没有 accent，与停留阶段衔接；`b = 1` 时全部消失。`outReverse` 用 `1 − h`。
- **首末帧与剪辑点**：由上面的映射直接得到。accent 色和填充色都是不透明的；`fill = block` 的前提同 T1。

### T6 进度提示（叠加层）

- `category: overlay`，`cutTime: null`，所以只有“首末帧全透明”这一条：滑入从 `pad` 开始、滑出在 `duration − pad` 结束，停在画外时面板左（右）边缘离舞台边缘还有 1 个设计单位。
- 面板：`ctx.sprite.create(ctx.resources.texture('minecraft:gui/sprites/toast/advancement'), { pixelSize: g })`，九宫格边框来自贴图的 `.mcmeta`（`gui.scaling`）。**规格说“资源栈里没有时用内置层自制的版本”**：按 M2a 的范围变更内置层是空的，没有原版层也没有资源包时这里是占位图并有一条警告，和其他贴图一样。
- 布局以界面像素计：图标在 (8, 8)、16×16；文字左边界 30。原版字体（约 8 像素高）时两行文字的上边界是 7 和 18，与游戏一致。**文字比原版字体高时**（兜底的方舟像素字体 12 像素，测试和没有原版层时就是这种情况）两行重新均分、必要时把面板加高；**文字比面板宽时**面板向右加宽（九宫格拉伸）。规格只给了原生尺寸 160×32。
- **实际缩放**：`g = min(guiScale, (舞台宽 − 2 × margin) / 面板宽, (舞台高 − 2 × margin) / 面板高)`，面板太大时（例如 9:16 下 `guiScale = 10`）按比例缩小，三种画幅都放得下（4.6 第 5 条）。文字按 `guiScale` 建好后整体缩放到 `g`。
- **标题行颜色**：`headerColor` 保持默认值 `#FFFF55` 时按 `frame` 取色（`task`、`goal` 为 `#FFFF55`，`challenge` 为 `#FF88FF`，与游戏的提示框一致）；改成别的值时用它。代价是挑战类没法显式选 `#FFFF55`。参数提示里写明了。
- 滑入、滑出沿水平方向（右侧停靠从右边进出，左侧从左边），缓动 `quadOut` / `quadIn`。

### 测试

- T-TPL-3、T-TPL-4、T-TPL-5 的测试本来就遍历全部内置模板，没有为新模板改判定。
- **改了一处 T-TPL-3 的附加检查**（`tests/engine/templates.spec.ts`）：M3 加的“确实在动”要求一半以上的帧互不相同，这不是 4.11 的判定，是防止模板根本不动的健全性检查。T6 默认停留 2.5 秒、总长 3 秒，停留阶段本来就静止，只有约 30 帧在动。现在对**叠加层**不计停留阶段内部的帧（`floor(hold × 60) − 1`，按默认参数），转场类的要求完全不变。
- 假资源栈（`fake-resources.ts`）不需要补：它对任何贴图 ID 都返回纯色图，界面贴图、方块面、物品图标都覆盖到了；文字用的是仓库里真实的兜底字体，默认文案（含 “…”）都有字形，T-TPL-3 无警告。
- T-TPL-5 的基准图由 `pnpm templates:baselines` 用纯色假资源栈渲染，路径已被 `ASSETS_PROVENANCE.json` 里 `tests/fixtures/baselines/**` 的 `rendered` 记录覆盖。
- 评审联络图 `docs/review/M6a/<模板>.png` 由 `docs/review/M6a/make-sheets.ts` 从基准图拼成（缩小一半、铺在棋盘格上），不含原版贴图。用本机真实游戏截的图放在被忽略的 `docs/review/M6a/out/`，不提交。

## 范围变更：模板开发模式纳入本次交付（2026-11-13，用户确认）

- 用户要求“为动画纯代码编辑做准备”，并要求该功能解耦、可整块砍掉。主控据三路调研给出方案 `docs/code-editing-and-mcp-plan.md`，用户答复“纳入”：把 P0（模板开发模式：外部编辑器改模板文件、应用监视并热重载）纳入本次交付，新增里程碑 MD（`docs/08-milestones.md`），排在 M7 之后、M8 之前。
- 这改变了 `docs/01-product-architecture.md` 1.2 的范围（原“之后的方向”第 1 条）。内嵌编辑器（P1 及以后）和 MCP 仍不做；MCP 启用前必须另行取得用户同意（H-MCP）。
- 界面重设计中途定稿的方向见 `docs/design/ui-direction-v4.*`；用户同意引入 IBM Plex Sans、IBM Plex Mono、Noto Sans SC 三种 OFL 字体，图标由 Lucide 换为 Phosphor。

## MD-a 模板开发模式中不碰界面的部分

范围：H5 的引擎与协议侧、H8、H10、H12，以及可选模块的接入骨架（`docs/code-editing-and-mcp-plan.md`；`docs/08-milestones.md` MD）。界面接线（热重载管线、错误浮层、命令、修订号、静帧接口、撤销分组）在 MD-b。

### 版本与依赖

| 项 | 版本 | 许可 | 说明 |
|---|---|---|---|
| acorn | 8.19.0 | MIT | 应用（`apps/desktop`）的运行时依赖：模板源码的语法预检和确定性静态规则。纯 JS，源码里没有 `eval`、`new Function`（查过），不用 WebAssembly，CSP 不放宽。`dist/acorn.mjs` 约 235 KB（未压缩），进渲染进程主包和主进程包。仓库里本来就有（ESLint 的 espree 依赖它），离线安装 |

没有用 es-module-lexer 做语法预检：它只是词法扫描，大部分语法错误发现不了，发现的也没有可用的位置。它仍然是 import 检查（T-ARC-4 的安全门），行为不变，只是错误里补上了位置。

### 结构化诊断（H5）

- `TemplateDiagnostic` 在 `packages/template-sdk/src/protocol.ts`：`compile | load | setup | update | watchdog | determinism | rule` 的判别联合，共有 `severity`、稳定的 `code`、`message`（不超过 2000 字）、可选的 `line`/`column`（都从 1 开始，列按 UTF-16 码元，与 V8 的调用栈和 VS Code 一致）。`update`、`determinism` 可带出错时刻 `t`；`watchdog` 带 `operation`、`timeoutMs`。错误码：compile 的 `syntax-error`/`has-import`/`too-large`，load 的 `evaluate-failed`/`bad-export`，setup 的 `setup-threw`/`bad-instance`，update 的 `update-threw`/`audio-cue-outside-setup`，watchdog 的 `unresponsive`，determinism 的 `forbidden-api`（开发构建拦到的调用，error）/`render-mismatch`（双渲比对不一致，warning），rule 见下。
- **位置只从模板自己的栈帧来**：引擎记下装载时的 Blob URL，在 `error.stack` 里找第一个属于它的栈帧。模板不转译，行列 1:1。找不到就不带位置，不猜。V8 记的位置：`throw new Error()` 记在 `new` 上，读 null 的属性记在出错的属性名上，方法调用记在方法名上。所以同一处 `Math.random()`，静态规则（指向表达式开头）和运行时拦截（指向 `random`）的列不同、行相同（T-DEV-2 两个都断言了）。
- **语法错误在宿主预检**：`EngineHost.load` 交给 Worker 之前用 acorn 解析，失败抛 `TemplateCodeError`，带 compile 诊断和位置。引擎里动态 `import()` 报的 SyntaxError 没有可用位置，只在 acorn 放过而 V8 不认时才会出现，归为 compile、不带位置。acorn 用 `ecmaVersion: 'latest'`；若将来有 V8 认而 acorn 还不认的新语法，模板会被拒绝，届时升级 acorn。
- **跨线程**：Comlink 默认只序列化错误的 name/message/stack，宿主一侧用 `Object.assign` 还原。Worker 入口换了一个 throw 处理器（`engine-host/error-transfer.ts`），多放一个 `diagnostic` 字段；宿主在 `EngineHost.call` 的出错路径上用 `diagnosticOf`（zod）校验，不合 schema 的删掉（线程边界照 2.3 的约定校验）。`EngineUnresponsiveError` 自己带 watchdog 诊断；`EngineCrashedError`（Worker 自己挂了）不带。
- **向后兼容**：错误的 `name` 不变（`TemplateError`、`TemplateCodeError`、`EngineUnresponsiveError`），`message` 沿用原来的写法（“template setup() failed: …”）。有一处变化：`update` 抛出的错误以前原样冒出来，现在包成 `TemplateError`，message 是 “template update(t) failed: 原错误名: 原信息”；试运行的 `detail` 和预览错误卡片的文字因此多了前缀。界面没改，现有测试的判定（如 `toMatch(/Math\.random\(\) is not allowed/)`）都照样成立。
- `LoadResult` 多一个可选的 `diagnostics`：宿主把静态规则的提示附在装载结果上，引擎自己不填。旧的调用方只看 `warnings`。
- **新增引擎方法 `checkDeterminism(probe, others, quality)`**（2.3 的接口表里没有）：在 Worker 里把 probe 帧渲染两次、中间穿插 others，逐字节比较，不一致时返回 determinism 诊断，像素不出 Worker。试运行（`trial.ts`）还是自己比；MD-b 的热重载管线和试运行可以改用它。时限按导出单帧时限乘以（others 的个数 + 2）。
- update 的零分配预算不变：只在 `catch` 里分配。

### 确定性的静态规则（H12）

- `apps/desktop/src/shared/template-code.ts` 的 `analyzeTemplateCode`：一次 acorn 解析，先报 compile 错误，再在同一棵语法树上跑规则：`Math.random`（含 `Math['random']`）→ `math-random`；`Date.now` → `date-now`；不带参数的 `new Date()` 和 `Date()` → `new-date`（`new Date(0)` 是确定的，不报）；`performance.now` → `performance-now`；`import` 声明、`import()`、`export … from` → `import`。只看语法树，字符串、注释、模板字符串、对象属性名里的不报。不管变量遮蔽（局部变量叫 `Math` 也报）：它只是提示。最多 100 条。
- **安装校验**：第 3 步在同一次解析里得到规则提示，暂存时带着；提交安装时主进程自己把它并进 `nondeterministic` 警告（沿用现有的“预览与导出可能不一致”文案，界面不用加字），具体位置写进 `<version>.meta.json` 的 `ruleDiagnostics`；不拒绝安装。`StageResult` 多一个 `ruleDiagnostics`，`InstallError` 多一个可选的 `diagnostic`（预检失败时带位置），渲染进程现在不读它们。
- `pnpm templates:build`：内置模板打包后有任何规则命中就构建失败（硬性规则 2）。六个内置模板现在都没有。

### 类型定义与编写指南（H8）

- `pnpm templates:api`（`scripts/gen-template-api.ts`）生成三个文件，提交进仓库，T-DEV-3 核对重新生成后无差异（比较前把 CRLF 统一成 LF，产物本身总是 LF）：
  - `packages/template-sdk/generated/template-api.d.ts`：`runtime.ts` 的类型原文，把 `import type * as THREE from 'three'` 换成手写的最小类型面（`scripts/template-api/three-surface.d.ts`，`export declare namespace THREE`），自包含、不 import 任何包。
  - `packages/template-sdk/generated/template-api.json`：`ctx` 各成员和相关接口的签名、说明，以及缓动名。形状是 `@allay/host-api` 的 `SdkApiDoc`。
  - `docs/template-authoring.md`：由 `scripts/template-api/authoring.md` 填入生成的部分（`ctx` 的成员表、缓动名、诊断种类、jsconfig、最小示例）。最小示例是 `scripts/template-api/example/` 下真实的文件。
- **`runtime.ts` 不在本任务可改的范围里**，它有不少成员没写 JSDoc。生成脚本从 `scripts/template-api/member-docs.ts` 补说明，作为 JSDoc 插进 d.ts（悬停可见）和 JSON。以后 `runtime.ts` 自己补了说明，生成脚本会报“已有 JSDoc”，提醒删掉重复的那条。
- **THREE 的取舍**：完整的 `@types/three` 有几百个文件，打成单文件既大又难维护；只写模板实际用得到的类和成员（向量、四元数、矩阵、颜色、Object3D、几种相机、几何体、材质、Mesh、贴图、常量、MathUtils），没写的成员运行时照样在，只是没有补全。为了不和真实的 three 走样，T-DEV-3 用编译器核对“真实的 `typeof THREE` 可以赋给类型面”。比较时关掉 `strictFunctionTypes`：类型面是子集，构造函数参数里出现的 `Color` 等是“少了成员”的版本，逆变比较必然不过；双向比较仍能抓出不存在的成员、类型不对的属性（实际抓到过 `isScene` 应为 boolean、`Blending` 少了 6、`Color.set` 的重载）。
- `Texture.image` 与 three 一样是 `unknown`。T3 的源码里用 `as` 断言读它的宽高，打包后断言没了，所以复制 T3 出来在外部编辑器里打开，会在两行看到 4 个类型错误（运行不受影响）。测试把这 4 条列为已知例外，别的模板、别的错误一律不许有。
- 写进模板文件夹的 `jsconfig.json`（`shared/template-dev.ts`）：`checkJs: true`、`strict: false`（复制出来的是打包产物，没有类型注解，开 strict 会满屏红线）、`lib: ES2023`、不带 DOM（模板在 Worker 里）。
- 生成物放在 `packages/template-sdk/generated/`（不在包的 `exports` 里：template-sdk 的 `package.json` 不在本任务可改的范围）；主进程用相对路径加 Vite 的 `?raw` 把 d.ts 以文本打进主进程包（`main/templates/template-api-dts.ts`，另加了 `*?raw` 的模块声明）。
- 示例 JS 里没写 `// @ts-check`：根 tsconfig 以 `allowJs` 收了 `scripts/`，写了会让根类型检查去查它（找不到同目录的 d.ts）；jsconfig 的 `checkJs` 已经打开检查。

### 模板目录的监视与开发模式的主进程方法（H10）

- `TemplateWatcher`（`main/templates/dev-watcher.ts`）只监视 `userData/templates/`（`fs.watch` 递归，Windows 原生支持）。下面一层是 `<id>/<版本>/`，id 和版本不合格式的（`.staging`、`*.meta.json`）忽略。只认 `manifest.json`、`template.js`、`assets/**`；编辑器的临时文件和交换文件（`~`、`.swp`、`#…#`、`.crswap`、`4913`、`.tmp` 等）、`template-api.d.ts`、`jsconfig.json`、`.vscode/` 都不算。
- 每个模板一个 150 ms 的防抖计时器；到点时按内容重新算 SHA-256（相对路径、字节数、内容），与上次相同就不报。所以“写临时文件再改名”的原子保存只报一次，原样重写不报。事件：`{ id, version, change: added | changed | removed, hash }`；给渲染进程的 `templates:changed` 多一个 `valid`（改动后模板服务还能不能装载它）。
- **自己的写入**：`ownWrite(id, version, fn)` 期间这个模板的事件不报，写完按新内容更新哈希，之后才到的事件比较出来相同也不报。`TemplateService` 加了写入钩子（`setWriteGuard`），安装提交、删除、另存为、复制内置模板都经过它；开发服务写类型定义也包在里面。
- **外部改动**：开发服务先让 `TemplateService.refreshUser` 按磁盘上的 manifest 刷新（与启动扫描同一个函数），再通知；manifest 坏了时这个模板从列表移除，`valid: false`。
- **复制内置模板**：新 id 是 `user.<6 位随机十六进制>.<原 id 最后一段>`（与“另存为模板”一致，不会以 `allay.` 开头），版本 1.0.0，名字可选（不给时沿用原名：主进程里不写“副本”这类界面文字，MD-b 决定怎么起名）。包里的文件原样解压出来，`template.js` 只多一行类型注解（`/** @type {import('./template-api').TemplateModule} */`，认不出打包产物的形状时不加）；元数据里记 `copiedFrom`。然后写 `template-api.d.ts` 和 `jsconfig.json`。
- **打开文件夹**：只开文件夹（`shell.openPath(目录)`），绝不对 `.js` 调用。路径由主进程按 id 和版本决定，并且要求：是已知的用户模板；真实路径（解开符号链接和目录联接之后）正好是根目录下两层。目录联接指向外面的拒绝（`outside`）。单元测试里打开文件夹用假的函数，e2e 只发畸形参数，测试不会真的弹出资源管理器。
- IPC：`templates.copyBuiltin({ id, version, name? })`、`templates.writeDevFiles(id, version)`、`templates.openFolder(id, version)`、`templates.onChanged(cb)`。失败时返回 `{ ok: false, error }`（枚举），不抛错。T-ARC-6 的畸形参数表补了三个方法。渲染进程只在 preload 和 `test-hooks.ts`（`copyBuiltinTemplate`、`writeTemplateDevFiles`、`templateChanges`）里接了，界面组件和 store 没动。
- 监视在模板列表就绪后启动，不阻塞窗口；启动失败只记日志（MD-b 可以在界面上提示）。

### 可选模块的接入骨架

- `packages/host-api`：只有类型。`EditorHost` 按方案 3.3 落地，每个成员注明“已有”还是“MD-b”。`SdkApiDoc`（接口 JSON 的形状）、`OptionalModule`（`activate(host): Disposable`）也在这里。只能引用 template-sdk 的类型。
- `packages/optional/` 现在只有 `README.md`。`pnpm-workspace.yaml` 加了 `packages/optional/*`；`packages/*` 也会匹配到 `packages/optional` 本身，它没有 `package.json`，pnpm 不当它是包。
- **依赖方向**（`eslint.config.js`）：兜底一条“任何文件不得引用 `packages/optional`”（包名 `@allay/optional-*`、路径里有 `packages/optional`、`../…/optional/`），排在最前；原有每条规则也带上同样的条目（扁平配置里后面的同名规则会整个覆盖前面的选项）。可选模块：`@allay/` 下只能引用 `host-api`；相对路径够到 `apps`、`engine`、`template-sdk`、`ui` 等主程序目录名的拦下（代价：模块自己的子目录不能叫这些名字）。第三方依赖不限。夹具：`tests/fixtures/lint/core-imports-optional.ts`、`optional-imports-core.ts`。
- **目录被删时**：手工把 `packages/optional` 移走，跑 `pnpm install --offline --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、T-DEV-4 与 T-ARC-1，全部通过，再移回来。T-DEV-4 另外核对主程序的构建、类型检查、测试配置里没有点名可选模块。没有把“删目录跑完整 `pnpm check`”做成 CI 步骤：要在 CI 里删工作区的目录，留给 M8 的 CI 配置。
- **惰性发现的实验**（在仓库外的临时目录，Vite 8.3.8，结构与本仓库相同：根目录有 `pnpm-workspace.yaml`，Vite 根目录是子目录）：`import.meta.glob('../../packages/optional/*/src/index.ts')`
  - 生产构建：有模块时每个模块打成单独的惰性块；目录为空、目录不存在都构建成功，结果是空对象。
  - 开发服务器：路径被改写成 `/@fs/<绝对路径>`，能取到（Vite 的 `server.fs.allow` 默认是按 `pnpm-workspace.yaml` 找到的工作区根目录）；目录不存在时是空对象。
  - 结论：可行。没验证的：electron-vite 的渲染进程构建里同样的写法（MD-b 接线时验证），以及 `app://` 下加载那个惰性块（应与其他分块相同）。

### 测试

- T-DEV-2（引擎层，`tests/engine/T-DEV-2.spec.ts`，夹具在 `tests/fixtures/templates/dev/`）：语法错误（compile，6:25）、setup 抛错（setup，5:11）、update 抛错（update，9:29，带 t）、死循环（watchdog，没有位置）、`Math.random`（rule 8:24 与 determinism 8:29）、乱序不一致（determinism `render-mismatch`，没有位置），加一个确定模板（T1）的对照。静态部分在 `tests/unit/T-DEV-2.rules.test.ts`。
- T-DEV-3：`tests/unit/T-DEV-3.template-api.test.ts`。内置模板源码按与 tsconfig.base 一样严格的选项、`@allay/template-sdk` 指向生成的 d.ts 检查；示例 JS 按 jsconfig 和严格模式各检查一次；另有一个反例确认 checkJs 真的在查。
- T-DEV-4：`tests/unit/T-DEV-4.optional-modules.test.ts`。
- 监视和开发模式方法：`tests/unit/template-dev.test.ts`，用真实的文件系统事件（临时目录、测试时生成的模板），含“自己写入不触发”“原子保存只触发一次”“目录外的路径被拒绝”（目录联接），以及复制出的六个内置模板按 jsconfig 做 checkJs。
- T-DEV-1 和 T-DEV-2 的界面部分（错误浮层显示位置、保留上一帧、修好后恢复）属于 MD-b，没有做。

## MD-b 模板开发模式的界面接线与主程序侧其余准备

范围：H3、H4、H6、H9、H11、错误浮层、入口命令、监视提示、可选模块的惰性发现、“可拆除”检查（`docs/code-editing-and-mcp-plan.md`；`docs/08-milestones.md` MD）。H7（导出任务化）属于 M7，没做。没有写任何可选模块，也没有内嵌编辑器或 MCP 的界面、文案、占位。

### 热重载管线（H9）

- `features/preview/hotReload.ts`：收到 `templates.onChanged` 且是当前模板 → 渲染进程再合并 100 ms（主进程已按模板防抖 150 ms）→ `templates.read` 重新取 → `analyzeTemplateCode`（语法、import、确定性规则）→ `previewEngine.trySwap` 在**新画布上的备用预览 Worker** 里 resize、load、render 当前时刻（每步受看门狗约束）→ 成功才把画布和 Worker 换上去并销毁旧的。失败时备用 Worker 销毁，旧 Worker、旧画面、播放都不动；预览状态保持“就绪”，原因只进错误浮层。连续保存只重载最后一次（进行中再来改动就做完再来一次）。
- **确定性规则命中不切换**：安装时规则命中只是警告，开发模式更严（硬性规则 2：写模板时就拦下）。生产构建的预览不开运行时拦截，所以不确定代码在开发模式里靠静态规则（`rule`，带位置）发现。
- 参数：`remapParams` 按键名和类型对上（同名同类型保留后再经 sanitize 钳制，类型变了、新加的回默认值，没了的丢掉）。提交那一刻再按最新参数对一次（试载期间用户可能又改了）。播放位置不动，时长可能变（时间轴按新时长）。
- 工程：`hotSwapTemplate` 换模板**不进撤销历史**；历史里引用旧模板的状态也换成新模板（参数同样重新对上），否则撤销会把磁盘上已经没有的旧代码带回来。manifest 变了属性面板随工程里的模板重建。
- `previewEngine` 里看门狗的回调改成按 Worker 实例判断（原来按 generation），备用 Worker 死掉不会触发主 Worker 的重建；装载中途被换掉的 Worker 的失败被忽略。新增 `hasLoaded`：热重载换上去后若参数在试载期间变了，结构已对上，参数走 `setParams`。
- 模板自带图片：热重载前清掉这个模板的 `asset:` 解码缓存（`forgetTemplateAssets`），改了 `assets/` 下的图也能更新。
- 只处理当前模板本身；当前模板是某个用户模板的派生、基模板被改时不自动重载（重新选一次即可）。
- 文件夹被删、manifest 坏了：诊断 `load / template-unreadable`，不带位置。

### 错误浮层与监视提示

- `DevOverlay`：贴在预览上沿（不挡画面中央），列出诊断的种类、错误码对应的文案、“第 N 行，第 M 列”、出错时刻和原文，最多 5 条；修好后自动消失。文案在 `dev.*`，两种语言。没有文案的错误码原样显示。
- 死循环（`watchdog`）**没有行列**：Worker 已被终止，拿不到卡在哪（同 MD-a）。浮层显示种类和错误码，测试断言 `operation` 为 `render`。这是 T-DEV-2“带位置”唯一做不到的一项。
- 状态栏 `DevWatchStatus`：当前模板是用户模板时显示“正在监视模板文件夹 · hh:mm:ss 已重新载入 / 重新载入失败”，重载中转圈；不是用户模板时不显示。
- 预览原有的错误卡片（悦灵）不动：装载时就失败（选中一个已经坏掉的用户模板）仍走原来的错误卡片，修好保存后热重载换上去，卡片随“就绪”消失。

### 入口

- 命令 `copyBuiltinTemplate`（当前是内置脚本模板时可用；新名字“原名（副本）”按界面语言取一次，参数沿用当前取值，复制后主进程已写好 `template-api.d.ts` 和 `jsconfig.json`，然后选中新模板）、`openTemplateFolder`（当前是用户模板时可用；只开文件夹）。经注册表注册，文件菜单第三组和命令面板里都有。失败按枚举错误提示。
- e2e 不点“打开模板文件夹”（会弹出资源管理器），只核对可用状态。

### 主程序侧其余准备

- **H3 修订号**：就是 `projectStore.revision`（模板、参数、输出每变一次加一）。新增 `ifRevision`、`RevisionConflictError` 和两个不在命令面板列出的命令 `project.get`（返回修订号、模板、参数）、`project.setParams`（可带 `baseRevision`，对不上就拒绝、不改任何东西）。
- **H4 静帧接口**：`engine-host/still.ts` 的 `openStill(host, req)`（装载一次、逐帧取 RGBA）和 `renderStillPng`。最长边上限 1920（超过等比缩小，两边至少 16），一个会话最多 240 帧。封面和悬停预览改用它；评审截图里“某一时刻的一帧”（`review:md-b` 的 `md-b-still.png`）和测试钩子 `renderStill` 用它。之前的评审脚本截的是整个窗口（界面截图），不是“渲染某一时刻”，没有改。安装试运行的确定性自检改用 `EngineHost.checkDeterminism`（probe 帧两次、中间穿插首末帧），渲染次数从 4 次变成 7 次，判定相同。
- **H6 撤销来源**：工程状态多一个 `origin { labelKey, source }`，跟着模板和参数一起进 zundo 的历史（只比较模板和参数，origin 单独变不产生记录）。`undoInfo()` 给出撤销、重做各对应哪次改动。`dispatch` 执行 write 命令时，同步产生的改动标为命令的 `undoLabelKey`（或标题）和来源（缺省 `command`，命令通道是 `main`，模块可用 `module:<id>`）；界面上直接改参数是 `ui`。异步命令在 `await` 之后的改动按界面修改记（`withOrigin` 只覆盖同步部分）。界面上还没有显示这个标签（顶栏不在本任务范围），数据和测试钩子有。
- **H11 命令通道**：`host:command`（主进程 → 界面的事件，带 requestId、命令 id、JSON 参数）和 `host:commandResult`（界面交回结果的 invoke 通道）。界面一侧按 schema 校验请求后经 `dispatch` 执行（参数再按命令自己的 schema 校验）；主进程一侧 IPC 层先查来源、按 `IPC_ARGS` 校验，再只认自己发出去的 requestId。超时 15 秒、窗口不在、窗口关闭都给明确的失败。结果 JSON 不超过 1 MB。现在主进程没有调用方（文件关联、第二实例参数在 M8 接）；测试开关打开时（只在未打包时）挂在主进程的 `globalThis.__allayHostCommands`，e2e 从主进程调用。T-ARC-6 的畸形参数表补了 `host.commandResult` 和 `optionalModules`。

### 可选模块的惰性发现

- `app/optionalModules.ts`：`import.meta.glob('../../../../../packages/optional/*/src/index.ts')`，按目录名整理成表；`OptionalModuleManager.sync(开关表)` 启停。设置 `ui.optionalModules`：目录名 → 布尔，最多 32 项，默认空表；关着的模块不加载代码块。模块入口导出 `activate(host)`（或默认导出 `{ id, activate }`）。activate 失败、没有导出时撤掉已注册的东西、记下原因，不连累主程序。
- 宿主：`app/editorHost.ts` + `app/hostUi.tsx`。已实现 `templates.onExternalChange`、`engine.onDiagnostics`、`engine.requestReload`（只能是当前模板，走同一条热重载管线）、`playhead`、`domain`（方块 ID、缓动、接口说明；接口说明 JSON 是单独的惰性块）、`ui.*`。**没实现** `templates.read`、`templates.write`（主进程没有带内容版本的读写，界面也不反写代码），调用时以 `HostUnsupportedError` 拒绝。模块注册的面板、命令、文案键必须以“<目录名>.”开头；`bottom` 位置的面板放进注册表的 `dock` 区域。模块命令的参数只要求是 JSON（契约里的命令没有自己的 schema）。设置里没有开关的界面：现在没有模块，也就没有可开的东西。
- `apps/desktop` 加了 `@allay/host-api` 的 workspace 依赖（只有类型）。
- **验证**：单元测试用只在测试夹具里的假模块（`tests/fixtures/fake-module`）验证开着加载、能注册面板与命令与文案、关着不加载、关掉全部注销。另外手工验证了 MD-a 没验证的那一项：把同一个假模块临时放进 `packages/optional/fake/`，`electron-vite build` 把它打成单独的块（`assets/src-*.js`），主包里没有它；在真实应用里开关打开时模块被激活、它的命令能经 `dispatch` 执行，关着时命令不存在。验证完已删除，没有提交。

### “可拆除”检查

- `pnpm check:removable`（`scripts/check-removable.ts`）：把 `packages/optional` 移到临时目录（`--mode=empty` 时换成空目录），跑完整的 `pnpm check`，结束（含失败、Ctrl+C）时把目录和 lockfile 原样放回。目录里有模块时先 `pnpm install --offline` 刷新、放回后按原 lockfile 再装一次（现在是空操作）。CI 在 `pnpm check` 之后跑它，超时从 45 分钟调到 75 分钟。

### 测试

- e2e `tests/e2e/dev.spec.ts`：T-DEV-1（菜单入口、类型定义、监视提示、改代码后 5 秒内换上新代码且播放位置和参数不变、换了 Worker、不进撤销历史、manifest 改类型和加参数后属性面板重建）、T-DEV-2 的界面部分（语法错误 6:25、setup 抛错 5:11、update 抛错 9:29、死循环、`Math.random` 8:24；每次核对浮层的种类、错误码、位置，Worker 没换、状态仍就绪、画面哈希不变；修好后浮层消失、画面更新），以及 H11、H3、H6、H4 的端到端。测试进程直接改模板文件夹里的文件（写临时文件再改名，真实的文件系统事件），判定全部用状态轮询（重载完成的次数与结果）。
- 单元：`MD-b.project-state`（参数对上、热重载不进历史、撤销来源、修订号冲突）、`MD-b.host-commands`（两端校验）、`T-DEV-4.optional-loader`。
- `T-ALY.mascot-bake` 在全量单元测试并行时偶尔报 “Process failed to launch”（同时启动 Electron），单独跑通过；与本次改动无关。

### 没验证的

- 真实 VS Code 里打开复制出的模板文件夹的补全体验（仍只有 MD-a 的编译器检查）。
- “打开模板文件夹”真的弹出资源管理器（测试里不点）。
- 中文输入法、真实剪辑软件与本任务无关，未涉及。

## M5b 悦灵接进应用（M5 后半）

范围：`docs/07-allay-mascot.md` 7.4 的五个组件换成读烘焙图集的实现、7.5 的十一个出场位置、7.6 的四段编排、全局协调（T-ALY-3）、减少动效、7.9 的性能预算、启动画面、应用图标进安装包、烘焙产物缺失时的行为。

### 烘焙产物怎么到达界面

- **不在构建产物里，由主进程提供**：`app://renderer/mascot/<文件名>` 由 `app-protocol.ts` 映射到产物目录（只认扁平的小写文件名、只有 `.png` 和 `.json`，`app-path.ts` 的 `resolveMascotPath`）。目录：打包后是安装目录的 `resources/mascot`，未打包时是 `packages/mascot/generated`，测试可以用 `ALLAY_E2E_MASCOT_DIR`（只在未打包时生效，同其他测试开关）换成自己生成的假图集或空目录。这样 `pnpm build` 的产物与本机有没有烘焙过无关，CI 和本机一样。
- **运行时缺产物就退回占位**：渲染进程先取 `allay.atlas.json`（zod 校验，`assets.ts`），404 或不合格就是“缺产物”，五个组件都用 M4 的 CSS 占位（`placeholder.tsx`，原样保留）。图集按尺寸各解码一次成 `ImageBitmap`，全应用共用。开发服务器上由同一个 Vite 插件提供 `/mascot/`。
- **e2e 默认走占位**：`tests/e2e/helpers.ts` 把 `ALLAY_E2E_MASCOT_DIR` 默认指向不存在的目录。本机烘焙过的真实产物（原版贴图的派生图像）不进任何测试和截图基线；需要图集的测试（`m5b.spec.ts`）用测试时生成的假图集（`tests/e2e/fake-mascot.ts`：文件名、网格、`atlas.json` 与烘焙约定相同，画面是每个动作一种颜色的纯色色块）。
- **`pnpm dist`**：新增前置步骤 `scripts/mascot-dist.ts`，把运行时用到的文件（图集、`atlas.json`、头像）复制到 `apps/desktop/build/mascot/`（electron-builder 的 `extraResources` → `resources/mascot`），`icon.ico` 复制到 `apps/desktop/build/icon.ico`（electron-builder 默认从 buildResources 取应用和安装程序的图标）。两处都被 git 忽略，每次先清空再复制。**缺产物时默认失败**，提示先 `pnpm mascot:bake`；只有设了 `ALLAY_DIST_ALLOW_PLACEHOLDER=1` 才用 Electron 默认图标和 CSS 占位继续并打印警告。理由：安装包是给人用的，悄悄换成占位不容易被发现；CI 没有游戏时显式加这个变量。

### 组件（接口按 7.4 不变，多了可选的 `priority`）

- `Allay`：`<canvas>` 按 `size × devicePixelRatio` 在 96 和 288 里选不小于所需的一套，只在帧号变化时 `drawImage`；捧着的东西按 `handAnchor` 每帧摆位。小于 28 px 用头像。朝向水平翻转、转身 140 ms。`glow` 照旧不画。
- `AllayHead`：烘焙的正面头像，取设备像素不超过所需的最大一张、整数像素显示（`image-rendering: pixelated`）；睁眼、闭眼两张都在 DOM 里只切可见性（眨眼不闪）。减少动效时点击不转圈。头像不参与全局协调（7.2：顶栏头像不算）。
- **一个帧循环**（`ticker.ts`）：全应用的悦灵（帧动画、飞舞、进度、拖放）共用一个 `requestAnimationFrame`，回调里只写 `transform`、`opacity` 和画布，尺寸来自 `ResizeObserver`。每帧耗时记进定长环形缓冲，T-ALY-6 读它。7.4 说的是“一个区域内一个循环”，全应用一个更严。
- **全局协调**（`stage.ts`，T-ALY-3）：每个要画全身悦灵的地方在 layout effect 里申请位置，只批准一个：优先级高的，同级先来的。优先级：拖放 > 导出 > 对话框（首次发现、关于）> 方块选择器 > 预览视口 > 模板库 > 错误卡片 > 空状态。没批准的只留同样大小的空位（`data-allay="reserved"`），加载区域只剩骨架。外层已经拿到位置的（飞舞区域、导出进度、拖放）用 `MascotSlotHeld` 让里面的 `<Allay>` 不再另外申请。申请变化时 React 同步重渲染，同一次提交里一只消失另一只出现。
- **规格没写的取舍**：“我的”空状态和预览错误卡片同时出现时只有错误卡片有悦灵（错误更需要注意）；模板库与预览同时加载时悦灵在预览上（用户在看的地方）。

### 四段编排与出场位置

- A 骨架屏飞舞：M4 的时序与路径不变，换到帧循环上；退场时内容项“淡入并上移 8 px”按悦灵**实际**飞出的那一侧排序（M4 固定按右侧），上移的动画放在 `packages/mascot/src/mascot.css`（ui 的 `allay-item-in` 只有淡入，没有改它）。
- B 导出进度：弹簧跟随（临界阻尼，不过冲不抖）；进度条前端在动时放拖尾方点；“写完全部帧、等 FFmpeg 收尾”算封装：飞到进度条右端的文件图标，东西放进去，图标弹一下；完成 `dance` 2 秒后 `hover`；失败 `sad`、东西掉下淡出；取消向上飞出。导出对话框把进度和结果页做成同一个 `AllayProgress`（不重新挂载），结果页上悦灵接着演。捧着的方块：模板第一个 `block` 参数，或第一个 `blockList` 的第一项（缩略图）；都没有时捧胶片图标。标题的“像素字”不做（界面不用像素字，6.2）。
- C 启动画面：见下。
- D 拖放：拖进来时沿用 M4 的压暗、虚线框和 hover。放下后（`AllayDelivery`）：按文件名判断去向（`.allaytpl` → “我的”标签，`.zip` 和文件夹 → 顶栏素材按钮，其余无效 → `sad`），600 ms 内飞到目标、目标弹一下、退场；真正的安装和通知仍由 `useDropPacks` 做，没有改它。判断只看文件名，所以“文件名有效但内容坏了”时悦灵照样送过去，随后出错误通知。
- 第 4 项（方块/物品选择器）：`packages/ui` 不能依赖 mascot，所以 `EditorServices` 加了可选的 `pickerLoader(loading)`，网格里每格的缩略图报告“还没取到”的计数，应用据此在网格上盖一层 `AllayLoader`（整层不接收指针）。
- 其余位置（模板库、预览、空状态、首次发现、顶栏头像、错误卡片、关于页）M4 已经放了，这次只加优先级。

### 启动画面

- 页面是构建时由 `apps/desktop/src/splash/generate.ts` 生成的静态 HTML 和 CSS（Vite 插件放进 `out/renderer/splash/`），没有脚本：CSS `steps()` 按图集网格播 `fly`（飞入时）和 `hover`，捧着的方块按同一份模型代码算出的手部锚点逐帧摆位（不读烘焙产物，所以产物缺失时构建照常）。方块是三块中性灰的面（界面色），不是贴图。
- 文字不写死：产品名、字标、非官方声明取自 `packages/ui/src/brand`，状态字是新文案 `splash.starting`（两种语言）。颜色从 `globals.css` 的两套主题变量读出来。字体用系统字体兜底（启动画面不加载应用的字体文件）。
- 每种语言 × 主题一个页面，主进程按设置挑；地址片段用 `:target` 选状态（`#p` 缺产物用 CSS 占位，`#s` 设置里开了减少动效，`#ps` 两者都是），系统的减少动效由 `@media (prefers-reduced-motion)` 直接生效。
- 窗口：420×260、无边框、透明底、圆角 12、不进任务栏、可拖动。`webPreferences` 与主窗口逐项相同，只是没有 preload（不需要 IPC）；CSP、网络拦截、导航拦截照常（同一个 `app://` 处理与全局加固）。设置读完就创建。
- 时序：主窗口 `ready-to-show` 后等启动画面显示满 600 ms，再显示主窗口（保存过“最大化”的，最大化挪到这一刻：`maximize` 在 Windows 上会顺带显示窗口），然后启动画面 `moveTop` 后 180 ms 淡出并销毁。主窗口 20 秒都没就绪时启动画面自己关掉。这是对 `window.ts` 的最小改动（`beforeShow`、`onShown` 两个可选回调）。
- 后台测试默认不建启动画面（其余 e2e 依赖“第一个窗口就是主窗口”）；`ALLAY_E2E_SPLASH=1`（只在未打包时生效）时建一个不显示的，供启动画面的测试检查。

### 减少动效

- 组件在减少动效时都不订阅帧循环：没有飞行、拖尾、掉落、弹跳、内容上移；帧动画停在当前动作的第一帧；加载区域里悦灵静止在中央偏左，旁边是状态字；导出时静止在进度条前端（位置随进度跳变，不做位移动画），取消时直接隐藏；拖放时原地停 300 ms 后消失。
- `useThemeSync` 原来只在设置变化时读一次系统的 `prefers-reduced-motion`，现在“跟随系统”时也监听它的变化（T-ALY-4 用 `emulateMedia` 开启，正好依赖这一点）。

### 测试

- T-ALY-1、T-ALY-7：M5a 的 `tests/unit/T-ALY.mascot-bake.test.ts`（T-ALY-7 按 M5a 改过的判定），没有改。另在 `tests/unit/M5b.mascot.test.ts` 核对 `apps/desktop/build/mascot`、`build/icon.ico` 被 git 忽略。
- T-ALY-2：M4 的单元测试与 e2e（占位实现），时序代码没有改。
- T-ALY-3：`tests/e2e/m5b.spec.ts`，假图集。一个 MutationObserver 在每次 DOM 变化时数 `[data-allay="body"]`，脚本依次走：资源栈变化（模板库重建封面）与预览装载同时、方块选择器叠在上面、关于页、完整导出（含封装与舞蹈）、“我的”空状态与预览错误卡片同时、拖放有效与无效的文件。判定：最大值为 1，且出现过的位置包含飞舞、关于、导出、空状态、拖放（确认不是因为悦灵没出现才不超过一只）。协调的纯逻辑另有单元测试。
- T-ALY-4：设置为“跟随系统”，`emulateMedia({ reducedMotion: 'reduce' })`，走飞舞、拖放、导出、点头像；每 30 ms 采样：悦灵帧循环的订阅数始终为 0（没有脚本驱动的 transform 动画），悦灵相关元素上没有改 `transform`/`translate`/`rotate`/`scale` 的 CSS 动画或过渡。
- T-ALY-5：M4 的占位版保留；新增图集版，并核对悦灵各层的计算样式都是 `pointer-events: none`。
- T-ALY-6：飞舞 3 秒，读帧循环的耗时统计（p95 ≤ 1 ms）；同时用 DevTools 协议录性能跟踪，`FireAnimationFrame` 执行期间同一线程上的 `Layout` 事件必须为零。窗口不显示（帧率限制已关），测的是这台机器上的数值；跟踪里数的是所有 rAF 回调，不只是悦灵的，比规格更严。
- 启动画面：URL 选对了页面、没有脚本和 Node、帧来自图集且取得到、`webPreferences` 与 1.6 第 1 条一致、非官方声明逐字相同、从显示到关闭 ≥ 600 ms、关闭后窗口没了；缺产物 + 减少动效时是 `#ps`、CSS 占位、没有任何动画。

### 没做的、没验证的

- **没在可见窗口里看过启动画面和主窗口的衔接**（淡出、最大化的时机）：测试窗口不显示。评审录屏里的启动画面是在同一应用里另开一个同样设置的窗口录的。
- 7.2“用户拖滑块、拖时间轴时悦灵不出现”：加载编排本来不会在拖动时触发（M4：只改参数时走 `setParams`，不进入装载状态），没有另加抑制。
- 7.2“预览正在播放时不进入预览画布区域”：其他区域的飞舞都限制在自己的区域里（`overflow: hidden`），拖放的送达路线可能从预览上方飞过（600 ms 内结束）。
- 拖放的去向只按文件名判断（见上）。
- `icon.icns`（v1 只做 Windows）。打包后的应用图标只核对了文件被放进去，没有在资源管理器、任务栏里人工看过。

## M7 导出完善

音频（cue 调度、离线混音、`export.writeAudio`、各预设的音频封装、T-EXP-4）属于并行的 M6b，这里没有做。命令行构造函数已经留好音频的位置：`ffmpegArgs({ …, audio })` 有音频文件时加第二个输入 `-i <wav>` 和各预设的 `-c:a …`（5.3：①`pcm_s16le`、③`libopus 160k`、④`aac 192k`；② PNG 序列不经 FFmpeg 封装音频，WAV 另存），没有时与 M1 相同；两种情况各有单元测试。`ExportJobOptions.audio` 已经接到命令行，`ExportService.start` 还没有传它，留给合并时对接。

### 导出任务（H7）

- **任务在渲染进程**（`features/export/exportTasks.ts`）：画面在渲染进程的导出 Worker 里出，帧经 IPC 交给主进程的 FFmpeg，所以“一次导出”的主人是渲染进程。任务有编号（UUID）、状态（`preparing → rendering → muxing → done | failed | canceled`）、进度、剩余时间、结果或错误；存在一个 zustand store 里，结束的只留最近 10 个。一次只跑一个（导出是模态的，5.1）。
- **三个带类型的命令**，经注册表的 `dispatch`（`app/core.tsx` 注册）：`exportTask.start`（参数全可选：`preset`、`quality`、`shutterAngle`、`key`、`fileName`，省略的取工程的导出设置；返回 `{ taskId }`，立即返回，任务在后台跑）、`exportTask.get`（`{ taskId }` → 快照或 null）、`exportTask.cancel`（`{ taskId }` → `{ status }`，等任务真的停下、清理完才返回）。参数和返回值都有 zod schema。**不接受输出路径**（下一节）。三个命令都不在命令面板里列出（要参数；面板里的“导出”仍是打开对话框）。
- `effect` 三个都标 `read`：它们不改工程，也没有可撤销的修改；导出只会在用户用文件夹对话框选过的位置新建文件，重名时加 “ (2)”，从不覆盖。将来 MCP 要不要对 `start` 再加一道确认，由那时的接入决定。
- **对话框只是观察者**：设置页的“导出”调 `dispatch('exportTask.start')`，进度页、完成页只读任务快照，“取消”调 `dispatch('exportTask.cancel')`。对话框重新打开时接上正在跑的任务（e2e 里经命令启动、再打开对话框、经命令取消，都验证了）。状态栏的“导出中”跟着任务走。M1 里“对话框卸载就取消导出”的做法去掉了（导出进行中对话框本来就关不掉）。

### 输出位置与文件名

- 规格 6.4 的设置页有“输出位置和文件名”，M1 的做法（点“导出”后弹保存对话框）对不上。改成：**文件夹**只来自主进程的文件夹对话框（“更改…”，或者还没选过时点“导出”会先弹一次），记在设置文件里（`settings.json` 的 `export.folder`，只有主进程读写，坏了只回退这一项）；**文件名**在对话框里可以改，默认按 5.2 的规则生成。渲染进程只交文件名，主进程再清洗一次（路径分隔符、保留名都换掉），所以渲染进程仍然不能让主进程写任意路径（1.6 第 6 条）。
- **重名一律加 “ (2)”、“ (3)”**，四个预设都一样（M1 的 ProRes 由保存对话框确认覆盖，现在没有保存对话框了，所以也不覆盖）。启动时挑一次（正在写的别人的 `.partial` 也算占用），封装完成改名时再挑一次（以防这期间有人占了）。
- 规格之外多出的 IPC 方法：`export.outputFolder()`、`export.chooseFolder()`、`export.reveal(jobId)`（“在文件夹中显示”，只认这个进程里导出完成的任务，最近 20 个）、`export.copyDiagnostics(text)`（写系统剪贴板，最长 2 万字）。规格里的 `export.probeEncoders` 的参数是 `force: boolean`。T-ARC-6 的畸形参数表都补了。

### 编码器探测（5.3）

- 试编码的输入用 `lavfi` 的 `color` 源（256×144、30 fps、8 帧），走与导出相同的色彩滤镜、编码器参数和 `h264_metadata` 比特流滤镜，输出到 `-f null -`。`-encoders` 里没有的候选不试，记 `unlisted`；单个候选 20 秒超时。
- **缓存**：结果连同 `ffmpeg -version` 的第一行存在设置文件的 `export.h264`；版本对不上就当没探测过。**“首次需要时”**：打开导出对话框或顶栏的格式下拉时，如果还没有缓存就在后台探测一次（卡片上显示“正在检测…”）；点“导出”时主进程再确认一次（有缓存直接用）。没探测过时，只要 `-encoders` 里有任何一个候选，绿幕就先算可用（不让界面闪成禁用）。
- 全部失败：绿幕卡片和下拉项置灰，写明“这台电脑上没有可用的 H.264 编码器（可在设置里重新检测）”；设置 → 导出的“重新检测”忽略缓存重新试编码（M4 时禁用的按钮现在可用）。
- 测试开关 `ALLAY_E2E_H264`（逗号分隔的编码器名，只认编码器名的字符，最多 8 个，只在未打包时生效）代替 5.3 的候选表，e2e 用它造“全部失败”。
- **本机实测**（固定的 n9.0.2 LGPL 构建，RTX 5070 笔记本 + Intel 核显）：`h264_nvenc` 成功（被选中）、`h264_qsv` 成功、`h264_amf` 失败（列表里有，没有 AMD 显卡）、`h264_mf` 成功、`libx264` 不在构建里、`libopenh264` 成功。T-EXP-1 ④ 对四个能用的都测了（1080p 八色块，最大误差 nvenc 3、qsv 3、mf 4、openh264 4），T-EXP-3 ④ 四个都带对了 bt709 标记。**AMD 的 `h264_amf` 没有实测过能编码**，它的参数照 5.3。
- T-EXP-1 ④ 改用 1920×1080 的八色块：`h264_mf`、`libopenh264` 的码率按像素数 × 帧率缩放，在 256×144 上只有约 0.2 Mbps，`libopenh264` 误差到 5，测的不是实际会用的画质。判定（≤ 4）没变。
- `libopenh264` 兜底保留、排最后（H-H264 的默认，等人决定）。

### 设置页的其他项

- **分辨率**：导出对话框按 5.2 列 1920×1080、2560×1440、3840×2160、1080×1920、1080×1080 和“自定义”（宽高输入框，失焦或回车时修正：限制在 64–4096、奇数减一，`evenDimension`）。改的是工程的输出设置（与“输出”标签页同一份）。“输出”标签页和设置里的 `OutputSettingsForm` 仍是 M4 的列表（有 720p、没有 1440p 和自定义），不在 M7 的范围里，没改；工程是自定义分辨率时那个下拉显示的是 1080p（只是显示不对，值没变）。
- **快门角** 0–360，整数，存在工程里（M1 起就有这个字段，之前固定 180）。草稿画质（1 个子帧）下快门角不起作用，界面没有特意禁用。
- **绿幕底色**：绿、蓝、黑和自定义（十六进制输入），存在工程的 `export.key`（新字段，旧工程没有时是 `#00FF00`）。只有绿幕预设用不透明模式渲染（5.1 第 2 步）。
- **体积估算**：按 5.9 的实测折算成每像素每帧的字节数（ProRes 约 107 MB / 120 帧 1080p，PNG 约 5 MB，VP9 约 2 MB，H.264 按 1080p60 20 Mbps），乘以像素数和帧数，界面写“约”。实际体积取决于画面内容，PNG 和 VP9 的偏差可能很大。
- **遮盖检查**（5.8）：设置页打开、或画质 / 快门角 / 输出 / 模板 / 参数变了以后 250 ms，另起一个导出模式的 Worker，按输出分辨率和所选画质、快门角渲染剪辑点那一帧（直通 alpha），最小 alpha 不到 255 就警告，不禁用“导出”。叠加层写“没有剪辑点”。导出过程中剪辑点那一帧的最小 alpha 也记进任务结果（`cutMinAlpha`，绿幕不记）。

### 进度、完成、失败

- 进度页：`AllayProgress`（按现有接口：`value`、`phase` 为 `rendering` / `muxing`、`carry`、`label`；外观由 M5b 做）、阶段、百分比、当前帧 / 总帧数、剩余时间（最近 20 帧的平均耗时，5.7）、“取消”。悦灵捧的是模板第一个方块参数的第一个方块的缩略图，没有方块参数时是胶片图标（7.6 B）。
- 完成页：“导出完成”、文件路径、剪辑点（`第 n 帧（分:秒:帧）`，与时间轴的时间码写法一致）、用到的 H.264 编码器、“在文件夹中显示”“再导出一个”“完成”。
- 失败页：错误码对应的一句话、停在哪一帧、“没有留下任何临时文件”、“复制诊断信息”（应用版本、FFmpeg 版本、H.264 探测结果、模板 ID、预设与输出设置、帧数、错误码、FFmpeg stderr 的最后几行；不含文件内容）、“返回设置”。取消后同样可以返回设置。
- 导出期间阻止休眠：M1 已接 `powerSaveBlocker('prevent-app-suspension')`；“job started”日志多记一项 `sleepBlocked`，e2e 核对它。没有验证系统真的没有休眠。
- `encoder-unavailable` 的文案从“随附的 FFmpeg 里没有这个格式的编码器”改成“没有可用的编码器来导出这个格式”：现在它也覆盖“探测过、但 H.264 编码器在导出时打不开”的情况。

### 顶栏与格式卡片

- 顶栏“导出”分体按钮的下拉列出全部四个预设，每项第二行是“适用于”的软件；不可用的置灰，第二行换成原因。打开下拉时同样会触发首次探测。
- **格式卡片的“适用于”是按规格写的，没有在真实剪辑软件里验证过**（M7 的人工确认项，见 `docs/review/M7/README.md`）。确认后改文案（两种语言）。

### 测试

- test:export（真实 FFmpeg，`tests/export/export-m7.test.ts`）：T-EXP-1 ③④、T-EXP-3 ③④、T-EXP-5 ③④、T-EXP-6 ③④（含 H.264 编码器在导出时打不开）、T-EXP-8、T-EXP-9（不在列表里的跳过；在列表里但必然失败的 `h264_vaapi` 和伪造进列表的名字都真的试一次并失败；全部失败时没有胜出者）、重名不覆盖。①② 的同名测试在 M1 的文件里。
- 单元测试：`export-m7.test.ts`（命令行有无音频、编码器参数与码率缩放、预设可用性、偶数修正、文件名、体积估算、时间码）、`export-task.test.ts`（引擎和 `window.allay.export` 换成假的，测三个命令的参数与返回值校验、状态机、一次只跑一个、取消、模板出错）。
- e2e（`tests/e2e/export.spec.ts`）：六个内置模板经 `exportTask.start` 各以 1080p60 标准画质导出 ProRes，核对时长（帧数 / 60）、帧数、首末帧最大 alpha 为 0、剪辑点最小 alpha 为 255（叠加层 T6 改为“中间有画面”）、bt709 / tv 标记与剪辑点注释；T-EXP-7 的其余三个预设经真实界面（PNG、WebM 的 alpha 判定同 ①；绿幕首末帧是纯底色）；任务命令；H.264 全部失败；T-EXP-8 界面；复制诊断信息；遮盖检查。M1 的 T-EXP-5/6/7 界面测试照旧通过（只改了日志里预设列表的期望）。
- 测试钩子多了 `dispatch(id, input)`：经注册表执行命令，出错时返回 `{ error: code }`。
