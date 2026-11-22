# 03 素材与资源栈

包：`packages/assets`（解析、目录数据）；读取在主进程，解码在渲染进程。

## 3.1 目标

- **开箱即用**：没装游戏、没有资源包，所有内置模板也能完整预览和导出。
- **可替换**：用户的资源包能改变方块、物品、界面贴图和音效的外观。
- **干净**：仓库和安装包里没有任何 Mojang 的文件（规则见 `09-compliance.md`）。

## 3.2 三层资源栈

从下到上：

| 层 | 来源 | 是否随安装包分发 | 说明 |
|---|---|---|---|
| `builtin` | `resources/builtin-pack/` | 是 | 本项目自制的素材，覆盖内置模板和目录用到的全部资源 ID |
| `vanilla` | 用户本机的 Minecraft Java 版客户端 jar 和资源索引 | 否 | 只读引用，不复制；找不到就没有这一层 |
| `pack`（可多个） | 用户添加的资源包（zip 或文件夹） | 否 | 用户可排序、可开关 |

解析规则与游戏一致：从最上层往下找，第一个启用且包含该文件的层胜出。`builtin` 永远在最底下且不能关闭。

```ts
interface ResourceLayer {
  id: string;
  kind: 'builtin' | 'vanilla' | 'pack';
  name: string;
  description?: string;
  icon?: Uint8Array;            // pack.png
  packFormat?: number;
  enabled: boolean;
  has(path: string): boolean;   // 例如 "assets/minecraft/textures/block/stone.png"
  read(path: string): Promise<Uint8Array | null>;
  list(prefix: string): string[];
}
```

- 资源 ID 写成 `命名空间:路径`。贴图 `minecraft:block/stone` 对应文件 `assets/minecraft/textures/block/stone.png`，可能伴随 `stone.png.mcmeta`。
- `resourceStamp` 是对（各层 id、文件修改时间、启用状态、顺序）的哈希。它变了，引擎缓存和所有缩略图缓存一起失效。
- 读取 zip 和 jar 用 `yauzl`（按中央目录随机读取，不整包解压）。
- 所有层都缺某个贴图时，用品红黑棋盘格占位，并在 `LoadResult.warnings` 里报告。不得崩溃。

## 3.3 内置层 `builtin`

- 命名与目录结构采用现代 Java 版资源包的约定（1.13 之后的路径和文件名），这样用户资源包可以直接覆盖。
- **第一阶段全部由脚本生成**：`scripts/gen-builtin-pack.ts` 用确定性的程序化算法画出 16×16 贴图。方块按配方生成（底色 + 噪声 + 图案：砖缝、木纹、矿点、金属块边框、羊毛纹理等），物品用代码里的 16×16 字符网格加调色板手绘。结果提交进仓库，脚本可重复运行且输出逐字节一致。
- 这些贴图是原创的，画风上“像 Minecraft 的方块”即可，不要照着原版贴图逐像素临摹。
- 界面贴图（提示框面板、进度条）同样自制。
- 音效用脚本合成（噪声脉冲加指数衰减、正弦短音等），覆盖 3.8 节列出的事件 ID。
- 可选升级：把一套开放许可的资源包并入内置层以提升画质。这一步**必须先由人确认许可证**，流程见 `09-compliance.md`。
- 覆盖率检查：`scripts/check-builtin-coverage.ts` 汇总方块目录、物品目录、内置模板默认值引用到的全部资源 ID，内置层缺任何一个就让 CI 失败。

## 3.4 原版层 `vanilla`

**探测**（主进程，启动后在后台做）：

1. 官方启动器的默认目录：Windows `%APPDATA%\.minecraft`，macOS `~/Library/Application Support/minecraft`，Linux `~/.minecraft`。
2. 用户上次手动选过的目录。
3. 其他常见启动器的默认位置作为候选表，由实现者调研后补充；探测不到就算了。

