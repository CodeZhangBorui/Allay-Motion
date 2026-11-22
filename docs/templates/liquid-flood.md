# 010 液体淹没 `allay.builtin.liquid-flood`

转场。水（或岩浆）带着起伏的水面从一边涨满画面，水下越深越暗，气泡往上冒；剪辑点时整个画面在水下；退出时水位退回去，或者继续流走、后面露出下一段画面。

## 1. 画面与动画

- **水位**：进入阶段水面从来水那一边（`source`）以外按 `easing` 推到对边以外（`layout.ts` 的 `levelRange` / `levelAt`，起伏和余量都算进去），首帧连浪尖都在画外，剪辑点时整个画面在水下。
- **水面**：四个往两边走的正弦叠起来（波数固定、速度和相位随机），高度 `waveHeight`；水面和水位都按贴图的像素格（`blockSize / 16`）吸附，是方的台阶。最上两行像素是亮的浪尖，第三行暗一点，水线清楚。
- **水下**：越往下越接近 `depthColor`（按离水面的距离指数地变暗，约 0.42 个画面短边变暗六成）。水的贴图（`block/water_still`；从上面、两侧灌进来时用流动的 `water_flow`，都带动画，引擎按 `t` 换帧）是灰度的，乘上 `waterColor`，越深贴图越淡、越接近底色。水本来是半透明的（贴图 alpha 180），下面垫着这层随深度变暗的底色，所以剪辑点时画面不透明，又不是一块平的色板。贴着水面的几格里有几道斜着、慢慢移动的淡光（游戏里没有，给水下的感觉）。
- **水下视野**：水面快到对边时，叠一层很淡的游戏水下视野贴图（`misc/underwater`，0.15），慢慢漂移；水面一离开就淡出。
- **气泡**（`bubbles`，`particle/bubble`）：在进入、退出阶段里随机出生，从画面下面七成的地方往上浮，越浮越快一点、左右轻轻摆，按像素吸附；只在水面以下显示，中心一浮出水面就没了。每颗的出生和寿命都收在时间窗里（`_lib/shader-particles.ts` 的 `fitLife`）。
- **岩浆**（`liquid = lava`）：贴图换成 `lava_still` / `lava_flow`（不透明），颜色固定（橙到暗红），不叠水下视野、没有气泡；从下面涨上来时液面上蹦出小火点（`particle/lava`，按液面在出生那一刻的位置算好起点，抛物线蹦起再落下）。
- **退出**：`drain` 时水位按同一条路退回来水那一边；`through` 时水面已经出了画面，来水那一边追上来第二个水面（另一组起伏），它后面露出下一段画面，像水整体流走。
- **没有原版素材**：水是底色加几道慢慢移动的浅色横纹（按噪声），气泡画成圆圈，岩浆是两色按噪声起伏；其余不变。
- 绘制调用 2 次（全屏着色器、气泡一批；岩浆时是火点一批）。没有自建贴图。

## 2. 参数表

| 参数 | 类型 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `liquid` | enum | `water` | `water`（水）、`lava`（岩浆） | 液体 |
| `waterColor` | color | `#3F76E4` | — | 水色：水的贴图是灰度的，乘上生物群系的水色；默认是平原的水色（`liquid = water` 时显示） |
| `depthColor` | color | `#0B1F57` | — | 深处的颜色（`liquid = water` 时显示） |
| `blockSize` | number | 120 | 40–360 px | 一格水的贴图的边长；水面按它的像素走成台阶 |
| `waveHeight` | number | 0.45 | 0–1 | 波浪高度 |
| `bubbles` | integer | 45 | 0–160 | 气泡的数量；岩浆时是蹦出液面的火点（只在从下面涨上来时有） |
| `seed` | seed | 1 | — | 随机种子 |
| `source` | enum（图案小格） | `bottom` | `bottom`、`top`、`left`、`right` | 从哪边来：从下面是静水涨上来；从上面、两侧是流动的水灌进来 |
| `outMode` | enum | `drain` | `drain`（水位退回去）、`through`（继续流走） | 退出方式 |
| `inDuration` / `hold` / `outDuration` | duration | 0.9 / 0.2 / 0.8 | 0.2–4 / 0–3 / 0.2–4 | 涨、停留、退 |
| `easing` | easing | `quadInOut` | — | 缓动 |
| `fillSound` | sound | `minecraft:item.bucket.empty` | 可为空 | 开始涨时播放；保持默认时岩浆自动换成倒岩浆桶的声音 |
| `drainSound` | sound | `minecraft:item.bucket.fill` | 可为空 | 开始退时播放；保持默认时岩浆自动换成装岩浆的声音 |
| `volume` | number | 0.7 | 0–1 | 音量 |

自带预设：岩浆（波浪矮一点、1.1 / 1 秒）；沼泽水色（`#617B64`、深处 `#232317`）；暖水海洋（`#43D5EE`、深处 `#041F33`、70 个气泡）；从侧面灌进来、继续流走（左边、`through`、波浪高 0.7）。

