# 第 0 批（前置）的记录

2026-11-19。范围是 `docs/template-catalog.md` 的 3.2（P1、P2、P3）和 4.3。这一批不做模板。

## 做了什么

| 项 | 改动 | 提交 |
|---|---|---|
| P3 可选贴图 | `ctx.resources.texture(id, { optional: true })`：资源栈里没有时返回 `null`、不记警告。`runtime.ts` 加一个重载，引擎 `EngineResources.texture` 多一个参数；`pnpm templates:api` 的三个产物重新生成；`04` 4.5 加一行。测试 T-TPL-OPT-1（`tests/engine/m2.spec.ts`） | `feat(engine): 可选贴图…` |
| P2 目录扩充 | 方块 112 → 278，物品 42 → 249，名称表同步；`03` 3.7 加一段 | `feat(assets): 方块目录扩充…` |
| P1 共用源码 | `packages/templates/_lib/`：`timing.ts`、`gui.ts`、`particles.ts`；构建脚本和 lint 的规则；`04` 4.9。测试 T-TPL-LIB-1 至 4 | `feat(templates): 内置模板共用的源码目录…` |
| 数量断言 | `template-dev.test.ts`、`T-DEV-3.template-api.test.ts` 里写死的 6 改成按模板目录数 | `test: 内置模板的数量断言…` |
| 分片与过滤 | `tests/engine/shard.ts`；`ALLAY_TPL_SHARD`、`ALLAY_TPL_ONLY`；`pnpm templates:baselines <名字…>`。测试 T-TPL-SHARD | `test: T-TPL-3/4/5 可以分片…` |
| 目录遍历的测试 | `M6b.audio.test.ts` 遍历模板目录时没有先看有没有 manifest，改成用 `templateDirs()` | `test: 音效默认值的检查…` |
| 骨架 | 94 个目录，各有 `package.json`、`tsconfig.json`、占位的 `src/index.ts`；锁文件更新一次 | `chore(templates): 建好 94 个…` |
| 文档 | 目录的质量标准加“对照游戏文件核对”一组、4.3 写回结论、5.1 记用户的决定；`04` 4.10 末尾加一节；`decisions.md` 加一节；本目录的 `README.md` 和这份记录 | `docs: …` |

## 骨架方案的结论

走得通，照做了。

- 只有 `package.json`、`tsconfig.json` 和内容为 `export {}` 的 `src/index.ts`、没有 `manifest.json` 的目录：`pnpm typecheck`（含 `pnpm -r typecheck`，111 个 workspace 项目）和 `pnpm lint` 都过。
- 构建脚本的 `templateDirs()` 本来就只认有 `manifest.json` 的目录，骨架不会被打包；加了“跳过 `_` 开头的目录”。
- 按目录遍历的测试里有一个没看 manifest（`M6b.audio.test.ts`），已经改掉。其余的（T-DEV-3、官网测试的模板计数、引擎测试的虚拟模块）都只认有 manifest 的目录。
- `_lib` **没有**按目录原来写的“不带 `package.json`”来做：它的源码要解析到 `@allay/template-sdk` 的类型，所以做成了一个 workspace 包（`@allay/template-lib`，只有 devDependencies）。`pnpm-workspace.yaml` 没有改。不带 `package.json` 的目录会不会让 workspace 的通配报错，因此没有去验证。
- 实现一个模板时：在自己的骨架目录里加 `manifest.json`，换掉 `src/index.ts`，不用碰 `package.json`、`tsconfig.json` 和锁文件。骨架 `package.json` 的 `description` 里写着目录的编号和中文名。

## P1：和目录写的不一样的地方

- 目录说“lint 放行 `_lib`”。实际上 lint 原来对相对路径一律放行，“只能导入本目录”只是约定，没有检查。所以这次是**收紧**：往上两层的相对导入只能去 `_lib`；构建脚本按解析后的真实路径再拦一次（lint 的正则管不到写在更深子目录里的文件）。
- `_lib` 只放了三样：时间余量、界面像素布局、闭式粒子的基础。目录里提到的“带贴图的长方体”（P4）、“按钮和面板的拼法”没有放，等有模板要用时再加，免得预先堆没人用的代码。
- 现有六个模板没有改成用 `_lib`（block-wipe 和 block-fall 各自的 `arrangement.ts`、T-ARR-7 都没动）。以后可以改，那会改变它们的构建产物。
- `timing.ts` 的公式照 block-wipe 里内联的那份写，T-TPL-LIB-1 拿具体数值核对。叠加层的 `overlayWindows` 是照 advancement-toast 的做法归纳的，没有逐项和它的代码对过。
- 构建产物：改构建脚本前后各构建一次，六个 `.allaytpl` 的 SHA-1 逐个相同。

## P2：加了多少、怎么核对的