在候选目录里读 `versions/<目录>/<目录>.json`，只考虑同目录下存在 `<目录>.jar`、而且 jar 是完整的原版客户端（里面有 `assets/minecraft/`）的版本，取 `type` 为 `release` 且 `releaseTime` 最新的一个；发布时间相同时，目录名就是版本号的原版目录优先于模组版本的目录。这就是 3.12 版本列表里排在最前的那个正式版：自动挑选和版本列表是同一套规则，挑出来的一定在列表里、打得开。再按它的 `assetIndex.id` 找 `assets/indexes/<id>.json`，音效文件在 `assets/objects/<哈希前两位>/<哈希>`。目录名原样用（PCL 等启动器给模组版本起的名字可以带空格、括号、中文），真实的游戏版本另外读，见 3.12“版本目录名与游戏版本”。

**首次发现时询问一次**（对话框文案见 `06-ui-design.md`）。用户同意后把这一层加进资源栈。设置里可以随时关闭或重新选择目录。

**约束**：

- 只读，不把任何文件复制到应用数据目录。由它派生的缩略图缓存可以存在本机的缓存目录。
- jar 不见了（游戏被移动或卸载）就静默退回内置层，并在资源面板里提示一次。
- 只支持 Java 版。基岩版的资源格式不同，v1 不做。

## 3.5 用户资源包 `pack`

- 支持 zip 和文件夹。可以从文件对话框添加，也可以直接拖进窗口。
- zip 复制到 `userData/packs/<内容哈希>.zip`；文件夹只记路径，窗口重新获得焦点时重扫。
- 读 `pack.mcmeta` 只用于展示名称、描述和格式号。各版本的字段不一样，全部当可选字段处理，缺了也照常加载。
- 发现 `assets/minecraft/textures/blocks/`（复数，1.12 及更早的命名）时，把这个包标成“旧版格式，暂不支持”，仍然列出但提示大部分贴图不会生效。v1 不做旧命名的映射。
- 安全：拒绝包含 `..` 或绝对路径的条目；单个文件解压后超过 64 MB 的跳过。

## 3.6 动画贴图

读取 `<贴图>.png.mcmeta` 的 `animation` 字段：

- 帧在 PNG 里纵向排列；没写 `width`/`height` 时每帧是正方形，边长等于图片宽度。
- `frametime` 单位是游戏刻（1/20 秒），默认 1。`frames` 可以是帧序号数组，也可以是带 `time` 的对象。
- 当前帧是时间的函数（公式见 `02-engine.md` 2.8）。v1 忽略 `interpolate`。

## 3.7 方块目录与物品目录

Mojang 的模型和方块状态 JSON 不能随包分发，所以应用自带一份自己写的目录，只描述“哪个面用哪张贴图”。资源包替换的是贴图，这覆盖了绝大多数使用场景。读取资源包自带的模型 JSON 留给以后的版本。

```jsonc
// packages/assets/data/blocks.json
{
  "minecraft:stone":       { "shape": "cube_all", "tex": { "all": "block/stone" } },
  "minecraft:oak_log":     { "shape": "cube_column", "tex": { "end": "block/oak_log_top", "side": "block/oak_log" } },
  "minecraft:grass_block": { "shape": "cube_bottom_top",
                             "tex": { "top": "block/grass_block_top", "side": "block/grass_block_side", "bottom": "block/dirt",
                                      "sideOverlay": "block/grass_block_side_overlay" },
                             "tint": { "top": "grass", "sideOverlay": "grass" } },
  "minecraft:furnace":     { "shape": "orientable", "tex": { "front": "block/furnace_front", "side": "block/furnace_side", "top": "block/furnace_top" } },
  "minecraft:glass":       { "shape": "cube_all", "tex": { "all": "block/glass" }, "render": "cutout" },
  "minecraft:oak_leaves":  { "shape": "cube_all", "tex": { "all": "block/oak_leaves" }, "render": "cutout", "tint": { "all": "foliage" } }
}
```

- `shape`：`cube_all`、`cube_column`、`cube_bottom_top`、`orientable`、`cube`（六个面分别指定）。
- `render`：`opaque`（默认）、`cutout`、`translucent`。
- `tint`：`grass`、`foliage`、`foliage_spruce`、`foliage_birch`、`water`，取固定常量，存在 `packages/assets/data/tints.json`。已核对的值（平原生物群系的默认色）：草 `#91BD59`、树叶 `#77AB2F`、水 `#3F76E4`。云杉和白桦树叶在游戏里是固定色，具体数值由实现者查证后填入。
- `sideOverlay` 缺失时跳过叠加层。
- 物品目录 `items.json`：`{ "minecraft:diamond_sword": { "tex": "item/diamond_sword" } }`。方块类物品直接用方块目录渲染。
- 显示名 `names.json`：`{ "minecraft:stone": { "zh-CN": "石头", "en": "Stone" } }`，选择器按 ID 和两种语言的名字搜索。

