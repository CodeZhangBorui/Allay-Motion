# 052 状态效果 `allay.builtin.effect-icons`

叠加层，没有剪辑点。还原 Java 版抬头显示右上角的状态效果图标：一个个出现，其中一个可以快到期，闪烁后消失。

## 1. 画面与动画

- 布局按界面像素：一个界面像素 = `guiScale` 个设计单位，界面宽 = 舞台宽 / `guiScale`。
- 每个效果是一个 24 × 24 的框，里面是 18 × 18 的图标（在框里偏 3）。正面效果在第一排（上边 y = 1），负面和中性的在第二排（y = 27）。每排从屏幕右边往左排，第 k 个的左边在 界面宽 − 25 × k。
- 六个栏位 `effect1`–`effect6`，选了“无”的跳过。第一个效果从开头就在（跟着整体淡入），之后每隔 `interval` 出现下一个，直接出现、不带动画（和游戏一样）。排的先后就是栏位的先后。
- 进入、退出：整体线性淡入、淡出（游戏里没有这个动画）。
- `expiring` 选中的那个效果出现时只剩 `remaining` 秒。剩余 200 刻（10 秒）以内，它的图标（不含框）按公式变淡并闪烁：先降到一半，闪烁的幅度每 20 刻加大一档，最后 50 刻再往下降；到 0 时连框一起消失，同一排里在它左边的立刻补上来。
- `ambient` 打开时所有的框换成信标给的效果那种。这种效果在游戏里不闪；这里也不让它到期（`expiring` 不起作用）。
- `anchor` 选左上时是右上的镜像。
- 放不下时整体缩小：一排的个数 × 25 + 1 超过界面宽时缩。默认缩放 6 下三种画幅都放得下六个。
- 六个都选“无”时什么都不画。同一个效果选了两次就画两个（游戏里不会有两个相同的效果，这里不拦）。
- 首末帧全透明：时间窗首尾各让出一帧（`_lib/timing.ts` 的 `overlayWindows`）。

## 2. 参数表

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `style` | enum | `java` | 只有 `java`（Java 版抬头显示） |
| `effect1`–`effect6` | enum | `speed`、`regeneration`、`strength`、`poison`、`none`、`none` | `none` 加 37 种效果（见下） |
| `ambient` | boolean | false | 信标的框 |
| `expiring` | enum | `3` | `none`、`1`–`6`；`ambient` 关着时显示 |
| `remaining` | duration | 5 | 0.5–30；`expiring` 不是 `none` 时显示 |
| `anchor` | enum | `topRight` | `topRight`、`topLeft` |
| `guiScale` | number | 6 | 1–10 |
| `inDuration` / `hold` / `outDuration` | duration | 0.25 / 6 / 0.25 | 0.05–3 / 0.1–20 / 0.05–3 |
| `interval` | duration | 0.4 | 0–3 |
| `sound` | sound | 无 | 每个效果出现时播放 |
| `volume` | number | 0.8 | 0–1 |

效果的选项和分排（分类凭记忆）：

- 第一排（正面）：speed 迅捷、haste 急迫、strength 力量、jump_boost 跳跃提升、regeneration 生命恢复、resistance 抗性提升、fire_resistance 抗火、water_breathing 水下呼吸、invisibility 隐身、night_vision 夜视、health_boost 生命提升、absorption 伤害吸收、saturation 饱和、luck 幸运、slow_falling 缓降、conduit_power 潮涌能量、dolphins_grace 海豚的恩惠、hero_of_the_village 村庄英雄。
- 第二排（负面和中性）：slowness 缓慢、mining_fatigue 挖掘疲劳、nausea 反胃、blindness 失明、hunger 饥饿、weakness 虚弱、poison 中毒、wither 凋零、levitation 飘浮、unluck 霉运、darkness 黑暗、glowing 发光、bad_omen 不祥之兆；1.21 起：raid_omen 袭击之兆、trial_omen 试炼之兆、infested 寄生、oozing 渗浆、weaving 盘丝、wind_charged 蓄风。

中文名里只有迅捷、生命恢复、急迫、力量、夜视、抗火、中毒、凋零八个对照过游戏的语言文件；其余的中文名和全部英文名里没在那八个之内的，都是凭记忆写的官方译名，没有对照语言文件。

自带预设：信标增益、药水快到期、袭击前后、凋灵战、一身负面效果。

## 3. 依据表

