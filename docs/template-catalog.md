# 内置模板目录：100 款与分批计划

状态：主控已验收（2026-11-19），按 4.1 的顺序分批实现。5.1、5.2 里要用户决定的事项未定之前，受影响的模板按本文的默认做法做。本文只是计划，不改变 `docs/04-templates.md` 的任何规则。

读这份文件之前要知道的三件事：

- **数值都是凭记忆写的。** 本文没有联网核对，也没有对照游戏文件。“依据”一栏里的类名、贴图路径、刻数、颜色，都是对反编译游戏代码和 Minecraft Wiki 的记忆。实现时逐条核对，核对不了的照 `04-templates.md` 4.10 的做法在模板文档里标“凭记忆”。贴图路径按 Java 版 1.20.2 之后的写法（`gui/sprites/...` 拆分之后）。
- **模板画的是叠加层，拿不到底下的视频。** 导出的是带透明通道的片段，所以“扭曲、模糊、抖动原画面”的效果做不出来，本目录一个也没列（见 3.3）。
- **没有原版素材时，贴图全是占位图。** 内置层是空的（`docs/decisions.md` M2a），所以每个模板都要想清楚没有素材时怎么表现（第 2 节第 6 条、第 5 节）。

## 1. 总表

### 1.0 怎么读

- **编号**：三位数，001–006 是现有六个，007–100 是新增。验收测试的编号用它（第 2 节）。
- **id**：表里只写最后一段，完整 id 是 `allay.builtin.<名字>`，目录是 `packages/templates/<名字>/`。
- **类别**：`transition`（转场，有剪辑点，剪辑点完全不透明）、`overlay`（叠加层，没有剪辑点）、`title`（标题：片头、片尾、标题卡，没有剪辑点）。三类的首末帧都全透明。
- **参数**：只写这个模板特有的。下面这些每个模板都有，表里不重复：
  - 转场：`inDuration`、`hold`、`outDuration`（`timeline.segments`）、`easing`、有随机时的 `seed`。
  - 叠加和标题：`inDuration`、`hold`、`outDuration`、`anchor`（停靠位置）、`guiScale` 或 `scale`、`margin`。
  - 有文字的：每段文字一个 `text` 加一个 `font`（默认 `minecraft:default`）。
  - 有声音的：每个音效一个 `sound`（可为空）加一个 `volume`。
- **前置**：依赖第 3 节的哪项能力。带括号的是“没有也能做，有了更好”，不带括号的是“没有就做不了”。
- **批**：第 4 节的批次。
- **难度**：S 约 150–250 行（像 pixel-dissolve），M 约 250–450 行（像 advancement-toast、block-fall），L 是 450 行以上或要写模型（像 loading-screen）。

各组数量：

| 组 | 现有 | 新增 | 合计 |
|---|---|---|---|
| A 方块类转场 | 2 | 12 | 14 |
| B 物品与实体 | 1 | 14 | 15 |
| C 原版界面还原 | 2 | 25 | 27 |
| D 粒子、天气与屏幕效果 | 0 | 11 | 11 |
| E 文字与字幕条 | 0 | 11 | 11 |
| F 频道包装 | 0 | 11 | 11 |
| G 像素与着色器风格 | 1 | 5 | 6 |
| H 节日与主题 | 0 | 5 | 5 |
| 合计 | 6 | 94 | 100 |

按类别：转场 39，叠加 53，标题 8。

### 1.1 A 方块类转场（14）

整面由方块构成，盖住画面再离开。方块贴图都来自 `ctx.resources.block()`。

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 001 | `block-wipe` | 方块擦除 / Block Wipe | 转场 | 现有（`04` T1） | — | — | — | — | — | — |
| 002 | `block-fall` | 方块坠落 / Block Fall | 转场 | 现有（`04` T2） | — | — | — | — | — | — |
| 007 | `mining-crack` | 挖掘裂纹 / Mining Crack | 转场 | 方块一格格“放置”出来成墙；退出时每格的裂纹从 0 级走到 9 级，然后碎成带该方块贴图的碎屑落下 | `blocks`、`arrangement`、`cols`、`placeOrder`、`breakOrder`、`crackTime`、`debris`（碎屑量）、`placeSound`、`breakSound`、`hitSound` | `block/destroy_stage_0`–`9`；方块贴图；`block.*.place`、`.hit`、`.break` | 挖掘时的裂纹叠加层（10 级）和方块破坏粒子（取方块贴图的一小块，受重力） | M | (P1) | 3 |
| 008 | `piston-push` | 活塞合拢 / Piston Push | 转场 | 两侧各一排活塞伸出，把两扇方块墙推到中间合拢；退出时粘性活塞把墙拉回去 | `blocks`、`axis`（左右 / 上下）、`rows`、`sticky`、`stagger`（各排先后）、`extendSound`、`contractSound` | `block/piston_top`、`piston_top_sticky`、`piston_side`、`piston_inner`、`piston_bottom`；`block.piston.extend`、`.contract` | 活塞伸出、收回各 2 刻；活塞臂是长方体，模板自己用贴图拼 | M | (P1) | 3 |
| 009 | `explosion-blast` | 爆炸 / Explosion | 转场 | 中央的 TNT（或苦力怕）闪白、膨胀，爆炸的白光和爆炸粒子铺满画面；退出时烟散开 | `source`（`tnt` / `creeper`）、`charged`、`fuse`（引信时长）、`flashColor`、`smoke`、`primeSound`、`explodeSound` | `block/tnt_*`；`entity/creeper/creeper`、`creeper_armor`；`particle/explosion_0`–`15`、`generic_0`–`7`；`entity.tnt.primed`、`entity.creeper.primed`、`entity.generic.explode` | 点燃的 TNT 每 10 刻闪白一次、引爆前膨胀；苦力怕 30 刻引信、膨胀闪白；爆炸粒子 16 帧 | L | P1 P4（只做 TNT 时不需要） | 9 |
| 010 | `liquid-flood` | 液体淹没 / Liquid Flood | 转场 | 水面带着起伏从下往上涨满，气泡上浮；退出时水位退下去 | `liquid`（`water` / `lava`）、`tint`（水的颜色）、`waveHeight`、`bubbles`、`direction`（涨 / 落 / 侧向灌入）、`sound` | `block/water_still`、`water_flow`、`lava_still`、`lava_flow`（带动画）；`particle/bubble`；`misc/underwater`；`item.bucket.empty`、`ambient.underwater.enter` | 水贴图是灰度图乘生物群系水色（默认 `#3F76E4`）；水下视野的叠加贴图 | M | (P1) | 4 |
| 011 | `door-shut` | 关门 / Door Shut | 转场 | 两扇放大的门从两侧绕门轴合上盖住画面，停留后推开 | `door`（各种木门、铁门）、`backing`（门后垫的颜色，盖住门上的窗）、`hinge`（对开 / 单开）、`perspective`、`closeSound`、`openSound` | `block/<木种>_door_top`、`_bottom`、`iron_door_*`；`block.wooden_door.close`、`.open`、`block.iron_door.*` | 门是上下两格的薄板；多数门的贴图有镂空的窗，所以要垫底 | S | — | 3 |
| 012 | `chunk-rise` | 区块升起 / Chunk Rise | 转场 | 俯视的地形按 16 列一组从下面升起拼满画面（草、沙、水、石头按噪声分布）；退出时一组组沉下去 | `palette`（生物群系：平原、沙漠、雪原、下界、末地，各自一组方块）、`chunkSize`、`order`（由近到远 / 中心扩散 / 随机）、`relief`（起伏）、`tilt`（俯视角） | 生物群系对应的方块顶面贴图；草用 `tint` 常量 | 区块 16 × 16；参考“区块加载动画”一类的做法（非原版行为），不照搬具体实现 | L | (P1) | 3 |
| 013 | `block-punch` | 方块冲镜 / Block Punch | 转场 | 一个方块从远处翻滚着飞来，撞到镜头时一个面刚好铺满画面；退出时方块继续穿过镜头 | `block`、`spin`、`approach`（来的方向）、`impactShake`（撞击时自身的晃动）、`sound` | 方块贴图；`block.*.place` 或 `entity.generic.small_fall` | 无原版出处；常见的“物体撞镜头”转场，用方块来做 | S | — | 3 |
| 014 | `ice-shatter` | 冰封碎裂 / Ice Shatter | 转场 | 霜从四边向中心结满，随后整面冰裂成不规则碎片飞散 | `block`（`packed_ice` / `blue_ice` 等不透明冰）、`frostEdge`、`shards`（碎片数）、`impact`（裂点位置）、`freezeSound`、`shatterSound` | `block/packed_ice`、`blue_ice`；`misc/powder_snow_outline`；`block.glass.break`、`block.powder_snow.*` | 细雪里结冰的视野边框；碎裂是泰森多边形分块（种子决定），非原版行为 | M | (P1) | 4 |
| 015 | `sculk-spread` | 幽匿蔓延 / Sculk Spread | 转场 | 幽匿从几个点成片蔓延铺满，边缘是幽匿脉络；退出时退去，带灵魂粒子 | `seeds`（起点数）、`veinWidth`、`pulse`（明暗脉动）、`particles`、`spreadSound`、`bloomSound` | `block/sculk`（带动画）、`sculk_vein`；`particle/sculk_soul_*`、`sculk_charge_*`；`block.sculk.spread`、`block.sculk_catalyst.bloom` | 幽匿催发体把周围方块变成幽匿、边缘长脉络 | M | (P1) | 4 |
| 016 | `vine-overgrow` | 藤蔓蔓生 / Overgrowth | 转场 | 藤蔓一列列从上往下垂下来，树叶一层层长满直到完全盖住；退出时树叶随机枯掉，飘落 | `leaves`（树叶种类）、`vines`、`layers`（叠几层）、`tint`（树叶颜色）、`fallItem`（飘落物） | `block/<树种>_leaves`、`vine`；树叶颜色用 `foliage` 常量；`block.grass.place`、`.break` | 树叶离开原木后随机腐烂；树叶贴图镂空，靠叠层和垫底保证剪辑点不透明 | M | (P1) | 3 |
| 017 | `portal-gate` | 传送门穿越 / Portal Gate | 转场 | 黑曜石一块块垒成 4 × 5 的门框，点燃，传送门面朝镜头放大铺满；退出时像穿过去一样向四周散开 | `frame`（门框方块）、`buildOrder`、`igniteAt`、`portalTint`、`placeSound`、`igniteSound`、`travelSound` | `block/obsidian`、`nether_portal`（带动画）；`item.flintandsteel.use`、`block.portal.trigger`、`block.portal.travel` | 最小的下界传送门框 4 × 5；和 loading-screen 的传送门背景不同：这里是搭门、点火、穿过 | M | (P1) | 3 |
| 018 | `tunnel-rush` | 矿道穿梭 / Tunnel Rush | 转场 | 镜头在方块围成的矿道里向前冲，尽头的墙迎面撞上铺满画面；退出时继续冲出另一头 | `walls`（方块列表）、`ores`（矿石出现的比例）、`size`（矿道宽高）、`speed`、`torches`（火把亮点） | 方块贴图；`block/torch`；`entity.minecart.riding` | 无原版出处；常见的“隧道推进”转场 | M | (P1) | 3 |

