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

在候选目录里读 `versions/<id>/<id>.json`，只考虑同目录下存在 `<id>.jar` 的版本，取 `type` 为 `release` 且 `releaseTime` 最新的一个。再按它的 `assetIndex.id` 找 `assets/indexes/<id>.json`，音效文件在 `assets/objects/<哈希前两位>/<哈希>`。

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

- 支持 `.ogg` 和 `.wav`。解码在渲染进程用 `decodeAudioData`。
- **来源与分类（2026-11 反馈）**：选择器里每个事件标明来源——原版、被资源包改过（改了 `sounds.json` 的定义或替换了文件）、资源包新增、用户导入，悬停显示相关资源包。分类按事件 ID 路径的第一段（`block`、`entity`、`music`…）；认不出时看第一个变体的文件路径（`mypack:music/boss` 归“音乐”），再不行归“其他”。导入的 `.ogg`、`.wav` 存在 `userData/imported-sounds/`，按资源包结构摆放，命名空间是本应用自有的 `allay_user`。
- **显示名**：运行时从资源栈的语言文件推出（jar 里的 `en_us.json`、资源索引里的 `zh_cn.json`，资源包可以覆盖），不随仓库分发任何翻译表。有字幕（`sounds.json` 的 `subtitle`）就用字幕，共用字幕时括注方块、实体或物品名；没有字幕的音乐、唱片、环境音用生物群系名或唱片名，几种没有字幕的方块动作（摔落、脚步等）用“方块名（动作）”。推不出时显示 ID。规则在 `packages/assets/src/sound-names.ts`。
- **空间音效**：见 `docs/decisions.md`“2026-11 反馈：素材与音效”。

## 3.9 字体

- 引擎的文字是位图字。字形来源按资源栈解析：
  - 有原版层或资源包提供 `assets/minecraft/font/default.json` 时，解析其中的 `bitmap`、`space`、`reference` 三种提供器。字形宽度按该字形最右侧的不透明像素列计算，字间距 1 像素，空格宽 4 像素。
  - `unihex` 和 `ttf` 提供器 v1 不解析。游戏里的中日韩字形来自 `unihex` 提供器加载的 Unifont，所以 v1 里这些字形一律走下面的回退。
  - 上面找不到的字形（包括全部中日韩字符）回退到内置的像素字体。
- 内置像素字体随安装包分发，必须是允许再分发的开放许可字体，同时覆盖拉丁字符和中文。候选和许可要求见 `09-compliance.md`。
- 内置字体在启动时按原生像素尺寸栅格化成字形图集，关闭平滑。

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
| 本机 | 候选游戏目录（用户手动选过的、官方启动器的默认目录、已登记的本机来源所在目录）的 `versions/<id>/` | 同目录有 `<id>.jar`、版本 JSON 有 `type` 和 `releaseTime` 的版本，正式版和快照都列。版本号要能当目录名（字母数字、`.`、`_`、`-`），带空格的跳过 |
| 已下载 | 下载缓存 `userData/vanilla-cache/versions/` | jar 和资源索引校验通过的版本 |
| Mojang 版本清单 | 用户点“获取版本列表”时取一次 `version_manifest_v2.json`（M2a 的下载例外：只访问 `piston-meta.mojang.com`） | 全部版本；点“下载”才下载那一版（同 M2a 的流程） |

- **排序**：新的在前。先比版本 JSON 和清单里的 `releaseTime`；没有发布时间时比纯数字版本号（`1.21.11` > `1.21.4`）；都比不出来时按 id 倒序，保证稳定。
- **搜索和筛选**：搜索框按空格分词，每个词都要出现在版本号、路径或来源名里；按来源（全部 / 本机 / 已下载 / 可下载）和类型（正式版 / 快照 / 全部）筛选。清单里已经下载过的版本只列在“已下载”里。

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
