# 038 标题命令 `allay.builtin.title-command`

叠加层，没有剪辑点。还原 `/title` 命令的三种文字：屏幕中央的标题和副标题、快捷栏上方的动作栏文字。

## 1. 画面与动画

- 布局按界面像素：一个界面像素 = `guiScale` 个设计单位，界面宽高 = 舞台宽高 / `guiScale`。
- 标题是界面像素的 4 倍大，上边在界面中心上方 40 个界面像素；副标题 2 倍大，上边在中心下方 10 个界面像素；都水平居中、带阴影。
- 动作栏文字 1 倍大，水平居中，上边在界面底边上方 72 个界面像素。
- 进入：标题和副标题在 `inDuration` 里线性淡入；停留 `hold`；退出：在 `outDuration` 里线性淡出。
- 动作栏文字有自己的寿命：从第一帧之后出现（不淡入），显示 `actionbarDuration`，最后 1 秒（20 刻）线性淡出。它不跟标题的三段时间走（游戏里也是这样）；超过模板时长的部分截掉。
- 某一行放不下（比两侧各留 4 个界面像素后的宽度还宽）时，这一行自己缩小。游戏里不缩，会出画。
- `textBackground` 打开时每行字后面有一块半透明黑底，向外各扩 2 个该行的像素。
- 首末帧全透明：时间窗首尾各让出一帧（`_lib/timing.ts` 的 `overlayWindows`）。

## 2. 参数表

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `style` | enum | `java` | 只有 `java`（Java 版 1.8 起） |
| `title` | text | “第 1 天” / “Day 1” | 最长 40 字，可为空 |
| `subtitle` | text | “生存开始” / “Survival begins” | 最长 60 字，可为空 |
| `actionbar` | text | 空 | 最长 80 字 |
| `titleColor` / `subtitleColor` / `actionbarColor` | color | `#FFFFFF` | 色板 `chat` |
| `titleFont` / `subtitleFont` / `actionbarFont` | font | `embedded:default`（普通模式），带阴影 | — |
| `textBackground` | boolean | false | — |
| `backgroundOpacity` | number | 0.5 | 0–1，`textBackground` 打开时显示 |
| `guiScale` | number | 4 | 1–8 |
| `inDuration` / `hold` / `outDuration` | duration | 0.5 / 3.5 / 1 | 0.05–5 / 0.1–20 / 0.05–5 |
| `actionbarDuration` | duration | 3 | 0.5–30 |
| `sound` | sound | 无 | 在开头播放 |
| `volume` | number | 0.8 | 0–1 |

自带预设：游戏默认时长、第 N 天、维度名、章节标题、只有动作栏提示。预设里的文字分中英文，套用时按界面语言取（`docs/04-templates.md` 4.7）。

## 3. 依据表

| 数值 | 来自 | 可靠程度 |
|---|---|---|
| 默认淡入 10 刻、停留 70 刻、淡出 20 刻 | `/title … times` 的默认值 | 经搜索确认：minecraft.wiki/w/Commands/title（“the default is 10 game ticks (0.5 seconds), 70 game ticks (3.5 seconds), and 20 game ticks (1 second)”） |
| 标题放大 4 倍、副标题 2 倍 | 游戏界面的标题绘制 | 凭记忆（Wiki 只写了“随界面缩放变化”） |
| 标题上边在中心上方 40、副标题在中心下方 10 个界面像素 | 标题画在 4 倍坐标系的 y = −10，副标题画在 2 倍坐标系的 y = 5 | 凭记忆 |
| 动作栏在快捷栏上方 | — | 经搜索确认：minecraft.wiki/w/Action_bar（“the space just above the player's hotbar”） |
| 动作栏文字上边在底边上方 72 个界面像素 | 以 (w / 2, h − 68) 为原点的 y = −4 | 凭记忆 |
| 动作栏显示 60 刻、最后 20 刻淡出 | 游戏界面的覆盖消息计时 | 凭记忆。**和 Wiki 有出入**：minecraft.wiki/w/Action_bar 写的是“大约 1.5 秒后淡出”，并标着“需要更多信息”。这里按记忆做成 3 秒，时长是参数，可以改 |
| 淡入淡出是线性的 | 不透明度 = 经过时间 / 淡入时长 | 凭记忆 |
| 三行字都带阴影 | — | 凭记忆 |
| 文本背景向外扩 2 像素、默认不透明度 50% | 辅助功能“文本背景”；默认 50% | 不透明度默认值经搜索确认（minecraft.wiki/w/Options）；外扩的像素数凭记忆 |
| 游戏里显示标题没有音效 | — | 凭记忆 |

## 4. 素材核对

对照的游戏版本：Java 版 26.3 和 1.21.1（本机 `versions/` 里的客户端 jar 的文件清单）。

| 素材 | 26.3 | 1.21.1 | 没有时 |
|---|---|---|---|
| 字体 `embedded:default`（普通模式）：ASCII 等用资源栈 `minecraft:default` 的位图字形（`assets/minecraft/font/default.json`），资源栈里没有的字形（中文等）用随应用内嵌的 GNU Unifont 18.0.01；预设“强制 Unicode 字体”用 `embedded:uniform`，全部用内嵌 Unifont | 有 | 有 | 没有原版素材时普通模式全部用内嵌 Unifont（字形和宽度与 Mojangles 不同），位置公式不变；按文字宽度定的尺寸用实际量出的宽度。模板不加载、不引用任何字体文件 |

不用任何贴图和音效文件。

## 5. 没做的

- 基岩版的标题：只查到基岩版的标题和动作栏有可调的黑色底板不透明度（minecraft.wiki/w/Commands/title），没查到版式数值，没有做。`textBackground` 是 Java 版辅助功能的那种底板，不是基岩版的。
- 一段文字里多种颜色、粗细（`/title` 的 JSON 文本组件）：文字接口还不支持（目录 P6），每行只有一种颜色和样式。
- 游戏里不透明度低于约 3% 时整行不画（避免几乎看不见的残影）。这里一直按线性画到 0。

## 6. 没验证的

- 没有在真实的原版字体上看过画面：测试和基准图用的是假资源栈，没有原版字体，文字全部是内嵌 Unifont 的字形，Mojangles 下的样子没看过。
- 没有和游戏的实际画面逐帧对照过。
- 没有在剪辑软件里看过导出结果。