### 1.2 B 物品与实体（15）

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 003 | `item-stinger` | 物品飞掠 / Item Stinger | 转场 | 现有（`04` T3） | — | — | — | — | — | — |
| 019 | `ender-pearl-warp` | 末影珍珠传送 / Pearl Warp | 转场 | 珍珠沿抛物线飞进来，落点炸开紫色传送粒子，粒子越聚越密成一面紫色像素幕；退出时向另一点收拢消失 | `from`、`to`（落点和出现点）、`particleColor`、`density`、`throwSound`、`teleportSound` | `item/ender_pearl`；`particle/generic_0`–`7`（染紫）；`entity.ender_pearl.throw`、`entity.player.teleport` | 末影珍珠落地时的 32 个传送门粒子 | M | (P1) | 5 |
| 020 | `sword-slash` | 剑斩 / Sword Slash | 转场 | 剑沿斜线挥过，留下横扫粒子；画面沿斩线被两块色板合上，停留后两块板沿斩线错开滑走 | `item`（剑）、`angle`、`fill`（颜色 / 方块）、`offset`（错开的距离）、`sweepSound` | `item/<剑>`；`particle/sweep_0`–`7`；`entity.player.attack.sweep` | 横扫攻击的 8 帧粒子 | M | (P1) | 6 |
| 021 | `chest-open` | 开箱 / Chest Open | 转场 | 箱子落到画面中央，箱盖掀开，里面涌出的光铺满画面；退出时光收回箱里、合盖 | `kind`（普通、陷阱、末影、圣诞、潜影盒）、`fill`（涌出的颜色或方块）、`items`（顺带喷出的物品）、`openSound`、`closeSound` | `entity/chest/normal`、`trapped`、`ender`、`christmas`；`entity/shulker/shulker`；`block.chest.open`、`.close`、`block.ender_chest.*`、`block.shulker_box.*` | 箱子模型是箱体、箱盖、锁扣三个长方体，箱盖绕后沿转；圣诞箱子是游戏在 12 月 24–26 日换的贴图 | L | P1 P4 | 9 |
| 022 | `item-swarm` | 掉落物涌入 / Item Swarm | 转场 | 上百个小方块像掉落物一样转着从四周涌向中心堆满；退出时向外散开 | `blocks`、`count`、`origin`（四周 / 一侧 / 下方）、`spinSpeed`、`pickupSound` | 方块贴图；`entity.item.pickup` | 掉落物的自转和上下浮动；被吸向玩家时的轨迹 | M | (P1) | 3 |
| 023 | `map-unfold` | 展开地图 / Map Unfold | 转场 | 地图从下方举到面前、放大到纸面铺满画面，可以在纸上显示一行标题；退出时放下 | `title`、`marker`（是否显示玩家标记）、`paperTint`、`sound` | `map/map_background`；`map/decorations/player`；`ui.cartography_table.take_result` | 第一人称双手持图的抬起动作 | M | (P3) | 6 |
| 024 | `book-flip` | 翻页 / Page Flip | 转场 | 一页纸从一侧翻过来盖住画面，再翻走 | `direction`、`pages`（连翻几页）、`curl`（卷曲程度）、`sound` | `gui/book`；`item.book.page_turn` | 书与笔界面的纸页；翻页的卷曲是自己的几何 | M | — | 6 |
| 025 | `painting-zoom` | 入画 / Into the Painting | 转场 | 墙上挂着一幅画，镜头推进直到画面铺满；退出时从另一幅画里退出来 | `painting`、`paintingOut`、`wall`（墙的方块）、`image`（用自己的图代替画） | `painting/<名字>`、`painting/back`；`entity.painting.place` | 画的贴图在 1.14 之后每幅一张 | S | (P3) | 6 |
| 026 | `riptide-vortex` | 激流 / Riptide | 转场 | 激流的旋涡贴图绕画面中心旋转着收紧铺满，水花四溅；退出时旋开 | `level`（1–3，影响转速和声音）、`tint`、`twist`、`sound` | `entity/trident_riptide`；`particle/splash_0`–`3`；`item.trident.riptide_1`–`3` | 激流附魔冲刺时套在玩家身上的旋转贴图 | M | (P1) | 4 |
| 027 | `beacon-beam` | 信标光柱 / Beacon Beam | 转场 | 光柱从下往上射出，越来越宽直到铺满画面；退出时收窄熄灭 | `color`（染料色板）、`origin`（水平位置）、`scroll`（贴图滚动速度）、`activateSound`、`deactivateSound` | `entity/beacon_beam`；`block.beacon.activate`、`.deactivate`、`.ambient` | 信标光柱：内层不透明、外层半透明、贴图向上滚动，染色玻璃改颜色 | S | — | 6 |
| 028 | `clock-wipe` | 时钟擦除 / Clock Wipe | 转场 | 画面中央的时钟走一圈，扇形色板跟着指针扫满；退出时再扫一圈擦掉 | `item`（时钟 / 指南针）、`turns`、`fill`、`clockwise`、`tickSound` | `item/clock_00`–`63`、`item/compass_00`–`31` | 时钟物品有 64 帧、指南针 32 帧，模板按角度选帧 | S | — | 6 |
| 029 | `totem-pop` | 图腾激活 / Totem Pop | 叠加 | 图腾（或任意物品）从画面下方弹到镜头前，放大、摆动、缩回，周围喷出黄绿色粒子 | `item`、`particleColors`、`particles`、`sound` | `item/totem_of_undying`；`particle/generic_*`；`item.totem.use` | `GameRenderer.displayItemActivation`：40 刻的物品激活动画 | M | (P1) | 6 |
| 030 | `first-person-hand` | 第一人称手持 / First-person Hand | 叠加 | 画面右下角的手臂拿着物品做动作：挥动、吃、拉弓、举盾 | `skin`（皮肤图片）、`slim`、`item`、`action`（`swing` / `eat` / `bow` / `block`）、`repeat`、`leftHanded`、`sound` | `entity/player/wide/steve`；物品贴图；`entity.player.attack.*`、`entity.generic.eat` | `ItemInHandRenderer`：挥动的位移是 sin(√进度 × π) 一族，吃东西有上下抖动 | L | P1 P4 | 9 |
| 031 | `item-showcase` | 获得物品 / Item Get | 叠加 | 物品转着升起，背后一圈放射光，下面弹出带稀有度颜色的名称；可带附魔光效 | `item`、`name`、`rarity`（常见 / 少见 / 稀有 / 史诗）、`glint`、`rays`、`sound` | 物品贴图；`misc/enchanted_glint_item`；`entity.player.levelup` | 物品稀有度的四种名称颜色；附魔光效贴图的滚动 | S | (P2) | 6 |
| 032 | `target-hit` | 正中靶心 / Bullseye | 叠加 | 角落里一个靶子，箭飞来钉在上面颤动，靶子闪一下；用来强调“说中了” | `ring`（命中几环）、`arrows`、`from`、`hitSound` | `block/target_top`、`target_side`；`entity/projectiles/arrow`；`entity.arrow.hit`、`block.note_block.pling` | 标靶方块；箭插上后的抖动 | M | P2 | 6 |

### 1.3 C 原版界面还原（27）