| 数值 | 来自 | 可靠程度 |
|---|---|---|
| 图标在屏幕右上角；正面效果在第一排，负面在第二排，中性的在下排；从右往左排 | — | 经搜索确认（minecraft.wiki/w/Heads-up_display、minecraft.wiki/w/Effect） |
| 框 24 × 24、图标 18 × 18 | 贴图文件的尺寸 | 对照过游戏文件 |
| 第 k 个框的左边 = 界面宽 − 25 × k；两排的上边 y = 1 和 y = 27；图标在框里偏 3 | 游戏界面的状态效果绘制 | 凭记忆 |
| 快结束的会闪 | — | 经搜索确认（minecraft.wiki/w/Effect，没写阈值） |
| 剩余 d ≤ 200 刻时：m = 10 − ⌊d / 20⌋，不透明度 = clamp(d / 10 / 5 × 0.5, 0, 0.5) + cos(d × π / 5) × clamp(m / 10 × 0.25, 0, 0.25)；只作用在图标上 | 同上 | 凭记忆 |
| 信标给的效果是另一种框（蓝色边），不闪 | — | 框经搜索确认（minecraft.wiki/w/Effect）；“不闪”凭记忆 |
| 哪些效果算正面 | `layout.ts` 的表 | 凭记忆 |
| 游戏里是按剩余时间排先后 | — | 经搜索确认（minecraft.wiki/w/Heads-up_display）。这里没照做，按栏位的先后排（见第 5 节） |
| 瞬间治疗、瞬间伤害不显示图标 | 它们没有持续时间 | 凭记忆 |
| 游戏里图标出现没有声音 | — | 凭记忆 |
| 效果的图标名 | `mob_effect/<名字>` | 对照过游戏文件（见第 4 节） |
| 旧图集里框的位置 (141, 166)、信标的框 (165, 166)，24 × 24 | 1.19.2 的 `gui/container/inventory`，按像素比对 | 对照过游戏文件（1.19.2） |
| 没有图标贴图时色块的颜色 | 各效果的药水颜色 | 凭记忆，只当占位用 |

## 4. 素材核对

对照的游戏版本：Java 版 26.3、1.21.1、1.19.2（本机客户端 jar 的文件清单）。

| 素材 | 26.3 | 1.21.1 | 1.19.2 | 没有时 |
|---|---|---|---|---|
| `minecraft:gui/sprites/hud/effect_background`、`effect_background_ambient` | 有 | 有 | 没有 | 退回旧图集 `minecraft:gui/container/inventory` 的那一块；也没有时画 24 × 24 的纯色块（普通的深灰，信标的深蓝） |
| `minecraft:gui/container/inventory`（256 × 256 的图集） | 没查 | 没查 | 有 | 只在新路径没有时用 |
| `minecraft:mob_effect/<名字>`：列表里除 1.21 起的六个之外的 31 个 | 有 | 有 | 有 | 画 18 × 18 的纯色块，颜色是这个效果的占位色 |
| `minecraft:mob_effect/raid_omen`、`trial_omen`、`infested`、`oozing`、`weaving`、`wind_charged` | 有 | 有 | 没有 | 同上；选项的名字里标了“1.21 起” |

26.3 另有 `mob_effect/breath_of_the_nautilus`，没有列进选项（不确定它的中文名和分类）。

不用字体。`sound` 默认是空的：游戏里图标出现没有声音，理想的默认就是没有。

绘制调用（默认参数）：框 1 个批次，四种效果各 1 个批次，共 5 次。六个不同的效果时 7 次。没有图标贴图的效果合在一个纯色批次里。

## 5. 没做的

- 物品栏里带名字和剩余时间的面板（目录里写的 `showTimer`）没有做：面板的贴图在 1.21.1（`effect_background_large`、`_small`）和 26.3（`effect_background`、`_ambient`，九宫格）之间换过，版式数值也记不准。
- 基岩版的排法（从上到下）没有做。
- 游戏按剩余时间给图标排先后，这里按栏位的先后排；所以快到期的那个不一定在游戏里它该在的位置。
- 只有一个效果能到期；其余的一直在。到期的效果消失时游戏里没有动画，这里也没有。
- 目录里写的 `effects`（列表）拆成了六个枚举参数，`blinkAt` 换成了 `expiring` 加 `remaining`：闪烁在游戏里完全由剩余时间决定，给剩余时间比给一个时刻更直接。
- 瞬间治疗、瞬间伤害不在选项里（游戏里不显示图标）；26.3 的 breath_of_the_nautilus 不在选项里。
- 效果的等级、试玩版时第一排下移 15 没有做（抬头显示里本来也不显示等级）。

## 6. 没验证的

- 没有在真实的原版贴图上看过画面。引擎测试 T-TPL-3、T-TPL-4、T-TPL-5 在本机真实显卡上跑过，用的是假资源栈（每张贴图是一块 16 × 16 的纯色、没有 .mcmeta，文字走系统字体）；基准图也是这样生成的，看不出真实贴图和原版字体下的样子。
- 旧图集和纯色块两条退路没有实际渲染过。
- 没有和游戏的实际画面逐帧对照过；闪烁公式和坐标都是凭记忆。
- 除八个对照过的之外，效果的中英文名没有对照语言文件。
- 没有在剪辑软件里看过导出结果。
