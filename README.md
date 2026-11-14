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
pnpm dev
```

常用命令（完整列表见 [`docs/01-product-architecture.md`](docs/01-product-architecture.md) 1.10）：

| 命令 | 作用 |
|---|---|
| `pnpm check` | 类型检查、lint、单元测试、引擎测试、导出测试、来源登记检查、许可检查、端到端测试 |
| `pnpm check:removable` | 可选模块目录不存在时 `pnpm check` 照常通过 |
| `pnpm dist` | 生成 Windows 安装包（`apps/desktop/release/`），并跑打包后的检查 |
| `pnpm licenses:gen` | 依赖变了之后重新生成第三方许可清单 |

悦灵的图集、头像和应用图标（`packages/mascot/generated/`）是由 Minecraft 原版悦灵贴图烘焙出的派生图像，版权归 Mojang；仓库里提交了运行时和打包要用的那几个，所以构建不需要游戏。`pnpm mascot:bake` 从本机安装的 Minecraft Java 版（或加 `--download` 从 Mojang 下载）读取贴图重新烘焙；原版贴图本身不进仓库。

## 持续集成与安装包

- GitHub Actions 跑 `pnpm check` 和 `pnpm check:removable`（`.github/workflows/ci.yml`）。CI 的 WebGL 是软件渲染（WARP），引擎和端到端测试比在显卡上慢得多；只在软件渲染下放宽的地方见 `docs/decisions.md` M8。
- 维护者的流程（不开 PR）：推工作分支（`claude/…`）→ CI 在这个提交上通过 → 把**同一个提交**快进推到 `main`。`main` 上的 push 发现这个提交已经通过就不再重跑。
- 外部贡献者照常从 fork 发 PR，CI 在 PR 上跑；见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 安装包：推 `v*` 标签或手动触发 `.github/workflows/release.yml`，构建 Windows 安装包，建一个挂着安装包和 `SHA256SUMS.txt` 的**草稿** Release；核对过资产后由人改为公开发布。安装包没有代码签名，SmartScreen 会提示“未知发布者”。
- v0.1.0 由仓库所有者于 2026-11-14 决定公开发布；[`docs/release-checklist.md`](docs/release-checklist.md) 里品牌、名称、签名等项当时尚未逐项确认，状态照实写在清单里。

## 第三方软件与许可

- FFmpeg（LGPLv3）以独立进程调用，随安装包附带许可全文；构建来源和源码去处写在应用的“关于”页。
- 方舟像素字体、IBM Plex、Noto Sans SC 使用 SIL Open Font License 1.1。
- 其余依赖使用 MIT、BSD、ISC、Apache-2.0 等许可；完整清单在“关于 → 第三方许可”和安装目录的 `THIRD_PARTY_NOTICES.txt`。

## 许可 / License

**中文**

- 本项目以 [GNU 通用公共许可证第 3 版](LICENSE)（**GPL-3.0-only**）授权。
- **商业授权**：需要以 GPL 不允许的方式使用（例如用在闭源产品里），请通过本仓库的 [Issues](https://github.com/Mystic-Stars/Allay-Motion/issues) 联系版权人，另行取得商业授权。
- 用本软件导出的视频归使用者所有，不受本许可约束。
- **许可范围**：GPL-3.0 和商业授权只覆盖本项目自己的代码和原创素材，都**不包含** Minecraft 的任何内容：Minecraft 的名称与商标；应用在运行时从 Mojang 下载或从本机游戏读取的原版资源（贴图、模型、音效、字体、语言文件等）；用户自己添加的第三方资源包；以及由它们派生的内容，包括照原版悦灵制作的模型数据（`packages/mascot/model/` 里与 Mojang 设计对应的部分）和由原版贴图渲染的悦灵图像（`packages/mascot/generated/`）。这些内容的权利属于 Mojang 或各资源包的作者，本项目未获授权、不分发原版资源包，也不对它们授予任何权利；使用者需自行遵守 Minecraft 最终用户许可协议和各资源包的许可。

**English**

- This project is licensed under the [GNU General Public License v3.0](LICENSE) (**GPL-3.0-only**).
- **Commercial license**: to use it in ways the GPL does not allow (for example in closed-source products), contact the copyright holder through this repository's [Issues](https://github.com/Mystic-Stars/Allay-Motion/issues).
- Videos you export with this software belong to you and are not covered by this license.
- **Scope**: the GPL-3.0 license and the commercial license cover only this project's own code and original assets. **Neither includes** any Minecraft content: the Minecraft name and trademarks; the vanilla resources the app downloads from Mojang at runtime or reads from your installed game (textures, models, sounds, fonts, language files and so on); third-party resource packs you add; and anything derived from them, including the Allay model data made after the original (the parts of `packages/mascot/model/` that correspond to Mojang's design) and the Allay images rendered from the original texture (`packages/mascot/generated/`). Those rights belong to Mojang or to the resource pack authors. This project is not licensed by them, does not distribute vanilla resource packs and grants no rights to them; follow the Minecraft EULA and each resource pack's license yourself.

贡献代码前请读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 文档

规格在 [`docs/`](docs)：从 `AGENTS.md` 的“先读什么”开始。实现中的决定与偏差记在 [`docs/decisions.md`](docs/decisions.md)，模板编写指南在 [`docs/template-authoring.md`](docs/template-authoring.md)。