布局一律按界面像素算（`guiScale` 个设计单位 = 1 个界面像素），坐标的整数截断照游戏代码，做法同 loading-screen 和 advancement-toast。每个都要有 `style` 参数为“按 Java / 基岩和版本区分”留位置；首版只做“Java 版 1.20.2 起”一种的，在自己的文档里写明没做哪些。

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 004 | `loading-screen` | 加载界面 / Loading Screen | 转场 | 现有（`04` T4） | — | — | — | — | — | — |
| 006 | `advancement-toast` | 进度提示 / Advancement Toast | 叠加 | 现有（`04` T6） | — | — | — | — | — | — |
| 033 | `death-screen` | 死亡画面 / Death Screen | 叠加 | 红色渐变蒙上来，“你死了！”两倍大，下面是死因、分数和两个按钮；按钮在 1 秒后才亮起 | `style`（Java / 极限模式）、`title`、`cause`、`score`、`buttons`、`hoverButton`（悬停并点击哪个）、`deathSound` | `gui/sprites/widget/button`、`button_highlighted`、`button_disabled`；`entity.player.death`、`ui.button.click` | `DeathScreen`：渐变 0x60500000 → 0xA0803030，标题放大 2 倍，按钮延迟 20 刻可用 | M | (P3) | 2 |
| 034 | `sleep-fade` | 入睡 / Sleep Fade | 转场 | 画面像躺在床上那样渐黑到全黑，底部是“离开床铺”按钮和聊天栏；退出时天亮渐显 | `showButton`、`buttonText`、`chatLine`（例如“1/1 名玩家正在睡觉”）、`sleepTicks` | `gui/sprites/widget/button` | `InBedChatScreen` 和睡觉时的渐暗（100 刻走完） | S | (P3) | 2 |
| 035 | `end-credits` | 片尾滚动 / Credits Roll | 标题 | 压暗的背景加暗角，多行文字从下往上滚，章节标题居中、条目两栏 | `text`（多行，约定标题行和条目行的写法）、`background`（泥土 / 全景 / 自选方块）、`speed`、`vignette`、`logoImage`（自己的标志，默认空） | `misc/vignette`；`gui/menu_background` 或方块贴图；`gui/title/background/panorama_*` | `WinScreen`：滚动的背景、暗角、行距 12、每刻 0.5 像素。**默认不显示 Minecraft 的标志** | M | — | 2 |
| 036 | `title-panorama` | 主菜单 / Title Screen | 标题 | 全景图慢慢转，中间是自己的标题，右上方斜着的黄色闪烁标语一胀一缩，下面一排按钮 | `title`、`splash`、`buttons`（多行）、`version`（左下角小字）、`panSpeed`、`image`（用图片代替标题） | `gui/title/background/panorama_0`–`5`、`panorama_overlay`；按钮贴图 | `TitleScreen`：标语倾斜 −20°、按正弦缩放；全景图的转速。**默认不用 `gui/title/minecraft` 标志** | M | (P3) | 2 |
| 037 | `pause-menu` | 游戏菜单 / Pause Menu | 叠加 | 画面压暗，“游戏菜单”和一列按钮弹出来；其中一个被悬停、按下 | `title`、`buttons`（多行，可以改成“订阅频道”之类）、`hoverIndex`、`dim`、`clickSound` | 按钮贴图；`ui.button.click` | `PauseScreen` 的版式：按钮 204 × 20 和 98 × 20 两种宽度，间距 4 | M | (P3) | 2 |
| 038 | `title-command` | 标题命令 / Title | 叠加 | 屏幕中央的大标题、副标题，以及快捷栏上方的动作栏文字，按游戏的淡入、停留、淡出 | `title`、`subtitle`、`actionbar`、三段文字各自的颜色、`fadeIn` / `stay` / `fadeOut`（默认 10 / 70 / 20 刻） | 只有字体 | `Gui.renderTitle`：标题放大 4 倍、副标题 2 倍，位置在中心偏上 | S | — | 1 |
| 039 | `boss-bar` | Boss 栏 / Boss Bar | 叠加 | 顶部一条 Boss 血条，上面是名字；进度从一个值走到另一个值 | `name`、`color`（7 种）、`notches`（不分段 / 6 / 10 / 12 / 20）、`from`、`to`、`changeAt`、`bars`（同时显示几条） | `gui/sprites/boss_bar/<颜色>_background`、`_progress`、`notched_*`；`event.raid.horn` 等可选 | `BossHealthOverlay`：条宽 182、高 5，名字在条上方 9 像素，多条间距 19 | S | (P3) | 1 |
| 040 | `scoreboard-sidebar` | 记分板 / Scoreboard | 叠加 | 右侧的记分板：标题一行，下面若干行“名字 + 红色分数”；分数可以滚动到新值，行可以换位 | `title`、`rows`（多行“名字 分数”）、`rowsAfter`（变化后的）、`changeAt`、`showNumbers` | 只有字体 | `Gui.displayScoreboardSidebar`：半透明黑底（标题行更深）、分数红色右对齐、垂直居中靠右 | M | (P6) | 1 |
| 041 | `chat-message` | 聊天消息 / Chat | 叠加 | 左下角的聊天行一条条顶上来，带半透明黑底，过一会儿淡出；可以先在输入栏里打字再发出 | `lines`（多行，每行一条）、`interval`、`lifetime`（默认 200 刻）、`typeFirst`、`bgOpacity`、`sound` | 只有字体 | `ChatComponent`：消息 200 刻后淡出，行高 9，宽 320 | M | (P6) | 1 |
| 042 | `hotbar-switch` | 快捷栏 / Hotbar | 叠加 | 底部九格快捷栏，选中框从一格跳到另一格，上方浮出物品名再淡出 | `items`（九个 `item`，可空）、`from`、`to`、`steps`（中间经过哪些格）、`showName`、`offhand` | `gui/sprites/hud/hotbar`、`hotbar_selection`、`hotbar_offhand_left`；物品贴图 | `Gui.renderHotbar`：182 × 22，选中框 24 × 23；物品名 40 刻后淡出 | M | (P2) (P3) | 2 |
| 043 | `hud-status` | 状态栏 / Status Bars | 叠加 | 生命、护甲、饥饿、氧气几排图标，生命值从一个值变到另一个值：掉血时闪白，低血量时抖动，回血时一颗颗跳起 | `healthFrom`、`healthTo`、`maxHealth`、`absorption`、`armor`、`food`、`air`、`heartStyle`（普通 / 极限 / 中毒 / 凋零 / 冰冻）、`changeAt`、`hurtSound` | `gui/sprites/hud/heart/*`、`hud/armor_*`、`hud/food_*`、`hud/air*`；`entity.player.hurt` | `Gui.renderPlayerHealth`：受伤后闪烁、4 点血以下每刻抖动（这里换成种子决定的表）、再生的波浪 | M | (P3) | 1 |
| 044 | `xp-collect` | 经验收集 / XP Collect | 叠加 | 经验球飞向底部的经验条，条一段段涨满，等级数字加一并跳一下 | `levelFrom`、`levels`、`orbs`、`orbOrigin`、`pickupSound`、`levelupSound` | `gui/sprites/hud/experience_bar_background`、`_progress`；`entity/experience_orb`；`entity.experience_orb.pickup`、`entity.player.levelup` | 经验条 182 × 5、等级数字绿色带黑边；经验球的颜色在黄绿之间循环 | M | (P3) | 1 |
| 045 | `item-tooltip` | 物品提示框 / Item Tooltip | 叠加 | 游戏的深色紫边提示框：第一行是带稀有度颜色的名字，下面几行说明；可以跟着一个物品图标 | `name`、`rarity`、`lore`（多行）、`item`（可空）、`followPath`（提示框的移动方式） | `gui/sprites/tooltip/background`、`frame`（1.21.2 起）；旧版本的框是代码画的渐变 | `TooltipRenderEvent` 一族：底 0xF0100010，边框渐变 0x505000FF → 0x5028007F，内边距 3 | S | (P3) (P6) | 1 |
| 046 | `crafting-recipe` | 合成 / Crafting | 叠加 | 工作台界面，材料一个个放进九宫格，结果格里出现成品，被拿走 | `grid`（九个 `item`，可空）、`result`、`count`、`title`、`placeInterval`、`takeResult`、`sound` | `gui/container/crafting_table`；物品贴图；`ui.button.click`、`entity.item.pickup` | 工作台界面 176 × 166，格子 18 × 18，九宫格起点 (30, 17)，结果格 (124, 35) | M | (P2) | 2 |
| 047 | `furnace-smelt` | 熔炼 / Smelting | 叠加 | 熔炉界面：火焰烧着，箭头从左走到右，成品出现 | `input`、`fuel`、`output`、`kind`（熔炉 / 高炉 / 烟熏炉）、`cookTime`、`loops`、`sound` | `gui/container/furnace`；`gui/sprites/container/furnace/lit_progress`、`burn_progress`；`block.furnace.fire_crackle` | 熔炉界面的火焰 14 × 14、箭头 24 × 16，熔炼 200 刻 | M | (P2) (P3) | 2 |
| 048 | `anvil-rename` | 铁砧改名 / Anvil Rename | 叠加 | 铁砧界面，输入框里一个字一个字打出新名字，下面出现“附魔花费” | `item`、`name`、`cost`、`tooExpensive`、`typeSpeed`、`sound` | `gui/container/anvil`；`gui/sprites/container/anvil/text_field`；`block.anvil.use` | 铁砧界面的输入框和花费文字（绿色，过于昂贵时红色） | S | (P3) | 2 |
| 049 | `game-mode-switcher` | 游戏模式切换 / Game Mode Switcher | 叠加 | 屏幕中央弹出一条四个图标的选择条，选中框移到另一个模式，上面是模式名 | `from`、`to`、`labels`（四个名字）、`hint`（下面的按键提示行）、`sound` | `gui/sprites/gamemode_switcher/slot`、`selection`；`gui/container/gamemode_switcher`；物品贴图 | `GameModeSwitcherScreen`（F3 + F4）：四格，图标是草方块、铁剑、地图、末影之眼 | S | (P3) | 2 |
| 050 | `tab-player-list` | 玩家列表 / Player List | 叠加 | 顶部的玩家列表：每行头像、名字、信号格，上下各有一段页眉页脚 | `players`（多行名字）、`skins`（最多 8 张皮肤图片）、`header`、`footer`、`columns`、`joinOrder`（逐个加入的动画） | `gui/sprites/icon/ping_1`–`5`；`entity/player/wide/*` | `PlayerTabOverlay`：每行高 9、头像 8 × 8（脸加帽子层）、每列最多 20 人 | M | (P3) (P6) | 2 |
| 051 | `server-list-entry` | 服务器条目 / Server Entry | 叠加 | 多人游戏列表里的一条：图标、服务器名、两行简介、人数和信号；悬停时图标上出现加入箭头 | `icon`（图片）、`name`、`motd`（两行）、`players`、`ping`、`hover`、`sound` | `gui/sprites/server_list/join`、`join_highlighted`、`icon/ping_*`；`misc/unknown_server` | `ServerSelectionList`：条目 305 × 36、图标 32 × 32 | M | (P3) | 2 |
| 052 | `effect-icons` | 状态效果 / Status Effects | 叠加 | 右上角的状态效果图标一个个出现；快结束的那个一闪一闪 | `effects`（最多 6 个，`enum`）、`ambient`（信标给的那种框）、`blinkAt`、`showTimer`（物品栏样式，带名字和时间） | `gui/sprites/hud/effect_background`、`effect_background_ambient`；`mob_effect/<名字>` | `Gui.renderEffects`：图标 24 × 24 的框、18 × 18 的图，剩 10 秒起闪烁 | S | (P3) | 1 |
| 053 | `now-playing` | 正在播放 / Now Playing | 叠加 | 快捷栏上方的彩虹变色文字“正在播放：……”，或 1.21.6 起的音乐提示框（音符跳动） | `style`（`actionbar` / `toast`）、`track`、`artist`、`disc`（唱片物品）、`rainbow` | 字体；`gui/sprites/toast/now_playing`、`icon/music_notes`；`item/music_disc_*` | 唱片机的动作栏文字用 HSV 循环变色；`NowPlayingToast`（1.21.6） | S | (P3) | 1 |
| 054 | `debug-f3` | 调试屏幕 / Debug Screen | 叠加 | 左右两栏带灰底的调试文字；坐标、朝向、帧率按参数给的路线随时间变化 | `left`、`right`（多行，可用占位符如 `{x}` `{fps}`）、`from`、`to`（坐标的起止）、`facing`、`fpsBase` | 只有字体 | `DebugScreenOverlay`：每行灰底 0x90505050、行高 9、字色 0xE0E0E0 | M | — | 1 |
| 055 | `sound-subtitles` | 声音字幕 / Subtitles | 叠加 | 右下角的字幕框，一行一条声音，带 `<` `>` 方向箭头，新的顶上来，旧的变淡消失 | `lines`（多行，每行“文字、方向”）、`interval`、`lifetime`（默认 3 秒）、`bgOpacity` | 只有字体 | `SubtitleOverlay`：黑底 80% 不透明，箭头表示声源方向，字从白淡到灰 | S | — | 1 |
| 056 | `enchant-glyphs` | 附魔 / Enchant | 叠加 | 银河字母从四周飘向中央的物品，物品蒙上流动的附魔光效，下方出现附魔名 | `item`、`enchantment`、`level`、`glyphs`（数量）、`glint`、`sound` | 字体 `minecraft:alt`；`particle/sga_a`–`z`；`misc/enchanted_glint_item`；`block.enchantment_table.use` | 附魔台的字母粒子飞向书；附魔光效两层滚动 | M | (P1) | 5 |
| 057 | `map-route` | 地图路线 / Map Route | 叠加 | 一张地图浮在角落，玩家标记沿一条路线走到红叉处，路线画成虚线 | `points`（多行坐标）、`showTarget`、`mapTint`、`image`（用自己的图当地图内容）、`sound` | `map/map_background`；`map/decorations/player`、`red_x`、`target_point` | 地图上的标记贴图（1.20.5 起每个一张） | M | (P3) | 6 |

### 1.4 D 粒子、天气与屏幕效果（11）

