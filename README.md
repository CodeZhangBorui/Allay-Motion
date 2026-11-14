> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
> 本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。

# Allay Motion（悦灵动画）

给 Minecraft 视频创作者做 YouTube 风格转场动画的桌面应用：选模板、调参数、实时预览，导出带透明通道的短片，拖进剪辑软件盖在两段素材的接缝上。

> 还没有对外发布。发布前要人确认的事项见 [`docs/release-checklist.md`](docs/release-checklist.md)。

## 能做什么

- 六个内置模板（方块擦除、方块坠落、物品飞掠、加载界面、像素溶解、进度提示），参数面板、预设、派生模板、模板包的导入导出、脚本模板。
- 模板开发模式：用自己的编辑器改模板文件，预览自动刷新，出错时显示带行列号的诊断。
- 素材：应用不自带 Minecraft 的贴图和音效。可以用本机安装的游戏，或在你同意后从 Mojang 官方服务器下载原版资源（只在你点按钮时联网），再叠上自己的资源包。
- 导出：透明 MOV（ProRes 4444）、PNG 序列、透明 WebM（VP9）、绿幕 MP4（H.264）；运动模糊；音效。
- 中文和英文，深色和浅色主题。

## 系统要求

- Windows 10/11 x64（v1 只做 Windows）。
- 支持 WebGL 2 的显卡和驱动。没有时应用会显示说明页和诊断信息。

## 隐私与网络

应用默认完全离线：没有账号、遥测、崩溃上报、自动更新。唯一的联网是你在应用里点“下载原版资源”或取回音效时，主进程只访问 `piston-meta.mojang.com`、`piston-data.mojang.com`、`resources.download.minecraft.net`，不发送任何标识。日志只写在本机的 `%APPDATA%\AllayMotion\logs`。

## 从源码构建

需要 Node 24+ 和 pnpm 12。

```bash
pnpm install
```

```bash
pnpm ffmpeg:fetch
```

```bash
pnpm mascot:bake
```

```bash
pnpm dev
```

常用命令（完整列表见 [`docs/01-product-architecture.md`](docs/01-product-architecture.md) 1.10）：

| 命令 | 作用 |
|---|---|
| `pnpm check` | 类型检查、lint、单元测试、引擎测试、导出测试、来源登记检查、许可检查、端到端测试 |
| `pnpm check:removable` | 可选模块目录不存在时 `pnpm check` 照常通过 |
| `pnpm dist` | 生成 Windows 安装包（`apps/desktop/release/`），并跑打包后的检查 |
| `pnpm licenses:gen` | 依赖变了之后重新生成第三方许可清单 |

`pnpm mascot:bake` 从本机安装的 Minecraft Java 版（或加 `--download` 从 Mojang 下载）读取悦灵的贴图，烘焙出应用里用的图集和图标；这些派生图像不进仓库。

## 第三方软件与许可

- FFmpeg（LGPLv3）以独立进程调用，随安装包附带许可全文；构建来源和源码去处写在应用的“关于”页。
- 方舟像素字体、IBM Plex、Noto Sans SC 使用 SIL Open Font License 1.1。
- 其余依赖使用 MIT、BSD、ISC、Apache-2.0 等许可；完整清单在“关于 → 第三方许可”和安装目录的 `THIRD_PARTY_NOTICES.txt`。

项目自己的许可证还没有决定（H-LICENSE）。

## 文档

规格在 [`docs/`](docs)：从 `AGENTS.md` 的“先读什么”开始。实现中的决定与偏差记在 [`docs/decisions.md`](docs/decisions.md)，模板编写指南在 [`docs/template-authoring.md`](docs/template-authoring.md)。