**v1 方块清单（约 110 个）**

| 分组 | 方块 |
|---|---|
| 自然 | `stone` `cobblestone` `deepslate` `dirt` `grass_block` `sand` `gravel` `snow_block` `ice` `packed_ice` `netherrack` `end_stone` `bedrock` `obsidian` `crying_obsidian` `magma_block` |
| 木材 | `oak_planks` `spruce_planks` `birch_planks` `dark_oak_planks` `oak_log` `spruce_log` `birch_log` `oak_leaves` `spruce_leaves` `birch_leaves` |
| 建材 | `bricks` `stone_bricks` `deepslate_bricks` `nether_bricks` `quartz_block` `smooth_stone` `glass` `bookshelf` `hay_block` |
| 矿石 | `coal_ore` `iron_ore` `copper_ore` `gold_ore` `redstone_ore` `lapis_ore` `diamond_ore` `emerald_ore` |
| 矿物块 | `coal_block` `iron_block` `copper_block` `gold_block` `redstone_block` `lapis_block` `diamond_block` `emerald_block` `netherite_block` `amethyst_block` |
| 功能 | `crafting_table` `furnace` `tnt` `note_block` `jukebox` `glowstone` `sea_lantern` `pumpkin` `melon` `slime_block` `honey_block` |
| 羊毛（16 色） | `white_wool` `orange_wool` `magenta_wool` `light_blue_wool` `yellow_wool` `lime_wool` `pink_wool` `gray_wool` `light_gray_wool` `cyan_wool` `purple_wool` `blue_wool` `brown_wool` `green_wool` `red_wool` `black_wool` |
| 混凝土（16 色） | 同上 16 色的 `*_concrete` |
| 陶瓦（16 色） | 同上 16 色的 `*_terracotta` |

**v1 物品清单（约 40 个）**

`diamond_sword` `iron_sword` `netherite_sword` `golden_sword` `diamond_pickaxe` `iron_pickaxe` `netherite_pickaxe` `diamond_axe` `diamond_shovel` `bow` `arrow` `diamond` `emerald` `gold_ingot` `iron_ingot` `netherite_ingot` `copper_ingot` `redstone` `lapis_lazuli` `coal` `amethyst_shard` `apple` `golden_apple` `bread` `cooked_beef` `ender_pearl` `ender_eye` `blaze_rod` `nether_star` `totem_of_undying` `firework_rocket` `book` `enchanted_book` `compass` `clock` `bucket` `water_bucket` `lava_bucket` `experience_bottle` `snowball` `stick` `music_disc_13`

**2026-11 扩充（为内置模板目录，`docs/template-catalog.md` P2）**：方块加到 278 个、物品加到 249 个。新增的条目只有 ID、贴图路径和两种语言的名称，逐条对照过本机 Java 版 26.3 和 1.21.1 的游戏文件（jar 里的贴图清单、`en_us.json`，资源索引里的 `zh_cn.json`）：贴图在两个版本里都存在、两种语言的名称都查得到才收，查不到的不收。只收整方块和贴图是单张图的物品；药水、刷怪蛋、皮革护甲这类要叠层染色的，以及盾牌、床这类只有模型的没有收。新增的清单见 `tests/unit/assets-catalog.test.ts` 的 `EXTRA_BLOCKS`、`EXTRA_ITEMS`。唱片在游戏里都叫“音乐唱片”，这里按 ID 括注区分（沿用 `music_disc_13` 的写法）。金合欢、丛林、深色橡木、红树的树叶都用 `foliage` 常量着色（红树在游戏里是固定色，这里是近似）。

## 3.8 音效

- 音效事件 ID 与游戏一致，例如 `minecraft:block.stone.place`。有原版层或资源包时，按 `sounds.json` 解析到具体文件，多个变体的选择规则见 `02-engine.md` 2.10。
- 内置层为下列事件提供合成音效，保证没有原版层时模板也有声音：