粒子都是“预先用 `ctx.random` 定好每个粒子的出生时刻和初速度，`update(t)` 里用闭式算位置”，不做逐帧积分（同 block-fall 的做法）。

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 058 | `precipitation` | 雨雪 / Rain & Snow | 叠加 | 雨或雪一列列落下，雨滴在底部溅起水花 | `kind`（雨 / 雪）、`intensity`、`wind`（倾斜）、`splashes`、`layers`、`ambientSound` | `environment/rain`、`environment/snow`；`particle/splash_*`；`weather.rain` | `LevelRenderer.renderSnowAndRain`：按列滚动的贴图，各列速度不同 | S | — | 5 |
| 059 | `lightning-flash` | 闪电 / Lightning | 转场 | 一道分叉的闪电劈下来，白光闪满全屏；退出时白光褪去，再闪一下余光 | `bolts`、`branches`、`flashColor`、`afterFlash`、`thunderSound`、`impactSound` | 没有贴图（游戏里闪电就是纯几何）；`entity.lightning_bolt.thunder`、`.impact` | `LightningBoltRenderer`：按种子逐段偏移的多层棱柱 | S | — | 5 |
| 060 | `sky-timelapse` | 昼夜流转 / Day–Night | 转场 | 天空铺满画面，太阳落下、星星出来、月亮升起（或反过来）；可以叠一行“第 N 天” | `from`、`to`（一天里的时刻）、`moonPhase`、`stars`、`label`、`skyColors` | `environment/sun`、`environment/moon_phases`；`environment/end_sky`（末地样式） | 太阳月亮各占 30 × 20 的方片、8 种月相、1500 颗星（种子 10842） | M | — | 4 |
| 061 | `cloud-pass` | 穿云 / Through the Clouds | 转场 | 镜头向上穿过一层云：云块从远到近变大、白色铺满，再穿出去 | `style`（平面 / 立体）、`color`、`direction`（上升 / 下降 / 平飞）、`density` | `environment/clouds` | 云的形状来自一张 256 × 256 的图，每像素一块 12 × 4 × 12 的云 | M | — | 4 |
| 062 | `ambient-particles` | 环境粒子 / Ambient Particles | 叠加 | 一种环境粒子在画面里飘：樱花花瓣、灰烬、孢子、萤火虫、末地烛的白点 | `kind`、`count`、`wind`、`size`、`depth`（远近层次） | `particle/cherry_*`、`ash_*`、`white_ash_*`、`spore_blossom_*`、`firefly`、`glow` 等 | 各生物群系的环境粒子，各自的下落、摇摆方式 | S | (P1) (P3) | 5 |
| 063 | `particle-burst` | 粒子迸发 / Particle Burst | 叠加 | 在一个点上迸出一团粒子：暴击、魔法暴击、爱心、村民生气或高兴、音符、伤害爱心、旋风 | `kind`、`count`、`origin`、`spread`、`gravity`、`repeat`、`sound` | `particle/critical_hit`、`enchanted_hit`、`heart`、`angry`、`glint`、`note`、`damage`、`gust_*` | 各粒子的初速度和重力；音符按音高染色 | S | (P1) | 5 |
| 064 | `splash-potion` | 喷溅药水 / Splash Potion | 叠加 | 药水瓶抛进来砸碎，一圈彩色水花扩散，画面边缘染上药水的颜色再褪去 | `color`、`lingering`（滞留药水，多一片云）、`target`、`tintStrength`、`throwSound`、`breakSound` | `item/splash_potion`、`potion_overlay`；`particle/splash_*`、`effect_*`；`entity.splash_potion.throw`、`.break` | 药水物品是瓶子加一层染色的液体；破碎时的水花和药水漩涡粒子 | M | (P1) | 5 |
| 065 | `smoke-rise` | 浓烟 / Smoke | 转场 | 营火的烟从下面一团团升起，越来越浓直到盖满；退出时被吹散 | `color`、`signal`（信号烟，更高更久）、`wind`、`backing`、`sound` | `particle/big_smoke_0`–`11`；`block.campfire.crackle`、`block.fire.extinguish` | 营火的烟粒子（12 帧）；烟是半透明的，剪辑点靠垫底保证不透明 | M | (P1) | 5 |
| 066 | `fire-burn` | 烧穿 / Burn Through | 转场 | 火从下往上烧，烧过的地方变成焦黑；退出时焦黑的幕被烧出洞、烧光，边缘带火星 | `fire`（火 / 灵魂火）、`charColor`、`embers`、`edgeGlow`、`sound` | `block/fire_0`、`fire_1`、`soul_fire_*`（带动画）；`particle/lava`、`flame`；`block.fire.ambient` | 着火时第一人称的火焰贴图；烧穿的边界是噪声阈值，非原版行为 | M | (P1) | 4 |
| 067 | `sonic-darkness` | 音波与黑暗 / Sonic Darkness | 转场 | 音波环从中心一圈圈冲出来，四周的黑暗跟着心跳向中间合拢到全黑；退出时黑暗退开 | `rings`、`pulse`（心跳的快慢）、`tint`、`boomSound`、`heartbeatSound` | `particle/sonic_boom_0`–`15`；`entity.warden.sonic_boom`、`entity.warden.heartbeat` | 监守者的音波粒子（16 帧）和黑暗效果的明暗脉动 | M | (P1) | 5 |
| 068 | `screen-vignette` | 视野叠层 / Vision Overlay | 叠加 | 一张铺满画面的原版视野贴图淡入、停留、淡出：南瓜头、细雪结霜、暗角、望远镜、水下 | `kind`、`strength`、`pulse`、`tint` | `misc/pumpkinblur`、`powder_snow_outline`、`vignette`、`spyglass_scope`、`underwater` | `Gui.renderTextureOverlay` 一族 | S | — | 5 |

### 1.5 E 文字与字幕条（11）

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 069 | `sign-post` | 告示牌 / Sign | 叠加 | 一块告示牌从下面插进画面，轻轻晃一下站稳，上面四行字；可以是发光的字 | `wood`、`hanging`（悬挂式）、`lines`（四行）、`textColor`（染料色板）、`glowing`、`sound` | `entity/signs/<木种>`、`entity/signs/hanging/<木种>`；`block.wood.place` | 告示牌每行最宽 90 像素；发光墨囊的八方向描边（`ctx.text` 已经支持） | M | (P1) | 7 |
| 070 | `typewriter-caption` | 打字机字幕 / Typewriter Caption | 叠加 | 底部居中的字幕一个字一个字打出来，带闪烁的光标和半透明黑底 | `text`（多行，一行一句）、`charsPerSecond`、`cursor`、`bgOpacity`、`keySound` | 只有字体；`ui.button.click`（压低音量）或音符盒 | 聊天输入栏的光标每 6 刻闪一次 | S | — | 7 |
| 071 | `nameplate` | 名牌 / Nameplate | 叠加 | 下三分之一位置滑出一块名牌：左边是皮肤的头像，右边名字和一行说明，底是实体名称标签那种半透明黑 | `skin`（图片）、`name`、`role`、`accent`（一条强调色）、`side`（左 / 右） | `entity/player/wide/steve`（默认皮肤） | 实体名称标签的底色（25% 不透明黑）；头像取皮肤的脸和帽子层 | M | — | 7 |
| 072 | `written-book-card` | 书页卡片 / Book Page | 叠加 | 一本打开的书弹出来，页面上逐行写出一段文字，页眉是“第 1 页，共 N 页” | `text`（多行）、`pageLabel`、`author`（签名行）、`writeSpeed`、`sound` | `gui/book`；`gui/sprites/widget/page_forward`、`page_backward`；`item.book.page_turn` | `BookViewScreen`：页面 192 × 192，文字区 114 宽，每页 14 行 | M | (P3) | 6 |
| 073 | `block-letters` | 方块拼字 / Block Letters | 标题 | 标题的每个像素是一个方块，方块一个个落位拼出字来；退出时散开 | `text`、`font`、`blocks`、`arrangement`、`depth`、`buildOrder`、`placeSound` | 字体（取字形的像素）；方块贴图 | 无原版出处；玩家用方块拼字的做法 | L | P5 | 7 |
| 074 | `kinetic-title` | 逐字标题 / Kinetic Title | 标题 | 两行标题一个字一个字弹进来（落下、翻转或放大），停留，再一个字一个字掉下去 | `title`、`subtitle`、`charIn`（落下 / 翻转 / 放大 / 打字）、`charOut`、`stagger`、`shadowDepth`、`sound` | 只有字体 | 无原版出处；常见的逐字动画标题 | M | — | 7 |
| 075 | `counter` | 计数器 / Counter | 叠加 | 角落里一个物品图标加一个数字，数字从一个值滚到另一个值，每跳一次图标弹一下 | `item`、`from`、`to`、`prefix`、`suffix`、`steps`（中途停几次）、`tickSound`、`doneSound` | 物品贴图；`entity.experience_orb.pickup`、`entity.player.levelup` | 物品栏里物品数量的画法（右下角、带阴影） | S | (P2) | 7 |
| 076 | `countdown` | 倒计时 / Countdown | 标题 | 屏幕中央的大数字 3、2、1 依次缩放出现，最后是一个词（“开始！”） | `from`、`finalText`、`interval`、`colors`、`tickSound`、`goSound` | 只有字体；`block.note_block.hat`、`block.note_block.pling` | 无原版出处；小游戏服务器常见的倒计时，用标题命令的字号 | S | — | 7 |
| 077 | `checklist` | 任务清单 / Checklist | 叠加 | 一块清单面板，条目一条条出现，再一条条打上勾、变灰划掉 | `title`、`items`（多行）、`checked`（哪几条打勾）、`checkInterval`、`strike`、`sound` | `gui/sprites/widget/checkbox`、`checkbox_selected`；`ui.button.click` | 游戏的复选框贴图；面板底用提示框的样式 | M | (P3) | 7 |
| 078 | `key-hint` | 按键提示 / Key Hint | 叠加 | 一个或几个键帽（带字母），按下去、弹起来，旁边一行说明 | `keys`（多行，如 `W` `A` `S` `D`）、`label`、`pressPattern`（依次 / 同时 / 长按）、`sound` | `gui/sprites/widget/button`（九宫格当键帽）；`ui.button.click` | 教程提示里的按键图标；键帽用按钮贴图拼 | S | (P3) | 7 |
| 079 | `ticker` | 滚动横幅 / Ticker | 叠加 | 一条横幅贴着画面上沿或下沿，文字从右往左连续滚过 | `text`、`speed`、`edge`（上 / 下）、`bgOpacity`、`separator`、`loops` | 只有字体 | 无原版出处；常见的滚动字幕条，底色用聊天栏的半透明黑 | S | — | 7 |

### 1.6 F 频道包装（11）

