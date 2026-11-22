# 017 传送门穿越 `allay.builtin.portal-gate`

转场。黑曜石一块块垒成 4 × 5 的门框，打火石一点，下界传送门从下往上亮起，镜头被吸着推进去，传送门铺满画面；退出时像穿过去一样，传送门碎成小块、从中间往四周朝镜头散开，带着紫色的粒子。

和 loading-screen 里的传送门背景不同：这里是搭门、点火、穿过。门框尺寸、点火的方式、传送门的贴图和声音照游戏；**推镜头、碎开散去是这个模板设计的**。

## 1. 画面与动画

- 门框（`layout.ts` 的 `frameCells`）：最小的下界传送门框，外框 4 × 5、里面 2 × 3，连四个角共 14 块（游戏里角可以不放，这里放上）。格子边长 = min(画面高 × 0.66 / 5, 画面宽 × 0.8 / 4)。
- 进入阶段里各步（`inSchedule`）：搭框在 [0, 点火 − 5%]，点火在 `igniteAt`（0.3–0.8，默认 0.55），传送门在接下来的 7% 里亮起，之后推镜头到阶段末。
  - 搭框：按 `buildOrder` 一块块弹出来落位（同 mining-crack 的放置）。`bottomUp` 像玩家搭门框：先铺底下一排、两边的柱子交替往上、最后封顶；`clockwise` 从左下角绕一圈；`random` 随机。
  - 点火：门框底边中间冒一下火（`block/fire_0`，带动画，0.2 秒长出来再缩回去）。
  - 亮起：传送门从下往上一排排出现（游戏里是一下子出现的，这里用 0.07 个阶段从下往上亮）。
  - 推镜头：相机沿视线推近（三次缓入，越推越快），停在传送门（2 × 3 格）正好铺满画面的距离（`coverDistance`，宽高都只用到 97%）。
- 传送门：里面 2 × 3 格，每格切成 4 × 4 块碎片（共 96 块，一次绘制，`_lib/block-tiles`），每块取所在那一格贴图里对应的 1/4 × 1/4；贴图是半透明的、带动画（引擎按时间播放），可以用 `portalTint` 染色。每块碎片后面垫一块不透明的深紫色（`backing`），剪辑点因此不透明。
- 停留：镜头停在传送门跟前，只有传送门在动（贴图动画）。
- 穿过（退出）：碎片从中间往外先后散开（离中心越远越晚），越飞越快，往外的同时朝镜头冲过去（透视下很快出画），自己转一点。同时 140 个紫色粒子（`particle/generic_3`、`5`、`7`，染紫）从传送门面上朝镜头、往四周飞散。门框在退出阶段藏起来（它本来就在画外，可碎片散开后会从洞里看到门框朝里的那几面）。
- 首末帧全透明、剪辑点前后各一帧铺满：`_lib/timing.ts` 的 `transitionWindows`。

## 2. 参数表

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `frame` | block | `minecraft:obsidian` | 方块目录里的方块 |
| `portalTint` | color | `#FFFFFF` | 乘在传送门贴图上；白色是游戏里的样子 |
| `backing` | color | `#22083D` | 传送门后面的颜色 |
| `buildOrder` | enum（图案） | `bottomUp` | `bottomUp` `clockwise` `random` |
| `igniteAt` | number | 0.55 | 0.3–0.8 |
| `inDuration` / `hold` / `outDuration` | duration | 1.6 / 0.15 / 0.6 | 0.6–4 / 0–2 / 0.25–2 |
| `placeSound` | sound | `minecraft:block.stone.place` | 每块门框（最多 12 个，按时刻均匀抽样） |
| `igniteSound` | sound | `minecraft:item.flintandsteel.use` | 点火时 |
| `portalSound` | sound | `minecraft:block.portal.trigger` | 开始被吸进去时 |
| `travelSound` | sound | 无 | 穿过去时；游戏里传送完成的声音是 `block.portal.travel`（预设里有） |
| `volume` | number | 0.7 | 0–1 |
| `seed` | seed | 1 | — |

自带预设：快速穿越（各段时间缩短）、哭泣的黑曜石（绕一圈搭）、带传送完成的声音（`block.portal.travel`）。

## 3. 依据表

| 数值 | 来自 | 可靠程度 |
|---|---|---|
| 下界传送门框最小 4 × 5（里面 2 × 3）、最大 23 × 23，角可以不放 | — | 经搜索确认：minecraft.wiki/w/Nether_Portal |
| 用打火石等点火，点着后传送门一下子出现 | — | 经搜索确认：minecraft.wiki/w/Nether_Portal（这里改成从下往上亮，见第 5 节） |
| 传送门贴图 16 × 512，`.mcmeta` 的 `animation` 为空（32 帧、每帧 1 刻） | `block/nether_portal` | 对照过游戏文件（26.3、26.2、1.21.1、1.20.1） |
| 传送门贴图半透明（像素 alpha 约 185–193） | 同上 | 对照过游戏文件（26.3，只统计） |
| 站进传送门时 `block.portal.trigger`、传送后 `block.portal.travel`、打火石 `item.flintandsteel.use` | — | 经搜索确认：minecraft.wiki/w/Nether_Portal#Sounds、/w/Flint_and_Steel#Sounds |
| 火的贴图 `block/fire_0` 16 × 512、带 `frames` 动画 | — | 对照过游戏文件 |
| 推镜头、碎片散开、粒子的数量和速度、门框的取景 | — | 自己设计的 |

## 4. 素材核对

对照的游戏版本：Java 版 26.3、26.2、1.21.1、1.20.1（客户端 jar 的文件清单、贴图尺寸和 `.mcmeta`，资源索引里的 `sounds.json`）。

| 素材 | 26.3 | 26.2 | 1.21.1 | 1.20.1 | 没有时 |
|---|---|---|---|---|---|
| `minecraft:block/nether_portal` | 有 | 有 | 有 | 有 | 占位图 + 警告 |
| `minecraft:block/fire_0` | 有 | 有 | 有 | 有 | 占位图 + 警告 |
| `minecraft:particle/generic_3`、`_5`、`_7`（可选贴图，8 × 8） | 有 | 有 | 有 | 有 | 不画粒子，不警告 |
| 门框方块（方块目录） | 有 | 有 | 有 | 有 | — |
| 音效 `block.stone.place`、`item.flintandsteel.use`、`block.portal.trigger`、预设里的 `block.portal.travel` | 有 | 有 | 有 | 有 | — |

- 体积（26.x / 1.21.1）：portal.trigger 49 / 24 KB，portal.travel 119 / 53 KB（所以默认不放），flintandsteel.use 6.9 / 6.3 KB，stone.place 29 / 26 KB。
- 没有原版素材时：门框、传送门、火都是占位图（传送门不透明），搭框、点火、推镜头、碎开都在；粒子不画。

## 5. 没做的

- 传送门点着时在游戏里是一下子出现的，这里改成在一小段时间里从下往上亮起（一下子出现在画面上像跳帧）。
- 穿过传送门在游戏里是一个紫色的扭曲效果加黑屏，这里画不出来（模板拿不到底下的画面），换成碎开散去。
- 门框的角块总是放上。

## 6. 没验证的

- 用评审截图工具 `pnpm review:templates`（应用本身，导出和封面用的同一条静帧路径）看过：26.2 的全部预设、三种画幅，1.21.1、1.20.1（`--mirror`）、没有素材的全部预设（16:9）。贴图的动画、半透明加垫底的颜色、碎开都对，三个版本一样；没有素材时门框、传送门是占位图，粒子不画。没有在剪辑软件里看过导出结果。