| 事件 ID | 用途 |
|---|---|
| `minecraft:block.stone.place` | 放置方块 |
| `minecraft:block.stone.break` | 破坏方块 |
| `minecraft:block.wood.place` | 放置木质方块 |
| `minecraft:ui.button.click` | 点击 |
| `minecraft:entity.experience_orb.pickup` | 清脆提示音 |
| `minecraft:entity.player.levelup` | 升级提示音 |
| `minecraft:ui.toast.in` | 提示框滑入 |
| `minecraft:ui.toast.out` | 提示框滑出 |
| `minecraft:ui.toast.challenge_complete` | 挑战完成 |
| `minecraft:entity.generic.explode` | 爆炸 |
| `allay:whoosh` | 飞掠（本项目自有的 ID） |

- 上表是基础表（`SOUND_EVENTS`）。“下载原版资源”时一并取回的是它加上全部内置模板 manifest 里的默认音效和预设音效（2026-11，`docs/decisions.md`“内置模板扩到 100 个”）；其余音效仍然只在试听、选中或导出前确认时取回。
- 支持 `.ogg` 和 `.wav`。解码在渲染进程用 `decodeAudioData`。
- **来源与分类（2026-11 反馈）**：选择器里每个事件标明来源——原版、被资源包改过（改了 `sounds.json` 的定义或替换了文件）、资源包新增、用户导入，悬停显示相关资源包。分类按事件 ID 路径的第一段（`block`、`entity`、`music`…）；认不出时看第一个变体的文件路径（`mypack:music/boss` 归“音乐”），再不行归“其他”。导入的 `.ogg`、`.wav` 存在 `userData/imported-sounds/`，按资源包结构摆放，命名空间是本应用自有的 `allay_user`。
- **显示名**：运行时从资源栈的语言文件推出（jar 里的 `en_us.json`、资源索引里的 `zh_cn.json`，资源包可以覆盖），不随仓库分发任何翻译表。有字幕（`sounds.json` 的 `subtitle`）就用字幕，共用字幕时括注方块、实体或物品名；没有字幕的音乐、唱片、环境音用生物群系名或唱片名，几种没有字幕的方块动作（摔落、脚步等）用“方块名（动作）”。推不出时显示 ID。规则在 `packages/assets/src/sound-names.ts`。
- **空间音效**：见 `docs/decisions.md`“2026-11 反馈：素材与音效”。

## 3.9 字体

- 引擎的文字是位图字。字形来源按资源栈解析（2026-11 起按字体族，见 `04-templates.md` 4.4 的 `font` 参数）：
  - 资源栈里的字体定义 `assets/<命名空间>/font/<名字>.json`：解析 `bitmap`、`space`、`reference`、`unihex` 四种提供器，以及 1.20 起提供器上的 `filter`（“强制使用 Unicode 字体”“日文字形变体”两个选项按游戏默认关闭处理）。字形宽度按该字形最右侧的不透明像素列计算，字间距 1 像素，空格宽 4 像素。
  - `unihex`（游戏里中日韩等字形来自它加载的 Unifont）：主进程在内存里解开 `hex_file` 指的 zip（原版是 jar 里的 `assets/minecraft/font/unifont.zip`），解析其中的 `.hex`，按游戏的规则画成一半大小（2 个 Unifont 像素 = 1 个字体像素），前进宽度 floor(列数 / 2) + 1，阴影和粗体只偏半个字体像素。
  - `ttf` 和 `legacy_unicode` 不解析。
  - 所选字体里找不到的字形依次回退到 `minecraft:default` 和系统字体；资源栈里一个原版字形都没有（没有原版素材）时，整段文字用系统字体。