不放任何视频平台的标志、图标和配色，文字都由用户填（第 5 节 5.1）。

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 080 | `subscribe-button` | 订阅按钮 / Subscribe Button | 叠加 | 一个游戏样式的按钮滑进来，被悬停变亮、按下，文字从“订阅”变成“已订阅”，旁边的钟摇起来 | `label`、`labelAfter`、`showBell`、`cursor`（是否画指针）、`pressAt`、`clickSound`、`bellSound` | 按钮贴图三种状态；`item/bell`；`ui.button.click`、`block.bell.use` | 游戏按钮的三种状态；参考视频里常见的订阅提示，不用任何平台的图形 | M | P2 (P3) | 8 |
| 081 | `like-reminder` | 点赞提醒 / Like Reminder | 叠加 | 一颗空的心被一点点填满，满了以后跳一下、迸出几颗小爱心，旁边一行字 | `label`、`fillSteps`、`heartStyle`、`burst`、`sound` | `gui/sprites/hud/heart/container`、`half`、`full`；`particle/heart`；`entity.experience_orb.pickup` | 生命值图标；参考常见的点赞提醒，用游戏里的心代替拇指 | S | (P3) | 8 |
| 082 | `end-screen` | 片尾画面 / End Screen | 标题 | 铺满的背景上留出两个 16:9 的视频位和一个圆形的头像位，带标题和一行说明；框一个个搭出来 | `layout`（两个视频位的排法）、`background`（方块 / 全景）、`frameBlock`（框用的方块）、`title`、`note`、`avatar`（图片） | 方块贴图；`gui/title/background/panorama_*`；`block/item_frame` | 视频平台片尾元素的常见位置和大小（**具体安全区数值要核对**） | M | — | 8 |
| 083 | `intro-logo` | 片头标志 / Logo Intro | 标题 | 一面方块墙被从中间挖开，露出后面的频道标志和频道名；停留后方块又填回去、整体消失 | `logo`（图片）、`name`、`tagline`、`blocks`、`revealShape`（圆 / 方 / 标志外接框）、`breakSound`、`placeSound` | 方块贴图；`block/destroy_stage_*`；用户的图片 | 无原版出处；片头的标志揭示 | M | (P1) | 8 |
| 084 | `social-handles` | 账号条 / Social Handles | 叠加 | 几个物品栏格子排成一列，每格里是一张用户给的图标，右边是账号名；一行行滑入 | `rows`（最多 4 行：`texture` 加 `text`）、`slotStyle`、`stagger` | `gui/sprites/container/slot`；用户的图片 | 物品栏格子 18 × 18；图标由用户提供，不内置任何平台图标 | S | (P3) | 8 |
| 085 | `versus-screen` | 对决 / Versus | 标题 | 两张头像带着名字从两边撞向中间，中间砸下一个“VS”，背景分成两种颜色 | `skinA`、`skinB`、`nameA`、`nameB`、`colorA`、`colorB`、`vsText`、`impactSound` | 默认皮肤；`entity.generic.explode`、`block.anvil.land` | 无原版出处；对战视频常见的对决画面 | M | — | 8 |
| 086 | `player-card` | 玩家卡片 / Player Card | 叠加 | 画面一侧站着一个玩家模型（用自己的皮肤），转头、摆手，旁边一块面板写名字和简介 | `skin`、`slim`、`name`、`bio`（多行）、`pose`（站立 / 挥手 / 持物）、`item`、`side` | 默认皮肤；物品贴图 | 玩家模型的六个部件加外层；物品栏里那个会看向鼠标的玩家预览 | L | P1 P4 | 9 |
| 087 | `corner-badge` | 角标 / Corner Badge | 叠加 | 角落里一个像掉落物那样慢慢转、上下浮的物品（或图片），旁边一行小字 | `item`、`image`、`label`、`bob`、`spin` | 物品贴图；用户的图片 | 掉落物的自转和浮动 | S | (P2) | 8 |
| 088 | `vote-bars` | 投票条 / Vote Bars | 叠加 | 上下两条 Boss 血条各代表一个选项，你追我赶地涨到各自的百分比，赢的那条闪一下 | `optionA`、`optionB`、`percentA`、`percentB`、`colorA`、`colorB`、`race`（中途的起伏）、`winSound` | `gui/sprites/boss_bar/*` | Boss 血条的贴图；两条对比的排法是自己的 | M | (P3) | 8 |
| 089 | `speedrun-timer` | 速通计时 / Speedrun Timer | 叠加 | 角落里的计时器从某个时间开始走，到点停住变色；下面可以有一行分段名 | `startAt`、`stopAt`、`format`（是否带毫秒）、`split`、`doneColor`、`doneSound` | 只有字体；`entity.player.levelup` | 无原版出处；速通视频的计时器。模板最长 30 秒，更长的要拼接 | S | — | 7 |
| 090 | `facecam-frame` | 摄像头边框 / Facecam Frame | 叠加 | 一个中间透明的方块边框搭出来，框住摄像头画面的位置，下沿挂一块名牌 | `frameBlock`、`width`、`height`、`position`、`name`、`buildOrder`、`sound` | 方块贴图 | 无原版出处；直播和实况视频的摄像头边框 | S | — | 8 |

### 1.7 G 像素与着色器风格（6）

整个模板是一个或几个全屏着色器，不依赖原版贴图也能看（填充可以选方块贴图）。

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 005 | `pixel-dissolve` | 像素溶解 / Pixel Dissolve | 转场 | 现有（`04` T5） | — | — | — | — | — | — |
| 091 | `crt-power` | 显像管 / CRT Power | 转场 | 画面像老电视关机那样压成一条亮线、缩成一个点，全黑；退出时带着雪花噪点重新亮起 | `lineColor`、`staticAmount`、`scanlines`、`staticStep`（噪点多久换一次）、`sound` | 无；`block.beacon.deactivate` 等可选 | 无原版出处；噪点按 `floor(t × 步频)` 取种子，仍是时间的纯函数 | S | — | 4 |
| 092 | `mask-iris` | 图形光圈 / Shape Iris | 转场 | 一个图形（望远镜圆框、苦力怕脸、头颅、花）的轮廓从大缩到小把画面收黑，再放大打开 | `mask`（预置图形或自己的图片）、`center`、`fill`、`pixelate`、`rotate`、`sound` | `misc/spyglass_scope`；`entity/banner/creeper`、`skull`、`flower`、`globe`（旗帜图案是灰度遮罩）；`item.spyglass.use` | 望远镜的视野遮罩；旗帜图案贴图当遮罩用 | S | — | 4 |
| 093 | `column-melt` | 逐列融化 / Column Melt | 转场 | 画面按竖条分开，每条以不同的速度从上面流下来盖满；退出时一条条继续往下流走 | `columns`、`variance`（各条速度的差别）、`fill`、`drip`（末端的滴落形状）、`direction` | 可选方块贴图 | 无原版出处；老游戏里著名的“融化”转场 | S | — | 4 |
| 094 | `glitch-blocks` | 故障色块 / Glitch Blocks | 转场 | 错位的色块条一阵阵闪出来，越来越多直到盖满；退出时一阵阵消失 | `colors`、`blockSize`、`bursts`（闪几阵）、`rgbSplit`（色块自身的色散）、`stepRate` | 无 | 无原版出处；只画色块，不扭曲底下的视频 | M | — | 4 |
| 095 | `glint-sweep` | 附魔光扫 / Glint Sweep | 叠加 | 附魔光效那种紫色的流动纹理斜着扫过整个画面，或者扫过一张图片 | `tint`、`angle`、`speed`、`strength`、`mask`（只在某张图片的范围内） | `misc/enchanted_glint_item`、`enchanted_glint_entity` | 附魔光效：两层贴图以不同角度滚动。游戏里是加法混合，导出是直通 alpha，这里只能近似 | S | — | 4 |

### 1.8 H 节日与主题（5）

| 编号 | id | 名称 | 类别 | 画面 | 主要参数 | 原版素材 | 依据 | 难度 | 前置 | 批 |
|---|---|---|---|---|---|---|---|---|---|---|
| 096 | `firework-show` | 烟花 / Fireworks | 叠加 | 几枚火箭拖着火星升空，炸成球、大球、星形、苦力怕脸或迸裂形，带拖尾和闪烁 | `shells`（几发）、`shapes`、`colors`、`fadeColors`、`trail`、`twinkle`、`launchSound`、`blastSound` | `item/firework_rocket`；`particle/spark_0`–`7`、`flash`；`entity.firework_rocket.launch`、`.blast`、`.large_blast`、`.twinkle` | `FireworkParticles`：五种形状的生成方式、拖尾、闪烁、渐变色 | M | (P1) | 5 |
| 097 | `cake-celebrate` | 蛋糕庆祝 / Cake | 叠加 | 一块蛋糕落在画面里，上面的蜡烛一根根点亮，旁边一行祝贺的字；或者被一口口吃掉 | `mode`（点蜡烛 / 吃掉）、`candles`、`candleColor`、`text`、`sound` | `block/cake_top`、`cake_side`、`cake_bottom`、`cake_inner`、`<颜色>_candle`；`particle/flame`；`block.cake.add_candle`、`entity.generic.eat` | 蛋糕有 7 口；蜡烛蛋糕（1.17） | M | (P1) | 8 |
| 098 | `bat-swarm` | 蝙蝠群 / Bat Swarm | 转场 | 一群蝙蝠扑着翅膀从一侧飞过，越来越密直到盖住画面；退出时飞散 | `count`、`direction`、`flapSpeed`、`backing`、`sound` | `entity/bat`；`entity.bat.takeoff`、`entity.bat.ambient` | 蝙蝠模型（1.20.3 换过一次）；每年 10 月下旬蝙蝠更容易生成 | L | P1 P4 | 9 |
| 099 | `elder-guardian-curse` | 远古守卫者 / Elder Guardian | 叠加 | 远古守卫者半透明的脸在画面正中浮现、逼近、消失 | `scale`、`opacity`、`eyeFollow`、`sound` | `entity/guardian_elder`；`entity.elder_guardian.curse` | 挖掘疲劳生效时的幻影，持续约 30 刻；这里只用贴图的正面，不做整个模型 | S | — | 9 |
| 100 | `banner-unfurl` | 旗帜 / Banner | 叠加 | 一面旗从上面垂下来展开，轻轻飘动，旗面是底色加几层图案，下面一行字 | `baseColor`、`patterns`（最多 4 层：图案加颜色）、`image`（旗面上再贴一张自己的图）、`text`、`wave` | `entity/banner_base`、`entity/banner/<图案>` | 旗帜的图案叠层和飘动（绕顶边的小幅正弦摆动） | M | (P1) | 8 |

### 1.9 做成预设或现有模板的增强，不计入 100

这些和某个模板只差颜色、方向、默认值或一种样式，单独做一个就是凑数。

**做成 manifest 的 `presets`**

| 归属的模板 | 预设 |
|---|---|
| `block-wipe` | 南瓜灯墙（万圣节）、红石灯、16 色陶瓦、矿石墙、玻璃染色渐变 |
| `block-fall` | 沙瀑（沙子和沙砾）、铁砧雨配色、雪块 |
| `loading-screen` | 下界传送（`javaTerrain` 加传送门背景）、末地传送、“正在连接服务器”、“正在登录” |
| `advancement-toast` | 新订阅提醒、里程碑达成（挑战框）、配方解锁 |
| `liquid-flood` | 岩浆、沼泽水色、暖水色 |
| `mining-crack` | 钻石矿、黑曜石（裂得慢）、玻璃（一下就碎） |
| `chest-open` | 圣诞礼物、末影箱、潜影盒 |
| `explosion-blast` | 闪电苦力怕、无声的白闪 |
| `title-command` | “第 N 天”、维度名、生物群系名、章节标题 |
| `boss-bar` | 末影龙（粉色）、凋灵（紫色）、袭击（红色、带号角声）、视频进度条 |
| `particle-burst` | 暴击、爱心、音符、旋风各一个 |
| `ambient-particles` | 樱花林、下界的三种孢子、玄武岩三角洲的白灰 |
| `screen-vignette` | 南瓜头、结霜、暗角、望远镜、水下各一个 |
| `mask-iris` | 望远镜、苦力怕、头颅、花 |
| `countdown` | 新年倒计时（接 `firework-show` 由用户在剪辑软件里拼） |
| `nameplate` | “下集预告”、嘉宾介绍 |
| `hud-status` | 极限模式、中毒、凋零、冰冻 |

**做成现有模板的增强**（改已有的模板，由维护那个模板的批次做）