## 3. 依据表

| 数值 | 来自 | 可靠程度 |
|---|---|---|
| 水的贴图是灰度的（亮度 165–255），alpha 一律 180；岩浆的贴图不透明 | `block/water_still`、`water_flow`、`lava_still` 的像素 | 对照过游戏文件（26.2，打印过统计） |
| 平原的水色 `#3F76E4`，沼泽 `#617B64`（水雾 `#232317`），暖水海洋 `#43D5EE`（水雾 `#041F33`） | `data/minecraft/worldgen/biome/*.json` 的 `water_color`、`water_fog_color` | 对照过游戏文件（26.2、1.20.1 都一样；26.2 的水雾颜色挪进了 `attributes` 的 `minecraft:visual/water_fog_color`） |
| 默认的深处颜色 `#0B1F57` | — | 自己定的：比平原的水雾色 `#050533` 亮一点，深处还看得出是水 |
| 水下视野贴图 `misc/underwater` 是 16 × 16 的蓝色，alpha 135–146 | 贴图像素 | 对照过游戏文件（26.2） |
| 水面的起伏、变暗的快慢、浪尖的两行亮像素、水下的斜光、气泡的速度 | — | 自己定的（游戏里方块的水面是平的） |
| 音效存在；倒水、装水桶的声音各有水和岩浆两种 | `sounds.json` | 对照过游戏文件 |

## 4. 素材核对

对照的游戏版本：Java 版 26.2、1.21.11、1.21.1、1.20.1（客户端 jar 的文件清单、贴图尺寸和 `.mcmeta`，资源索引 32、29、17、5 的 `sounds.json`）。

| 素材 | 26.2 | 1.21.11 | 1.21.1 | 1.20.1 | 没有时 |
|---|---|---|---|---|---|
| `minecraft:block/water_still` | 16×512，32 帧，frametime 2 | 同 | 同 | 同 | 底色加程序画的横纹 |
| `minecraft:block/water_flow` | 32×1024，32 帧，frametime 1 | 同 | 同 | 同 | 同上 |
| `minecraft:block/lava_still` | 16×320，38 帧的顺序表，frametime 2 | 同 | 同 | 同 | 两色按噪声起伏 |
| `minecraft:block/lava_flow` | 32×512，16 帧，frametime 3 | 同 | 同 | 同 | 同上 |
| `minecraft:misc/underwater` | 16×16 | 同 | 同 | 同 | 不叠 |
| `minecraft:particle/bubble` | 8×8 | 同 | 同 | 同 | 程序画的圆圈 |
| `minecraft:particle/lava` | 8×8 | 同 | 同 | 同 | 程序画的方块（黄 → 橙） |
| `minecraft:item.bucket.empty` | 4 个文件 41 KB | 41 KB | 40 KB | 40 KB | — |
| `minecraft:item.bucket.fill` | 3 个文件 29 KB | 29 KB | 31 KB | 31 KB | — |
| `minecraft:item.bucket.empty_lava` | 3 个文件 34 KB | 34 KB | 36 KB | 36 KB | — |
| `minecraft:item.bucket.fill_lava` | 3 个文件 28 KB | 28 KB | 27 KB | 27 KB | — |

- 贴图一律用可选贴图（缺失时不记警告）。
- 带动画的贴图在自定义着色器里取当前帧：引擎每个子帧在 `update(t)` 之前改好贴图的 `offset` / `repeat`，着色器的 uniform 直接引用这两个 `Vector2`（只读），见 `docs/templates/batch-4.md`。

## 5. 没做的

- 目录写的 `ambient.underwater.enter`：没用。它有 3 个文件 73 KB（26.2），而且是“头没进水里”的闷声，放在涨水的开头不如倒水桶的声音合拍；想要可以在 `fillSound` 里选。
- 目录的 `tint` 拆成了 `waterColor`、`depthColor` 两个；`direction`（涨 / 落 / 侧向灌入）做成 `source`（四个方向）加 `outMode`。
- 水面折射、扭曲底下的画面：模板拿不到底下的视频（目录 3.3）。
- 游戏里流动的水按方向旋转贴图（`water_flow` 斜着流）：这里贴图不转，只按来水方向选用静水还是流动的那张。

## 6. 没验证的

- 用评审截图工具（`pnpm review:templates`）在 26.2、1.21.1、1.20.1 的原版素材下和没有素材时截了默认参数和全部自带预设（16:9），看过联络图，没有警告、没有出错（`docs/templates/batch-4.md`“评审截图”）。9:16、1:1 只在引擎测试和基准图（假资源栈）里看过；截图不带运动模糊。 从上面、右边来没有预设，只在测试里跑过。
- 没在剪辑软件里看过导出结果。
- 引擎测试 T-TPL-3、4、5 在本机真实显卡上通过（见 `docs/templates/batch-4.md`）。
