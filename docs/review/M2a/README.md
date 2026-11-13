# M2a 评审说明

**做了什么**
- `packages/assets`：
  - 方块目录（112）、物品目录（42）、名称表（中英）、着色常量。
  - 资源栈纯逻辑：叠加、开关、重排、`resourceStamp`。
  - `.mcmeta` 动画和 `pack.mcmeta` 解析。
  - sounds.json 合并与变体选择。
  - 字体提供器解析。
  - 目录覆盖率工具。
- 主进程 `apps/desktop/src/main/resources/`：
  - 资源层：内置（通用目录层）、zip、文件夹、原版（jar 加资源索引）。
  - zip 导入，防路径穿越和解压炸弹。
  - 本机 Minecraft 探测。
- 运行时下载（用户批准的“不联网”例外）：只在主进程、只用 https、只访问三个写死的 Mojang 主机，拒绝重定向，校验 sha1 和大小，用户同意后才调用。
- 验收：T-AST-1、4、5、6 和 T-AST-DL-1 到 9 通过，全部用本机假服务器和假夹具，不访问真实网络。

**范围变更**：用户取消自制贴图和音效，素材改为运行时只读本机游戏 jar。已写好的生成器和产物已经删除，T-AST-7 和 H-ART 不再适用。“没装游戏也能用”不再成立，没有素材时界面怎么表现待确认。运行时从 Mojang 下载 jar 已经过用户批准并实现，发布前要人确认 H-DOWNLOAD（是否符合 Mojang 条款）。详见 `docs/decisions.md` 的 M2a 节。

**本机冒烟**（`pnpm exec tsx scripts/smoke-vanilla.ts`，手动运行，只读，不进 `pnpm check`）
- 选中 `1.21.1`：`26.3` 没有 jar，`26.4-snapshot-1` 不是正式版，`fabric-loader-*` 没有自己的 jar。
- jar 里 `assets/` 下 8448 个文件。
- 目录贴图全部能解析：方块 132/132，物品 42/42，界面 6/6。
- 本机 `.minecraft` 没有 `assets/` 目录，所以资源索引不存在，音效事件 0/10。

**真实下载冒烟**（`pnpm exec tsx scripts/smoke-download.ts`，手动运行，会联网，不进 `pnpm check`，下载到仓库外的临时目录）
- 第一次运行：最新正式版 `26.3`（2026-09-15），jar 41 483 720 字节，sha1 校验通过，用时约 128 秒。
- 目录贴图 180/180 全部能解析；jar 中 `assets/` 下 16745 个文件。
- 按需取音效 `dig/stone1.ogg`（7434 字节）成功。
- 第二次运行只请求了清单和版本 JSON（约 2 秒），jar 没有重新下载。

**和规格不同**
- `ResourceLayer` 多了 `revision` 字段。
- 只要有一个不安全的 zip 条目，整个包就被拒绝。
- 探测时，用户上次手动选的目录优先于默认目录。
- 测试夹具在测试时生成，不提交。
- 指南针、时钟取第一帧贴图。

**没验证的**
- 云杉、白桦的着色值按记忆填写，没有联网复核。
- 带资源索引的原版层（音效）只用假夹具测过。
- 贴图没有在引擎里渲染过（等 M2b）。

**留给 M2b 的接线点**
- 主进程资源层：`apps/desktop/src/main/resources/index.ts` 导出以下函数，都不依赖 Electron：
  - `openBuiltinLayer(root)`
  - `openFolderPack(dir, id)`
  - `openZipPack(file, id)`
  - `importZipPack(src, userData)`
  - `packZipPath()`
  - `detectMinecraft(env, lastChosen)`
  - `openVanillaLayer(install)`
- `@allay/assets` 的纯逻辑：
  - 资源栈：`buildStack()`、`resolveLayer()`、`readResource()`、`setLayerEnabled()`、`moveLayer()`、`computeResourceStamp()`。
  - 设置：`ResourceStackSettingsSchema`，接进 settings.json。
  - 目录与动画：`resolveBlockFaces()`、`layoutAnimation()`、`animationFrameAt()`。
  - 音效：`mergeSoundDefinitions()`、`expandSoundEvent()`、`pickSoundVariant()`。
  - 字体：`resolveFontProviders()`、`findGlyph()`、`glyphInkWidth()`。
  - 覆盖率：`requiredTextures()`、`findMissing()`。
- 运行时下载：
  - `createVanillaDownloader({ cacheDir, packaged })` 提供 `findCached()`（离线）、`downloadLatest({ signal, onProgress })`、`fetchObject()`。
  - `chooseVanillaSource(local, cached, prefer)` 返回 `local`、`cached` 或 `needs-download`。
  - 打开下载缓存的原版层：`openVanillaLayer(install, { fetchObject })`。
  - 接线时，征求用户同意的对话框和进度界面由 M2b 做。
- 待做验收：T-AST-2（需要按新前提改判定）、T-AST-3。