| 模板 | 增强 |
|---|---|
| `pixel-dissolve` | `pattern` 加 `bayer`（有序抖动）、`spiral`、`texture`（用旗帜图案的灰度图当阈值）；加 `cellAnim: grow`（网点那样由小变大） |
| `advancement-toast` | `kind` 加 `tutorial`（教程提示，带进度条和按键图标），`04` 里列为没做 |
| `loading-screen` | 加一个可选的按钮行，覆盖“连接已丢失”“被踢出”的画面；Java 版 1.21.9 起区块图下面的进度条 |
| `item-stinger` | 物品换成用户皮肤的头像或鞘翅飞行的玩家（要 P4，放最后） |

## 2. 质量标准

以现有六个模板和 `04-templates.md` 4.3–4.6、4.9–4.11 为准。每个模板交付前逐条打勾，做不到的那条在模板自己的文档里写明原因。

**manifest**

- [ ] `id` 是 `allay.builtin.<名字>`，和目录名一致；`version` 从 `1.0.0` 起；不写 `author`（硬性规则 9）。
- [ ] `name`、`description` 两种语言都有；说明一句话讲清画面，不写“炫酷”“震撼”之类的词。
- [ ] 每个参数都有两种语言的 `label`；不是一眼能懂的参数有 `hint`；数值参数有 `min`、`max`、合适的 `step` 和 `unit`。
- [ ] 参数分了 `groups`（内容、外观、时间、声音这类），不常用的组默认折叠。
- [ ] 互相依赖的参数用 `visibleWhen` 收起来（例如只在某个 `style` 下才有意义的）。
- [ ] 顺序、图案类的 `enum` 用 `ui: 'pattern'`，每个选项给 16 格的图案。
- [ ] 颜色参数给了合适的 `palette`（文字用 `chat`，染色用 `dye`）。
- [ ] 每段文字都配一个 `font` 参数，默认 `minecraft:default`；阴影默认值照游戏里那个界面的实际情况。
- [ ] 文字参数的默认值两种语言都有，是游戏里那一句的原文（有的话）。
- [ ] 时间参数都是 `duration` 类型；`timeline.segments` 声明了首尾相接的各段，各段之和等于模板的 `duration`。
- [ ] 至少 2 个 `presets`（展示这个模板能做出的不同样子）；有版本样式的，每种样式的游戏原始时长做成一个预设。
- [ ] `tags` 写了所属的组（`blocks`、`items`、`ui`、`particles`、`text`、`channel`、`shader`、`seasonal`），供模板库筛选。

**代码**

- [ ] 只从 `@allay/template-sdk` 做类型导入，只导入本目录和 `_lib`（P1 落地之后）里的文件；`THREE` 从 `ctx.THREE` 拿。
- [ ] `update(t)` 只依赖 `t` 和 `setup` 里建好的状态：不读真实时间、不用 `Math.random`、不留跨帧状态；随机量在 `setup` 里用 `ctx.random(key)` 算好。
- [ ] 所有资源在 `setup` 里取完；`update` 里不建几何体、材质、贴图，不做异步。
- [ ] 着色器只读 uniform；不设 `glslVersion: GLSL3`；平铺贴图用 `textureGrad`；不改引擎缓存里贴图的属性（`decisions.md` M6a）。
- [ ] `dispose` 释放自己建的几何体、材质、贴图；引擎给的句柄不动。
- [ ] 布局全部由 `ctx.stage` 推出，16:9、9:16、1:1 三种画幅都放得下、不出画、不重叠；界面类按界面像素算，放不下时整体缩小。
- [ ] 用了时间余量 `pad = 1 / fps`：`[0, pad]` 和 `[duration − pad, duration]` 里画面全空；转场在 `[cutTime − pad, cutTime + pad]` 里全满。
- [ ] 转场在剪辑点完全不透明：用了半透明或镂空贴图的（传送门、树叶、烟、门窗、冰）下面垫了不透明的底。
- [ ] `0.1 ≤ duration ≤ 30` 在参数的任意合法组合下都成立。

**声音**

- [ ] 音效 ID 用原版事件名；每个音效是一个可以置空的 `sound` 参数；`ctx.audio.cue` 只在 `setup` 里调用。
- [ ] 默认音效可以是任何原版事件，写成带命名空间的事件 ID（`minecraft:block.chest.open`）。模板开箱要有声音：该响的地方给默认音效，不留空。写进 manifest（默认值和自带预设）的音效会在“下载原版资源”时一并取回，不用改任何公共的表。
- [ ] 每个默认音效和预设里的音效，都对照本机游戏文件核对过事件 ID 存在（资源索引里的 `sounds.json`），核对结果写进模板文档。挑体积小的：一个事件的全部变体都会被取回，环境音、长音效（几百 KB）只在确实需要时用。
- [ ] 音效时刻对得上画面（放置对落位、点击对按下）；同一种声音一次最多 12 个 cue，多了按时刻均匀抽样（同 block-wipe）。
- [ ] 画面里有位置的声音（方块、爆炸、箭）带 `position`；界面音不带（`decisions.md`“素材与音效”）。

**对照游戏文件核对**（把开头“数值都是凭记忆写的”落到流程上）

- [ ] 用到的每个贴图路径、音效事件 ID、字体 ID，实现时都对照本机游戏文件的清单核对过：贴图看客户端 jar 里的 `assets/minecraft/textures/`，音效看资源索引里的 `sounds.json`，字体看 jar 里的 `assets/minecraft/font/`。只读清单，不把任何游戏文件复制进仓库。
- [ ] 核对结果写进该模板的文档：对照的是哪个游戏版本，每个 ID 在不在；某个版本没有的写明，并说明模板在那个版本上怎么表现（用可选贴图退回旧路径，或换一种画法）。
- [ ] 界面坐标、颜色、刻数：能上网查到公开资料的要查，在依据表里标“经搜索确认”并写出处；查不到的标“凭记忆”。不许把没核对过的写成核对过的。
- [ ] 方块和物品只用目录里有的 ID（`packages/assets/data/`，第 0 批已对照游戏文件扩充）；目录里没有而又需要的，告诉主控，不自己加。

**没有原版素材、素材版本不对时**

- [ ] 模板文档里列出用到的每个贴图 ID、音效 ID、字体。
- [ ] 贴图缺失时不抛错：画面的结构还在（面板、文字、动作都对），只是贴图是占位图。
- [ ] 没有原版字体时文字走系统字体，布局不坏（文字变宽、变高时面板跟着变，同 advancement-toast）。
- [ ] 用到 1.20.2 之后才有的贴图路径的，写明在更早的版本上会怎样；P3 落地后改成按版本选路径。

**性能**（`02-engine.md` 2.11）

- [ ] 1080p、不开运动模糊时 `update + render` 在核显上 ≤ 8 ms；参数变更到出画面 ≤ 50 ms。
- [ ] 实例总数不超过 5000，绘制调用不超过 64 次，自建贴图合计不超过 16 MB；超了先量出瓶颈再定，不靠降画质。
- [ ] 默认参数下的 `setup` 不超过看门狗时限的一半。

**测试与基线**

- [ ] `T-TPL-3`（三种画幅、无警告、确定性、首末帧透明、剪辑点不透明、确实在动）通过。
- [ ] `T-TPL-4`（50 组随机合法参数）通过。
- [ ] `T-TPL-5` 的基准图已生成：`tests/fixtures/baselines/<id>/` 下三种画幅各五帧。
- [ ] 模板自己的验收测试编号是 `T-TPL-C<三位编号>-<序号>`，例如 `T-TPL-C039-1`；一个模板一个文件 `tests/unit/T-TPL-C039.boss-bar.test.ts`。至少包括：布局数值和游戏一致（界面类）、时间公式（各段的起止和游戏的刻数一致）、每个自带预设能载入。
- [ ] 没有跳过或标成待办的测试。

**封面与文档**

- [ ] 封面（剪辑点那一帧；没有剪辑点的取中间一帧）在 320 × 180 下看得出是什么，不是一片空白或一片纯色。叠加层默认的 `scale` 要让封面里看得清。
- [ ] `docs/templates/<名字>.md`：画面与动画、参数表、依据表（每条标“凭记忆”“经搜索确认”或“对照过游戏文件”）、没做的。
- [ ] 评审用的联络图用假资源栈生成（不含原版贴图）；用真实游戏素材截的图不提交。
- [ ] 汇报里写清哪些对照过游戏、哪些没有；没在真实剪辑软件里看过的不说“已验证”。

## 3. 需要先补的引擎或接口能力

### 3.1 不改接口就能做的

94 个新模板里，86 个在现在的公开接口内就能做出首版（表里“前置”一栏为空或只有带括号的项）。它们用到的都是现有能力：

- 任意贴图 ID（`gui/sprites/*`、`particle/*`、`entity/*`、`environment/*`、`misc/*`、`map/*`、`painting/*`、`mob_effect/*`），带动画的由引擎按 `t` 播放。
- 自己用 `THREE` 建几何体和着色器（长方体、薄板、全屏四边形、自己的 `InstancedMesh`）。
- 九宫格精灵、按字体族排的文字、方块和物品句柄、带位置的音效 cue、带种子的随机和噪声。

非整方块的东西（门、活塞、蛋糕、告示牌、旗帜）用几个带贴图的长方体或薄板拼，不需要引擎支持。

### 3.2 要补的六项，按解锁的模板数排序

| 编号 | 能力 | 最小改动 | 没有它就做不了的 | 有了更好的 | 是否改公开接口 |
|---|---|---|---|---|---|
| P1（已做） | 内置模板之间共享代码 | `scripts/build-templates.ts` 允许导入 `packages/templates/_lib/` 下的文件（esbuild 照样打进单文件，产物里仍然没有 import）；`eslint.config.js` 的 `deps/templates` 规则放行这个目录；`04` 4.9 改一句。`_lib` 里先放了时间余量、界面像素布局、闭式粒子的基础；带贴图的长方体（P4）、按钮和面板的拼法等到有模板要用时再加 | 5（都是因为 P4） | 全部 94 个：现在的做法是每个目录各放一份相同的副本（`arrangement.ts` 就是两份） | 不改。运行时接口不变，用户模板不受影响，硬性规则 5 仍然成立（内置模板用的还是公开接口，只是源码可以复用） |
| P3（已做） | 可选贴图 | `ctx.resources.texture(id, { optional: true })`：没有时返回 `null`、不记警告。模板按“新路径 → 旧路径”依次试 | 0 | 约 30 个界面类：1.20.2 之前界面贴图在几张大图集里（`gui/icons`、`gui/widgets`、`gui/bars`），没有这个接口就只能支持 1.20.2 之后的素材，而且试旧路径会触发警告、过不了 `T-TPL-3` | 改：加一个可选参数。`template-api.d.ts` 和编写指南重新生成 |
| P2（已做：方块 278 个、物品 249 个，见 `03` 3.7） | 方块和物品目录扩充 | `packages/assets/data/blocks.json`、`items.json`、`names.json` 加条目。原来物品只有 42 个、方块 112 个，目录外的 ID 会给占位图加警告。药水、刷怪蛋、皮革护甲（要叠层染色）和盾牌（只有模型）没有收，要用的模板自己取贴图来画 | 2（080 要钟，032 要标靶） | 约 20 个带 `item` 参数的：物品选择器里能选的太少。建议一次加到约 200 个物品（全部唱片、工具、食物、药水瓶、刷怪蛋、钟、地图、鞘翅、三叉戟、盾牌）和约 60 个方块（标靶、幽匿、蓝冰、南瓜灯、红石灯、各种木板和原木） | 不改接口，只加数据。名字仍从运行时的语言文件来，不抄翻译表（`names.json` 现在怎么填的要先看一眼） |
| P6 | 一段文字里多种颜色 | `ctx.text.create` 的 `text` 接受分段数组 `{ text, color?, bold?, italic?, obfuscated? }[]`。乱码字（§k）按 `floor(t × 20)` 和种子换字形 | 0 | 6 个（040、041、045、050，以及 054、055 的局部着色）。没有时每种颜色建一个文字对象、按 `width` 自己拼，能做但换行处理不了 | 改：`TextOptions` 加一种写法 |
| P4 | 带贴图的长方体模型 | 放在 `_lib` 里（依赖 P1）：给出部件表（原点、尺寸、贴图坐标、轴心、父子关系），返回一组可以按部件转动的 `THREE.Group`；贴图坐标照游戏的箱体展开方式。先写玩家（宽、细两种，带外层）、箱子、潜影盒、苦力怕、蝙蝠 | 5（009 的苦力怕、021、030、086、098），另有 `item-stinger` 的增强 | — | 不改。部件尺寸是我们自己写的数（悦灵模型是先例，`decisions.md` M5a）；合规上的顾虑见 5.1 |
| P5 | 取字形的像素 | `ctx.text.rasterize(opts)`：返回 `{ width, height, data }`（每个字体像素一个 0 / 1），和 `text.create` 用同一套排版 | 1（073） | 以后的“文字溶解成像素”之类 | 改：加一个方法 |