- 新增方块 166 个、物品 207 个。清单在 `tests/unit/assets-catalog.test.ts` 的 `EXTRA_BLOCKS`、`EXTRA_ITEMS`。
- 核对方式：写了一个不进仓库的草稿脚本，只读本机 `D:\Minecraft\.minecraft` 里两个版本的文件——`versions/26.3-Vanilla/26.3-Vanilla.jar` 和 `versions/1.21.1/1.21.1.jar` 的文件清单与 `assets/minecraft/lang/en_us.json`，以及资源索引（34 和 17）指向的 `zh_cn.json`。每个候选条目要同时满足：用到的每张贴图在两个 jar 里都有；`block.minecraft.<id>` 或 `item.minecraft.<id>` 在两个版本的两种语言里都查得到。不满足的不收。
- 候选里被拒掉的三个：`quartz_pillar`、`purpur_pillar`（我凭记忆写的侧面贴图名在 26.3 里不存在）、`heavy_core`（没有物品贴图，只有模型）。这正是“不能凭记忆”的例子。
- 两个版本之间名称不一致的条目：没有。
- 顺带核对了原有的 154 条：贴图全部存在；名称有四条和游戏不一样，改成了游戏里的叫法（云杉木板、白桦木板、干草捆、铁桶）。
- 之后用仓库里的 `scripts/smoke-vanilla.ts` 对本机游戏目录再跑了一遍（它选中的是另一个版本目录“Vanilla Perfected”）：方块贴图 344/344、物品贴图 248/248。
- 没有把任何游戏文件复制进仓库；`names.json` 里是整理后的名称表，和原来的做法一样。
- 唱片在游戏里都叫“音乐唱片”，按 ID 括注区分（`音乐唱片（cat）`），沿用 `music_disc_13` 原来的写法。括注里是 ID 的后半段，不是曲名。
- 没有收的：药水、喷溅药水、刷怪蛋、皮革护甲（物品贴图要叠层染色，目录的格式是一张贴图）；盾牌、床、箱子、旗帜（只有模型）；1.21.1 里没有的新内容（苍白橡木等）。要用这些的模板自己用 `ctx.resources.texture()` 取贴图来画。
- 金合欢、丛林、深色橡木、红树的树叶用 `foliage` 着色。红树树叶在游戏里是固定色，这里是近似。

## 给后面批次的提醒

- **默认音效不再受基础表限制**（2026-11-20 主控决定后改的）：下载时一并取回的清单从内置模板的 manifest 推出来，新模板在自己的 manifest 里写默认音效就行。规则见目录第 2 节“声音”：事件 ID 要对照本机游戏文件核对，挑体积小的。
- **T-TPL-5 的那一项已经处理**：在这一批之前的提交（c205608）上单独跑了 T-TPL-5，同一帧、同一个误差值（2.1184874/255）同样失败，证实是旧基准图过期。随后用 `pnpm templates:baselines advancement-toast` 只重新生成了这一个模板的基准图。接着露出来的 `loading-screen` 同样处理（同样在 c205608 上证实）。现在六个现有模板的 T-TPL-5 全部通过。
- 物品选择器里方块和物品是合在一起的，两份目录没有重名（测试里加了断言）。
- 用可选贴图时注意：缺失的贴图不进缓存，每次 `setup` 都会再问一次宿主。按版本试两三个路径没问题，不要在循环里试几十个。

## 跑过哪些检查

都在本机（Windows，真实显卡），全部提交完成之后跑的：

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test`（vitest 63 个文件 653 项，加两个 node 测试 14 项） | 通过 |
| `pnpm check:provenance` | 通过（没有新增二进制素材） |
| `pnpm check:licenses` | 通过（没有新增生产依赖） |
| `pnpm templates:build` 前后比对 | 六个产物逐字节相同 |
| `pnpm test:engine` | 39 项里 38 项通过，**T-TPL-5 失败** |

每个提交单独能不能过类型检查：P3、P2、P1 三个提交各自提交前跑过相关包和根目录的 `tsc`；其余提交只改测试和文档。**没有**逐个检出每个提交重跑完整的 `pnpm typecheck`。另外，P1 那个提交单独检出时 `pnpm test` 会有一项失败（`M6b.audio.test.ts` 遇到没有 manifest 的 `_lib`），在两个提交之后修掉。

T-TPL-5 的失败：`allay.builtin.advancement-toast` 的 1:1 画幅、25% 那一帧，平均绝对误差 2.12/255，上限 1.5。基准图是 M6a 时生成的，而这个模板在 2026-11 的“原版动画还原与字体”里重做过，`docs/decisions.md` 那一节写了“T-TPL-5 的基准图没有重新生成……CI 上 T-TPL-5 会失败”。这一批没有改任何现有模板（构建产物逐字节相同），所以判断不是这一批引入的；**没有在这一批之前的提交上单独跑一遍来证实**。测试在第一个不合格的帧就停了，别的模板、别的帧有没有问题不知道。基准图没有重新生成：那要有人对着联络图看一眼再提交，不属于这一批。

## 没验证的

- `pnpm test:export`、`pnpm test:website`、`pnpm test:e2e` 没跑，以 GitHub Actions 为准。目录扩充后物品和方块选择器里的条目多了一倍多，界面上的表现（滚动、搜索、缩略图生成的时间）没有起应用看过。
- 新增的方块和物品只核对了“贴图存在、名称查得到”，没有在应用里逐个看渲染出来对不对。朝向类的方块（发射器、侦测器、织布机等）各个面的贴图是按贴图文件名推的，没有对照游戏里的模型文件。
- 官网的演示用到 `blocks.json`（`apps/website/src/host/demo-pack.ts` 按贴图名里的词给色块挑颜色），条目多了以后官网的表现没看。
- 分片在 CI 上没有用起来（`.github/workflows/ci.yml` 没改），只有 `shard.ts` 的单元测试和本机不分片的一次完整运行。
- `pnpm templates:baselines <名字…>` 只改了脚本、过了类型检查，没有实际跑过。
- 可选贴图在真实的旧版本素材上（1.20.1 及更早）没有试过，只有假资源栈的测试。