- **内嵌 Unifont**（2026-11-20 起）：随应用分发一份 GNU Unifont 18.0.01 的标准版 `unifont-18.0.01.otf`（`resources/fonts/unifont/`，汉字是 G 源即中国大陆来源的字形），主进程第一次用到时还原成点阵字形表（和 unihex 同一套度量），所有模板共用。字体族 `embedded:default`（普通模式：Mojangles 优先、缺的用它）和 `embedded:uniform`（强制 Unicode 模式：全部用它），见 `04-templates.md` 4.4 和 docs/decisions.md“内嵌 Unifont 与两种字体模式”。
- **不内置别的像素字体**（2026-11 起删除了方舟像素字体）。系统字体是 Worker 里 OffscreenCanvas 的字体栈 `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif`：原版字体里缺的字形按子像素画、按 alpha 二值化，和原版字形一样是硬边像素；整段用系统字体时按输出分辨率抗锯齿。同一台机器上预览和导出一致，换一台机器装的字体不同，字形可能不同。
- 用户可以导入自己的字体文件（TTF、OTF、WOFF、WOFF2、BDF）：复制进 `userData/fonts/<sha256>.<格式>`，字体族 ID 是 `user:<sha256 前 32 位>`。BDF 和内置字体一样按像素画；矢量字体在 Worker 里用 FontFace 载入、按输出分辨率抗锯齿栅格化。
- 文字一律在引擎 Worker 里栅格化（预览和导出走同一份代码），位图字按子像素（一个字体像素 2 × 2）拼贴、最近邻放大，结果只取决于文字、字体和样式。

## 3.10 缩略图

- 方块图标：正交相机，绕 X 轴 30°、绕 Y 轴 225°，带面明暗，64×64 和 128×128 两档。
- 物品图标：正面平视。
- 由杂务 Worker 批量生成，按 `resourceStamp` 缓存到 `userData/cache/thumbs/`。资源栈一变就后台重建，重建期间界面显示骨架和悦灵（见 `07-allay-mascot.md`）。

## 3.11 验收测试

| 编号 | 内容 | 判定 |
|---|---|---|
| T-AST-1 | 用三个夹具资源包（各自覆盖不同贴图）测试叠加顺序、开关、重排 | 解析结果与预期表一致 |
| T-AST-2 | 资源栈为空（只有内置层）时加载每个内置模板 | `warnings` 为空 |
| T-AST-3 | 引用一个不存在的贴图 ID | 得到占位图和一条警告，不抛错 |
| T-AST-4 | 带 `.mcmeta` 的 4 帧动画贴图，`frametime = 2` | `t = 0, 0.1, 0.2, 0.3, 0.4` 时的帧序号为 `0, 1, 2, 3, 0` |
| T-AST-5 | 含 `../` 条目的恶意 zip | 被拒绝，应用数据目录外没有新文件 |
| T-AST-6 | 夹具 `.minecraft` 目录（含两个版本，其中一个没有 jar） | 选中有 jar 且最新的正式版 |
| T-AST-7 | 运行两次 `gen-builtin-pack` | 输出目录逐字节相同 |

## 3.12 多个原版来源、版本检索与本机资源包（2026-11 反馈）

**多个原版来源**：原版层可以有多个，各自一行、可开关、可排序、可删除，设置里记在 `resources.vanillaSources`（从下往上）。来源是“某个游戏目录里的某个版本”（本机）或“下载缓存里的某个版本”。

- 资源栈的查找规则不变：从最上层往下，第一个启用且有这个文件的层胜出。原版层整体在资源包之下，原版层之间可以排序。
- **生效的原版基底** = 最上面那个启用的原版层。同名文件用它的；资源包的格式号和它比较；状态栏、顶栏显示它的版本。下面的原版层只补它没有的文件。
- 新加的来源（下载完成、选游戏目录、在版本列表里加入）放在原版层最上面，成为新的基底；之前的来源保留。
- 旧设置只有“同意 + 开关”。同意过、还没有来源列表时，按旧规则（本机和下载缓存里取较新的那个）迁移成第一条来源。
- 登记过、但现在打不开的来源（游戏被移动、缓存被删），在资源面板里单独列出，可以删除；其他来源照常。

**版本从哪里来**（离线，除非用户点按钮）：

| 来源 | 怎么找 | 列出哪些 |
|---|---|---|
| 本机 | 候选游戏目录（用户手动选过的、官方启动器的默认目录、已登记的本机来源所在目录）的 `versions/<目录>/` | 同目录有 `<目录>.jar`、版本 JSON 有 `type` 和 `releaseTime` 的版本，正式版和快照都列。目录名原样列出，带空格、括号、中文的也列（见下面“版本目录名与游戏版本”），旁边标出真实的游戏版本；查出来 jar 用不了的（不是完整的原版客户端、打不开）那一行写明原因、不能加入 |
| 已下载 | 下载缓存 `userData/vanilla-cache/versions/` | jar 和资源索引校验通过的版本 |
| Mojang 版本清单 | 用户点“获取版本列表”时取一次 `version_manifest_v2.json`（M2a 的下载例外：只访问 `piston-meta.mojang.com`） | 全部版本；点“下载”才下载那一版（同 M2a 的流程） |