建议：P1、P2、P3 在前置批次里做完；P4 在第 9 批开始前做；P5、P6 排在对应批次之前，赶不上就先按“没有也能做”的方式做，073 顺延。

### 3.3 不做、所以目录里没有列的

| 能力 | 为什么不做 | 因此不列的模板 |
|---|---|---|
| 读取底下的视频画面 | 模板输出的是叠加层，应用里没有“用户素材”这个概念（`01` 1.2 的范围） | 变焦模糊、画面抖动、色散故障、马赛克、反胃的扭曲、镜头畸变 |
| 把自己的画面先渲染到离屏再做后处理 | 要给模板开放渲染目标和多遍渲染，改动大；这批模板都能用单遍着色器做到 | 自身画面的高斯模糊、辉光。loading-screen 的模糊已经用 mipmap 近似 |
| 加法混合的发光 | 导出是直通 alpha（`05` 5.4），“只加亮、不遮挡”的像素在剪辑软件里表达不出来 | 光晕、镜头光斑。095 和 027 用普通混合近似，文档里写明 |
| 基岩版的界面贴图 | 基岩版的资源不在 Java 版的游戏文件里，应用也不读基岩版的安装目录（`03` 3.4） | 基岩版的样式只能像 loading-screen 的 `bedrock` 那样做近似，各模板首版都不承诺 |
| 取语言文件里的词 | 模板拿不到翻译表；文字参数的默认值两种语言各写一句就够 | 无，只是默认文字只有中英两种 |
| 超过 30 秒 | `04` 4.6 第 6 条 | 整首歌长度的计时器、完整的终末之诗。035 和 089 都受这个限制 |

## 4. 分批计划

### 4.1 批次与顺序

每批一个实现会话。批次按“共享同一种技术和素材”分，不按 1.1–1.8 的主题分，所以一个批次里会有不同组的模板。

| 批 | 主题 | 模板（编号） | 数量 | 前置 | 说明 |
|---|---|---|---|---|---|
| 0 | 前置：公共改动 | 不做模板。做 P1、P2、P3，以及 4.3 的全部公共文件改动 | 0 | — | 做完之后各批次才能互不相碰 |
| 1 | 界面一：抬头显示 | 038 039 040 041 043 044 045 052 053 054 055 | 11 | (P3) (P6) | 用户最明确的要求是还原原版界面；这批只用精灵和文字，风险最低，顺带把 `_lib` 的界面布局用实 |
| 2 | 界面二：容器与菜单 | 033 034 035 036 037 042 046 047 048 049 050 051 | 12 | (P2) (P3) | 用第 1 批沉淀下来的布局代码；要物品目录扩充才好用 |
| 3 | 方块实例 | 007 008 011 012 013 016 017 018 022 | 9 | — | 延续 block-wipe、block-fall 的技术，是产品的招牌，不依赖新能力 |
| 4 | 全屏着色器 | 010 014 015 026 060 061 066 091 092 093 094 095 | 12 | — | 延续 pixel-dissolve 的技术；对原版素材依赖最少，没有素材时也好看 |
| 5 | 粒子 | 019 056 058 059 062 063 064 065 067 068 096 | 11 | — | 共用闭式粒子；`particle/*` 的路径要逐个对照游戏文件，集中在一批里核对 |
| 6 | 物品与平面道具 | 020 023 024 025 027 028 029 031 032 057 072 | 11 | P2（只 032） | 共用物品句柄、地图和书的贴图 |
| 7 | 文字 | 069 070 071 073 074 075 076 077 078 079 089 | 11 | P5（只 073） | 只靠字体，创作者用得最多的一类 |
| 8 | 频道包装 | 080 081 082 083 084 085 087 088 090 097 100 | 11 | P2（只 080） | 组合前面几批的做法；合规上要注意的最多，等 5.1 的决定 |
| 9 | 模型 | 009 021 030 086 098 099 | 6 | P1 P4 | 全是难度 L 或依赖模型库，数量少但工作量和别的批相当 |

合计 94。批号只是名字，和总表“批”一栏对应。**建议的执行顺序是 0 → 1 → 3 → 4 → 2 → 7 → 5 → 6 → 8 → 9**：先做价值最明确、风险最低的抬头显示；接着做两批不依赖任何新能力的（方块、着色器）；然后是用得上第 1 批布局代码的容器和菜单；文字、粒子、物品随后；合规顾虑最多的频道包装和依赖模型库的放最后。第 0 批必须先完成并合入，之后的批次只要前置满足就可以调换。

### 4.2 每批碰哪些文件

一个批次只写这些地方，其余一律不碰：

| 位置 | 内容 |
|---|---|
| `packages/templates/<名字>/` | 本批每个模板的 `manifest.json`、`src/`、可选的 `README.md`。`package.json` 和 `tsconfig.json` 第 0 批已经建好，不用改 |
| `tests/fixtures/baselines/allay.builtin.<名字>/` | 本批模板的基准图 |
| `tests/unit/T-TPL-C<编号>.<名字>.test.ts` | 本批模板自己的验收测试，一个模板一个文件 |
| `docs/templates/<名字>.md` | 本批每个模板的文档 |
| `docs/templates/batch-<批号>.md` | 本批的决定、偏差、没验证的（代替直接改 `docs/decisions.md`） |

**不碰的**：`packages/templates/_lib/`（要改就告诉主控，由主控改）、别的批次的模板目录、现有六个模板、`docs/04-templates.md`、`docs/decisions.md`、`pnpm-lock.yaml`、任何测试的公共文件、`apps/`、`packages/engine`、`packages/template-sdk`、`packages/assets`。另一个会话正在改的 `apps/desktop/src/renderer/features/animation` 和 `packages/optional/code-editor` 更不能碰。

1.9 里“现有模板的增强”不属于任何批次，等 100 个做完后单独排。

### 4.3 公共文件怎么改才不冲突（第 0 批做）

查到的现状和对应的改法：

| 公共文件 | 现状 | 第 0 批怎么改 | 之后各批还要不要碰 |
|---|---|---|---|
| 模板注册 | 没有注册表：`scripts/build-templates.ts` 扫描 `packages/templates/` 下有 `manifest.json` 的目录 | 只加“跳过 `_` 开头的目录”和 P1 的导入规则 | 不用 |
| `pnpm-lock.yaml`、`pnpm-workspace.yaml` | `packages/templates/*` 每个目录是一个 workspace 包，新加一个模板就要在锁文件里加一段 | 一次建好 94 个目录的骨架：`package.json`、`tsconfig.json`、一个只有 `export {}` 的 `src/index.ts`，然后更新一次锁文件。没有 `manifest.json` 的目录构建脚本本来就会跳过。`_lib` 自己也是一个 workspace 包（它要解析到 template-sdk 的类型），`pnpm-workspace.yaml` 不用改 | 不用。批次只是往已有目录里加 `manifest.json`、换掉 `src/index.ts` |
| `tests/unit/template-dev.test.ts:274` | `expect(builtins).toHaveLength(6)` | 改成和 `templateDirs().length` 比 | 不用 |
| `tests/unit/T-DEV-3.template-api.test.ts:102` | `index.ts` 的个数写死 6 | 改成“有 `manifest.json` 的目录数” | 不用 |
| `tests/engine/templates.spec.ts`（T-TPL-3、4、5） | 遍历全部内置模板，超时按 6 个定的（600 秒、1800 秒；软件渲染慢二三十倍） | 加分片：`ALLAY_TPL_SHARD="i/n"` 只跑第 i / n 份，`ALLAY_TPL_ONLY="名字,名字"` 只跑指定模板（`tests/engine/shard.ts`）。**不减少每个模板的检查量**。CI（`.github/workflows/ci.yml`）分 8 份（2026-11-22 起，原来 4 份；每份不多于 5 个模板）：第 1 份随 `pnpm check` 在 `check` 作业里跑，第 2–8 份在 `templates` 作业里并行跑（`pnpm test:engine:templates`）。模板多到某一份接近超时的时候加份数，三处一起改，有单元测试核对 | 不用 |
| `tests/e2e/export.spec.ts` | 写死的六个 id 各导出一次 1080p60 | 不扩到 100 个。标题改成“代表性模板”，名单不动 | 不用 |
| `tests/fixtures/baselines/` | 每个模板一个目录；`ASSETS_PROVENANCE.json` 已经用 `tests/fixtures/baselines/**` 覆盖 | 不用改 | 各批只加自己的目录 |
| `scripts/gen-template-baselines.ts` | 原来只能全部重新生成 | `pnpm templates:baselines <名字…>` 只重新生成指定模板的基准图，免得一个批次动别人的 | 不用 |
| `eslint.config.js` | `deps/templates` 规则只允许类型导入 template-sdk；相对路径原来一律放行（“只能导入本目录”靠的是约定） | 加一条：往上两层的相对导入只能去 `_lib`。构建脚本按解析后的路径再拦一次 | 不用 |
| `packages/assets/data/*.json` | 112 个方块、42 个物品 | P2：一次加完 | 不用 |
| `packages/assets/src/sounds.ts` 的 `SOUND_EVENTS` | 原来“下载原版资源时一并取回”的就是这张 11 个事件的表，`tests/unit/M6b.audio.test.ts` 要求内置模板的默认音效都在表里 | 主控决定（2026-11-20）：一并取回的清单改成“基础表 ∪ 全部内置模板 manifest 里 `sound` 参数的默认值和自带预设里的音效值”，运行时从 manifest 推出来（`apps/desktop/src/shared/template-sounds.ts`），不提交生成文件。测试改成：默认音效是带命名空间的合法事件 ID 且在清单里。基础表不用再加 | 不用。批次只在自己的 manifest 里写默认音效 |
| `packages/template-sdk`、`packages/engine`、`pnpm templates:api` 的产物 | — | P3（以及赶得上的 P5、P6）；重新生成 `template-api.d.ts` 和 `docs/template-authoring.md` | 不用 |
| `scripts/template-api/three-surface.d.ts`（`ctx.THREE` 的类型面） | 手写的最小类型面，内置模板的源码按它做类型检查（T-DEV-3）；没列的 three 成员运行时有、但类型检查过不了 | 2026-11-20 补了自建几何体和实例化要用的成员（`BufferAttribute`、`InstancedBufferAttribute`、`setAttribute`、`setIndex`、`InstancedMesh` 等）。还缺什么告诉主控，改完要重新生成 `pnpm templates:api` 的产物 | 不用（由主控改） |
| `docs/04-templates.md` | 4.10 只写了六个 | 4.9 改一句（`_lib`）；4.10 末尾加一句“其余模板见 `docs/templates/` 和本文” | 不用 |
| `docs/decisions.md` | 所有会话都往里写 | 加一节说明模板批次的记录放在 `docs/templates/batch-<批号>.md` | 不用 |
| 本文 | — | — | 批次不改。完成情况由主控在验收后更新 |
| 模板库界面（`GalleryPanel.tsx`） | 只有“转场 / 叠加”两个标签加搜索 | 按 `tags` 加一层分组筛选，补“标题”标签。这是界面改动，和第 0 批分开，单独一个会话 | 不用 |
| `apps/website` | 写死了几个模板名 | 不动 | 不用 |

