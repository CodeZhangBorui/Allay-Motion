# M8 打包与发布准备：评审说明

**做了什么**：NSIS 安装包（按用户安装，Windows x64）去掉了 Electron 自带的 `default_app.asar`，加了 `.allay`、`.allaytpl` 的文件关联（双击和第二实例参数经主进程的命令通道交给界面）、欢迎页的非官方声明、安装目录的 `THIRD_PARTY_NOTICES.txt`；关于页有完整的第三方许可清单、FFmpeg 的来源和源码去处、悦灵图像的来源；找不到 WebGL 2 时显示说明页；量了打包后的冷启动；写了 `README.md`、`CHANGELOG.md` 和发布清单 `docs/release-checklist.md`。决定和偏差见 `docs/decisions.md` 的 M8 一节。

**截图**（`pnpm build` 后 `pnpm review:m8` 重新生成；悦灵是 CSS 占位，没有原版素材）：

- `m8-about-top-*.png`：关于页上半——版本、非官方声明、悦灵图像的来源、Minecraft 使用准则的地址、许可摘要、FFmpeg 的构建与源码去处。
- `m8-about-*.png`：同一页往下，完整清单，展开了 three 一项的许可原文。
- `m8-no-webgl-*.png`：关掉 GPU 和软件渲染模拟“没有 WebGL 2”时的说明页。

**要人做的**（M8 的人工验收）：在一台干净的 Windows 上运行 `apps/desktop/release/Allay Motion-0.1.0-x64-setup.exe`：

1. SmartScreen 会拦（没签名，H-SIGN），选“仍要运行”。
2. 欢迎页：中英文的非官方声明完整显示。
3. 装完：开始菜单和桌面有快捷方式，图标是悦灵头像。
4. 双击一个 `.allay` 工程文件、一个 `.allaytpl` 模板包：应用打开它们；应用已经开着时交给那个窗口，不开第二个。
5. 导出一个转场。
6. 卸载：快捷方式和文件关联没了；`%APPDATA%\AllayMotion` 按设计保留。

**没验证的**：没有在任何机器上实际安装和卸载过（不在用户的机器上注册文件关联）；欢迎页、快捷方式、文件关联只核对了 electron-builder 生成的安装脚本；应用图标没有在资源管理器、任务栏里看过；冷启动只在这台机器上量过，文件缓存是热的。