- **排序**：新的在前。先比版本 JSON 和清单里的 `releaseTime`；没有发布时间时比纯数字版本号（`1.21.11` > `1.21.4`）；都比不出来时按 id 倒序，保证稳定。
- **搜索和筛选**：搜索框按空格分词，每个词都要出现在版本号（本机的是目录名）、游戏版本、路径或来源名里；按来源（全部 / 本机 / 已下载 / 可下载）和类型（正式版 / 快照 / 全部）筛选。清单里已经下载过的版本只列在“已下载”里。

**版本目录名与游戏版本**（2026-11-22，`docs/decisions.md`“版本目录名与设置的健壮性”）：本机来源分开记三样东西。

- **目录名**：`versions/` 下的那个目录名，原样保存，设置里本机来源的 `versionId` 就是它（键名沿用旧设置）。只要求它能当 `versions/` 的一个直接子目录：非空、不超过 255 个字符、没有 `/` `\` 和控制字符、不是 `.` `..`（`@allay/assets` 的 `isVersionDirName`，设置的 schema 和 IPC 两端是同一条）。目录名只来自主进程自己扫描游戏目录的结果，页面传回来的名字要在扫描结果里才用（T-AST-MV-5、T-AST-VD-7）。下载的来源仍然只能是 Mojang 的版本号。
- **层 id**：目录名只含字母数字、`.`、`_`、`-`（不超过 64 个字符）时照旧是 `vanilla:local:<游戏目录的哈希>:<目录名>`，以前的设置、层 id 一个不变；其余写成 `vanilla:local:<游戏目录的哈希>:~<目录名的哈希>`。读设置文件时按来源重新算 id。
- **游戏版本**：jar 根目录 `version.json` 的 `id` 最可靠（模组版本目录里的 jar 是原版客户端的副本）；版本列表不打开 jar，用版本 JSON 的 `clientVersion`（PCL 等写的），其次 `inheritsFrom`（加载器的版本 JSON）。原版层的名字、原版基底的版本、资源包格式的兼容提示都用游戏版本；资源栈里目录名和游戏版本不同时，目录名写在这一层的描述里。
- **jar 不是完整的原版客户端**（没有 `assets/minecraft/`，常见于 OptiFine 这类只装了加载器的版本目录：jar 是个空壳，游戏用的是它 `inheritsFrom` 的那个原版）：自动挑选跳过；从版本列表加入时先查 jar，不完整的不登记、列表上那一行写明原因；登记过的来源变成这样时，资源面板单独列出这一条，说明原因，不说成“游戏找不到了”。jar 打不开的（损坏、没下载完、被占用）同样处理，和“不完整”分开说。jar 里仍然只读 `assets/` 和根目录的 `version.json`，模组版本目录也一样。
- **设置里坏了一条**：一条原版来源或资源包过不了 schema，只丢那一条并写日志；同意、游戏目录和其余条目照常（T-AST-SET）。以前整节资源栈设置会静默退回默认值。

**资源包与原版版本的匹配**：

- 资源包的格式范围来自 `pack.mcmeta`：1.21.9 起是 `min_format` / `max_format`（整数或 `[主, 次]`）；1.20.2 起是 `pack_format` 加可选的 `supported_formats`（整数、`[最小, 最大]` 或 `{ min_inclusive, max_inclusive }`）；更早只有 `pack_format`。
- 原版的格式号优先取客户端 jar 根目录的 `version.json`。`pack_version` 有三种写法：整数（1.14–1.16）、`{ resource }`（1.17 起）、`{ resource_major, resource_minor }`（1.21.9 起）。读不到时查 `packages/assets/src/versions.ts` 里的对照表，表里只到 1.21.8，更新的版本以 jar 为准。
- 比较：基底的格式在包的范围内是“匹配”；比范围大是“包比基底旧”；比范围小是“包比基底新”；有一边不知道就不提示。不匹配只是提示（“为 1.20–1.20.1 制作（格式 15），比原版基底 1.21.11 旧，部分内容可能不生效”），照样加载，与游戏一致。
- “为哪个版本制作”按对照表从格式号反推，表外的只显示格式号。

**本机 Minecraft 的资源包文件夹**：只读本机文件，不联网，不复制。

| 启动器 | 位置 | 游戏版本 |
|---|---|---|
| 官方启动器（及候选游戏目录） | `<游戏目录>/resourcepacks/` | 所有版本共用 |
| PCL、HMCL 等的版本隔离 | `<游戏目录>/versions/<id>/resourcepacks/` | 版本 JSON 的 `inheritsFrom`，其次 `clientVersion`，都没有时就是 `<id>` |
| Prism Launcher | `instances/<实例>/{.minecraft,minecraft}/resourcepacks/` | `mmc-pack.json` 里 `net.minecraft` 组件的 `version` |
| CurseForge | `~/curseforge/minecraft/Instances/<实例>/resourcepacks/` | `minecraftinstance.json` 的 `gameVersion` |
| Modrinth App | `profiles/<名字>/resourcepacks/` | `profile.json` 的 `metadata.game_version`（新版存在数据库里，读不到就写“版本未知”） |

- zip 和带 `pack.mcmeta` 的子文件夹算资源包。界面写明启动器、游戏版本、完整路径，以及与原版基底的匹配。
- 加入时：文件夹按文件夹包（只记路径）；zip **原地只读引用**（设置里记为 `linked`，不复制到 `userData/packs/`），窗口重新获得焦点时按大小和修改时间重扫。主进程只接受上一次探测结果里出现过的路径。

**界面上的说明**（资源栈弹层、版本列表各一两句）：“原版可以有多个：最上面开着的那个是基底，同名文件用它的，资源包按它的版本匹配……”；“版本从三处来……按发布时间从新到旧排……资源包靠 pack.mcmeta 里的格式号和基底比较，对不上时会提示。”

| 编号 | 内容 | 判定 |
|---|---|---|
| T-AST-MV-1 | 本机 1.21.11 和下载的 26.3 同时加入；开关、排序、删除 | 两层并存；基底是最上面启用的那个；基底没有的文件由下面的原版补；只影响操作的那一层 |
| T-AST-MV-2 | 资源包加在两层原版之间之后重排 | 资源包始终在原版之上；原版层之间按给的顺序；格式匹配随基底变化 |
| T-AST-MV-3 | 旧设置（同意、无来源列表） | 迁移成一条来源，按旧的“取较新”规则 |
| T-AST-MV-4 | 登记过的版本的 jar 被删 | 列进 missingSources，其他来源照常，不报错 |
| T-AST-MV-5 | 页面要加一个不在探测结果里的游戏目录 | 不加 |
| T-AST-VER-1/2/3 | 本机版本列表、三处来源合并、`pack.mcmeta` 和 jar `version.json` 的各种写法、匹配、排序、搜索 | 与上面的规则一致 |
| T-AST-LP-1 | 夹具里的官方、版本隔离、Prism、CurseForge 目录 | 认出四处，版本和路径正确，只列真正的资源包 |
| T-AST-LP-2 | 加入探测到的 zip | 原地引用、不复制；未探测到的路径被拒绝；重复加入是同一行 |
| T-AST-SET-1 至 6 | 设置文件里资源栈的一条原版来源、一个资源包坏了、重复了、id 对不上、有不认识的键；整节不是对象 | 只丢那一条（写日志），同意、游戏目录和其余条目照常；原版来源的 id 按来源重新算 |
| T-AST-VD-1、2 | 同意过、还没有来源，游戏目录里有带空格的版本目录（复现步骤），启动两次 | 设置还在，选中的版本打得开；自动挑选的版本一定在版本列表里 |
| T-AST-VD-3 至 7 | 带空格、括号、中文的版本目录；目录名的规则；层 id；设置里登记的这类来源；从版本列表加入 | 都列出来，游戏版本取 `clientVersion` / `inheritsFrom` / jar 的 `version.json`；旧的层 id 不变；没扫描到的名字不加 |
| T-AST-VD-8 至 10 | jar 里没有 `assets/minecraft/` 的版本目录；jar 打不开的版本目录 | 自动挑选跳过，加入时不登记、列表上标出原因（两种分开说）；登记过的单独列出原因 |