**第 0 批的结论（2026-11-19）**：骨架方案走得通，已经照做。只有 `package.json`、`tsconfig.json` 和占位 `src/index.ts`、没有 `manifest.json` 的目录能过 `pnpm typecheck` 和 lint，构建脚本和所有按目录遍历的测试都跳过它们；94 个骨架目录已建好，锁文件更新了一次。`_lib` 没有按原计划“不带 `package.json`”来做：它的源码要解析到 template-sdk 的类型，所以也做成了一个 workspace 包（`@allay/template-lib`），workspace 的通配因此不需要排除它。细节和没验证的部分见 `docs/templates/batch-0.md`。

各批次因此不需要碰锁文件：实现一个模板就是在已有的目录里加 `manifest.json`、换掉占位的 `src/index.ts`。骨架的 `package.json` 里 `description` 写的是目录的编号和中文名，改名时一起改。

### 4.4 同一个目录里并行的注意事项

用户要求直接在仓库根目录改、不用 worktree，所以：

- `pnpm templates:build` 会先清空 `resources/templates/` 再重建，两个会话同时跑会互相打断。同一时间只让一个会话跑构建和基准图生成，其余的只做类型检查和针对性的单元测试。
- 批次自己不运行 `pnpm install`；缺依赖时告诉主控。
- 提交时只 `git add` 自己那几个路径，不用 `git add -A`；不暂存、不重置、不切分支。
- 完整的 `pnpm check` 以 GitHub Actions 为准（`AGENTS.md`“CI 与发布”）。
- 建议同时最多两个批次在跑，并且两个批次的技术不同（例如一个界面、一个着色器），这样对 `_lib` 的改动要求不会撞在一起。

## 5. 风险和需要用户决定的事

### 5.1 合规

| 事项 | 风险 | 本文的默认做法 | 要用户决定的 |
|---|---|---|---|
| 视频平台的标志和图形 | 订阅按钮的红色播放键、铃铛图标、拇指图标是别家的商标或界面设计 | 080、081、084 不带任何平台图形；用游戏的按钮、钟、心代替；账号图标由用户自己提供图片；模板名和参数标签里不出现平台的名字 | 是否接受“订阅”“点赞”这两个通用词出现在默认文字里（本文默认接受） |
| Minecraft 和 Mojang 的标志 | 标志贴图在用户的游戏文件里，画出来的是用户的视频内容；但做成“一键带官方标志的片头”更容易让视频看起来像官方的。现有的 loading-screen `javaSplash` 已经在画 Mojang Studios 的标志 | 035、036 默认不显示 `gui/title/minecraft`，标题位置放用户自己的文字或图片 | 是否提供“显示游戏标志”的开关；已有的 `javaSplash` 要不要照这个口径调整。**用户 2026-11-19 决定**：模板可以像应用其他地方一样用原版素材，所以 035、036 可以提供“显示游戏标志”的开关（用 `gui/title/minecraft` 等原版贴图），默认关闭、显示用户自己的文字或图片；`javaSplash` 不用改 |
| 游戏模型的部件数据 | P4 的部件尺寸和贴图坐标是照游戏的模型凭记忆写的，算不算“Mojang 的模型”有含糊之处（`09` 9.2 的“素材”包括模型） | 照悦灵模型的先例做（`decisions.md` M5a，用户决定），数据是自己写的，不复制游戏的模型文件 | 这个先例是否适用于其他生物和玩家模型。**用户 2026-11-19 决定**：适用。第 9 批的模型类模板照常做，部件数据自己写，不复制游戏的模型文件 |
| 界面版式的数值 | 界面类模板的坐标、颜色、刻数来自对反编译代码的记忆 | 只写数值，不引用代码；每条在模板文档里标出处的可靠程度（同 `04` 的 T4、T6） | 无新的决定，沿用 2026-11 反馈时的批准 |
| 玩家皮肤 | 按玩家名联网取皮肤会违反硬性规则 10 | 皮肤只用游戏文件里的默认皮肤，或用户自己导入的图片 | 无 |
| 唱片和音乐 | 053 的默认曲名如果写真实的曲目和作者，像是在替用户声明用了那首音乐 | 默认文字用占位的“曲名 - 作者” | 无 |
| “还原”的口径 | 本文的依据都没有对照过游戏 | 实现时逐条核对；核对不了的如实标注 | 是否要求每批至少由人在游戏里对照一次再算通过（建议要，工作量在用户这边） |

用户 2026-11-19 对本节的答复（经主控转达的原话）：“Yes, same as Allay and you are allowed to use Vanilla Minecraft assets like other places.” 主控的解读写在上表对应的两行里。原版素材仍然只在运行时取自用户下载的游戏文件，仓库和安装包里不放任何 Mojang 文件（硬性规则 1 不变）。表里其余要用户决定的事项，以及 5.2 和“每批是否要人在游戏里对照”，用户还没有答复，继续按默认做法。

### 5.2 没有原版素材时的体验

- 现状：内置层是空的，没有原版素材和资源包时所有贴图都是品红黑格的占位图。100 个模板里只有约 20 个（着色器类、纯文字类）在这种情况下还能看。
- 影响：新用户第一次打开，模板库里是一百张占位图的封面。
- 建议的做法（要用户决定）：
  1. 没有任何素材层时，模板库不生成封面，改成一句引导和“添加素材”按钮（音效选择器已经是这样做的）。
  2. manifest 加一个可选字段声明“需要原版素材”，模板卡片上标出来，缺素材时排到后面。这要改 manifest 的格式，是第 3 节之外的又一项改动。
  3. 什么都不做，接受占位图。
- 素材版本：界面类模板用的是 1.20.2 之后的贴图路径。用户的原版基底更旧时，P3 落地之前这些模板会缺图。应用默认下载的是最新正式版，所以多数用户不受影响；要不要在模板卡片上提示“需要 1.20.2 或更新的原版素材”，由用户决定。

### 5.3 安装包和仓库体积

- 安装包：一个模板打包后是几十 KB 的 JS 加 manifest，100 个估计 2–4 MB（**估的，没有量过**）。模板不带任何图片（硬性规则 1），所以不会更大。
- 仓库：基准图现在六个模板共 598 KB（每个模板 15 张）。按这个比例 100 个约 10 MB。可以接受；如果介意，可以把基准图的分辨率或张数降下来，但那是在动验收条件，要用户同意。
- 骨架目录：4.3 的做法会一次提交 94 个只有三个小文件的目录。

### 5.4 启动和模板库的性能

- 封面：`covers.ts` 给每个模板渲染一张封面和一份悬停预览（320 × 180、30 fps、最多 120 帧），资源栈一变就全部重建。100 个模板是最多 12000 帧，而且是在一个杂务 Worker 里排队做。文件里有一个 8 MB 的磁盘上限（`MAX_DISK_BYTES`），**没有核实它限制的是单个文件还是总量**；如果是总量，100 个模板会超。
- 建议：封面只给滚动到可见范围里的模板生成；悬停预览等到鼠标真的停上去再生成；按模板的内容哈希缓存，资源栈变了也只重建用到了变动贴图的那些。这些是界面和缓存的改动，放在模板库界面那个会话里，不放进模板批次。
- 启动：内置模板从 `resources/templates/` 读，现在是六个包。100 个时要确认启动只读 manifest、不解析代码，模板列表有没有虚拟滚动。没有量过。
- 模板库的可找性：一百个模板只靠“转场 / 叠加”两个标签和搜索不够用，要按 `tags` 分组（4.3 最后一行）。
- CI 时间：`T-TPL-3`、`T-TPL-4`、`T-TPL-5` 的工作量随模板数线性增长，从 6 个到 100 个是 17 倍左右；CI 是软件渲染。不分片的话会远超现在的超时。4.3 的分片是必须做的，不是优化。要用户知道的是：CI 的总时长和并行作业数会明显增加。

### 5.5 没有把握的地方

- **“依据”一栏的全部数值**：没有联网，也没有对照游戏文件。贴图路径（尤其是 `particle/*` 和 1.21 之后新增的 `tooltip/*`、`toast/now_playing`、`map/decorations/*`）、界面坐标、刻数，都可能有错。
- **每个模板是否真的在 8 ms 预算内**：012（地形）、022（上百个掉落物）、096（烟花）、098（蝙蝠群）没有量过，只是按实例数估的。
- **转场在剪辑点完全不透明**：016、065、098 这类靠“堆满”来盖住画面的，都要垫底才能保证，画面效果会比想象的差一点；做的时候可能要调整设计。
- **A 组里的 015（幽匿蔓延）和 066（烧穿）**与 pixel-dissolve 的“径向阈值”在机制上相近，区别在边缘的画法和粒子。如果主控认为不够“实质区别”，可以降成 pixel-dissolve 的预设，再从 1.9 里提一个上来。
- **047（熔炼）和 046（合成）、088（投票条）和 039（Boss 栏）**共用贴图和版式，区别在动画和用途。同上，是可以商量的边界。
- **`title` 类别**：`04` 里有这个类别，但模板库的标签只有转场和叠加，现有模板里也没有一个是 `title`。8 个标题类模板会是第一批用它的，可能会碰到没人走过的路径。
- **4.3 的骨架方案**没有试过（任务要求不运行构建和测试）。
- **用户对“专业、不要默认味”的要求**落到模板上是什么标准，历史记录里只有对界面的反馈，没有对模板画面的。建议第 1 批做完后先让用户看一次，再继续后面的批次。
